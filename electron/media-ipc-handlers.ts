import { app, dialog, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import AdmZip from 'adm-zip'
import path from 'node:path'
import fs from 'node:fs'
import type { PlannerDatabase } from './database'
import { validateArgumentCount, validateId, validateMediaMode, validateProject } from './ipc-validation'
import { detectCsvBatchLayout, getCsvBatchIndexes, getCsvBatchTargetName } from './integrations/media-batch-layout'

type MediaIpcDependencies = {
  database: PlannerDatabase
  dataDirectory: string
  getMainWindow(): BrowserWindow | null
  handle(channel: string, callback: (args: unknown[], event: IpcMainInvokeEvent) => unknown): void
  withoutArguments(callback: () => unknown): (args: unknown[]) => unknown
  ensurePostMediaFolder(project: string, postId: string): string
  mapPost(row: Record<string, unknown>): Record<string, any>
}
export function safeMediaGroupName(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('El nombre de carpeta es obligatorio.')
  const name = value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').slice(0, 80)
  if (!name || name === '.' || name === '..') throw new TypeError('Nombre de carpeta no valido.')
  return name
}

export function validImageData(extension: string, data: Buffer) {
  if (extension === '.png') return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (extension === '.jpg' || extension === '.jpeg') return data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255
  if (extension === '.gif') return data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))
  if (extension === '.webp') return data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
  return false
}

export function registerMediaIpcHandlers({ database, dataDirectory, getMainWindow, handle, withoutArguments, ensurePostMediaFolder, mapPost }: MediaIpcDependencies) {
  type CsvBatchAssignment = { sourcePath: string; postId: string; project: string; code: string; name: string; targetName: string; isCover: boolean; title: string; columnHeader: string; referenceText: string }
  const pendingCsvImports = new Map<string, CsvBatchAssignment[]>()
  handle('media:preview-csv-batch', async args => {
    if (args.length) throw new TypeError('Argumento IPC no valido: media.previewCsvBatch')
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Ventana principal no disponible')
    const csvPick = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (csvPick.canceled || !csvPick.filePaths[0]) return null
    const folderPick = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    if (folderPick.canceled || !folderPick.filePaths[0]) return null
    const csvPath = csvPick.filePaths[0]
    const csvStat = fs.statSync(csvPath)
    if (csvStat.size > 20 * 1024 * 1024) throw new Error('El CSV supera el límite de 20 MB.')
    const parsedCsv = parseBatchCsv(fs.readFileSync(csvPath, 'utf8'))
    const records = parsedCsv.records
    if (!records.length) throw new Error('El CSV no contiene filas de publicaciones.')
    const headerKeys = parsedCsv.headers.map(key => key.trim().toLocaleLowerCase())
    if (new Set(headerKeys).size !== headerKeys.length) throw new Error('El CSV tiene encabezados duplicados; no es seguro identificar sus columnas.')
    const posts = database.list().map(row => mapPost(row))
    const postsById = new Map(posts.map(post => [String(post.id), post]))
    const normalizeHeader = (header: string) => header.trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const namedIdColumn = parsedCsv.headers.find(header => ['post.id', 'id de publicacion'].includes(normalizeHeader(header)))
    const matchingIdColumns = namedIdColumn ? [] : parsedCsv.headers.filter(header => records.every(record => postsById.has(String(record[header] || '').trim())))
    const idColumn = namedIdColumn || (matchingIdColumns.length === 1 ? matchingIdColumns[0] : undefined)
    if (!idColumn) {
      const headers = parsedCsv.headers.slice(0, 10).join(', ')
      throw new Error(`No se pudo identificar el ID de publicación en el CSV. Encabezados detectados: ${headers || '(ninguno)'}. Agrega el campo "ID de publicación" al perfil, guarda los cambios y descarga el CSV de nuevo.`)
    }
    const rowIds = new Set<string>()
    for (const record of records) {
      const id = String(record[idColumn] || '').trim()
      if (!id) throw new Error('Hay una fila sin ID de publicación en el CSV.')
      if (rowIds.has(id)) throw new Error(`El ID de publicación ${id} aparece más de una vez en el CSV.`)
      rowIds.add(id)
    }
    const files = fs.readdirSync(folderPick.filePaths[0], { withFileTypes: true }).filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.png')
    const codes = files.flatMap(file => {
      const codeMatches = [...file.name.matchAll(/R(\d{2,})-C(\d{2,})/gi)]
      if (codeMatches.length !== 1) return []
      const row = Number(codeMatches[0]![1])
      const column = Number(codeMatches[0]![2])
      return Number.isSafeInteger(row) && row >= 1 && Number.isSafeInteger(column) && column >= 1 ? [{ row, column }] : []
    })
    const layout = detectCsvBatchLayout(codes, records.length, parsedCsv.headers.length)
    const assignments: CsvBatchAssignment[] = []
    const unmatched: string[] = []
    const seenCodes = new Set<string>()
    const plannedTargets = new Set<string>()
    for (const file of files) {
      const filePath = path.join(folderPick.filePaths[0], file.name)
      if (!hasPngSignature(filePath)) { unmatched.push(`${file.name}: el archivo no contiene una imagen PNG válida`); continue }
      const codeMatches = [...file.name.matchAll(/R(\d{2,})-C(\d{2,})/gi)]
      if (codeMatches.length !== 1) { unmatched.push(`${file.name}: se esperaba exactamente un código R##-C##`); continue }
      const codeMatch = codeMatches[0]!
      const code = `R${codeMatch[1]}-C${codeMatch[2]}`.toUpperCase()
      if (seenCodes.has(code)) { unmatched.push(`${file.name}: código duplicado ${code}`); continue }
      seenCodes.add(code)
      const rowNumber = Number(codeMatch[1])
      const columnNumber = Number(codeMatch[2])
      if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || !Number.isSafeInteger(columnNumber) || columnNumber < 1) { unmatched.push(`${file.name}: el código contiene una fila o columna no válida`); continue }
      const { recordIndex, headerIndex } = getCsvBatchIndexes({ row: rowNumber, column: columnNumber }, layout)
      const record = records[recordIndex]
      if (!record) {
        unmatched.push(layout === 'posts-in-columns'
          ? `${file.name}: la publicación C${codeMatch[2]} no existe en el CSV`
          : `${file.name}: la fila ${codeMatch[1]} no existe en el CSV`)
        continue
      }
      const postId = String(record[idColumn] || '').trim()
      const post = postsById.get(postId)
      if (!post) { unmatched.push(`${file.name}: ID de publicación ausente o desconocido (${postId || 'vacío'})`); continue }
      if (post.status !== 'review') { unmatched.push(`${file.name}: ${post.title || post.id} ya no está “En revisión”`); continue }
      const columnHeader = parsedCsv.headers[headerIndex]
      if (!columnHeader) {
        unmatched.push(layout === 'posts-in-columns'
          ? `${file.name}: el campo R${codeMatch[1]} no existe en el CSV`
          : `${file.name}: la columna ${codeMatch[2]} no existe en el CSV`)
        continue
      }
      const project = String(post.project || '')
      const folder = ensurePostMediaFolder(project, postId)
      const destination = path.join(folder, file.name)
      const targetName = getCsvBatchTargetName(file.name, fs.existsSync(destination), fs.existsSync(path.join(folder, 'portada.png')))
      if (!targetName) { unmatched.push(`${file.name}: ya existe un archivo con ese nombre y también existe portada.png en la carpeta de destino`); continue }
      const plannedTargetKey = `${postId}:${targetName.name.toLocaleLowerCase()}`
      if (plannedTargets.has(plannedTargetKey)) { unmatched.push(`${file.name}: más de un archivo se asignaría a ${targetName.name} en la misma publicación`); continue }
      plannedTargets.add(plannedTargetKey)
      assignments.push({ sourcePath: filePath, postId, project, code, name: file.name, targetName: targetName.name, isCover: targetName.isCover, title: String(post.title || 'Publicación sin título'), columnHeader, referenceText: String(record[columnHeader] || '') })
    }
    const token = crypto.randomUUID()
    pendingCsvImports.set(token, assignments)
    const describe = ({ sourcePath: _sourcePath, ...item }: CsvBatchAssignment) => item
    return {
      token,
      csvName: path.basename(csvPath),
      folderName: path.basename(folderPick.filePaths[0]),
      layout,
      matches: assignments.filter(item => !item.isCover).map(describe),
      coverCandidates: assignments.filter(item => item.isCover).map(describe),
      unmatched,
    }
  })
  handle('media:apply-csv-batch', args => {
    if (args.length !== 2 || typeof args[0] !== 'string' || typeof args[1] !== 'boolean') throw new TypeError('Argumento IPC no valido: media.applyCsvBatch')
    const assignments = pendingCsvImports.get(args[0])
    if (!assignments) throw new Error('La vista previa caducó. Vuelve a elegir el CSV y la carpeta.')
    if (assignments.some(item => item.isCover) && !args[1]) throw new Error('Confirma que los archivos en conflicto son portadas antes de aplicar el lote.')
    pendingCsvImports.delete(args[0])
    const copied: string[] = []
    const grouped = new Map<string, Array<{ id: string; name: string; path: string; size: number; mode: string; kind: string }>>()
    const mediaAssets: Array<{ id: string; name: string; path: string; size: number; mode: string; kind: string }> = []
    try {
      for (const item of assignments) {
        if (!fs.existsSync(item.sourcePath)) throw new Error(`Ya no se encuentra ${item.name}.`)
        const post = database.getPost(item.postId)
        if (!post || String(post.status) !== 'review') throw new Error(`La publicación de ${item.name} ya no está “En revisión”. No se copió ningún archivo.`)
        const folder = ensurePostMediaFolder(item.project, item.postId)
        const target = path.join(folder, item.targetName)
        if (fs.existsSync(target)) throw new Error(`Ya existe ${item.targetName} en la carpeta de ${item.title}. No se copió ningún archivo.`)
      }
      for (const item of assignments) {
        const folder = ensurePostMediaFolder(item.project, item.postId)
        const target = path.join(folder, item.targetName)
        const staging = path.join(folder, `.${crypto.randomUUID()}.tmp`)
        copied.push(staging)
        fs.copyFileSync(item.sourcePath, staging, fs.constants.COPYFILE_EXCL)
        fs.renameSync(staging, target)
        copied.push(target)
        const stat = fs.statSync(target)
        const asset = { id: crypto.randomUUID(), name: item.targetName, path: target, size: stat.size, mode: 'copy', kind: 'image' }
        mediaAssets.push(asset)
        const group = grouped.get(item.postId) || []
        group.push(asset); grouped.set(item.postId, group)
      }
      const updatedPosts: Array<Record<string, any>> = []
      for (const [postId, assets] of grouped) {
        const row = database.getPost(postId)
        if (!row) throw new Error(`No se encontró la publicación ${postId}.`)
        const post = mapPost(row)
        updatedPosts.push({ ...post, media: [...post.media, ...assets.map(({ id, name, size }) => ({ id, name, size, kind: 'image', mode: 'copy' }))] })
      }
      database.saveMediaBatchToPosts(mediaAssets, updatedPosts)
    } catch (error) {
      for (const file of copied) { try { fs.unlinkSync(file) } catch { /* Clean up files created by an incomplete import. */ } }
      throw error
    }
    return { files: assignments.length, posts: grouped.size }
  })
  handle('media:cancel-csv-batch', args => {
    if (args.length !== 1 || typeof args[0] !== 'string') throw new TypeError('Argumento IPC no valido: media.cancelCsvBatch')
    pendingCsvImports.delete(args[0])
  })
  handle('media:reveal', args => {
    validateArgumentCount(args, 1)
    const media = database.getMediaFile(validateId(args[0], 'media.id'))
    const target = media?.archivePath || media?.path
    if (!target || !path.isAbsolute(target)) throw new Error('Archivo multimedia no encontrado')
    shell.showItemInFolder(target)
  })
  handle('media:open-folder', args => {
    if (args.length > 2) throw new TypeError('Argumento IPC no valido: media.openFolder')
    const postId = args[0] === undefined || args[0] === null || args[0] === '' ? undefined : validateId(args[0], 'post.id')
    const project = postId ? (args[1] === undefined ? database.projectForPost(postId) || '' : validateProject(args[1], 'project')) : undefined
    const folder = postId ? ensurePostMediaFolder(project || '', postId) : path.join(app.getPath('userData'), 'Media', 'Posts', 'General')
    if (!postId) fs.mkdirSync(folder, { recursive: true })
    return shell.openPath(folder)
  })
  handle('media:list', withoutArguments(() => database.listMedia().filter(asset => {
    const file = database.getMediaFile(String(asset.id))
    return Boolean(file && ((fs.existsSync(file.path) && fs.statSync(file.path).isFile()) || (file.archivePath && fs.existsSync(file.archivePath))))
  })))
  handle('media:list-for-posts', args => {
    if (args.length !== 1 || !Array.isArray(args[0]) || args[0].length > 500) throw new TypeError('Argumento IPC no valido: media.listForPosts')
    const requested = args[0] as unknown[]
    const targets = requested.map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Publicación ${index + 1} no válida.`)
      const target = value as Record<string, unknown>
      return {
        id: validateId(target.id, 'post.id'),
        project: validateProject(target.project, 'project'),
      }
    })
    const attached: Record<string, Array<Record<string, unknown>>> = {}
    const usages: Record<string, Array<{ postId: string; title: string }>> = {}
    const postFolders = new Map<string, string>()
    for (const row of database.list()) {
      const post = mapPost(row)
      const postFolder = path.resolve(ensurePostMediaFolder(String(post.project || ''), String(post.id)))
      const seenNames = new Set<string>()
      for (const asset of post.media as Array<{ id: string; name: string }>) {
        const name = String(asset.name || '')
        if (!name || seenNames.has(name)) continue
        const file = database.getMediaFile(String(asset.id))
        if (!file || !((fs.existsSync(file.path) && fs.statSync(file.path).isFile()) || (file.archivePath && fs.existsSync(file.archivePath)))) continue
        if (!file.archivePath) {
          const relative = path.relative(postFolder, path.resolve(file.path))
          if (relative !== '' && (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative))) continue
        }
        seenNames.add(name)
        usages[name] = [...(usages[name] || []), { postId: String(post.id), title: String(post.title || 'Publicación sin título') }]
      }
    }
    for (const target of targets) {
      const postRow = database.getPost(target.id)
      if (!postRow) throw new Error(`No se encontró la publicación ${target.id}.`)
      const postMedia = mapPost(postRow).media as Array<Record<string, unknown>>
      const folder = ensurePostMediaFolder(target.project, target.id)
      postFolders.set(target.id, path.resolve(folder))
      const found: Array<Record<string, unknown>> = []
      const visit = (directory: string, groupName?: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue
          const filePath = path.join(directory, entry.name)
          if (entry.isDirectory() && groupName === undefined) { visit(filePath, entry.name); continue }
          if (!entry.isFile()) continue
          const extension = path.extname(entry.name).toLowerCase()
          const kind = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension) ? 'image'
            : ['.mp4', '.mov'].includes(extension) ? 'video'
              : ['.pdf', '.doc', '.docx'].includes(extension) ? 'document' : null
          if (!kind) continue
          const stat = fs.statSync(filePath)
          let asset = database.findMediaByPath(filePath)
          if (!asset) {
            asset = { id: crypto.randomUUID(), name: entry.name, path: filePath, kind, size: stat.size, mode: 'reference', groupName }
            database.saveMedia([asset])
          }
          const linkedAsset = postMedia.find(item => item.id === asset!.id)
          found.push({
            id: asset.id,
            name: entry.name,
            size: stat.size,
            kind,
            mode: asset.mode,
            ...(groupName ? { groupName } : {}),
            ...(typeof linkedAsset?.sourceId === 'string' ? { sourceId: linkedAsset.sourceId } : {}),
            ...(linkedAsset?.presentationRole ? { presentationRole: linkedAsset.presentationRole } : {}),
            ...(linkedAsset?.sequence !== undefined ? { sequence: linkedAsset.sequence } : {}),
          })
        }
      }
      visit(folder)
      attached[target.id] = found
    }
    const library = database.listMedia().filter(asset => {
      const file = database.getMediaFile(String(asset.id))
      if (!file || !((fs.existsSync(file.path) && fs.statSync(file.path).isFile()) || (file.archivePath && fs.existsSync(file.archivePath)))) return false
      const mediaPath = path.resolve(file.path)
      return ![...postFolders.values()].some(folder => {
        const relative = path.relative(folder, mediaPath)
        return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
      })
    })
    return { library, attached, usages }
  })
  handle('media:copy-to-post', args => {
    if (args.length !== 3) throw new TypeError('Argumento IPC no valido: media.copyToPost')
    const postId = validateId(args[0], 'post.id')
    const project = validateProject(args[1], 'project')
    if (!Array.isArray(args[2]) || args[2].length > 500 || args[2].some(id => typeof id !== 'string')) throw new TypeError('Lista de medios no valida')
    const assetIds = [...new Set((args[2] as string[]).map(id => validateId(id, 'media.id')))]
    const postFolder = ensurePostMediaFolder(project, postId)
    const mediaById = new Map(database.listMedia().map(asset => [String(asset.id), asset]))
    const postRow = database.getPost(postId)
    if (!postRow) throw new Error('No se encontró la publicación.')
    const linkedMedia = mapPost(postRow).media as Array<{ id: string; sourceId?: string; name: string; kind: string; size: number }>
    const attachedAssets: Array<{ id: string; sourceId?: string; name: string; kind: string; size: number }> = database.listMedia().flatMap(asset => {
      const file = database.getMediaFile(String(asset.id))
      if (!file || !fs.existsSync(file.path) || !fs.statSync(file.path).isFile()) return []
      const relative = path.relative(path.resolve(postFolder), path.resolve(file.path))
      if (relative !== '' && (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative))) return []
      const linked = linkedMedia.find(item => item.id === asset.id)
      return [{
        id: String(asset.id),
        sourceId: linked?.sourceId,
        name: String(asset.name),
        kind: String(asset.kind),
        size: Number(asset.size),
      }]
    })
    const copies: Array<{ id: string; sourceId?: string; name: string; path: string; kind: string; size: number; mode: string }> = []
    const newCopies: typeof copies = []
    const createdFiles: string[] = []
    try {
      for (const id of assetIds) {
        const asset = mediaById.get(id)
        const source = database.getMediaFile(id)
        if (!asset || !source) throw new Error('Uno de los medios seleccionados ya no está disponible.')
        const sourceId = linkedMedia.find(linked => linked.id === id)?.sourceId || id
        const existingCopy = attachedAssets.some(attached =>
          attached.id === sourceId ||
          attached.sourceId === sourceId ||
          (String(attached.kind) === String(asset.kind) &&
            Number(attached.size) === Number(asset.size) &&
            normalizedMediaName(String(attached.name)) === normalizedMediaName(String(asset.name))),
        )
        if (existingCopy) continue
        const relative = path.relative(path.resolve(postFolder), path.resolve(source.path))
        if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
          copies.push({ id, name: String(asset.name), path: source.path, kind: String(asset.kind), size: Number(asset.size), mode: source.mode })
          continue
        }

        const assetName = path.basename(String(asset.name)) || 'medio'
        const extension = path.extname(assetName)
        const baseName = path.basename(assetName, extension) || 'medio'
        let destination = path.join(postFolder, assetName)
        for (let suffix = 2; fs.existsSync(destination); suffix += 1) {
          destination = path.join(postFolder, `${baseName} (${suffix})${extension}`)
          if (suffix === 10000) throw new Error('No se pudo encontrar un nombre disponible para la copia.')
        }
        if (source.archivePath && source.entryName) {
          const contents = new AdmZip(source.archivePath).readFile(source.entryName)
          if (!contents) throw new Error(`No se pudo leer el medio comprimido ${String(asset.name)}.`)
          fs.writeFileSync(destination, contents, { flag: 'wx' })
        } else {
          if (!fs.existsSync(source.path) || !fs.statSync(source.path).isFile()) throw new Error(`No se encontró el archivo ${String(asset.name)}.`)
          fs.copyFileSync(source.path, destination, fs.constants.COPYFILE_EXCL)
        }
        createdFiles.push(destination)
        const stat = fs.statSync(destination)
        const copy = {
          id: crypto.randomUUID(),
          sourceId,
          name: path.basename(destination),
          path: destination,
          kind: String(asset.kind),
          size: stat.size,
          mode: 'copy',
        }
        copies.push(copy)
        newCopies.push(copy)
      }
      if (newCopies.length) database.saveMedia(newCopies)
      return copies.map(({ id, sourceId, name, size, kind, mode }) => ({ id, sourceId, name, size, kind, mode }))
    } catch (error) {
      createdFiles.forEach(file => { try { fs.unlinkSync(file) } catch { /* Partial copy cleanup is best-effort. */ } })
      throw error
    }
  })
  handle('media:duplicate-post-asset', args => {
    validateArgumentCount(args, 3)
    const postId = validateId(args[0], 'post.id')
    const project = validateProject(args[1], 'project')
    const assetId = validateId(args[2], 'media.id')
    if (!database.getPost(postId)) throw new Error('No se encontró la publicación.')

    const postFolder = path.resolve(ensurePostMediaFolder(project, postId))
    const sourcePath = database.getMediaPath(assetId)
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) throw new Error('La imagen ya no está disponible.')
    const absoluteSource = path.resolve(sourcePath)
    const relative = path.relative(postFolder, absoluteSource)
    if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Solo se pueden duplicar imágenes de la carpeta de esta publicación.')
    }

    const originalName = path.basename(absoluteSource)
    const extension = path.extname(originalName)
    const baseName = path.basename(originalName, extension)
    let destination = path.join(path.dirname(absoluteSource), `${baseName} (copia)${extension}`)
    for (let suffix = 2; fs.existsSync(destination); suffix += 1) {
      destination = path.join(path.dirname(absoluteSource), `${baseName} (copia ${suffix})${extension}`)
      if (suffix === 10000) throw new Error('No se pudo encontrar un nombre disponible para la copia.')
    }

    fs.copyFileSync(absoluteSource, destination, fs.constants.COPYFILE_EXCL)
    try {
      const stat = fs.statSync(destination)
      const asset = {
        id: crypto.randomUUID(),
        name: path.basename(destination),
        path: destination,
        kind: 'image',
        size: stat.size,
        mode: 'reference',
      }
      database.saveMedia([asset])
      return { id: asset.id, name: asset.name, kind: asset.kind, size: asset.size, mode: asset.mode }
    } catch (error) {
      fs.unlinkSync(destination)
      throw error
    }
  })
  handle('media:delete-post-asset', args => {
    validateArgumentCount(args, 3)
    const postId = validateId(args[0], 'post.id')
    const project = validateProject(args[1], 'project')
    const assetId = validateId(args[2], 'media.id')
    if (!database.getPost(postId)) throw new Error('No se encontró la publicación.')

    const postFolder = path.resolve(ensurePostMediaFolder(project, postId))
    const media = database.getMediaFile(assetId)
    if (!media || !fs.existsSync(media.path) || !fs.statSync(media.path).isFile()) throw new Error('La imagen ya no está disponible.')
    const absoluteMediaPath = path.resolve(media.path)
    const relative = path.relative(postFolder, absoluteMediaPath)
    if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Solo se pueden eliminar imágenes de la carpeta de esta publicación.')
    }

    fs.unlinkSync(absoluteMediaPath)
    database.removeMedia(assetId)
  })
  handle('media:scan-post-folder', args => {
    if (args.length < 1 || args.length > 2) throw new TypeError('Argumento IPC no valido: media.scanPostFolder')
    const postId = validateId(args[0], 'post.id')
    const project = args[1] === undefined ? database.projectForPost(postId) || '' : validateProject(args[1], 'project')
    const folder = ensurePostMediaFolder(project, postId)
    const found: Array<{ id: string; name: string; path: string; kind: string; size: number; mode: string; groupName?: string }> = []
    const visit = (directory: string, groupName?: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filePath = path.join(directory, entry.name)
        if (entry.isDirectory() && groupName === undefined && !entry.name.startsWith('.')) { visit(filePath, entry.name); continue }
        if (!entry.isFile() || !['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(entry.name).toLowerCase())) continue
        const stat = fs.statSync(filePath)
        const existing = database.findMediaByPath(filePath)
        found.push({ id: String(existing?.id || crypto.randomUUID()), name: entry.name, path: filePath, kind: 'image', size: stat.size, mode: 'reference', groupName })
      }
    }
    visit(folder)
    const newAssets = found.filter(asset => !database.findMediaByPath(String(asset.path)))
    if (newAssets.length) database.saveMedia(newAssets)
    return found.map(asset => ({ id: asset.id, name: asset.name, kind: 'image', size: asset.size, mode: asset.mode, groupName: asset.groupName }))
  })
  handle('media:organize-post', args => {
    if (args.length < 4 || args.length > 5) throw new TypeError('Argumento IPC no valido: media.organizePost')
    const postId = validateId(args[0], 'post.id')
    const project = validateProject(args[1], 'project')
    if (!Array.isArray(args[2]) || args[2].length > 500 || args[2].some(id => typeof id !== 'string')) throw new TypeError('Lista de medios no valida')
    const assetIds = args[2] as string[]
    const groupName = safeMediaGroupName(args[3])
    const postFolder = ensurePostMediaFolder(project, postId)
    if (args[4] !== undefined) {
      const oldName = safeMediaGroupName(args[4])
      if (oldName === groupName) return
      const oldFolder = path.join(postFolder, oldName)
      const newFolder = path.join(postFolder, groupName)
      if (!fs.existsSync(oldFolder) || fs.existsSync(newFolder)) throw new Error('No se pudo renombrar la carpeta: el nombre ya existe o la carpeta no está disponible.')
      fs.renameSync(oldFolder, newFolder)
      const updatePaths = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const filePath = path.join(directory, entry.name)
          if (entry.isDirectory()) updatePaths(filePath)
          else {
            const media = database.findMediaByPath(path.join(oldFolder, path.relative(newFolder, filePath)))
            if (media) database.updateMediaPath(String(media.id), filePath)
          }
        }
      }
      updatePaths(newFolder)
      return
    }
    if (!assetIds.length) throw new Error('Selecciona al menos una imagen para agrupar.')
    const destination = path.join(postFolder, groupName)
    const moves = assetIds.map(id => {
      const mediaPath = database.getMediaPath(validateId(id, 'media.id'))
      if (!mediaPath) throw new Error('Una de las imágenes ya no está disponible.')
      const relative = path.relative(postFolder, mediaPath)
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Solo se pueden agrupar imágenes de esta publicación.')
      const target = path.join(destination, path.basename(mediaPath))
      if (fs.existsSync(target)) throw new Error('Ya existe un archivo con ese nombre dentro de la carpeta.')
      return { id, source: mediaPath, target }
    })
    fs.mkdirSync(destination, { recursive: true })
    const moved: typeof moves = []
    try {
      for (const item of moves) { fs.renameSync(item.source, item.target); moved.push(item) }
    } catch (error) {
      for (const item of moved.reverse()) { try { fs.renameSync(item.target, item.source) } catch { /* Best-effort rollback if the filesystem changed during grouping. */ } }
      throw error
    }
    for (const item of moves) database.updateMediaPath(item.id, item.target)
  })
  handle('media:choose', async args => {
    if (args.length < 1 || args.length > 3) throw new TypeError('Argumento IPC no valido: media.choose')
    const mode = validateMediaMode(args[0])
    const postId = args[1] === undefined || args[1] === null || args[1] === '' ? undefined : validateId(args[1], 'post.id')
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Ventana principal no disponible')
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile','multiSelections'], filters: [{ name:'Imágenes, ZIP y contenido', extensions:['png','jpg','jpeg','webp','gif','mp4','mov','pdf','doc','docx','zip'] }, { name: 'ZIP', extensions: ['zip'] }] })
    if (result.canceled) return []
    const project = postId ? (args[2] === undefined ? database.projectForPost(postId) || '' : validateProject(args[2], 'project')) : undefined
    const root = project ? path.join(dataDirectory, 'Spaces', project.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')) : path.join(app.getPath('userData'), 'Media')
    const library = mode === 'copy' && postId ? ensurePostMediaFolder(project || '', postId) : path.join(root, 'Posts', postId || 'General')
    if (mode === 'copy' && !postId) fs.mkdirSync(library, { recursive: true })
    const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'caballocci-media-'))
    const sources: Array<{ path: string; originalName: string }> = []
    try {
      for (const selectedPath of result.filePaths) {
        if (path.extname(selectedPath).toLowerCase() !== '.zip') { sources.push({ path: selectedPath, originalName: path.basename(selectedPath) }); continue }
        const zipStat = fs.statSync(selectedPath)
        if (!zipStat.isFile() || zipStat.size > 100 * 1024 * 1024) throw new Error('El ZIP supera el límite de 100 MB.')
        let entries: ReturnType<AdmZip['getEntries']>
        try { entries = new AdmZip(selectedPath).getEntries() } catch { throw new Error(`No se pudo leer el ZIP: ${path.basename(selectedPath)}`) }
        if (entries.length > 5000) throw new Error('El ZIP contiene demasiadas entradas para procesarlo de forma segura.')
        let totalBytes = 0
        let extractedCount = 0
        for (const entry of entries) {
          if (entry.isDirectory) continue
          const entryName = entry.entryName.replace(/\\/g, '/')
          if (entryName.includes('/') || entryName === '.' || entryName === '..') continue
          if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(entryName).toLowerCase())) continue
          if (extractedCount >= 500) throw new Error('El ZIP contiene más de 500 imágenes.')
          if (entry.header.size > 50 * 1024 * 1024 || totalBytes + entry.header.size > 500 * 1024 * 1024) throw new Error('Las imágenes del ZIP superan el límite de extracción permitido.')
          let data: Buffer
          try { data = entry.getData() } catch { throw new Error(`El ZIP está dañado o no se pudo validar ${entryName}.`) }
          if (!validImageData(path.extname(entryName).toLowerCase(), data)) throw new Error(`El archivo ${entryName} no coincide con un formato de imagen compatible.`)
          totalBytes += data.length
          if (data.length > 50 * 1024 * 1024 || totalBytes > 500 * 1024 * 1024) throw new Error('Las imágenes del ZIP superan el límite de extracción permitido.')
          const tempPath = path.join(tempRoot, `${String(extractedCount).padStart(4, '0')}-${crypto.randomUUID()}${path.extname(entryName).toLowerCase()}`)
          fs.writeFileSync(tempPath, data, { flag: 'wx' })
          sources.push({ path: tempPath, originalName: entryName })
          extractedCount += 1
        }
        if (!extractedCount) throw new Error(`El ZIP ${path.basename(selectedPath)} no contiene imágenes compatibles directamente en su raíz.`)
      }
      if (mode === 'copy') fs.mkdirSync(library, { recursive: true })
      const assets: Array<{ id: string; name: string; path: string; size: number; mode: string; kind: string }> = []
      const copied: string[] = []
      try {
        for (const source of sources) {
          let finalPath = source.path
          if (mode === 'copy') {
            const ext = path.extname(source.originalName).toLowerCase()
            const name = `${path.basename(source.originalName, ext)}-${crypto.randomUUID()}${ext}`
            finalPath = path.join(library, name)
            fs.copyFileSync(source.path, finalPath, fs.constants.COPYFILE_EXCL)
            copied.push(finalPath)
          }
          const stat = fs.statSync(finalPath); const ext = path.extname(finalPath).toLowerCase()
          assets.push({ id: crypto.randomUUID(), name: path.basename(finalPath), path: finalPath, size: stat.size, mode, kind: ['.mp4','.mov'].includes(ext) ? 'video' : ['.png','.jpg','.jpeg','.webp','.gif'].includes(ext) ? 'image' : 'document' })
        }
      } catch (error) {
        copied.forEach(file => { try { fs.unlinkSync(file) } catch { /* Partial import cleanup is best-effort. */ } })
        throw error
      }
      if (assets.length) database.saveMedia(assets)
      return assets.map(asset => ({ id: asset.id, name: asset.name, size: asset.size, mode: asset.mode, kind: asset.kind }))
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })
}

function normalizedMediaName(name: string) {
  return name.replace(/ \(\d+\)(?=\.[^.]+$|$)/, '').toLocaleLowerCase()
}

function parseBatchCsv(text: string): { headers: string[]; records: Array<Record<string, string>> } {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const input = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1 }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '' }
    else cell += char
  }
  if (quoted) throw new Error('El CSV contiene comillas sin cerrar.')
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row) }
  const headers = rows.shift()?.map(value => value.trim()) || []
  if (!headers.length || headers.some(value => !value)) throw new Error('La cabecera del CSV no es válida.')
  return { headers, records: rows.filter(values => values.some(value => value.trim())).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || '']))) }
}

function hasPngSignature(filePath: string) {
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(filePath, 'r')
    const header = Buffer.alloc(8)
    return fs.readSync(descriptor, header, 0, header.length, 0) === 8 && validImageData('.png', header)
  } catch { return false }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
}

import { app, dialog, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import AdmZip from 'adm-zip'
import path from 'node:path'
import fs from 'node:fs'
import type { PlannerDatabase } from './database'
import { validateArgumentCount, validateId, validateMediaMode, validateProject } from './ipc-validation'

type MediaIpcDependencies = {
  database: PlannerDatabase
  dataDirectory: string
  getMainWindow(): BrowserWindow | null
  handle(channel: string, callback: (args: unknown[], event: IpcMainInvokeEvent) => unknown): void
  withoutArguments(callback: () => unknown): (args: unknown[]) => unknown
  ensurePostMediaFolder(project: string, postId: string): string
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

export function registerMediaIpcHandlers({ database, dataDirectory, getMainWindow, handle, withoutArguments, ensurePostMediaFolder }: MediaIpcDependencies) {
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
  handle('media:list', withoutArguments(() => database.listMedia()))
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



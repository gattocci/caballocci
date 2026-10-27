import { dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { PlannerDatabase } from './database'
import { exportPostForPhone, phoneExportFolderName, type PhoneFile } from './media-export'
import { cleanUnreferencedMobileAlbums, mergeMobilePublications, mobileTargetKey, nextMobileBatch, nextMobileSpaceOrder, pruneMobilePublications, recordMobileBatch, summarizeMobileUsage, writeMobileCatalog, type MobilePublication } from './mobile-sync'

type MobileExportReport = {
  batch: string
  publications: number
  destinations: number
  skipped: Array<{ postId: string; title: string; reason: string }>
  catalogPath: string
  missingAlbums: string[]
  catalogBackupPaths: string[]
}

type MobileSyncDependencies = {
  getDatabase(): PlannerDatabase
  getMainWindow(): BrowserWindow | null
  mapPost(row: Record<string, unknown>): Record<string, any>
  restoreTargetMedia(targetType: 'group' | 'post', targetId: string): unknown
  isPhonePresentationRole(value: unknown): value is PhoneFile['presentationRole']
}

export function createMobileSyncService(dependencies: MobileSyncDependencies) {
  const phoneExportPreferenceKey = 'caballocci.phone-export-root'
  const mobileSyncPreferenceKey = 'caballocci.mobile-sync-root'

  function mobileSyncRoot() {
  const preferences = dependencies.getDatabase().listPreferences()
  const root = preferences[mobileSyncPreferenceKey] || preferences[phoneExportPreferenceKey]
  return root && path.isAbsolute(root) && fs.existsSync(root) ? root : null
}

function archiveMobileCatalog(root: string, catalogPath: string) {
  const historyRoot = path.join(root, 'pc-outbox', 'catalog-history')
  fs.mkdirSync(historyRoot, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archivePath = path.join(historyRoot, `catalog-${stamp}-${crypto.randomUUID()}.json`)
  const temporaryPath = `${archivePath}.tmp`
  fs.copyFileSync(catalogPath, temporaryPath)
  fs.renameSync(temporaryPath, archivePath)
  return archivePath
}

function writeMobileCatalogWithBackup(root: string, publications: MobilePublication[]) {
  const catalogPath = path.join(root, 'pc-outbox', 'catalog.json')
  let backupPath: string | null = null
  if (fs.existsSync(catalogPath)) {
    const catalogText = fs.readFileSync(catalogPath, 'utf8')
    const existing = JSON.parse(catalogText) as { publications?: unknown }
    if (Array.isArray(existing.publications) && JSON.stringify(existing.publications) !== JSON.stringify(publications)) {
      backupPath = archiveMobileCatalog(root, catalogPath)
    }
  }
  writeMobileCatalog(root, publications)
  return backupPath
}

function listUnreferencedMobileAlbums(root: string, referenced: Set<string>) {
  const publicationRoot = path.join(root, 'pc-outbox', 'publications')
  if (!fs.existsSync(publicationRoot)) return [] as string[]
  return fs.readdirSync(publicationRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !referenced.has(entry.name) && fs.existsSync(path.join(publicationRoot, entry.name, 'manifest.json')))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, 'es'))
}

function getMobileCatalogStatus(root: string | null) {
  if (!root) return {
    configured: false, catalogExists: false, catalogPath: null as string | null,
    referencedDestinations: 0, referencedAlbums: 0, availableAlbums: 0,
    missingAlbums: [] as string[], incompleteAlbums: [] as string[], unreferencedAlbums: [] as string[], archivedCatalogs: 0, latestCatalogBackupPath: null as string | null,
  }
  const catalogPath = path.join(root, 'pc-outbox', 'catalog.json')
  const historyRoot = path.join(root, 'pc-outbox', 'catalog-history')
  const archiveNames = fs.existsSync(historyRoot)
    ? fs.readdirSync(historyRoot, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name).sort()
    : []
  const archivedCatalogs = archiveNames.length
  const latestCatalogBackupPath = archiveNames.length ? path.join(historyRoot, archiveNames[archiveNames.length - 1]!) : null
  if (!fs.existsSync(catalogPath)) return {
    configured: true, catalogExists: false, catalogPath,
    referencedDestinations: 0, referencedAlbums: 0, availableAlbums: 0,
    missingAlbums: [] as string[], incompleteAlbums: [] as string[], unreferencedAlbums: listUnreferencedMobileAlbums(root, new Set()), archivedCatalogs, latestCatalogBackupPath,
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as { schema?: unknown; version?: unknown; publications?: unknown }
  if (catalog.schema !== 'caballocci.mobile-sync.catalog' || catalog.version !== 1 || !Array.isArray(catalog.publications)) {
    throw new TypeError('El catálogo móvil no tiene un formato compatible; no se pudo consultar su estado.')
  }
  const albums = new Map<string, { folder: string; directoryPath: string; manifestPath: string }>()
  for (const item of catalog.publications as MobilePublication[]) {
    const parts = String(item.manifestPath || '').replace(/\\/g, '/').split('/')
    const valid = parts.length === 4 && parts[0] === 'pc-outbox' && parts[1] === 'publications' && parts[3] === 'manifest.json' && !!parts[2] && !parts[2]!.startsWith('.')
    const key = valid ? parts[2]! : String(item.manifestPath || '(ruta no válida)')
    if (!albums.has(key)) albums.set(key, {
      folder: key,
      directoryPath: valid ? path.join(root, 'pc-outbox', 'publications', parts[2]!) : '',
      manifestPath: valid ? path.join(root, ...parts) : '',
    })
  }
  const unreferencedAlbums = listUnreferencedMobileAlbums(root, new Set([...albums.values()].map(album => album.folder)))
  const missingAlbums: string[] = []
  const incompleteAlbums: string[] = []
  let availableAlbums = 0
  for (const album of albums.values()) {
    try {
      if (!album.directoryPath || !fs.statSync(album.directoryPath).isDirectory()) missingAlbums.push(album.folder)
      else {
        availableAlbums += 1
        if (!album.manifestPath || !fs.existsSync(album.manifestPath)) incompleteAlbums.push(album.folder)
      }
    } catch { missingAlbums.push(album.folder) }
  }
  return {
    configured: true, catalogExists: true, catalogPath,
    referencedDestinations: catalog.publications.length,
    referencedAlbums: albums.size, availableAlbums, missingAlbums, incompleteAlbums, unreferencedAlbums, archivedCatalogs, latestCatalogBackupPath,
  }
}

function getMobileReconcilePreview(root: string) {
  const catalogPath = path.join(root, 'pc-outbox', 'catalog.json')
  let publications: MobilePublication[] = []
  if (fs.existsSync(catalogPath)) {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as { schema?: unknown; version?: unknown; publications?: unknown }
    if (catalog.schema !== 'caballocci.mobile-sync.catalog' || catalog.version !== 1 || !Array.isArray(catalog.publications)) {
      throw new TypeError('El catálogo móvil no tiene un formato compatible; no se pudo preparar la vista previa.')
    }
    publications = catalog.publications as MobilePublication[]
  }
  const publicationRoot = path.resolve(root, 'pc-outbox', 'publications')
  const missingFolders = new Set<string>()
  for (const item of publications) {
    const parts = item.manifestPath.replace(/\\/g, '/').split('/')
    if (parts.length !== 4 || parts[0] !== 'pc-outbox' || parts[1] !== 'publications' || parts[3] !== 'manifest.json' || !parts[2] || parts[2].startsWith('.')) continue
    const directory = path.resolve(publicationRoot, parts[2])
    if (!directory.startsWith(`${publicationRoot}${path.sep}`)) continue
    let isDirectory = false
    try { isDirectory = fs.statSync(directory).isDirectory() } catch { /* Carpeta ausente. */ }
    if (!isDirectory) missingFolders.add(parts[2])
  }
  const existingPublications = publications.filter(item => {
    const folder = item.manifestPath.replace(/\\/g, '/').split('/')[2]
    return !folder || !missingFolders.has(folder)
  })
  const { removed, used } = mobileUsageSummary()
  const expected = pruneMobilePublications(existingPublications, { postIsActive: mobilePostIsActive, removed })
  const referencedFolders = new Set(expected.kept.map(item => item.manifestPath.replace(/\\/g, '/').split('/')[2]).filter(Boolean))
  const foldersToDelete: string[] = []
  const foldersToRename: Array<{ from: string; to: string }> = []
  const renameConflicts: string[] = []
  if (fs.existsSync(publicationRoot)) {
    for (const entry of fs.readdirSync(publicationRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || referencedFolders.has(entry.name)) continue
      if (fs.existsSync(path.join(publicationRoot, entry.name, 'manifest.json'))) foldersToDelete.push(entry.name)
    }
    for (const entry of fs.readdirSync(publicationRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const manifestPath = path.join(publicationRoot, entry.name, 'manifest.json')
      if (!fs.existsSync(manifestPath)) continue
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { postId?: unknown; title?: unknown; scheduledAt?: unknown; batch?: unknown; spaceName?: unknown; spaceOrder?: unknown }
      const postId = String(manifest.postId || '')
      const reference = expected.kept.find(item => item.postId === postId && used.has(`${postId}\u0000${item.targetId}`))
      if (!postId || !reference || typeof manifest.batch !== 'string' || !manifest.batch) continue
      const album = {
        title: typeof manifest.title === 'string' ? manifest.title : '',
        scheduledAt: typeof manifest.scheduledAt === 'string' ? manifest.scheduledAt : null,
        batch: manifest.batch,
        spaceName: typeof manifest.spaceName === 'string' ? manifest.spaceName : 'General',
        spaceOrder: typeof manifest.spaceOrder === 'number' ? manifest.spaceOrder : 1,
      }
      const previous = phoneExportFolderName({ ...album, used: false })
      const next = phoneExportFolderName({ ...album, used: true }) + (entry.name.startsWith(previous) ? entry.name.slice(previous.length) : '')
      if (next === entry.name) continue
      if (fs.existsSync(path.join(publicationRoot, next))) renameConflicts.push(`${entry.name} → ${next}`)
      else foldersToRename.push({ from: entry.name, to: next })
    }
  }
  return {
    missingAlbums: [...missingFolders],
    retiredDestinations: publications.length - expected.kept.length,
    foldersToDelete,
    foldersToRename,
    renameConflicts,
  }
}

function mobileUsageSummary() {
  return summarizeMobileUsage(dependencies.getDatabase().listMobileUsage().map(event => ({
    postId: String(event.post_id),
    targetId: String(event.target_id),
    action: String(event.action),
    usedAt: String(event.used_at),
  })))
}

function mobilePostIsActive(postId: string) {
  const post = dependencies.getDatabase().getPost(postId)
  return Boolean(post) && String(post?.status) !== 'archived'
}

async function exportMobilePublications(postIds?: string[], forceChooseFolder = false): Promise<MobileExportReport | null> {
  const mainWindow = dependencies.getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Ventana principal no disponible')
  let root = forceChooseFolder ? null : mobileSyncRoot()
  if (!root) {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    root = result.filePaths[0]
    dependencies.getDatabase().savePreferences({ [mobileSyncPreferenceKey]: root })
  }

  // If exporting will reconcile removals or clean stale albums, show its preview first.
  const existingCatalogPath = path.join(root, 'pc-outbox', 'catalog.json')
  let reconciliation = { pruned: 0, cleaned: 0, cleanupFailed: [] as string[], missingAlbums: [] as string[], catalogBackupPaths: [] as string[] }
  const preview = getMobileReconcilePreview(root)
  if (preview.retiredDestinations || preview.foldersToDelete.length || preview.foldersToRename.length) {
    if (preview.renameConflicts.length) throw new Error(`No se puede exportar hasta resolver los conflictos de carpetas: ${preview.renameConflicts.join(', ')}.`)
    const details = [
        `Destinos a retirar: ${preview.retiredDestinations}.`,
        `Carpetas ausentes: ${preview.missingAlbums.join(', ') || 'ninguna'}.`,
        `Carpetas que se borrarán: ${preview.foldersToDelete.join(', ') || 'ninguna'}.`,
        `Carpetas que se marcarán como usadas: ${preview.foldersToRename.map(item => `${item.from} → ${item.to}`).join(', ') || 'ninguna'}.`,
        preview.renameConflicts.length ? `Conflictos de nombres: ${preview.renameConflicts.join(', ')}.` : '',
      ].filter(Boolean).join('\n')
      const decision = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Continuar con la exportación', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        title: 'Revisar limpieza del catálogo móvil',
        message: 'La exportación conciliará el catálogo y puede borrar carpetas de pc-outbox/publications.',
        detail: `${details}\n\n${fs.existsSync(existingCatalogPath) ? 'Se guardará una copia del catálogo en pc-outbox/catalog-history/.' : 'Todavía no existe un catálogo anterior que archivar.'} Espera a que Syncthing termine y no borres álbumes desde Android durante esta operación.`,
      })
    if (decision.response !== 0) return null
  }
  if (fs.existsSync(existingCatalogPath)) {
    reconciliation = updateMobileCatalogAfterUsage(root)
  }

  const selectedIds = postIds ? new Set(postIds) : null
  const selectedRows = selectedIds
    ? dependencies.getDatabase().list().filter(row => selectedIds.has(String(row.id)))
    : dependencies.getDatabase().list()
  let publications: MobilePublication[] = []
  let exportedPublications: MobilePublication[] = []
  if (selectedIds && fs.existsSync(existingCatalogPath)) {
    const existing = JSON.parse(fs.readFileSync(existingCatalogPath, 'utf8')) as {
      schema?: unknown
      version?: unknown
      publications?: unknown
    }
    if (existing.schema !== 'caballocci.mobile-sync.catalog' || existing.version !== 1 || !Array.isArray(existing.publications)) {
      throw new TypeError('El catálogo móvil existente no tiene un formato compatible; no se modificó.')
    }
    publications = existing.publications as MobilePublication[]
  }

  const { used: usedTargets, removed: removedTargets } = mobileUsageSummary()
  const batch = nextMobileBatch(root)
  const exportedPostIds = new Set<string>()
  const skipped: MobileExportReport['skipped'] = []
  const publicationsRoot = path.join(root, 'pc-outbox', 'publications')
  fs.mkdirSync(publicationsRoot, { recursive: true })

  for (const postRow of selectedRows) {
    const post = dependencies.mapPost(postRow)
    if (post.status === 'archived') {
      skipped.push({ postId: String(post.id), title: String(post.title || ''), reason: 'La publicación está archivada.' })
      continue
    }
    const targets = (post.distribution as Array<{ id: string; name: string; status: string; scheduledAt?: string | null }>)
      .filter(target => target.status !== 'published' && target.status !== 'not_applicable')
      .filter(target => !removedTargets.has(mobileTargetKey(String(post.id), String(target.id))))
    if (!targets.length) {
      skipped.push({ postId: String(post.id), title: String(post.title || ''), reason: 'No tiene destinos pendientes de uso (o ya se retiraron del móvil).' })
      continue
    }
    if (post.media.some((asset: { compressed: boolean }) => asset.compressed)) dependencies.restoreTargetMedia('post', String(post.id))
    const currentPost = dependencies.mapPost(dependencies.getDatabase().getPost(String(post.id)) || postRow)
    const files: PhoneFile[] = []
    for (const asset of currentPost.media) {
      if (asset.kind !== 'image' && asset.kind !== 'video') continue
      const media = dependencies.getDatabase().getMediaFile(String(asset.id || ''))
      if (!media || !fs.existsSync(media.path) || !fs.statSync(media.path).isFile()) continue
      files.push({
        name: String(asset.name || 'archivo'),
        sourcePath: media.path,
        ...(dependencies.isPhonePresentationRole(asset.presentationRole) ? { presentationRole: asset.presentationRole } : {}),
        sequence: typeof asset.sequence === 'number' ? asset.sequence : asset.sequence === null ? null : undefined,
      })
    }
    if (!files.length) {
      skipped.push({ postId: String(post.id), title: String(post.title || ''), reason: 'No hay imágenes o videos disponibles.' })
      continue
    }
    const postId = String(post.id)
    const used = targets.some(target => usedTargets.has(`${postId}\u0000${String(target.id)}`))
    const spaceName = String(post.project || 'General')
    const spaceOrder = nextMobileSpaceOrder(root, spaceName, String(post.id))
    const exportResult = exportPostForPhone(publicationsRoot, {
      id: postId,
      title: String(post.title || ''),
      caption: String(post.caption || ''),
      hashtags: Array.isArray(post.hashtags) ? post.hashtags.map(String) : [],
      mentions: Array.isArray(post.mentions) ? post.mentions.map(String) : [],
      platforms: Array.isArray(post.platforms) ? post.platforms.map(String) : [],
      scheduledAt: typeof post.scheduledAt === 'string' ? post.scheduledAt : null,
      batch,
      spaceName,
      spaceOrder,
      used,
    }, files)
    const exportFolder = path.join(publicationsRoot, exportResult.folderName)
    exportedPostIds.add(postId)
    for (const target of targets) {
      exportedPublications.push({
        postId,
        targetId: String(target.id),
        targetName: String(target.name || target.id),
        manifestPath: path.relative(root, path.join(exportFolder, 'manifest.json')).split(path.sep).join('/'),
        captionPath: path.relative(root, path.join(exportFolder, 'caption.txt')).split(path.sep).join('/'),
        scheduledAt: target.scheduledAt === null
          ? null
          : typeof target.scheduledAt === 'string'
            ? target.scheduledAt
            : typeof post.scheduledAt === 'string' ? post.scheduledAt : null,
        used: usedTargets.has(`${postId}\u0000${String(target.id)}`),
        batch,
      })
    }
  }
  publications = selectedIds
    ? mergeMobilePublications(publications, exportedPublications)
    : exportedPublications
  // El catálogo nunca debe conservar publicaciones eliminadas/archivadas ni destinos retirados desde el móvil.
  publications = pruneMobilePublications(publications, { postIsActive: mobilePostIsActive, removed: removedTargets }).kept
  const catalogBackupPath = writeMobileCatalogWithBackup(root, publications)
  cleanUnreferencedMobileAlbums(root, publications)
  recordMobileBatch(root, batch, [...exportedPostIds])
  return {
    batch,
    publications: exportedPostIds.size,
    destinations: publications.filter(item => item.batch === batch).length,
    skipped,
    catalogPath: path.join(root, 'pc-outbox', 'catalog.json'),
    missingAlbums: reconciliation.missingAlbums,
    catalogBackupPaths: [...reconciliation.catalogBackupPaths, ...(catalogBackupPath ? [catalogBackupPath] : [])],
  }
}

function updateMobileCatalogAfterUsage(root: string, archiveSnapshot = false) {
  const catalogPath = path.join(root, 'pc-outbox', 'catalog.json')
  if (!fs.existsSync(catalogPath)) return { pruned: 0, cleaned: 0, cleanupFailed: [] as string[], missingAlbums: [] as string[], catalogBackupPaths: [] as string[] }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as {
    schema?: unknown
    version?: unknown
    publications?: unknown
  }
  if (catalog.schema !== 'caballocci.mobile-sync.catalog' || catalog.version !== 1 || !Array.isArray(catalog.publications)) {
    throw new TypeError('El catálogo móvil no tiene un formato compatible; no se actualizaron sus estados.')
  }
  const preservedBackupPath = archiveSnapshot ? archiveMobileCatalog(root, catalogPath) : null
  const { used: usedTargets, removed: removedTargets } = mobileUsageSummary()
  const originalCount = (catalog.publications as MobilePublication[]).length
  const catalogPublications = catalog.publications as MobilePublication[]
  const originalPublicationsText = JSON.stringify(catalogPublications)
  const missingByFolder = new Map<string, MobilePublication[]>()
  for (const item of catalogPublications) {
    const parts = item.manifestPath.replace(/\\/g, '/').split('/')
    if (parts.length !== 4 || parts[0] !== 'pc-outbox' || parts[1] !== 'publications' || parts[3] !== 'manifest.json' || !parts[2] || parts[2].startsWith('.')) continue
    const directory = path.resolve(root, 'pc-outbox', 'publications', parts[2])
    const albumsRoot = path.resolve(root, 'pc-outbox', 'publications')
    if (!directory.startsWith(`${albumsRoot}${path.sep}`)) continue
    // A present folder without its manifest may still be syncing. Only a truly
    // absent folder is safe to reconcile automatically.
    let directoryExists = false
    try { directoryExists = fs.statSync(directory).isDirectory() } catch { /* Carpeta ausente. */ }
    if (directoryExists) continue
    const group = missingByFolder.get(parts[2]) || []
    group.push(item)
    missingByFolder.set(parts[2], group)
  }
  for (const [folder, entries] of missingByFolder) {
    const first = entries[0]!
    const post = dependencies.getDatabase().getPost(first.postId)
    const order = Number(folder.match(/^[a-z]+-[^-]+-(\d+)-/)?.[1])
    dependencies.getDatabase().recordMobileAlbumCleanup({
      eventId: crypto.randomUUID(), postId: first.postId, title: String(post?.title || ''),
      folderName: folder,
      batch: String(first.batch || ''), spaceName: String(post?.project || ''),
      spaceOrder: Number.isSafeInteger(order) && order > 0 ? order : null,
      reason: 'folder_missing', occurredAt: new Date().toISOString(),
    })
  }
  const missingAlbums = [...missingByFolder.keys()]
  const existingPublications = catalogPublications.filter(item => {
    const parts = item.manifestPath.replace(/\\/g, '/').split('/')
    return !(parts.length === 4 && parts[0] === 'pc-outbox' && parts[1] === 'publications' && missingByFolder.has(parts[2]!))
  })
  const publications = pruneMobilePublications(existingPublications, {
    postIsActive: mobilePostIsActive,
    removed: removedTargets,
  }).kept
  const prunedEntries = originalCount - publications.length
  const directoryRenames: Array<{ from: string; to: string }> = []
  const publicationRoot = path.join(root, 'pc-outbox', 'publications')
  if (fs.existsSync(publicationRoot)) {
    for (const entry of fs.readdirSync(publicationRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const directory = path.join(publicationRoot, entry.name)
      const manifestPath = path.join(directory, 'manifest.json')
      if (!fs.existsSync(manifestPath)) continue
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        postId?: unknown
        title?: unknown
        scheduledAt?: unknown
        batch?: unknown
        spaceName?: unknown
        spaceOrder?: unknown
      }
      const postId = String(manifest.postId || '')
      if (!postId || !publications.some(item => item.postId === postId && usedTargets.has(`${postId}\u0000${item.targetId}`))) continue
      const batch = typeof manifest.batch === 'string' ? manifest.batch : ''
      if (!batch) continue
      const albumName = {
        title: typeof manifest.title === 'string' ? manifest.title : '',
        scheduledAt: typeof manifest.scheduledAt === 'string' ? manifest.scheduledAt : null,
        batch,
        spaceName: typeof manifest.spaceName === 'string' ? manifest.spaceName : 'General',
        spaceOrder: typeof manifest.spaceOrder === 'number' ? manifest.spaceOrder : 1,
      }
      const previousBaseName = phoneExportFolderName({ ...albumName, used: false })
      const nextBaseName = phoneExportFolderName({
        ...albumName,
        used: true,
      })
      const collisionSuffix = entry.name.startsWith(previousBaseName) ? entry.name.slice(previousBaseName.length) : ''
      const nextName = `${nextBaseName}${collisionSuffix}`
      if (nextName === entry.name) continue
      const destination = path.join(publicationRoot, nextName)
      if (fs.existsSync(destination)) throw new Error(`No se puede marcar el álbum como listo porque ya existe ${nextName}.`)
      fs.renameSync(directory, destination)
      directoryRenames.push({ from: directory, to: destination })
      const oldPrefix = `pc-outbox/publications/${entry.name}/`
      const newPrefix = `pc-outbox/publications/${nextName}/`
      for (const item of publications) {
        if (item.postId !== postId) continue
        item.manifestPath = item.manifestPath.replace(oldPrefix, newPrefix)
        item.captionPath = item.captionPath.replace(oldPrefix, newPrefix)
      }
    }
  }
  for (const item of publications) item.used = usedTargets.has(`${item.postId}\u0000${item.targetId}`)
  let catalogBackupPath: string | null = null
  try {
    if (originalPublicationsText !== JSON.stringify(publications)) {
      catalogBackupPath = preservedBackupPath ? (writeMobileCatalog(root, publications), preservedBackupPath) : writeMobileCatalogWithBackup(root, publications)
    }
  } catch (error) {
    for (const rename of directoryRenames.reverse()) {
      if (fs.existsSync(rename.to) && !fs.existsSync(rename.from)) fs.renameSync(rename.to, rename.from)
    }
    throw error
  }
  const cleanup = cleanUnreferencedMobileAlbums(root, publications)
  return { pruned: prunedEntries, cleaned: cleanup.removed.length, cleanupFailed: cleanup.failed, missingAlbums, catalogBackupPaths: catalogBackupPath ? [catalogBackupPath] : preservedBackupPath ? [preservedBackupPath] : [] }
}

  return { mobileSyncRoot, getMobileCatalogStatus, getMobileReconcilePreview, exportMobilePublications, updateMobileCatalogAfterUsage }
}

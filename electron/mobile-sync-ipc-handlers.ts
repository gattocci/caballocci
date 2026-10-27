import { app, dialog, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { PlannerDatabase } from './database'
import { importMobileUsageFiles } from './mobile-sync'
import type { createMobileSyncService } from './mobile-sync-service'
import { validateArgumentCount, validateId, validateNoArguments } from './ipc-validation'

type MobileSyncIpcDependencies = {
  database: PlannerDatabase
  getMainWindow(): BrowserWindow | null
  mobileSync: ReturnType<typeof createMobileSyncService>
  handle(channel: string, callback: (args: unknown[], event: IpcMainInvokeEvent) => unknown): void
  withoutArguments(callback: () => unknown): (args: unknown[]) => unknown
}

export function registerMobileSyncIpcHandlers({ database, getMainWindow, mobileSync, handle, withoutArguments }: MobileSyncIpcDependencies) {
  const phoneExportPreferenceKey = 'caballocci.phone-export-root'
  const mobileSyncPreferenceKey = 'caballocci.mobile-sync-root'
  handle('media:phone-export-folder', withoutArguments(() => {
    return mobileSync.mobileSyncRoot()
  }))
  handle('media:export-to-phone', async args => {
    if (args.length < 1 || args.length > 2) throw new TypeError('Argumento IPC no valido: media.exportToPhone')
    const postId = validateId(args[0], 'post.id')
    const chooseFolder = args[1] === undefined ? false : (() => {
      const options = args[1]
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Opciones de exportaciÃ³n no vÃ¡lidas')
      const value = (options as Record<string, unknown>).chooseFolder
      if (value !== undefined && typeof value !== 'boolean') throw new TypeError('OpciÃ³n chooseFolder no vÃ¡lida')
      return value === true
    })()
    return mobileSync.exportMobilePublications([postId], chooseFolder)
  })
  handle('mobile-sync:choose-folder', async args => {
    validateNoArguments(args)
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Ventana principal no disponible')
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    const root = result.filePaths[0]
    database.savePreferences({ [mobileSyncPreferenceKey]: root })
    return root
  })
  handle('mobile-sync:folder', args => {
    validateNoArguments(args)
    return mobileSync.mobileSyncRoot()
  })
  handle('mobile-sync:status', args => {
    validateNoArguments(args)
    return mobileSync.getMobileCatalogStatus(mobileSync.mobileSyncRoot())
  })
  handle('mobile-sync:publication-state', args => {
    validateNoArguments(args)
    const root = mobileSync.mobileSyncRoot()
    if (!root) return { configured: false, currentPostIds: [], previouslyExportedPostIds: [] }
    const outbox = path.join(root, 'pc-outbox')
    const currentPostIds = new Set<string>()
    const catalogPath = path.join(outbox, 'catalog.json')
    if (fs.existsSync(catalogPath)) {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as { schema?: unknown; version?: unknown; publications?: unknown }
      if (catalog.schema !== 'caballocci.mobile-sync.catalog' || catalog.version !== 1 || !Array.isArray(catalog.publications)) {
        throw new TypeError('El catÃ¡logo mÃ³vil no tiene un formato compatible; no se pudo consultar su estado.')
      }
      for (const publication of catalog.publications as Array<{ postId?: unknown }>) {
        if (typeof publication.postId === 'string' && publication.postId) currentPostIds.add(publication.postId)
      }
    }
    const exportedPostIds = new Set(currentPostIds)
    const batchHistoryPath = path.join(outbox, 'batch-history.json')
    if (fs.existsSync(batchHistoryPath)) {
      const history = JSON.parse(fs.readFileSync(batchHistoryPath, 'utf8')) as unknown
      if (!Array.isArray(history)) throw new TypeError('El historial de lotes mÃ³vil no es vÃ¡lido.')
      for (const batch of history as Array<{ postIds?: unknown }>) {
        if (Array.isArray(batch.postIds)) for (const postId of batch.postIds) if (typeof postId === 'string' && postId) exportedPostIds.add(postId)
      }
    }
    return {
      configured: true,
      currentPostIds: [...currentPostIds],
      previouslyExportedPostIds: [...exportedPostIds].filter(postId => !currentPostIds.has(postId)),
    }
  })
  handle('mobile-sync:reconcile', args => {
    validateNoArguments(args)
    const root = mobileSync.mobileSyncRoot()
    if (!root) throw new Error('Primero elige la carpeta compartida de Syncthing.')
    const result = mobileSync.updateMobileCatalogAfterUsage(root, true)
    return {
      missingAlbums: result.missingAlbums,
      pruned: result.pruned,
      cleaned: result.cleaned,
      cleanupFailed: result.cleanupFailed,
      catalogBackupPath: result.catalogBackupPaths.at(-1) || null,
    }
  })
  handle('mobile-sync:preview-reconcile', args => {
    validateNoArguments(args)
    const root = mobileSync.mobileSyncRoot()
    if (!root) throw new Error('Primero elige la carpeta compartida de Syncthing.')
    return mobileSync.getMobileReconcilePreview(root)
  })
  handle('mobile-sync:read-catalog', args => {
    if (args.length > 1) throw new TypeError('Argumentos IPC no vÃ¡lidos: mobile-sync:read-catalog')
    const root = mobileSync.mobileSyncRoot()
    if (!root) throw new Error('Primero elige la carpeta compartida de Syncthing.')
    let archiveName: string | undefined
    if (args.length === 1) {
      const value = args[0]
      if (typeof value !== 'string' || path.basename(value) !== value || !/^catalog-[\w.-]+\.json$/.test(value)) {
        throw new TypeError('Nombre de copia de catÃ¡logo no vÃ¡lido.')
      }
      archiveName = value
    }
    const catalogPath = archiveName === undefined
      ? path.join(root, 'pc-outbox', 'catalog.json')
      : path.join(root, 'pc-outbox', 'catalog-history', archiveName)
    if (!fs.existsSync(catalogPath)) throw new Error(archiveName ? 'No se encontrÃ³ esa copia del catÃ¡logo.' : 'TodavÃ­a no existe pc-outbox/catalog.json.')
    const stat = fs.statSync(catalogPath)
    if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('catalog.json no es un archivo vÃ¡lido o supera 10 MB.')
    const text = fs.readFileSync(catalogPath, 'utf8')
    JSON.parse(text)
    return { path: catalogPath, text }
  })
  handle('mobile-sync:list-catalog-backups', args => {
    validateNoArguments(args)
    const root = mobileSync.mobileSyncRoot()
    if (!root) throw new Error('Primero elige la carpeta compartida de Syncthing.')
    const historyRoot = path.join(root, 'pc-outbox', 'catalog-history')
    if (!fs.existsSync(historyRoot)) return []
    return fs.readdirSync(historyRoot, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^catalog-[\w.-]+\.json$/.test(entry.name))
      .map(entry => {
        const stat = fs.statSync(path.join(historyRoot, entry.name))
        let publications = 0
        let destinations = 0
        let batches = 0
        try {
          if (stat.size <= 10 * 1024 * 1024) {
            const catalog = JSON.parse(fs.readFileSync(path.join(historyRoot, entry.name), 'utf8')) as { publications?: unknown }
            if (Array.isArray(catalog.publications)) {
              const entries = catalog.publications as Array<{ postId?: unknown; batch?: unknown }>
              destinations = entries.length
              publications = new Set(entries.map(item => item.postId).filter((id): id is string => typeof id === 'string')).size
              batches = new Set(entries.map(item => item.batch).filter((batch): batch is string => typeof batch === 'string' && batch.length > 0)).size
            }
          }
        } catch { /* Se podrÃ¡ inspeccionar el archivo y la vista previa informarÃ¡ si el JSON estÃ¡ daÃ±ado. */ }
        return { name: entry.name, createdAt: stat.mtime.toISOString(), publications, destinations, batches }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name))
  })
  handle('mobile-sync:open-catalog-history', args => {
    validateNoArguments(args)
    const root = mobileSync.mobileSyncRoot()
    if (!root) throw new Error('Primero elige la carpeta compartida de Syncthing.')
    const historyRoot = path.join(root, 'pc-outbox', 'catalog-history')
    fs.mkdirSync(historyRoot, { recursive: true })
    return shell.openPath(historyRoot)
  })
  handle('mobile-sync:export', async args => {
    validateNoArguments(args)
    return mobileSync.exportMobilePublications()
  })
  handle('mobile-sync:export-selected', async args => {
    validateArgumentCount(args, 1)
    if (!Array.isArray(args[0]) || args[0].length < 1 || args[0].length > 2_000) {
      throw new TypeError('Selecciona entre 1 y 2000 publicaciones para exportar.')
    }
    const postIds = args[0].map((id, index) => validateId(id, `postIds[${index}]`))
    if (new Set(postIds).size !== postIds.length) throw new TypeError('La selecciÃ³n contiene publicaciones repetidas.')
    return mobileSync.exportMobilePublications(postIds)
  })
  handle('mobile-sync:import', args => {
    validateNoArguments(args)
    const root = mobileSync.mobileSyncRoot()
    if (!root) throw new Error('Primero elige la carpeta compartida de Syncthing.')
    const report = importMobileUsageFiles(root, (postId, targetId) => {
      const post = database.getPost(postId)
      if (!post) return false
      const platforms = JSON.parse(String(post.platforms || '[]')) as unknown[]
      const parsedTargets = JSON.parse(String(post.distribution_json || '[]')) as unknown[]
      const targets = parsedTargets.length ? parsedTargets : platforms.map(id => ({ id }))
      return targets.some(target => typeof target === 'object' && target !== null && String((target as Record<string, unknown>).id || '') === targetId)
    }, event => database.recordMobileUsage({
      eventId: event.eventId,
      postId: event.postId,
      targetId: event.targetId,
      action: event.action,
      usedAt: event.usedAt,
      deviceId: event.deviceId,
      version: event.version,
    }))
    return report
  })
  handle('mobile-sync:history', args => {
    validateNoArguments(args)
    const usage = database.listMobileUsage().slice(-100).map(event => {
      const postId = String(event.post_id)
      const targetId = String(event.target_id)
      const post = database.getPost(postId)
      let targetName = targetId
      if (post) {
        try {
          const targets = JSON.parse(String(post.distribution_json || '[]')) as Array<Record<string, unknown>>
          targetName = String(targets.find(target => String(target.id || '') === targetId)?.name || targetId)
        } catch {
          targetName = targetId
        }
      }
      return {
        eventId: String(event.event_id),
        postId,
        postTitle: post ? String(post.title || '') : 'PublicaciÃ³n eliminada',
        action: String(event.action) === 'removed' ? 'removed' : 'used',
        targetId,
        targetName,
        usedAt: String(event.used_at),
        deviceId: String(event.device_id),
      }
    })
    const missing = database.listMobileAlbumCleanup().slice(-100).map(event => ({
      eventId: String(event.event_id), postId: String(event.post_id),
      postTitle: String(event.title || '') || 'PublicaciÃ³n eliminada',
      action: 'folder_missing' as const, targetId: '', targetName: String(event.folder_name || 'Carpeta borrada de Syncthing'),
      reason: String(event.reason || ''), usedAt: String(event.occurred_at), deviceId: '',
    }))
    return [...usage, ...missing].sort((a, b) => Date.parse(b.usedAt) - Date.parse(a.usedAt)).slice(0, 100)
  })
}

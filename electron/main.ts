import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, net, protocol, shell, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import os from 'node:os'
import AdmZip from 'adm-zip'
import { pathToFileURL } from 'node:url'
import { PlannerDatabase } from './database'
import type { PhoneFile } from './media-export'
import { createMobileSyncService } from './mobile-sync-service'
import { registerIdeaIpcHandlers } from './idea-ipc-handlers'
import { registerIntegrationIpcHandlers } from './integration-ipc-handlers'
import { registerMobileSyncIpcHandlers } from './mobile-sync-ipc-handlers'
import { registerMediaIpcHandlers } from './media-ipc-handlers'
import { registerConceptMapIpcHandlers } from './concept-map-ipc-handlers'
import { registerPostsIpcHandlers } from './posts-ipc-handlers'
import { validateArgumentCount, validateClipboardText, validateId, validateNoArguments } from './ipc-validation'
import { UpdateManager } from './updater'
import { createStartupSplashWindow } from './splash'

let mainWindow: BrowserWindow | null = null
let allowMainWindowClose = false
let lastCloseRequestAt = 0
let closeRequestTimer: NodeJS.Timeout | undefined
let splashWindow: BrowserWindow | null = null
let splashShownAt = 0
let splashReady = false
let splashStatus = 'Iniciando caballocci'
let database: PlannerDatabase
let updater: UpdateManager
let mediaWorkspaceRoot = ''
let activeIpcOperations = 0
let ipcQuiescingForUpdate = false
let ipcOperationsPaused = false
const ipcIdleWaiters = new Set<() => void>()

function setSplashStatus(status: string) {
  splashStatus = status
  if (splashReady && splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:status', status)
  }
}

const devServerUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL
const rendererFilePath = path.join(__dirname, '../dist/index.html')
const rendererFileUrl = pathToFileURL(rendererFilePath).href
const mediaScheme = 'caballocci-media'
const phoneExportPreferenceKey = 'caballocci.phone-export-root'
const mobileSyncPreferenceKey = 'caballocci.mobile-sync-root'
const syncthingUiPreferenceKey = 'caballocci.syncthing-ui-url'
const defaultSyncthingUiUrl = 'http://127.0.0.1:8384'
const syncthingDownloadsUrl = 'https://syncthing.net/downloads/'
const mobileAppReleaseApiUrl = 'https://api.github.com/repos/gattocci/caballocci/releases/latest'
const mobileSync = createMobileSyncService({ getDatabase: () => database, getMainWindow: () => mainWindow, mapPost, restoreTargetMedia, isPhonePresentationRole })

type TrackedOptionalIntegration = {
  integrationId: string
  child: ChildProcess
  startedAt: number
  cpuTimeSeconds: number | null
  sampledAt: number
  cpuPercent: number | null
  memoryBytes: number | null
  metricsAvailable: boolean
}

type OptionalIntegrationLastRun = { startedAt: number; endedAt: number }

const trackedOptionalIntegrations = new Map<number, TrackedOptionalIntegration>()
const optionalIntegrationLastRuns = new Map<string, OptionalIntegrationLastRun>()
let optionalIntegrationMonitor: NodeJS.Timeout | undefined
let optionalIntegrationPollActive = false
let optionalIntegrationMetricsErrorLogged = false

function optionalIntegrationStatuses() {
  const integrationIds = new Set([...optionalIntegrationLastRuns.keys(), ...[...trackedOptionalIntegrations.values()].map(item => item.integrationId)])
  return [...integrationIds].map(integrationId => {
    const instances = [...trackedOptionalIntegrations.values()].filter(item => item.integrationId === integrationId)
    if (instances.length) {
      const startedAt = Math.min(...instances.map(item => item.startedAt))
      return {
        integrationId,
        state: 'running' as const,
        startedAt,
        durationMs: Math.max(0, Date.now() - startedAt),
        instanceCount: instances.length,
        cpuPercent: instances.every(item => item.cpuPercent !== null) ? instances.reduce((total, item) => total + (item.cpuPercent || 0), 0) : null,
        memoryBytes: instances.every(item => item.memoryBytes !== null) ? instances.reduce((total, item) => total + (item.memoryBytes || 0), 0) : null,
        metricsAvailable: instances.every(item => item.metricsAvailable),
      }
    }
    const lastRun = optionalIntegrationLastRuns.get(integrationId)
    return {
      integrationId,
      state: lastRun ? 'stopped' as const : 'not-started' as const,
      startedAt: lastRun?.startedAt ?? null,
      durationMs: lastRun ? Math.max(0, lastRun.endedAt - lastRun.startedAt) : 0,
      instanceCount: 0,
      cpuPercent: null,
      memoryBytes: null,
      metricsAvailable: false,
    }
  })
}

function notifyOptionalIntegrationStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('system:optional-integration-status', optionalIntegrationStatuses())
  }
}

function stopOptionalIntegrationMonitorWhenIdle() {
  if (trackedOptionalIntegrations.size === 0 && optionalIntegrationMonitor) {
    clearInterval(optionalIntegrationMonitor)
    optionalIntegrationMonitor = undefined
  }
}

function pollOptionalIntegrationMetrics() {
  if (optionalIntegrationPollActive || trackedOptionalIntegrations.size === 0) return
  if (process.platform !== 'win32') {
    for (const item of trackedOptionalIntegrations.values()) item.metricsAvailable = false
    notifyOptionalIntegrationStatus()
    return
  }

  optionalIntegrationPollActive = true
  const ids = [...trackedOptionalIntegrations.keys()].filter(Number.isSafeInteger)
  const command = `$ids=@(${ids.join(',')}); Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object Id,CPU,WorkingSet64 | ConvertTo-Json -Compress`
  execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
    optionalIntegrationPollActive = false
    if (error) {
      for (const item of trackedOptionalIntegrations.values()) item.metricsAvailable = false
      if (!optionalIntegrationMetricsErrorLogged) {
        console.error('No se pudo consultar el uso de recursos de las integraciones opcionales:', error.message)
        optionalIntegrationMetricsErrorLogged = true
      }
      notifyOptionalIntegrationStatus()
      return
    }
    try {
      const parsed: unknown = stdout.trim() ? JSON.parse(stdout) as unknown : []
      const rows = Array.isArray(parsed) ? parsed : [parsed]
      const samples = new Map<number, { cpuTimeSeconds: number; memoryBytes: number }>()
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const values = row as Record<string, unknown>
        const pid = Number(values.Id)
        const cpuTimeSeconds = values.CPU == null ? Number.NaN : Number(values.CPU)
        const memoryBytes = values.WorkingSet64 == null ? Number.NaN : Number(values.WorkingSet64)
        if (Number.isSafeInteger(pid) && Number.isFinite(cpuTimeSeconds) && Number.isFinite(memoryBytes)) {
          samples.set(pid, { cpuTimeSeconds, memoryBytes })
        }
      }
      const sampledAt = Date.now()
      for (const [pid, item] of trackedOptionalIntegrations) {
        const sample = samples.get(pid)
        if (!sample) {
          item.metricsAvailable = false
          item.cpuPercent = null
          item.memoryBytes = null
          continue
        }
        const elapsedSeconds = (sampledAt - item.sampledAt) / 1_000
        item.cpuPercent = item.cpuTimeSeconds === null || elapsedSeconds <= 0
          ? null
          : Math.min(100, Math.max(0, ((sample.cpuTimeSeconds - item.cpuTimeSeconds) / elapsedSeconds / Math.max(1, os.cpus().length)) * 100))
        item.cpuTimeSeconds = sample.cpuTimeSeconds
        item.sampledAt = sampledAt
        item.memoryBytes = sample.memoryBytes
        item.metricsAvailable = true
      }
      optionalIntegrationMetricsErrorLogged = false
      notifyOptionalIntegrationStatus()
    } catch (parseError) {
      if (!optionalIntegrationMetricsErrorLogged) {
        console.error('La consulta de recursos de las integraciones opcionales devolvió datos no válidos:', parseError)
        optionalIntegrationMetricsErrorLogged = true
      }
      for (const item of trackedOptionalIntegrations.values()) item.metricsAvailable = false
      notifyOptionalIntegrationStatus()
    }
  })
}

function startOptionalIntegrationMonitor() {
  if (!optionalIntegrationMonitor) {
    optionalIntegrationMonitor = setInterval(pollOptionalIntegrationMetrics, 3_000)
    optionalIntegrationMonitor.unref()
  }
  pollOptionalIntegrationMetrics()
}

function getOptionalIntegrationIcon(filePath: string) {
  return app.getFileIcon(filePath, { size: 'large' }).then(icon => icon.isEmpty() ? null : icon.resize({ width: 64, height: 64 }).toDataURL()).catch(error => {
    console.warn('No se pudo leer el icono del ejecutable; se usará el icono genérico:', error)
    return null
  })
}

async function findMobileAppReleaseAsset() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(mobileAppReleaseApiUrl, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'caballocci-desktop' },
      signal: controller.signal,
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub respondió con el estado ${response.status} al consultar la última versión.`)
    const release: unknown = await response.json()
    if (!release || typeof release !== 'object' || Array.isArray(release)) throw new Error('GitHub devolvió información de versión no válida.')
    const assets = (release as Record<string, unknown>).assets
    if (!Array.isArray(assets)) throw new Error('La última versión no contiene una lista de archivos válida.')
    const asset = assets.find(value => value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).name === 'caballocci-android.apk')
    if (!asset || typeof (asset as Record<string, unknown>).browser_download_url !== 'string') return null
    const downloadUrl = new URL((asset as Record<string, unknown>).browser_download_url as string)
    if (downloadUrl.protocol !== 'https:' || downloadUrl.hostname !== 'github.com') throw new Error('La dirección de descarga del APK no es de confianza.')
    return downloadUrl.href
  } finally {
    clearTimeout(timeout)
  }
}

protocol.registerSchemesAsPrivileged([{
  scheme: mediaScheme,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])

function validateSyncthingUiUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2_048) throw new TypeError('La dirección de Syncthing no es válida.')
  let url: URL
  try { url = new URL(value) } catch { throw new TypeError('Escribe una URL completa, por ejemplo http://127.0.0.1:8384.') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new TypeError('La dirección debe usar HTTP o HTTPS y no incluir credenciales.')
  }
  return url.href
}

function isTrustedRendererUrl(candidate: string) {
  try {
    const actual = new URL(candidate)
    actual.hash = ''
    actual.search = ''
    if (devServerUrl) {
      const expected = new URL(devServerUrl)
      return actual.origin === expected.origin && actual.pathname === expected.pathname
    }

    return actual.href === rendererFileUrl
  } catch {
    return false
  }
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent) {
  const window = mainWindow
  const frame = event.senderFrame
  if (
    !window || window.isDestroyed() || !frame ||
    event.sender !== window.webContents ||
    frame !== window.webContents.mainFrame ||
    !isTrustedRendererUrl(frame.url)
  ) {
    throw new Error('Solicitud IPC rechazada')
  }
}

function trackIpcOperation(channel: string) {
  if (channel.startsWith('updates:')) return () => {}
  if (ipcOperationsPaused) throw new Error('La aplicación está finalizando una actualización.')
  activeIpcOperations += 1
  let finished = false
  return () => {
    if (finished) return
    finished = true
    activeIpcOperations -= 1
    if (activeIpcOperations === 0 && ipcQuiescingForUpdate) {
      ipcOperationsPaused = true
      for (const resolve of ipcIdleWaiters) resolve()
      ipcIdleWaiters.clear()
    }
  }
}

function waitForIpcOperations() {
  ipcQuiescingForUpdate = true
  if (activeIpcOperations === 0) {
    ipcOperationsPaused = true
    return Promise.resolve()
  }
  return new Promise<void>(resolve => ipcIdleWaiters.add(resolve))
}

function resumeIpcOperations() {
  ipcQuiescingForUpdate = false
  ipcOperationsPaused = false
}

function handle(channel: string, callback: (args: unknown[], event: IpcMainInvokeEvent) => unknown) {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertTrustedIpcSender(event)
    const finishTracking = trackIpcOperation(channel)
    try {
      const result = callback(args, event)
      if (!result || typeof (result as Promise<unknown>).then !== 'function') {
        finishTracking()
        return result
      }
      return Promise.resolve(result).catch(async error => {
        if (error instanceof WebAssembly.RuntimeError || (error && typeof error === 'object' && 'name' in error && String((error as { name?: unknown }).name) === 'RuntimeError')) {
          database = await database.reopenFromDisk()
        }
        throw error
      }).finally(finishTracking)
    } catch (error) {
      if (error instanceof WebAssembly.RuntimeError || (error && typeof error === 'object' && 'name' in error && String((error as { name?: unknown }).name) === 'RuntimeError')) {
        return database.reopenFromDisk().then((replacement) => {
          database = replacement
          throw error
        }).finally(finishTracking)
      }
      finishTracking()
      throw error
    }
  })
}

function withoutArguments(callback: () => unknown) {
  return (args: unknown[]) => {
    validateNoArguments(args)
    return callback()
  }
}

function fileErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : ''
}

function isPhonePresentationRole(value: unknown): value is NonNullable<PhoneFile['presentationRole']> {
  return value === 'representative' || value === 'cover' || value === 'slide' || value === 'closing' || value === 'other'
}

function mapMediaAssets(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || '[]')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(item => typeof item === 'object' && item !== null && !Array.isArray(item))
      .map(item => {
        const asset = item as Record<string, unknown>
        const compressed = typeof asset.id === 'string' && Boolean(database?.getMediaCompressionState(asset.id))
        return { id: asset.id, name: asset.name, kind: asset.kind, size: asset.size, mode: asset.mode, presentationRole: asset.presentationRole, sequence: asset.sequence, groupName: asset.groupName, compressed }
      })
  } catch {
    return []
  }
}

function mapIdeaBlocks(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || '[]')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(item => typeof item === 'object' && item !== null && !Array.isArray(item))
      .map(item => {
        const block = item as Record<string, unknown>
        return { id: block.id, title: block.title, text: block.text }
      })
  } catch {
    return []
  }
}

function mapPost(row: Record<string, unknown>) {
  const platforms = JSON.parse(String(row.platforms || '[]')) as string[]
  let distribution = JSON.parse(String(row.distribution_json || '[]')) as unknown[]
  if (!distribution.length) distribution = platforms.map(id => ({ id, name: id, status: 'pending' }))
  return {
    id: row.id, title: row.title, caption: row.caption, notes: row.notes,
    hashtags: JSON.parse(String(row.hashtags || '[]')), mentions: JSON.parse(String(row.mentions || '[]')),
    platforms, distribution, contentType: row.content_type, status: row.status,
    scheduledAt: row.scheduled_at, durationMinutes: row.duration_minutes, project: row.project, color: row.color,
    media: mapMediaAssets(row.media), ideaBlocks: mapIdeaBlocks(row.idea_blocks), sourceIdeaId: row.source_idea_id || null,
    isCombined: Number(row.combined_idea_count || 0) > 0,
    combinedIdeaIds: parseJsonStringArray(row.combined_idea_ids),
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function mapWorkGroup(row: Record<string, unknown>) {
  const postIds = Array.isArray(row.post_ids) ? row.post_ids.map(String) : []
  const postIdSet = new Set(postIds)
  const compressedIds = new Set(database.compressedMediaIds())
  const compressedMediaIds = new Set([
    ...database.list()
    .filter(post => postIdSet.has(String(post.id)))
    .flatMap(post => mapMediaAssets(post.media))
    .filter(asset => compressedIds.has(String(asset.id)))
    .map(asset => String(asset.id)),
    ...database.compressedMediaIdsForTarget('group', String(row.id)),
  ])
  const compressedMediaCount = compressedMediaIds.size
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    space: row.space || '',
    archivedAt: row.archived_at || null,
    postIds,
    compressedMediaCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapIdea(row: Record<string, unknown>) {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(String(row.tags || '[]')) as unknown
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === 'string')
  } catch {
    tags = []
  }
  const combinedPostIds = parseJsonStringArray(row.combined_post_ids)
  return {
    id: row.id, space: row.space, title: row.title, body: row.body, tags,
    media: mapMediaAssets(row.media), status: row.status, priority: row.priority,
    dueDate: row.due_at || null, postId: row.post_id || null, combinedPostId: combinedPostIds[0] || null, combinedPostIds,
    contentHash: row.content_hash || '', sourceName: row.source_name || '',
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function parseJsonStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || '[]')) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

function restoreTargetMedia(targetType: 'group' | 'post', targetId: string) {
  let postIds: Set<string>
  if (targetType === 'group') {
    const group = database.listWorkGroups().find(item => String(item.id) === targetId)
    if (!group) throw new Error('No se encontró la colección.')
    postIds = new Set(Array.isArray(group.post_ids) ? group.post_ids.map(String) : [])
  } else {
    if (!database.getPost(targetId)) throw new Error('No se encontró la publicación.')
    postIds = new Set([targetId])
  }
  const compressedIds = new Set(database.compressedMediaIds())
  const assetIds = [...new Set([
    ...database.compressedMediaIdsForTarget(targetType, targetId),
    ...database.list()
      .filter(post => postIds.has(String(post.id)))
      .flatMap(post => mapMediaAssets(post.media))
      .map(asset => String(asset.id))
      .filter(id => compressedIds.has(id)),
  ])]
  return database.restoreMedia(assetIds, app.getPath('userData'))
}

function mapIdeaNeighbor(row: Record<string, unknown>) {
  return { ...mapIdea(row), similarity: Number(row.similarity || 0) }
}

function registerMediaProtocol() {
  protocol.handle(mediaScheme, async request => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'asset') return new Response(null, { status: 404 })
      const id = validateId(decodeURIComponent(url.pathname.slice(1)), 'media.id')
      const media = database.getMediaFile(id)
      if (!media || media.kind !== 'image') {
        return new Response(null, { status: 404 })
      }
      if (path.isAbsolute(media.path) && fs.existsSync(media.path)) {
        return net.fetch(pathToFileURL(media.path).href, { bypassCustomProtocolHandlers: true })
      }
      if (media.archivePath && media.entryName && fs.existsSync(media.archivePath)) {
        const entry = new AdmZip(media.archivePath).getEntry(media.entryName)
        if (!entry) return new Response(null, { status: 404 })
        const extension = path.extname(media.path).toLowerCase()
        const contentType = extension === '.png' ? 'image/png' : extension === '.gif' ? 'image/gif' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
        return new Response(new Uint8Array(entry.getData()), { headers: { 'content-type': contentType } })
      }
      return new Response(null, { status: 404 })
    } catch {
      return new Response(null, { status: 400 })
    }
  })
}

async function createWindow() {
  const windowIcon = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../build/icon.png')
  mainWindow = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1120, minHeight: 720, show: false,
    icon: windowIcon,
    backgroundColor: '#101311', title: 'caballocci', titleBarStyle: 'hidden', titleBarOverlay: { color: '#101311', symbolColor: '#c9d0ca', height: 64 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })
  mainWindow.on('close', event => {
    if (allowMainWindowClose) return
    const now = Date.now()
    if (now - lastCloseRequestAt <= 2_000) {
      allowMainWindowClose = true
      clearTimeout(closeRequestTimer)
      closeRequestTimer = undefined
      return
    }
    event.preventDefault()
    lastCloseRequestAt = now
    mainWindow?.webContents.send('app:close-warning')
    clearTimeout(closeRequestTimer)
    closeRequestTimer = setTimeout(() => { lastCloseRequestAt = 0; closeRequestTimer = undefined }, 2_000)
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const preventUntrustedNavigation = (event: Electron.Event, targetUrl: string) => {
    if (!isTrustedRendererUrl(targetUrl)) event.preventDefault()
  }
  mainWindow.webContents.on('will-navigate', preventUntrustedNavigation)
  mainWindow.webContents.on('will-redirect', preventUntrustedNavigation)
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault())

  if (devServerUrl) await mainWindow.loadURL(devServerUrl)
  else await mainWindow.loadFile(rendererFilePath)
  mainWindow.once('ready-to-show', () => {
    void (async () => {
      const minimumSplashDurationMs = 4_500
      const remainingMs = Math.max(0, minimumSplashDurationMs - (Date.now() - splashShownAt))
      if (remainingMs > 0) await new Promise(resolve => setTimeout(resolve, remainingMs))
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.show()
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
      splashWindow = null
    })()
  })
}

app.setAppUserModelId('com.caballocci.desktop')
app.setName('caballocci')

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

app.whenReady().then(async () => {
  splashShownAt = Date.now()
  splashWindow = createStartupSplashWindow()
  splashWindow.webContents.once('did-finish-load', () => {
    splashReady = true
    setSplashStatus(splashStatus)
  })
  splashWindow.once('closed', () => { splashReady = false; splashWindow = null })
  setSplashStatus('Abriendo la base de datos')
  const wasmPath = app.isPackaged ? path.join(process.resourcesPath, 'sql-wasm.wasm') : path.join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm')
  const dataDirectory = app.getPath('userData')
  mediaWorkspaceRoot = dataDirectory
  const databasePath = path.join(dataDirectory, 'caballocci.sqlite')
  const backupsDirectory = path.join(dataDirectory, 'Backups')
  const appDataDirectory = app.getPath('appData')
  const legacyDatabasePaths = [
    path.join(dataDirectory, 'content-planner.sqlite'),
    path.join(appDataDirectory, 'Content Planner', 'content-planner.sqlite'),
    path.join(appDataDirectory, 'content-planner', 'content-planner.sqlite'),
    path.join(appDataDirectory, 'Electron', 'content-planner.sqlite'),
  ]
  const legacyDatabasePath = legacyDatabasePaths.find(candidate => fs.existsSync(candidate))
  if (!fs.existsSync(databasePath) && legacyDatabasePath) {
    fs.mkdirSync(dataDirectory, { recursive: true })
    fs.copyFileSync(legacyDatabasePath, databasePath)
  }
  database = new PlannerDatabase(databasePath, wasmPath, backupsDirectory)
  await database.init()
  setSplashStatus('Preparando tus publicaciones')
  database.list().forEach(row => ensurePostMediaFolder(String(row.project || ''), String(row.id)))
  registerMediaProtocol()
  updater = new UpdateManager(
    () => mainWindow,
    () => { database.createBackup('before-update') },
    waitForIpcOperations,
    resumeIpcOperations,
  )
  registerPostsIpcHandlers({ database, dataDirectory, handle, withoutArguments, mapPost, mapIdea, mapWorkGroup, restoreTargetMedia, ensurePostMediaFolder })
  registerIntegrationIpcHandlers({ database, handle, withoutArguments })
  registerIdeaIpcHandlers({ database, handle, withoutArguments, mapIdea, mapPost, mapIdeaNeighbor, ensurePostMediaFolder })
  registerConceptMapIpcHandlers({ database, handle, withoutArguments })
  handle('clipboard:write', args => {
    validateArgumentCount(args, 1)
    clipboard.writeText(validateClipboardText(args[0]))
  })
  handle('preferences:sync', args => {
    validateArgumentCount(args, 1)
    const incoming = args[0]
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new TypeError('Preferencias invalidas')
    const entries: Record<string, string> = {}
    for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
      if (key === phoneExportPreferenceKey) continue
      if (!/^caballocci\.[a-z0-9._-]+$/i.test(key) || typeof value !== 'string' || value.length > 2_000_000) continue
      entries[key] = value
    }
    const stored = database.listPreferences()
    database.savePreferences(entries)
    const synced = { ...stored, ...entries }
    delete synced[phoneExportPreferenceKey]
    return synced
  })
  handle('preferences:remove', args => {
    validateArgumentCount(args, 1)
    const key = String(args[0])
    if (!/^caballocci\.[a-z0-9._-]+$/i.test(key)) throw new TypeError('Preferencia invalida')
    database.removePreference(key)
  })
  handle('files:read-text', async args => {
    if (args.length !== 0) throw new TypeError('Argumento IPC no valido: files.readText')
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Ventana principal no disponible')
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Texto', extensions: ['md', 'markdown', 'txt'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    const stat = fs.statSync(filePath)
    if (stat.size > 10 * 1024 * 1024) throw new Error('El archivo supera el limite de 10 MB')
    return { name: path.basename(filePath), path: filePath, text: fs.readFileSync(filePath, 'utf8') }
  })
  handle('system:info', withoutArguments(() => ({
    version: app.getVersion(),
    workspacePath: dataDirectory,
    backupsPath: backupsDirectory,
    packaged: app.isPackaged,
    platform: process.platform,
    platformVersion: os.release(),
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    databaseSizeBytes: fs.statSync(databasePath).size,
    statistics: database.getStatistics(),
  })))
  handle('system:get-resource-usage', withoutArguments(() => {
    const metrics = app.getAppMetrics()
    return {
      cpuPercent: Math.min(100, metrics.reduce((total, metric) => total + metric.cpu.percentCPUUsage, 0)),
      memoryBytes: metrics.reduce((total, metric) => total + metric.memory.workingSetSize, 0) * 1024,
      processCount: metrics.length,
      sampledAt: Date.now(),
    }
  }))
  handle('system:choose-optional-integration', async args => {
    validateArgumentCount(args, 0)
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Ventana principal no disponible')
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Aplicaciones y scripts ejecutables', extensions: ['exe', 'bat', 'cmd'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return { path: result.filePaths[0], iconDataUrl: await getOptionalIntegrationIcon(result.filePaths[0]) }
  })
  handle('system:choose-optional-integration-icon', async args => {
    validateArgumentCount(args, 0)
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Ventana principal no disponible')
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'ico'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const iconPath = result.filePaths[0]
    if (fs.statSync(iconPath).size > 10 * 1024 * 1024) throw new Error('El archivo de icono supera el límite de 10 MB.')
    const icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) throw new Error('No se pudo leer el archivo de imagen seleccionado.')
    return icon.resize({ width: 64, height: 64 }).toDataURL()
  })
  handle('system:get-optional-integration-statuses', args => {
    validateArgumentCount(args, 0)
    return optionalIntegrationStatuses()
  })
  handle('system:launch-optional-integration', async args => {
    validateArgumentCount(args, 2)
    if (typeof args[0] !== 'string' || !args[0].trim() || args[0].length > 200) throw new TypeError('El identificador de integración no es válido.')
    if (typeof args[1] !== 'string' || !args[1].trim() || args[1].length > 32_000) throw new TypeError('La ruta del ejecutable no es válida.')
    const integrationId = args[0]
    const filePath = path.resolve(args[1].trim())
    if (!['.exe', '.bat', '.cmd'].includes(path.extname(filePath).toLowerCase())) throw new TypeError('Solo se pueden abrir archivos .exe, .bat o .cmd.')
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('El archivo seleccionado ya no existe o no es un archivo.')
    if (process.platform !== 'win32') throw new Error('El monitoreo de integraciones opcionales está disponible en Windows.')
    const extension = path.extname(filePath).toLowerCase()
    const child = extension === '.exe'
      ? spawn(filePath, [], { stdio: 'ignore', windowsHide: true })
      : spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${filePath}""`], { stdio: 'ignore', windowsHide: true })
    let trackedRun: TrackedOptionalIntegration | undefined
    await new Promise<void>((resolve, reject) => {
      let launched = false
      child.once('spawn', () => {
        if (!child.pid) {
          reject(new Error('Windows no devolvió un identificador de proceso para la integración.'))
          return
        }
        launched = true
        const startedAt = Date.now()
        trackedRun = {
          integrationId,
          child,
          startedAt,
          cpuTimeSeconds: null,
          sampledAt: startedAt,
          cpuPercent: null,
          memoryBytes: null,
          metricsAvailable: process.platform === 'win32',
        }
        trackedOptionalIntegrations.set(child.pid, trackedRun)
        optionalIntegrationLastRuns.set(integrationId, { startedAt, endedAt: startedAt })
        startOptionalIntegrationMonitor()
        notifyOptionalIntegrationStatus()
        resolve()
      })
      child.once('error', error => {
        if (!launched) reject(error)
        else console.error('Falló una integración opcional después de iniciarse:', error)
      })
      child.once('close', code => {
        if (!launched || !trackedRun) return
        const pid = child.pid
        if (pid) trackedOptionalIntegrations.delete(pid)
        optionalIntegrationLastRuns.set(integrationId, { startedAt: trackedRun.startedAt, endedAt: Date.now() })
        stopOptionalIntegrationMonitorWhenIdle()
        notifyOptionalIntegrationStatus()
      })
    })
  })
  handle('system:open-workspace', withoutArguments(() => shell.openPath(dataDirectory)))
  handle('system:open-space-folder', args => {
    if (args.length !== 1 || typeof args[0] !== 'string' || !args[0].trim()) throw new TypeError('Argumento IPC no valido: system.openSpaceFolder')
    const safeName = args[0].trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\.+$/g, '') || 'Espacio'
    const folder = path.join(dataDirectory, 'Spaces', safeName)
    fs.mkdirSync(folder, { recursive: true })
    fs.mkdirSync(path.join(folder, 'Posts'), { recursive: true })
    fs.mkdirSync(path.join(folder, 'Archive'), { recursive: true })
    return shell.openPath(folder)
  })
  handle('system:open-backups', withoutArguments(() => { fs.mkdirSync(backupsDirectory, { recursive: true }); return shell.openPath(backupsDirectory) }))
  handle('system:open-syncthing-downloads', withoutArguments(() => shell.openExternal(syncthingDownloadsUrl)))
  handle('system:open-syncthing-ui', args => {
    validateArgumentCount(args, 1)
    const url = validateSyncthingUiUrl(args[0])
    database.savePreferences({ [syncthingUiPreferenceKey]: url })
    return shell.openExternal(url)
  })
  handle('system:open-mobile-app-download', withoutArguments(async () => {
    const downloadUrl = await findMobileAppReleaseAsset()
    if (!downloadUrl) return { available: false }
    await shell.openExternal(downloadUrl)
    return { available: true }
  }))
  handle('system:create-backup', withoutArguments(() => database.createBackup('manual')))
  handle('updates:get-state', withoutArguments(() => updater.getState()))
  handle('updates:check', withoutArguments(() => updater.check()))
  handle('updates:download', withoutArguments(() => updater.download()))
  handle('updates:install', withoutArguments(async () => {
    const started = await updater.install()
    if (started) allowMainWindowClose = true
    return started
  }))
  handle('updates:open-release-notes', withoutArguments(() => updater.openReleaseNotes()))
  registerMobileSyncIpcHandlers({ database, getMainWindow: () => mainWindow, mobileSync, handle, withoutArguments })
  registerMediaIpcHandlers({ database, dataDirectory, getMainWindow: () => mainWindow, handle, withoutArguments, ensurePostMediaFolder, mapPost })
  setSplashStatus('Cargando el tablero')
  await createWindow()
  updater.startAutomaticChecks()
})
}

function ensurePostMediaFolder(project: string, postId: string) {
  const safeProject = project.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\.+$/g, '') || 'Mi contenido'
  const safePostId = postId.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\.+$/g, '') || crypto.randomUUID()
  const folder = path.join(mediaWorkspaceRoot, 'Spaces', safeProject, 'Posts', safePostId)
  fs.mkdirSync(folder, { recursive: true })
  return folder
}

app.on('before-quit', () => { updater?.onAppWillQuit(); database?.flush() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

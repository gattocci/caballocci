import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, shell, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { PlannerDatabase } from './database'
import {
  validateArgumentCount,
  validateClipboardText,
  validateConceptFolderInput,
  validateConceptLinkInput,
  validateConceptNodeInput,
  validateId,
  validateIdeaInput,
  validateMediaMode,
  validateNoArguments,
  validatePostInput,
  validateProject,
} from './ipc-validation'
import { UpdateManager } from './updater'

let mainWindow: BrowserWindow | null = null
let database: PlannerDatabase
let updater: UpdateManager
const devServerUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL
const rendererFilePath = path.join(__dirname, '../dist/index.html')
const rendererFileUrl = pathToFileURL(rendererFilePath).href
const mediaScheme = 'caballocci-media'

protocol.registerSchemesAsPrivileged([{
  scheme: mediaScheme,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])

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

function handle(channel: string, callback: (args: unknown[]) => unknown) {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertTrustedIpcSender(event)
    return callback(args)
  })
}

function withoutArguments(callback: () => unknown) {
  return (args: unknown[]) => {
    validateNoArguments(args)
    return callback()
  }
}

function mapMediaAssets(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || '[]')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(item => typeof item === 'object' && item !== null && !Array.isArray(item))
      .map(item => {
        const asset = item as Record<string, unknown>
        return { id: asset.id, name: asset.name, kind: asset.kind, size: asset.size, mode: asset.mode }
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
  return {
    id: row.id, title: row.title, caption: row.caption, notes: row.notes,
    hashtags: JSON.parse(String(row.hashtags || '[]')), mentions: JSON.parse(String(row.mentions || '[]')),
    platforms: JSON.parse(String(row.platforms || '[]')), contentType: row.content_type, status: row.status,
    scheduledAt: row.scheduled_at, durationMinutes: row.duration_minutes, project: row.project, color: row.color,
    media: mapMediaAssets(row.media), ideaBlocks: mapIdeaBlocks(row.idea_blocks), sourceIdeaId: row.source_idea_id || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
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
  return {
    id: row.id, space: row.space, title: row.title, body: row.body, tags,
    media: mapMediaAssets(row.media), status: row.status, priority: row.priority,
    dueDate: row.due_at || null, postId: row.post_id || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function mapConceptNode(row: Record<string, unknown>) {
  return {
    id: row.id, folderId: row.folder_id || null, kind: row.kind, sourceId: row.source_id || null,
    title: row.title, body: row.body, x: row.x, y: row.y,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function mapConceptFolder(row: Record<string, unknown>) {
  return { id: row.id, parentId: row.parent_id || null, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }
}

function mapConceptLink(row: Record<string, unknown>) {
  return {
    id: row.id, fromNodeId: row.from_node_id, toNodeId: row.to_node_id,
    relation: row.relation, createdAt: row.created_at,
  }
}

function registerMediaProtocol() {
  protocol.handle(mediaScheme, async request => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'asset') return new Response(null, { status: 404 })
      const id = validateId(decodeURIComponent(url.pathname.slice(1)), 'media.id')
      const media = database.getMediaFile(id)
      if (!media || media.kind !== 'image' || !path.isAbsolute(media.path) || !fs.existsSync(media.path)) {
        return new Response(null, { status: 404 })
      }
      return net.fetch(pathToFileURL(media.path).href, { bypassCustomProtocolHandlers: true })
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
    backgroundColor: '#101311', titleBarStyle: 'hidden', titleBarOverlay: { color: '#101311', symbolColor: '#c9d0ca', height: 64 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
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
  mainWindow.once('ready-to-show', () => mainWindow?.show())
}

app.setAppUserModelId('com.caballocci.desktop')

app.whenReady().then(async () => {
  const wasmPath = app.isPackaged ? path.join(process.resourcesPath, 'sql-wasm.wasm') : path.join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm')
  const dataDirectory = app.getPath('userData')
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
  registerMediaProtocol()
  updater = new UpdateManager(() => mainWindow, () => { database.createBackup('before-update') })
  handle('posts:list', withoutArguments(() => database.list().map(mapPost)))
  handle('posts:save', args => {
    validateArgumentCount(args, 1)
    return mapPost(database.save(validatePostInput(args[0])))
  })
  handle('posts:remove', args => {
    validateArgumentCount(args, 1)
    return database.remove(validateId(args[0], 'post.id'))
  })
  handle('posts:reassign-project', args => {
    validateArgumentCount(args, 2)
    return database.reassignProject(validateProject(args[0], 'fromProject'), validateProject(args[1], 'toProject'))
  })
  handle('ideas:list', withoutArguments(() => database.listIdeas().map(mapIdea)))
  handle('ideas:save', args => {
    validateArgumentCount(args, 1)
    return mapIdea(database.saveIdea(validateIdeaInput(args[0])))
  })
  handle('ideas:remove', args => {
    validateArgumentCount(args, 1)
    return database.removeIdea(validateId(args[0], 'idea.id'))
  })
  handle('ideas:convert', args => {
    validateArgumentCount(args, 1)
    const converted = database.convertIdea(validateId(args[0], 'idea.id'))
    return { idea: mapIdea(converted.idea), post: mapPost(converted.post) }
  })
  handle('concept-map:list', withoutArguments(() => {
    const conceptMap = database.listConceptMap()
    return { nodes: conceptMap.nodes.map(mapConceptNode), links: conceptMap.links.map(mapConceptLink), folders: conceptMap.folders.map(mapConceptFolder) }
  }))
  handle('concept-map:save-node', args => {
    validateArgumentCount(args, 1)
    return mapConceptNode(database.saveConceptNode(validateConceptNodeInput(args[0])))
  })
  handle('concept-map:remove-node', args => {
    validateArgumentCount(args, 1)
    return database.removeConceptNode(validateId(args[0], 'conceptMap.node.id'))
  })
  handle('concept-map:save-link', args => {
    validateArgumentCount(args, 1)
    return mapConceptLink(database.saveConceptLink(validateConceptLinkInput(args[0])))
  })
  handle('concept-map:remove-link', args => {
    validateArgumentCount(args, 1)
    return database.removeConceptLink(validateId(args[0], 'conceptMap.link.id'))
  })
  handle('concept-map:save-folder', args => {
    validateArgumentCount(args, 1)
    return mapConceptFolder(database.saveConceptFolder(validateConceptFolderInput(args[0])))
  })
  handle('concept-map:remove-folder', args => {
    validateArgumentCount(args, 1)
    return database.removeConceptFolder(validateId(args[0], 'conceptMap.folder.id'))
  })
  handle('clipboard:write', args => {
    validateArgumentCount(args, 1)
    clipboard.writeText(validateClipboardText(args[0]))
  })
  handle('system:info', withoutArguments(() => ({
    version: app.getVersion(),
    workspacePath: dataDirectory,
    backupsPath: backupsDirectory,
    packaged: app.isPackaged,
  })))
  handle('system:open-workspace', withoutArguments(() => shell.openPath(dataDirectory)))
  handle('system:open-backups', withoutArguments(() => { fs.mkdirSync(backupsDirectory, { recursive: true }); return shell.openPath(backupsDirectory) }))
  handle('system:create-backup', withoutArguments(() => database.createBackup('manual')))
  handle('updates:get-state', withoutArguments(() => updater.getState()))
  handle('updates:check', withoutArguments(() => updater.check()))
  handle('updates:download', withoutArguments(() => updater.download()))
  handle('updates:install', withoutArguments(() => updater.install()))
  handle('media:reveal', args => {
    validateArgumentCount(args, 1)
    const target = database.getMediaPath(validateId(args[0], 'media.id'))
    if (!target || !path.isAbsolute(target)) throw new Error('Archivo multimedia no encontrado')
    shell.showItemInFolder(target)
  })
  handle('media:list', withoutArguments(() => database.listMedia()))
  handle('media:choose', async args => {
    validateArgumentCount(args, 1)
    const mode = validateMediaMode(args[0])
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Ventana principal no disponible')
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile','multiSelections'], filters: [{ name:'Contenido', extensions:['png','jpg','jpeg','webp','gif','mp4','mov','pdf','doc','docx'] }] })
    if (result.canceled) return []
    const library = path.join(app.getPath('userData'), 'Media')
    if (mode === 'copy') fs.mkdirSync(library, { recursive: true })
    const assets = result.filePaths.map((source) => {
      let finalPath = source
      if (mode === 'copy') {
        const ext = path.extname(source); const name = `${path.basename(source, ext)}-${crypto.randomUUID()}${ext}`; finalPath = path.join(library, name); fs.copyFileSync(source, finalPath, fs.constants.COPYFILE_EXCL)
      }
      const stat = fs.statSync(finalPath); const ext = path.extname(finalPath).toLowerCase()
      return { id: crypto.randomUUID(), name:path.basename(finalPath), path:finalPath, size:stat.size, mode, kind:['.mp4','.mov'].includes(ext)?'video':['.png','.jpg','.jpeg','.webp','.gif'].includes(ext)?'image':'document' }
    })
    database.saveMedia(assets)
    return assets.map(asset => ({ id: asset.id, name: asset.name, size: asset.size, mode: asset.mode, kind: asset.kind }))
  })
  await createWindow()
  updater.startAutomaticChecks()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

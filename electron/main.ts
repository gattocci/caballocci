import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { PlannerDatabase } from './database'
import { UpdateManager } from './updater'

let mainWindow: BrowserWindow | null = null
let database: PlannerDatabase
let updater: UpdateManager
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

function mapPost(row: Record<string, unknown>) {
  return {
    id: row.id, title: row.title, caption: row.caption, notes: row.notes,
    hashtags: JSON.parse(String(row.hashtags || '[]')), mentions: JSON.parse(String(row.mentions || '[]')),
    platforms: JSON.parse(String(row.platforms || '[]')), contentType: row.content_type, status: row.status,
    scheduledAt: row.scheduled_at, durationMinutes: row.duration_minutes, project: row.project, color: row.color,
    media: JSON.parse(String(row.media || '[]')), createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

async function createWindow() {
  const windowIcon = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../build/icon.png')
  mainWindow = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1120, minHeight: 720, show: false,
    icon: windowIcon,
    backgroundColor: '#101311', titleBarStyle: 'hidden', titleBarOverlay: { color: '#101311', symbolColor: '#c9d0ca', height: 64 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  if (isDev) await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!)
  else await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
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
  updater = new UpdateManager(() => mainWindow, () => { database.createBackup('before-update') })
  ipcMain.handle('posts:list', () => database.list().map(mapPost))
  ipcMain.handle('posts:save', (_event, post) => mapPost(database.save(post)))
  ipcMain.handle('posts:remove', (_event, id) => database.remove(id))
  ipcMain.handle('posts:reassign-project', (_event, fromProject, toProject) => database.reassignProject(fromProject, toProject))
  ipcMain.handle('clipboard:write', (_event, text) => clipboard.writeText(text))
  ipcMain.handle('system:info', () => ({
    version: app.getVersion(),
    workspacePath: dataDirectory,
    backupsPath: backupsDirectory,
    packaged: app.isPackaged,
  }))
  ipcMain.handle('system:open-workspace', () => shell.openPath(dataDirectory))
  ipcMain.handle('system:open-backups', () => { fs.mkdirSync(backupsDirectory, { recursive: true }); return shell.openPath(backupsDirectory) })
  ipcMain.handle('system:create-backup', () => database.createBackup('manual'))
  ipcMain.handle('updates:get-state', () => updater.getState())
  ipcMain.handle('updates:check', () => updater.check())
  ipcMain.handle('updates:download', () => updater.download())
  ipcMain.handle('updates:install', () => updater.install())
  ipcMain.handle('media:reveal', (_event, target) => shell.showItemInFolder(target))
  ipcMain.handle('media:list', () => database.listMedia())
  ipcMain.handle('media:choose', async (_event, mode: 'copy' | 'reference') => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile','multiSelections'], filters: [{ name:'Contenido', extensions:['png','jpg','jpeg','webp','gif','mp4','mov','pdf','doc','docx'] }] })
    if (result.canceled) return []
    const library = path.join(app.getPath('userData'), 'Media')
    if (mode === 'copy') fs.mkdirSync(library, { recursive: true })
    const assets = result.filePaths.map((source) => {
      let finalPath = source
      if (mode === 'copy') {
        const ext = path.extname(source); const name = `${path.basename(source, ext)}-${Date.now()}${ext}`; finalPath = path.join(library, name); fs.copyFileSync(source, finalPath)
      }
      const stat = fs.statSync(finalPath); const ext = path.extname(finalPath).toLowerCase()
      return { id: crypto.randomUUID(), name:path.basename(finalPath), path:finalPath, size:stat.size, mode, kind:['.mp4','.mov'].includes(ext)?'video':['.png','.jpg','.jpeg','.webp','.gif'].includes(ext)?'image':'document' }
    })
    database.saveMedia(assets)
    return assets
  })
  await createWindow()
  updater.startAutomaticChecks()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

import { app, type BrowserWindow } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'

export type UpdateStatus = 'unavailable' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

export interface UpdateState {
  status: UpdateStatus
  message: string
  installedVersion: string
  availableVersion: string | null
  percent: number | null
  transferred: number | null
  total: number | null
}

export class UpdateManager {
  private state: UpdateState
  private configured = false

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly beforeInstall: () => void,
  ) {
    this.state = {
      status: app.isPackaged ? 'idle' : 'unavailable',
      message: app.isPackaged ? 'Listo para buscar actualizaciones.' : 'Las actualizaciones solo están disponibles en la aplicación instalada.',
      installedVersion: app.getVersion(),
      availableVersion: null,
      percent: null,
      transferred: null,
      total: null,
    }
  }

  startAutomaticChecks() {
    if (!app.isPackaged) return
    this.configure()
    setTimeout(() => { void this.check().catch(() => undefined) }, 10_000)
  }

  getState() { return { ...this.state } }

  async check() {
    if (!app.isPackaged) return this.getState()
    this.configure()
    this.setState({ status: 'checking', message: 'Buscando actualizaciones...', percent: null, transferred: null, total: null })
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.reportError(error)
    }
    return this.getState()
  }

  async download() {
    if (!app.isPackaged || this.state.status !== 'available') return this.getState()
    this.setState({ status: 'downloading', message: 'Descargando actualización...', percent: 0, transferred: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.reportError(error)
    }
    return this.getState()
  }

  install() {
    if (!app.isPackaged || this.state.status !== 'downloaded') return false
    this.beforeInstall()
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
    return true
  }

  private configure() {
    if (this.configured) return
    this.configured = true
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('checking-for-update', () => this.setState({ status: 'checking', message: 'Buscando actualizaciones...' }))
    autoUpdater.on('update-available', (info: UpdateInfo) => this.setState({
      status: 'available',
      message: 'Hay una actualización disponible.',
      availableVersion: info.version,
      percent: null,
      transferred: null,
      total: null,
    }))
    autoUpdater.on('update-not-available', () => this.setState({
      status: 'not-available',
      message: 'Tienes la versión más reciente.',
      availableVersion: null,
      percent: null,
      transferred: null,
      total: null,
    }))
    autoUpdater.on('download-progress', (progress: ProgressInfo) => this.setState({
      status: 'downloading',
      message: 'Descargando actualización...',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    }))
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => this.setState({
      status: 'downloaded',
      message: 'La actualización está lista para instalar.',
      availableVersion: info.version,
      percent: 100,
    }))
    autoUpdater.on('error', (error: Error) => this.reportError(error))
  }

  private reportError(error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    this.setState({ status: 'error', message: 'No se pudo completar la actualización: ' + detail })
  }

  private setState(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch }
    const window = this.getWindow()
    if (window && !window.isDestroyed()) window.webContents.send('updates:state', this.getState())
  }
}

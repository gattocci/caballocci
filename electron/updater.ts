import { app, shell, type BrowserWindow } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'

export type UpdateStatus = 'unavailable' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'installing' | 'error'

export interface UpdateState {
  status: UpdateStatus
  message: string
  installedVersion: string
  availableVersion: string | null
  releaseNotes: string | null
  releaseUrl: string | null
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
    private readonly waitForIdle: () => Promise<void>,
    private readonly resumeOperations: () => void,
  ) {
    this.state = {
      status: app.isPackaged ? 'idle' : 'unavailable',
      message: app.isPackaged ? 'Listo para buscar actualizaciones.' : 'Las actualizaciones solo están disponibles en la aplicación instalada.',
      installedVersion: app.getVersion(),
      availableVersion: null,
      releaseNotes: null,
      releaseUrl: null,
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
    if (this.state.status === 'checking' || this.state.status === 'downloading' || this.state.status === 'downloaded') return this.getState()
    this.configure()
    this.setState({
      status: 'checking',
      message: 'Buscando actualizaciones...',
      availableVersion: null,
      releaseNotes: null,
      releaseUrl: null,
      percent: null,
      transferred: null,
      total: null,
    })
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.reportError(error)
    }
    return this.getState()
  }

  async download() {
    const canDownload = this.state.status === 'available' || (this.state.status === 'error' && this.state.availableVersion !== null)
    if (!app.isPackaged || !canDownload) return this.getState()
    this.setState({ status: 'downloading', message: 'Descargando actualización...', percent: 0, transferred: 0, total: null })
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.reportError(error)
    }
    return this.getState()
  }

  async openReleaseNotes() {
    const url = this.state.releaseUrl || 'https://github.com/gattocci/caballocci/releases'
    await shell.openExternal(url)
  }

  async install() {
    if (!app.isPackaged || this.state.status !== 'downloaded') return false
    this.setState({ status: 'installing', message: 'Esperando a que terminen las operaciones en curso...' })
    try {
      await this.waitForIdle()
      this.beforeInstall()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.resumeOperations()
      this.setState({
        status: 'downloaded',
        message: 'No se pudo preparar la instalación. Puedes volver a intentarlo: ' + detail,
      })
      return false
    }
    // The user already confirmed this action inside caballocci.
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
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
      releaseNotes: this.formatReleaseNotes(info.releaseNotes),
      releaseUrl: this.releaseUrl(info.version),
      percent: null,
      transferred: null,
      total: null,
    }))
    autoUpdater.on('update-not-available', () => this.setState({
      status: 'not-available',
      message: 'Tienes la versión más reciente.',
      availableVersion: null,
      releaseNotes: null,
      releaseUrl: null,
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
      releaseNotes: this.formatReleaseNotes(info.releaseNotes),
      releaseUrl: this.releaseUrl(info.version),
      percent: 100,
      transferred: info.files?.[0]?.size ?? this.state.transferred,
      total: info.files?.[0]?.size ?? this.state.total,
    }))
    autoUpdater.on('error', (error: Error) => this.reportError(error))
  }

  private reportError(error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    this.setState({
      status: 'error',
      message: 'No se pudo completar la actualización: ' + detail,
      percent: null,
      transferred: null,
      total: null,
    })
  }

  private formatReleaseNotes(notes: UpdateInfo['releaseNotes']) {
    if (typeof notes === 'string') return notes.trim() || null
    if (!Array.isArray(notes)) return null
    const text = notes
      .map(note => note.note?.trim() || '')
      .filter(Boolean)
      .join('\n\n')
    return text || null
  }

  private releaseUrl(version: string) {
    return `https://github.com/gattocci/caballocci/releases/tag/v${encodeURIComponent(version)}`
  }

  private setState(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch }
    const window = this.getWindow()
    if (window && !window.isDestroyed()) window.webContents.send('updates:state', this.getState())
  }
}

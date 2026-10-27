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
  private automaticChecksStarted = false
  private automaticCheckTimer: ReturnType<typeof setTimeout> | null = null
  private installFallbackTimer: ReturnType<typeof setTimeout> | null = null
  private quittingForInstall = false
  private checkInProgress = false

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
    if (!app.isPackaged || this.automaticChecksStarted) return
    this.automaticChecksStarted = true
    this.configure()
    void this.runAutomaticCheck()
  }

  stopAutomaticChecks() {
    this.automaticChecksStarted = false
    if (this.automaticCheckTimer) clearTimeout(this.automaticCheckTimer)
    this.automaticCheckTimer = null
    if (this.installFallbackTimer) clearTimeout(this.installFallbackTimer)
    this.installFallbackTimer = null
  }

  onAppWillQuit() {
    this.quittingForInstall = true
    this.stopAutomaticChecks()
  }

  getState() { return { ...this.state } }

  async check() {
    if (!app.isPackaged) return this.getState()
    if (this.checkInProgress || ['checking', 'downloading', 'downloaded', 'installing'].includes(this.state.status)) return this.getState()
    this.configure()
    this.checkInProgress = true
    if (this.state.status !== 'available') this.setState({
      status: 'checking', message: 'Buscando actualizaciones...', percent: null, transferred: null, total: null,
    })
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.reportError(error)
    } finally {
      this.checkInProgress = false
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
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') throw new Error('La direcciÃ³n de las notas de versiÃ³n no es vÃ¡lida.')
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
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(true, true)
        this.installFallbackTimer = setTimeout(() => {
          if (this.quittingForInstall) return
          this.setState({ status: 'downloaded', message: 'La aplicaciÃ³n no se cerrÃ³ para instalar. Puedes volver a intentarlo.' })
        }, 15_000)
      } catch (error) {
        this.setState({ status: 'downloaded', message: 'No se pudo iniciar la instalaciÃ³n: ' + (error instanceof Error ? error.message : String(error)) })
      }
    })
    return true
  }

  private async runAutomaticCheck() {
    try {
      await this.check()
    } finally {
      if (!this.automaticChecksStarted) return
      const delay = this.state.status === 'error' ? 30 * 60 * 1_000 : 6 * 60 * 60 * 1_000
      this.scheduleAutomaticCheck(delay)
    }
  }

  private scheduleAutomaticCheck(delay: number) {
    if (this.automaticCheckTimer) clearTimeout(this.automaticCheckTimer)
    this.automaticCheckTimer = setTimeout(() => { this.automaticCheckTimer = null; void this.runAutomaticCheck() }, delay)
  }

  private configure() {
    if (this.configured) return
    this.configured = true
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
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
      transferred: this.state.transferred,
      total: this.state.total,
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
    if (this.automaticChecksStarted) this.scheduleAutomaticCheck(30 * 60 * 1_000)
  }

  private formatReleaseNotes(notes: UpdateInfo['releaseNotes']) {
    if (typeof notes === 'string') return this.notesAsPlainText(notes) || null
    if (!Array.isArray(notes)) return null
    const text = notes
      .map(note => this.notesAsPlainText(note.note || ''))
      .filter(Boolean)
      .join('\n\n')
    return text || null
  }

  private notesAsPlainText(notes: string) {
    return notes
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/(p|li|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
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

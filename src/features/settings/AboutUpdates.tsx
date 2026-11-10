import { useEffect, useState } from 'react'
import { Archive, BookOpen, Download, ExternalLink, FolderOpen, Globe2, RefreshCw, RotateCw, Smartphone } from 'lucide-react'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { ViewHeading } from '../../components/layout/AppShell'
import { MobileAppDownload } from '../../components/MobileAppDownload'
import type { AppResourceUsage, SystemInfo, UpdateState } from '../../shared/types'
import { MobileSyncSettings } from './MobileSyncSettings'
import { OptionalIntegrations } from './OptionalIntegrations'
import './about-updates.css'

const formatBytes = (bytes: number | null) => {
  if (bytes === null) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const formatCount = (value: number) => new Intl.NumberFormat('es').format(value)

const platformName = (platform: string) => ({
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
}[platform] || platform)

export function AboutUpdates() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [resourceUsage, setResourceUsage] = useState<AppResourceUsage | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [backupMessage, setBackupMessage] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const [showCollectionDate, setShowCollectionDate] = useState(() => { try { return localStorage.getItem('caballocci.collection-label-date') === 'true' } catch { return false } })

  useEffect(() => {
    void Promise.all([window.planner.system.info(), window.planner.updates.getState()]).then(([system, state]) => {
      setInfo(system)
      setUpdate(state)
    }).catch(error => reportAppError(error, 'No se pudo cargar la información de la aplicación'))
    return window.planner.updates.onStateChange(setUpdate)
  }, [])
  useEffect(() => {
    let active = true
    let requestPending = false
    const updateUsage = async () => {
      if (requestPending) return
      requestPending = true
      try {
        const usage = await window.planner.system.getResourceUsage()
        if (active) setResourceUsage(usage)
      } catch (error) {
        reportAppError(error, 'No se pudo consultar el consumo actual de caballocci')
      } finally {
        requestPending = false
      }
    }
    void updateUsage()
    const interval = window.setInterval(() => { void updateUsage() }, 3_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [])
  const createBackup = async () => {
    const backupPath = await window.planner.system.createBackup()
    setBackupMessage(`Backup creado: ${backupPath}`)
  }

  const busy = update?.status === 'checking' || update?.status === 'downloading' || update?.status === 'installing'
  return <section className="workspace about-workspace">
    <ViewHeading title="Acerca de / Actualizaciones" subtitle="Versión, datos locales y actualizaciones de caballocci." />
    <div className="about-layout">
      <section className="settings-section">
        <div className="settings-heading"><div><span>PERSONALIZACIÓN</span><h2>Etiquetas de colecciones</h2></div></div>
        <p className="settings-note">Elige qué información aparece junto a cada colección en la navegación lateral.</p>
        <label className="collection-date-setting"><input type="checkbox" checked={showCollectionDate} onChange={event => { const checked = event.target.checked; setShowCollectionDate(checked); try { localStorage.setItem('caballocci.collection-label-date', String(checked)) } catch { /* La preferencia es opcional. */ } window.dispatchEvent(new Event('caballocci-collection-label-change')) }} /><span><strong>Mostrar fecha de creación</strong><small>Desactivado: nombre y cantidad. Activado: nombre, fecha y cantidad.</small></span></label>
      </section>
      <section className="settings-section">
        <div className="settings-heading"><div><span>APLICACIÓN</span><h2>caballocci</h2></div><strong>v{info?.version || update?.installedVersion || '...'}</strong></div>
        <div className={`update-state ${update?.status || 'idle'}`}><div><strong>{update?.message || 'Consultando estado...'}</strong>{update?.availableVersion && <small>Versión disponible: {update.availableVersion}</small>}</div></div>
        {update?.status === 'downloading' && <div className="download-progress"><div><span>Descarga</span><b>{Math.round(update.percent || 0)}%</b></div><progress max="100" value={update.percent || 0} /><small>{formatBytes(update.transferred)} de {formatBytes(update.total)}</small></div>}
        <div className="settings-actions">
          <button className="settings-button" disabled={busy || update?.status === 'unavailable' || update?.status === 'downloaded'} onClick={() => void runWithErrorReporting(() => window.planner.updates.check(), 'No se pudieron buscar actualizaciones')}><RefreshCw size={16} /> Buscar actualizaciones</button>
          {(update?.status === 'available' || (update?.status === 'error' && update.availableVersion)) && <button className="settings-button primary" onClick={() => void runWithErrorReporting(() => window.planner.updates.download(), 'No se pudo descargar la actualización')}><Download size={16} /> {update.status === 'error' ? 'Reintentar descarga' : 'Descargar actualización'}</button>}
          {update?.status === 'downloaded' && <button className="settings-button primary" onClick={() => void runWithErrorReporting(() => window.planner.updates.install(), 'No se pudo instalar la actualización')}><RotateCw size={16} /> Reiniciar y actualizar</button>}
        </div>
        {update?.availableVersion && <div className="settings-actions update-notes-actions">
          <button className="settings-button" aria-expanded={notesOpen} onClick={() => setNotesOpen(open => !open)}><BookOpen size={15} /> {notesOpen ? 'Ocultar novedades' : 'Ver novedades'}</button>
          <button className="settings-button" onClick={() => void runWithErrorReporting(() => window.planner.updates.openReleaseNotes(), 'No se pudieron abrir las notas de versión')}><ExternalLink size={14} /> Ver en GitHub</button>
        </div>}
        {notesOpen && update?.availableVersion && <div className="release-notes">
          <strong>Novedades de la versión {update.availableVersion}</strong>
          <p>{update.releaseNotes || 'El lanzamiento no incluye notas detalladas. Puedes consultar la publicación en GitHub.'}</p>
        </div>}
        {update?.status === 'downloaded' && <p className="settings-note success">{update.preview ? 'La actualización simulada está lista para continuar.' : 'La actualización se aplicará en segundo plano y caballocci volverá a abrirse.'}</p>}
        {update?.status === 'updated' && <p className="settings-note success">{update.message}</p>}
        {!info?.packaged && <p className="settings-note">La comprobación de actualizaciones está deshabilitada durante el desarrollo. Se activa en el instalador empaquetado.</p>}
        {!info?.packaged && <div className="settings-actions"><button className="settings-button" onClick={() => void runWithErrorReporting(async () => setUpdate(await window.planner.updates.preview()), 'No se pudo iniciar la vista previa de la actualización')}>Previsualizar actualización</button></div>}
      </section>
      <section className="settings-section">
        <div className="settings-heading"><div><span>DATOS LOCALES</span><h2>Workspace</h2></div></div>
        <dl className="path-list"><div><dt>Ubicación del workspace</dt><dd>{info?.workspacePath || '...'}</dd></div><div><dt>Carpeta de backups</dt><dd>{info?.backupsPath || '...'}</dd></div></dl>
        <div className="settings-actions">
          <button className="settings-button" onClick={() => void runWithErrorReporting(() => window.planner.system.openWorkspace(), 'No se pudo abrir el workspace')}><FolderOpen size={16} /> Abrir workspace</button>
          <button className="settings-button" onClick={() => void runWithErrorReporting(() => window.planner.system.openBackups(), 'No se pudo abrir la carpeta de backups')}><Archive size={16} /> Abrir backups</button>
          <button className="settings-button" onClick={() => void runWithErrorReporting(createBackup, 'No se pudo crear el backup')}><Archive size={16} /> Crear backup ahora</button>
        </div>
        {backupMessage && <p className="settings-note success">{backupMessage}</p>}
      </section>
      <section className="settings-section app-information">
        <div className="settings-heading"><div><span>DATOS LOCALES</span><h2>Esta instalación</h2></div><strong>v{info?.version || '...'}</strong></div>
        <p className="settings-note">Información técnica y resumen de los datos guardados localmente. No se envía a ningún servicio.</p>
        <dl className="app-information-grid">
          <div><dt>Entorno</dt><dd>{info ? info.packaged ? 'Aplicación instalada' : 'Desarrollo' : '...'}</dd></div>
          <div><dt>Sistema operativo</dt><dd>{info ? `${platformName(info.platform)} ${info.platformVersion}` : '...'}</dd></div>
          <div><dt>Electron</dt><dd>{info?.electronVersion || '...'}</dd></div>
          <div><dt>Chromium</dt><dd>{info?.chromiumVersion || '...'}</dd></div>
          <div><dt>Base de datos local</dt><dd>{info ? formatBytes(info.databaseSizeBytes) : '...'}</dd></div>
          <div><dt>Archivos adjuntos registrados</dt><dd>{info ? `${formatCount(info.statistics.mediaFiles)} · ${formatBytes(info.statistics.mediaBytes)}` : '...'}</dd></div>
        </dl>
        <div className="app-resource-usage">
          <strong>Consumo actual de caballocci</strong>
          <div>
            <span><b>{resourceUsage ? `${resourceUsage.cpuPercent.toFixed(1)}%` : '...'}</b><small>CPU · {resourceUsage ? `${formatCount(resourceUsage.processCount)} procesos` : 'midiendo'}</small></span>
            <span><b>{resourceUsage ? formatBytes(resourceUsage.memoryBytes) : '...'}</b><small>Memoria RAM en uso</small></span>
          </div>
          <p>Consumo agregado de la aplicación y sus procesos auxiliares de Electron. Se actualiza cada 3 segundos.</p>
        </div>
        {info && <div className="app-content-summary">
          <strong>Contenido en este espacio</strong>
          <div>
            <span>{formatCount(info.statistics.posts)} <small>publicaciones</small></span>
            <span>{formatCount(info.statistics.ideas)} <small>ideas</small></span>
            <span>{formatCount(info.statistics.workGroups)} <small>colecciones</small></span>
            <span>{formatCount(info.statistics.sources)} <small>fuentes</small></span>
          </div>
        </div>}
      </section>
      <OptionalIntegrations />
      <MobileSyncSettings />
    </div>

  </section>
}

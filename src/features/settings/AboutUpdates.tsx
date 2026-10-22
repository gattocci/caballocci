import { useEffect, useState } from 'react'
import { Archive, BookOpen, Download, ExternalLink, FolderOpen, RefreshCw, RotateCw } from 'lucide-react'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { ViewHeading } from '../../components/layout/AppShell'
import type { SystemInfo, UpdateState } from '../../shared/types'
import './about-updates.css'

const formatBytes = (bytes: number | null) => {
  if (bytes === null) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function AboutUpdates() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [backupMessage, setBackupMessage] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)

  useEffect(() => {
    void Promise.all([window.planner.system.info(), window.planner.updates.getState()]).then(([system, state]) => {
      setInfo(system)
      setUpdate(state)
    }).catch(error => reportAppError(error, 'No se pudo cargar la información de la aplicación'))
    return window.planner.updates.onStateChange(setUpdate)
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
        <div className="settings-heading"><div><span>APLICACIÓN</span><h2>caballocci</h2></div><strong>v{info?.version || update?.installedVersion || '...'}</strong></div>
        <div className={`update-state ${update?.status || 'idle'}`}><span /><div><strong>{update?.message || 'Consultando estado...'}</strong>{update?.availableVersion && <small>Versión disponible: {update.availableVersion}</small>}</div></div>
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
        {update?.status === 'downloaded' && <p className="settings-note success">La actualización se aplicará en segundo plano y caballocci volverá a abrirse.</p>}
        {!info?.packaged && <p className="settings-note">La comprobación de actualizaciones está deshabilitada durante el desarrollo. Se activa en el instalador empaquetado.</p>}
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
    </div>
  </section>
}

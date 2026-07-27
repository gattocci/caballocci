import { useEffect, useState } from 'react'
import { Archive, Download, FolderOpen, RefreshCw, RotateCw } from 'lucide-react'
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

  useEffect(() => {
    void Promise.all([window.planner.system.info(), window.planner.updates.getState()]).then(([system, state]) => {
      setInfo(system)
      setUpdate(state)
    })
    return window.planner.updates.onStateChange(setUpdate)
  }, [])

  const createBackup = async () => {
    const backupPath = await window.planner.system.createBackup()
    setBackupMessage(`Backup creado: ${backupPath}`)
  }

  const busy = update?.status === 'checking' || update?.status === 'downloading'
  return <section className="workspace about-workspace">
    <ViewHeading title="Acerca de / Actualizaciones" subtitle="Versión, datos locales y actualizaciones de caballocci." />
    <div className="about-layout">
      <section className="settings-section">
        <div className="settings-heading"><div><span>APLICACIÓN</span><h2>caballocci</h2></div><strong>v{info?.version || update?.installedVersion || '...'}</strong></div>
        <div className={`update-state ${update?.status || 'idle'}`}><span /><div><strong>{update?.message || 'Consultando estado...'}</strong>{update?.availableVersion && <small>Versión disponible: {update.availableVersion}</small>}</div></div>
        {update?.status === 'downloading' && <div className="download-progress"><div><span>Descarga</span><b>{Math.round(update.percent || 0)}%</b></div><progress max="100" value={update.percent || 0} /><small>{formatBytes(update.transferred)} de {formatBytes(update.total)}</small></div>}
        <div className="settings-actions">
          <button className="settings-button" disabled={busy || update?.status === 'unavailable'} onClick={() => void window.planner.updates.check()}><RefreshCw size={16} /> Buscar actualizaciones</button>
          {update?.status === 'available' && <button className="settings-button primary" onClick={() => void window.planner.updates.download()}><Download size={16} /> Descargar actualización</button>}
          {update?.status === 'downloaded' && <button className="settings-button primary" onClick={() => void window.planner.updates.install()}><RotateCw size={16} /> Reiniciar y actualizar</button>}
        </div>
        {update?.status === 'downloaded' && <p className="settings-note success">La actualización se aplicará en segundo plano y caballocci volverá a abrirse.</p>}
        {!info?.packaged && <p className="settings-note">La comprobación de actualizaciones está deshabilitada durante el desarrollo. Se activa en el instalador empaquetado.</p>}
      </section>
      <section className="settings-section">
        <div className="settings-heading"><div><span>DATOS LOCALES</span><h2>Workspace</h2></div></div>
        <dl className="path-list"><div><dt>Ubicación del workspace</dt><dd>{info?.workspacePath || '...'}</dd></div><div><dt>Carpeta de backups</dt><dd>{info?.backupsPath || '...'}</dd></div></dl>
        <div className="settings-actions">
          <button className="settings-button" onClick={() => void window.planner.system.openWorkspace()}><FolderOpen size={16} /> Abrir workspace</button>
          <button className="settings-button" onClick={() => void window.planner.system.openBackups()}><Archive size={16} /> Abrir backups</button>
          <button className="settings-button" onClick={() => void createBackup()}><Archive size={16} /> Crear backup ahora</button>
        </div>
        {backupMessage && <p className="settings-note success">{backupMessage}</p>}
      </section>
    </div>
  </section>
}

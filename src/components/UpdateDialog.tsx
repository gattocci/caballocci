import { useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, RotateCw, X } from 'lucide-react'
import type { UpdateState } from '../shared/types'
import { reportAppError, runWithErrorReporting } from '../app/errors'
import './update-dialog.css'

export function UpdateDialog() {
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const unsubscribe = window.planner.updates.onStateChange(setUpdate)
    void window.planner.updates.getState().then(setUpdate).catch(error => reportAppError(error, 'No se pudo consultar el estado de las actualizaciones'))
    return unsubscribe
  }, [])

  const version = update?.availableVersion
  const visible = Boolean(update?.status === 'installing' || (version && version !== dismissedVersion && ['available', 'downloading', 'downloaded', 'error'].includes(update?.status || '')))
  const busy = update?.status === 'downloading' || update?.status === 'installing'
  useEffect(() => {
    if (!visible) return
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busy && version) setDismissedVersion(version)
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, version, visible])

  if (!visible || !update || (!version && update.status !== 'installing')) return null

  const title = update.status === 'downloaded' ? 'ACTUALIZACIÓN LISTA' : update.status === 'installing' ? 'INSTALANDO ACTUALIZACIÓN' : update.status === 'error' ? 'ERROR DE ACTUALIZACIÓN' : update.status === 'downloading' ? 'DESCARGANDO ACTUALIZACIÓN' : 'ACTUALIZACIÓN DISPONIBLE'
  const installing = update.status === 'installing'
  return <div className="update-dialog-backdrop" role="presentation">
    <section ref={dialogRef} tabIndex={-1} className={`update-dialog${installing ? ' installing' : ''}`} role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
      {!busy && <button className="update-dialog-close" type="button" aria-label="Cerrar" onClick={() => setDismissedVersion(version || null)}><X size={17} /></button>}
      <span className="update-dialog-eyebrow">{title}</span>
      <h2 id="update-dialog-title">{installing ? 'Preparando el instalador' : `caballocci ${version}`}</h2>
      <p className="update-dialog-message">{installing ? 'La aplicación se cerrará para instalar la actualización. Windows puede mostrar una solicitud de permiso; al terminar, caballocci volverá a abrirse.' : update.message}</p>
      {!installing && <div className="update-dialog-notes"><strong>Novedades</strong><p>{update.releaseNotes || 'No se publicaron notas para esta versión. Puedes consultar la publicación en GitHub.'}</p></div>}
      {update.status === 'downloading' && <div className="update-dialog-progress"><progress max="100" value={update.percent || 0} /><span>{Math.round(update.percent || 0)}%</span></div>}
      {installing && <div className="update-install-progress" role="progressbar" aria-label="Preparando la instalación"><span /></div>}
      {!installing && <footer>
        {!busy && <button type="button" className="settings-button" onClick={() => setDismissedVersion(version || null)}>Más tarde</button>}
        <button type="button" className="settings-button" onClick={() => void runWithErrorReporting(() => window.planner.updates.openReleaseNotes(), 'No se pudieron abrir las notas de versión')}><ExternalLink size={14} /> GitHub</button>
        {(update.status === 'available' || (update.status === 'error' && update.availableVersion)) && <button type="button" className="settings-button primary" onClick={() => void runWithErrorReporting(() => window.planner.updates.download(), 'No se pudo descargar la actualización')}><Download size={15} /> {update.status === 'error' ? 'Reintentar descarga' : 'Descargar'}</button>}
        {update.status === 'downloaded' && <button type="button" className="settings-button primary" onClick={() => void runWithErrorReporting(() => window.planner.updates.install(), 'No se pudo instalar la actualización')}><RotateCw size={15} /> Reiniciar y actualizar</button>}
      </footer>}
    </section>
  </div>
}

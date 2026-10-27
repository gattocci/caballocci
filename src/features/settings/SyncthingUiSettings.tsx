import { useState } from 'react'
import { ExternalLink, Globe2 } from 'lucide-react'
import { reportAppError } from '../../app/errors'

const syncthingUiPreferenceKey = 'caballocci.syncthing-ui-url'
const defaultSyncthingUiUrl = 'http://127.0.0.1:8384'

function normalizeSyncthingUiUrl(value: string) {
  const input = value.trim()
  let url: URL
  try { url = new URL(input) } catch { throw new Error('Escribe una URL completa, por ejemplo http://127.0.0.1:8384.') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('La dirección debe usar HTTP o HTTPS y no incluir credenciales.')
  }
  return url.href
}

export function SyncthingUiSettings() {
  const [syncthingUiUrl, setSyncthingUiUrl] = useState(() => localStorage.getItem(syncthingUiPreferenceKey) || defaultSyncthingUiUrl)
  const [syncthingUiBusy, setSyncthingUiBusy] = useState(false)
  const [syncthingUiMessage, setSyncthingUiMessage] = useState('')
  const [syncthingUiError, setSyncthingUiError] = useState(false)
  const saveSyncthingUiUrl = async (openAfterSave: boolean) => {
    setSyncthingUiBusy(true)
    setSyncthingUiMessage('')
    setSyncthingUiError(false)
    try {
      const normalizedUrl = normalizeSyncthingUiUrl(syncthingUiUrl)
      await window.planner.preferences.sync({ [syncthingUiPreferenceKey]: normalizedUrl })
      localStorage.setItem(syncthingUiPreferenceKey, normalizedUrl)
      setSyncthingUiUrl(normalizedUrl)
      if (openAfterSave) {
        await window.planner.system.openSyncthingUi(normalizedUrl)
        setSyncthingUiMessage('Dirección guardada. Syncthing se abrió en el navegador; comprueba que Syncthing esté ejecutándose en el PC.')
      } else {
        setSyncthingUiMessage('Dirección de Syncthing guardada en este equipo.')
      }
    } catch (error) {
      setSyncthingUiError(true)
      setSyncthingUiMessage(error instanceof Error ? error.message : 'No se pudo guardar o abrir Syncthing.')
      reportAppError(error, 'No se pudo guardar o abrir la interfaz de Syncthing')
    } finally {
      setSyncthingUiBusy(false)
    }
  }
  return <section className="syncthing-ui-settings" aria-labelledby="syncthing-ui-title">
    <div className="syncthing-ui-heading"><Globe2 size={16} /><div><b id="syncthing-ui-title">Interfaz de Syncthing en este PC</b><small>Guarda la dirección local para abrir y configurar las carpetas compartidas.</small></div></div>
    <label htmlFor="syncthing-ui-url">Dirección web<input id="syncthing-ui-url" type="url" value={syncthingUiUrl} maxLength={2048} onChange={event => setSyncthingUiUrl(event.target.value)} placeholder={defaultSyncthingUiUrl} /></label>
    <div className="settings-actions">
      <button className="settings-button" disabled={syncthingUiBusy} onClick={() => void saveSyncthingUiUrl(false)}>{syncthingUiBusy ? 'Guardando…' : 'Guardar dirección'}</button>
      <button className="settings-button primary" disabled={syncthingUiBusy} onClick={() => void saveSyncthingUiUrl(true)}><ExternalLink size={14} /> {syncthingUiBusy ? 'Abriendo…' : 'Guardar y abrir Syncthing'}</button>
    </div>
    {syncthingUiMessage && <p className={`settings-note ${syncthingUiError ? 'error' : 'success'}`} role={syncthingUiError ? 'alert' : 'status'}>{syncthingUiMessage}</p>}
  </section>
}

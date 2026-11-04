import { useEffect, useState } from 'react'
import { AppWindow, ImagePlus, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import type { OptionalIntegration, OptionalIntegrationStatus } from '../../shared/types'

const preferenceKey = 'caballocci.optional-integrations'

function readIntegrations(value: string | undefined): OptionalIntegration[] {
  if (!value) return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new Error('La lista de integraciones opcionales no tiene un formato válido.')
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`La integración ${index + 1} no es válida.`)
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80
      || typeof item.path !== 'string' || !item.path || item.path.length > 32_000
      || typeof item.note !== 'string' || item.note.length > 240) {
      throw new Error(`La integración ${index + 1} no contiene todos sus datos.`)
    }
    if (item.iconDataUrl !== undefined && (typeof item.iconDataUrl !== 'string' || item.iconDataUrl.length > 100_000 || !item.iconDataUrl.startsWith('data:image/'))) {
      throw new Error(`El icono de la integración ${index + 1} no es válido.`)
    }
    if (item.customIconDataUrl !== undefined && (typeof item.customIconDataUrl !== 'string' || item.customIconDataUrl.length > 100_000 || !item.customIconDataUrl.startsWith('data:image/'))) {
      throw new Error(`El icono personalizado de la integración ${index + 1} no es válido.`)
    }
    return {
      id: item.id, name: item.name, path: item.path, note: item.note,
      ...(typeof item.iconDataUrl === 'string' ? { iconDataUrl: item.iconDataUrl } : {}),
      ...(typeof item.customIconDataUrl === 'string' ? { customIconDataUrl: item.customIconDataUrl } : {}),
    }
  })
}

function formatDuration(milliseconds: number) {
  const totalMinutes = Math.floor(milliseconds / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours} h ${minutes} min`
  if (totalMinutes > 0) return `${totalMinutes} min`
  return `${Math.max(1, Math.floor(milliseconds / 1_000))} s`
}

function formatMemory(bytes: number | null) {
  if (bytes === null) return '—'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

export function OptionalIntegrations() {
  const [integrations, setIntegrations] = useState<OptionalIntegration[]>([])
  const [statuses, setStatuses] = useState<Record<string, OptionalIntegrationStatus>>({})
  const [selectedPath, setSelectedPath] = useState('')
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null)
  const [customIcon, setCustomIcon] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [clock, setClock] = useState(Date.now())

  useEffect(() => {
    let active = true
    const updateStatuses = (items: OptionalIntegrationStatus[]) => {
      if (active) setStatuses(Object.fromEntries(items.map(item => [item.integrationId, item])))
    }
    const unsubscribe = window.planner.system.onOptionalIntegrationStatusChange(updateStatuses)
    void Promise.all([
      window.planner.preferences.sync({}),
      window.planner.system.getOptionalIntegrationStatuses(),
    ]).then(([preferences, items]) => {
      if (!active) return
      setIntegrations(readIntegrations(preferences[preferenceKey]))
      updateStatuses(items)
    }).catch(error => reportAppError(error, 'No se pudieron cargar las integraciones opcionales'))
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => { active = false; unsubscribe(); window.clearInterval(timer) }
  }, [])

  const chooseFile = async () => {
    const selection = await window.planner.system.chooseOptionalIntegration()
    if (!selection) return
    setSelectedPath(selection.path)
    setSelectedIcon(selection.iconDataUrl)
    setCustomIcon(null)
    setName(current => current || selection.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '')
  }

  const chooseCustomIcon = async () => {
    const iconDataUrl = await window.planner.system.chooseOptionalIntegrationIcon()
    if (iconDataUrl) setCustomIcon(iconDataUrl)
  }

  const saveIntegrations = async (next: OptionalIntegration[]) => {
    setSaving(true)
    try {
      await window.planner.preferences.sync({ [preferenceKey]: JSON.stringify(next) })
      setIntegrations(next)
    } finally {
      setSaving(false)
    }
  }

  const addIntegration = async () => {
    const trimmedName = name.trim()
    if (!selectedPath || !trimmedName) return
    const integration: OptionalIntegration = {
      id: crypto.randomUUID(),
      name: trimmedName,
      path: selectedPath,
      note: note.trim(),
      ...(selectedIcon ? { iconDataUrl: selectedIcon } : {}),
      ...(customIcon ? { customIconDataUrl: customIcon } : {}),
    }
    await saveIntegrations([...integrations, integration])
    setSelectedPath('')
    setSelectedIcon(null)
    setCustomIcon(null)
    setName('')
    setNote('')
  }

  const removeIntegration = (id: string) => runWithErrorReporting(
    () => saveIntegrations(integrations.filter(integration => integration.id !== id)),
    'No se pudo quitar la integración opcional',
  )

  return <section className="settings-section optional-integrations">
    <div className="settings-heading"><div><span>INTEGRACIONES OPCIONALES</span><h2>Accesos rápidos</h2></div><button className="settings-button" disabled={saving} onClick={() => void runWithErrorReporting(chooseFile, 'No se pudo seleccionar el ejecutable')}><Plus size={15} /> Añadir</button></div>
    <p className="settings-note">Estado de los procesos iniciados desde aquí durante esta sesión de caballocci. El consumo es aproximado y corresponde al proceso directo.</p>
    {integrations.length > 0 && <div className="optional-integration-grid">
      {integrations.map(integration => {
        const status = statuses[integration.id]
        const running = status?.state === 'running'
        const icon = integration.customIconDataUrl || integration.iconDataUrl
        return <article className={`optional-integration-card${running ? ' is-running' : ''}`} key={integration.id}>
          <div className="optional-integration-card-top">
            <div className="optional-integration-icon">{icon ? <img src={icon} alt="" /> : <AppWindow size={30} strokeWidth={1.5} />}</div>
            <button className="optional-integration-remove" aria-label={`Quitar ${integration.name}`} disabled={saving} onClick={() => removeIntegration(integration.id)}><Trash2 size={15} /></button>
          </div>
          <h3 title={integration.name}>{integration.name}</h3>
          <p className="optional-integration-note" title={integration.note}>{integration.note || 'Acceso opcional'}</p>
          <div className={`optional-integration-status ${running ? 'running' : ''}`}><span />{running ? `En ejecución${status.instanceCount > 1 ? ` · ${status.instanceCount} instancias` : ''}` : status?.state === 'stopped' ? 'Finalizado' : 'No iniciado en esta sesión'}</div>
          {running && status && <div className="optional-integration-metrics">
            <span>Activo <b>{formatDuration(clock - (status.startedAt || clock))}</b></span>
            <span>RAM <b>{status.metricsAvailable ? formatMemory(status.memoryBytes) : 'No disponible'}</b></span>
            <span>CPU <b>{status.metricsAvailable && status.cpuPercent !== null ? `${status.cpuPercent.toFixed(1)}%` : '—'}</b></span>
          </div>}
          {status?.state === 'stopped' && <p className="optional-integration-last-run">Última ejecución: {formatDuration(status.durationMs)}</p>}
          <details className="optional-integration-path"><summary>Ver ruta</summary><code>{integration.path}</code></details>
          <div className="optional-integration-card-actions">
            <button className="settings-button primary" disabled={saving || running} onClick={() => void runWithErrorReporting(
              () => window.planner.system.launchOptionalIntegration(integration.id, integration.path),
              `No se pudo abrir ${integration.name}`,
            )}><Play size={14} /> {running ? 'Ejecutándose' : 'Abrir'}</button>
            <button className="settings-button" title="Cambiar icono" aria-label={`Cambiar icono de ${integration.name}`} disabled={saving} onClick={() => void runWithErrorReporting(async () => {
              const iconDataUrl = await window.planner.system.chooseOptionalIntegrationIcon()
              if (!iconDataUrl) return
              await saveIntegrations(integrations.map(item => item.id === integration.id ? { ...item, customIconDataUrl: iconDataUrl } : item))
            }, `No se pudo cambiar el icono de ${integration.name}`)}><ImagePlus size={15} /></button>
            {integration.customIconDataUrl && <button className="settings-button" title="Restaurar icono del archivo" aria-label={`Restaurar icono del archivo para ${integration.name}`} disabled={saving} onClick={() => void runWithErrorReporting(
              () => saveIntegrations(integrations.map(item => {
                if (item.id !== integration.id) return item
                const { customIconDataUrl: _customIconDataUrl, ...rest } = item
                return rest
              })),
              `No se pudo restaurar el icono de ${integration.name}`,
            )}><RotateCcw size={14} /></button>}
          </div>
        </article>
      })}
    </div>}
    <div className="optional-integration-form">
      {selectedPath && <>
        <div className="optional-integration-editor">
          <div className="optional-integration-icon editor">{customIcon || selectedIcon ? <img src={customIcon || selectedIcon || undefined} alt="" /> : <AppWindow size={26} />}</div>
          <div className="optional-integration-editor-fields">
            <label><span>Nombre personalizado</span><input maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="Por ejemplo, Sincronizar archivos" /></label>
            <label><span>Nota (opcional)</span><input maxLength={240} value={note} onChange={event => setNote(event.target.value)} placeholder="Describe para qué sirve" /></label>
            <code className="optional-integration-selected-path">{selectedPath}</code>
            <div className="settings-actions">
              <button className="settings-button" disabled={saving} onClick={() => void runWithErrorReporting(chooseCustomIcon, 'No se pudo seleccionar el icono')}><ImagePlus size={15} /> Icono personalizado</button>
              {customIcon && <button className="settings-button" disabled={saving} onClick={() => setCustomIcon(null)}><RotateCcw size={14} /> Icono del archivo</button>}
              <button className="settings-button primary" disabled={saving || !name.trim()} onClick={() => void runWithErrorReporting(addIntegration, 'No se pudo guardar la integración')}><Plus size={15} /> Guardar</button>
            </div>
          </div>
        </div>
      </>}
    </div>
  </section>
}

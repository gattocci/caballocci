import { Play, RefreshCw, Save, Trash2 } from 'lucide-react'
import type { Source } from '../../shared/types'

export type SourceDraft = { name: string; baseUrl: string; method: Source['method']; format: Source['format']; recordsPath: string; bodyTemplate: string; authType: Source['authType']; maxRecords: number; targetProject: string; importMode: Source['importMode']; initialStatus: Source['initialStatus'] }
export type MappingSuggestion = { externalRef: string; title: string; sourceKindField: string; hashFields: string[]; contentTypeMap: Record<string, string> }

export function SourceConnectionPanel({
  selected, draft, onDraftChange, headersText, onHeadersChange, authText, onAuthChange, busy,
  message, messageTone, requestDetails, connectionSample, mappingSuggestion, onTest, onSave, onApplyDestination, onDelete,
}: {
  selected: Source | null
  draft: SourceDraft
  onDraftChange(draft: SourceDraft): void
  headersText: string
  onHeadersChange(value: string): void
  authText: string
  onAuthChange(value: string): void
  busy: boolean
  message: string
  messageTone: 'pending' | 'success' | 'error'
  requestDetails: string
  connectionSample: string
  mappingSuggestion: MappingSuggestion | null
  onTest(): void
  onSave(): void
  onApplyDestination(): void
  onDelete(): void
}) {
  const update = (patch: Partial<SourceDraft>) => onDraftChange({ ...draft, ...patch })

  return <section className="source-panel"><header><div><span>CONEXIÓN</span><h2>{selected ? selected.name : 'Nueva fuente'}</h2>{selected && <small className="source-config-status">Configuración guardada · {selected.method} · {selected.format} · {selected.authType === 'none' ? 'sin autenticación' : selected.authType}{selected.hasStoredHeaders ? ' · headers protegidos' : ''}{selected.hasStoredAuth ? ' · credenciales protegidas' : ''}</small>}</div>{selected && <button className="icon-button" title="Eliminar fuente" onClick={onDelete}><Trash2 size={16} /></button>}</header>
    <div className="source-grid"><label>Nombre<input value={draft.name} onChange={event => update({ name: event.target.value })} placeholder="Resource API" /></label><label>URL<input value={draft.baseUrl} onChange={event => update({ baseUrl: event.target.value })} placeholder="https://..." /></label><label>Método<select value={draft.method} onChange={event => update({ method: event.target.value as Source['method'] })}><option>GET</option><option>POST</option></select></label><label>Formato<select value={draft.format} onChange={event => update({ format: event.target.value as Source['format'] })}><option value="json">JSON</option><option value="ndjson">NDJSON</option><option value="csv">CSV</option></select></label><label>Autenticación<select value={draft.authType} onChange={event => update({ authType: event.target.value as Source['authType'] })}><option value="none">Ninguna</option><option value="bearer">Bearer token</option><option value="apiKey">API key</option><option value="basic">Basic</option></select></label><label>Ruta de registros<input value={draft.recordsPath} onChange={event => update({ recordsPath: event.target.value })} placeholder="data.items (opcional)" /></label><label>Máximo de registros<input type="number" min="1" max="10000" value={draft.maxRecords} onChange={event => update({ maxRecords: Number(event.target.value) })} /></label></div>
    <div className="source-grid"><label>Proyecto / espacio destino<input value={draft.targetProject} onChange={event => update({ targetProject: event.target.value })} placeholder="Mi contenido" /></label><label>Destino<select value={draft.importMode} onChange={event => update({ importMode: event.target.value as Source['importMode'] })}><option value="post">Publicaciones</option><option value="idea">Ideas</option><option value="both">Publicaciones e ideas</option></select></label><label>Estado inicial<select value={draft.initialStatus} onChange={event => update({ initialStatus: event.target.value as Source['initialStatus'] })}><option value="idea">Idea</option><option value="draft">Borrador</option><option value="review">Revisión</option><option value="approved">Aprobado</option></select></label></div>
    <div className="source-grid"><label>Headers JSON<textarea value={headersText} onChange={event => onHeadersChange(event.target.value)} placeholder={'{"Authorization":"Bearer ..."}'} /></label><label>Auth JSON<textarea value={authText} onChange={event => onAuthChange(event.target.value)} placeholder={'{"token":"..."} o token directo'} /></label></div><label>Body JSON para POST<textarea value={draft.bodyTemplate} onChange={event => update({ bodyTemplate: event.target.value })} placeholder="{ }" /></label>
    <div className="source-actions"><button className="settings-button" disabled={busy} onClick={onTest}><Play size={15} /> Probar conexión</button><button className="save-button" disabled={busy || !draft.name || !draft.baseUrl} onClick={onSave}><Save size={15} /> Guardar fuente</button>{selected && <button className="settings-button" disabled={busy || !draft.targetProject.trim()} onClick={onApplyDestination}><RefreshCw size={15} /> Aplicar destino a registros</button>}</div>
    {message && <p role="status" className={`source-message ${messageTone}`}>{message}</p>}{requestDetails && <pre className="source-request-details">Petición efectiva:{'\n'}{requestDetails}</pre>}{connectionSample && <pre className="source-response-preview">{connectionSample}</pre>}{mappingSuggestion && <p className="source-suggestion">Sugerencia detectada: <b>{mappingSuggestion.externalRef}</b> como referencia, <b>{mappingSuggestion.title}</b> como título{mappingSuggestion.sourceKindField ? ` y ${mappingSuggestion.sourceKindField} como tipo` : ''}. El mapeo se completó en el formulario inferior; revísalo antes de guardarlo.</p>}
  </section>
}

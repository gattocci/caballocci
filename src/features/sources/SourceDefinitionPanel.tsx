import { Play, Save } from 'lucide-react'
import type { SourceDefinition } from '../../shared/types'

export type SourceDefinitionDraft = {
  externalRef: string
  title: string
  sourceKindField: string
  hashFields: string
  contentTypeMapText: string
  customDefaultsText: string
}

export function SourceDefinitionPanel({ draft, onDraftChange, definition, busy, onSave, onPreview }: {
  draft: SourceDefinitionDraft
  onDraftChange(draft: SourceDefinitionDraft): void
  definition: SourceDefinition | null
  busy: boolean
  onSave(): void
  onPreview(): void
}) {
  const update = (patch: Partial<SourceDefinitionDraft>) => onDraftChange({ ...draft, ...patch })
  const canSave = Boolean(draft.externalRef && draft.title)

  return <>
    <section className="source-panel"><header><div><span>MAPEO REUTILIZABLE</span><h2>{definition ? 'Definición activa' : 'Configura el primer mapeo'}</h2></div></header><div className="source-grid"><label>External ref<input value={draft.externalRef} onChange={event => update({ externalRef: event.target.value })} placeholder="id" /></label><label>Título<input value={draft.title} onChange={event => update({ title: event.target.value })} placeholder="title" /></label><label>Tipo de fuente<input value={draft.sourceKindField} onChange={event => update({ sourceKindField: event.target.value })} placeholder="kind" /></label><label>Campos para hash<input value={draft.hashFields} onChange={event => update({ hashFields: event.target.value })} placeholder="title, url" /></label></div><div className="source-actions"><button className="save-button" disabled={busy || !canSave} onClick={onSave}><Save size={15} /> Guardar mapeo</button>{definition && <button className="settings-button" disabled={busy} onClick={onPreview}><Play size={15} /> Preview de importación</button>}</div></section>
    <section className="source-panel"><header><div><span>REGLAS DE CONTENIDO</span><h2>Tipos y valores iniciales</h2></div></header><div className="source-grid"><label>Mapa de tipos JSON<textarea value={draft.contentTypeMapText} onChange={event => update({ contentTypeMapText: event.target.value })} placeholder={'{"resource":"post"}'} /></label><label>Valores iniciales JSON<textarea value={draft.customDefaultsText} onChange={event => update({ customDefaultsText: event.target.value })} placeholder={'{"text1":""}'} /></label></div><div className="source-actions"><button className="save-button" disabled={busy || !canSave} onClick={onSave}><Save size={15} /> Guardar reglas</button></div></section>
  </>
}

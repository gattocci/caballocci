import { X } from 'lucide-react'
import type { IdeaInput, IdeaPriority, IdeaStatus } from '../../shared/types'
import { priorityLabels, statusLabels } from './idea-utils'

export function IdeaEditorDialog({ draft, onChange, onClose, onSave, onSaveAndConvert }: {
  draft: IdeaInput
  onChange(draft: IdeaInput): void
  onClose(): void
  onSave(): void
  onSaveAndConvert(): void
}) {
  const update = (patch: Partial<IdeaInput>) => onChange({ ...draft, ...patch })

  return <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><form className="space-dialog idea-dialog" onSubmit={event => { event.preventDefault(); onSave() }}>
    <header><div><span>{draft.id ? 'EDITAR IDEA' : 'NUEVA IDEA'}</span><h2>{draft.title || 'Idea sin título'}</h2></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={18} /></button></header>
    <label>Título<input autoFocus value={draft.title} maxLength={240} onChange={event => update({ title: event.target.value })} placeholder="Describe la idea" /></label>
    <label>Desarrollo<textarea value={draft.body} maxLength={20_000} onChange={event => update({ body: event.target.value })} placeholder="Anota el enfoque, datos o una primera versión" /></label>
    <div className="idea-dialog-row"><label>Estado<select value={draft.status} onChange={event => update({ status: event.target.value as IdeaStatus })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Prioridad<select value={draft.priority} onChange={event => update({ priority: event.target.value as IdeaPriority })}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <label>Espacio<input value={draft.space} maxLength={200} onChange={event => update({ space: event.target.value })} /></label>
    <footer><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button type="button" className="ghost-button" disabled={!draft.title.trim()} onClick={onSaveAndConvert}>Guardar y convertir</button><button className="save-button" disabled={!draft.title.trim()}>Guardar idea</button></footer>
  </form></div>
}

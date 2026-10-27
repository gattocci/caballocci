import { Plus, Trash2 } from 'lucide-react'
import type { UndoableChange } from '../../app/useUndoableState'
import type { NoteItem } from './editor-utils'

export function EditorNotes({ items, onChange }: { items: NoteItem[]; onChange(items: NoteItem[], change: UndoableChange): void }) {
  const update = (id: string, patch: Partial<NoteItem>, change: UndoableChange) => onChange(items.map(item => item.id === id ? { ...item, ...patch } : item), change)

  return <section className="notes-editor"><header><div><span>APUNTES INTERNOS</span><strong>{items.length} {items.length === 1 ? 'nota' : 'notas'}</strong></div><button type="button" className="new-button" onClick={() => onChange([...items, { id: crypto.randomUUID(), title: '', text: '' }], { label: 'Añadir nota' })}><Plus size={15} /> Nueva nota</button></header>{items.map((note, index) => <article className="note-item" key={note.id}><div className="note-item-heading"><span>NOTA {String(index + 1).padStart(2, '0')}</span>{items.length > 1 && <button type="button" onClick={() => onChange(items.filter(item => item.id !== note.id), { label: 'Eliminar nota' })}><Trash2 size={14} /></button>}</div><input data-undo-control value={note.title} onChange={event => update(note.id, { title: event.target.value }, { label: 'Editar título de nota', groupKey: `note:${note.id}:title` })} placeholder="Nombre opcional" /><textarea data-undo-control value={note.text} onChange={event => update(note.id, { text: event.target.value }, { label: 'Editar nota', groupKey: `note:${note.id}:text` })} placeholder="Dato, referencia, pendiente o contexto..." /></article>)}</section>
}

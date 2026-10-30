import { useState } from 'react'
import { ChevronDown, Plus, StickyNote, Trash2 } from 'lucide-react'
import type { UndoableChange } from '../../app/useUndoableState'
import type { NoteItem } from './editor-utils'
import './editor-notes.css'

type Props = {
  items: NoteItem[]
  onChange(items: NoteItem[], change: UndoableChange): void
  /** compact = bloque plegable dentro de la pestaña Contenido. Sin compact = pestaña Notas completa. */
  compact?: boolean
}

export function EditorNotes({ items, onChange, compact = false }: Props) {
  const filled = items.filter(note => note.title.trim() || note.text.trim()).length
  const [open, setOpen] = useState(filled > 0)

  const update = (id: string, patch: Partial<NoteItem>, change: UndoableChange) =>
    onChange(items.map(item => (item.id === id ? { ...item, ...patch } : item)), change)

  const list = (
    <div className="notes-list">
      {items.map(note => (
        <div className="note-row" key={note.id}>
          {(!compact || note.title) && (
            <input
              data-undo-control
              className="note-title"
              value={note.title}
              onChange={event => update(note.id, { title: event.target.value }, { label: 'Editar título de nota', groupKey: `note:${note.id}:title` })}
              placeholder="Título (opcional)"
            />
          )}
          <textarea
            data-undo-control
            className="note-text"
            rows={compact ? 2 : 4}
            value={note.text}
            onChange={event => update(note.id, { text: event.target.value }, { label: 'Editar nota', groupKey: `note:${note.id}:text` })}
            placeholder="Dato, referencia, pendiente o contexto..."
          />
          <button
            type="button"
            className="note-remove"
            title="Eliminar nota"
            aria-label="Eliminar nota"
            onClick={() => onChange(items.filter(item => item.id !== note.id), { label: 'Eliminar nota' })}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="note-add"
        onClick={() => onChange([...items, { id: crypto.randomUUID(), title: '', text: '' }], { label: 'Añadir nota' })}
      >
        <Plus size={13} /> Añadir nota
      </button>
    </div>
  )

  if (!compact) return <section className="notes-editor">{list}</section>

  return (
    <details className="notes-editor notes-compact" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>
        <StickyNote size={14} />
        <span>Notas internas</span>
        {filled > 0 && <em>{filled}</em>}
        <ChevronDown size={15} className="notes-chevron" />
      </summary>
      {list}
    </details>
  )
}

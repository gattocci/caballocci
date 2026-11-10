import { useEffect, useState } from 'react'
import { CheckSquare, ChevronDown, ChevronUp, Clipboard, ClipboardCopy, Lightbulb, Plus, Trash2 } from 'lucide-react'
import type { IdeaBlock } from '../../shared/types'
import type { UndoableChange } from '../../app/useUndoableState'
import { runWithErrorReporting } from '../../app/errors'
import { formatTitle } from './editor-utils'

export function EditorIdeaBlocks({ blocks, onChange }: { blocks: IdeaBlock[]; onChange(blocks: IdeaBlock[], change: UndoableChange): void }) {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectionFeedback, setSelectionFeedback] = useState('')
  const selectedBlocks = blocks
    .map((block, index) => ({ block, slideNumber: index + 1 }))
    .filter(({ block }) => selectedIds.has(block.id))
  const copyableBlocks = selectedBlocks.filter(({ block }) => block.title.trim() || block.text.trim())

  useEffect(() => {
    if (!selectionFeedback) return
    const timeout = window.setTimeout(() => setSelectionFeedback(''), 1800)
    return () => window.clearTimeout(timeout)
  }, [selectionFeedback])

  const add = () => onChange([...blocks, { id: crypto.randomUUID(), title: '', text: '' }], { label: 'Añadir diapositiva' })
  const update = (id: string, patch: Partial<IdeaBlock>, change: UndoableChange) => onChange(blocks.map(block => block.id === id ? { ...block, ...patch } : block), change)
  const format = (id: string, mode: 'upper' | 'lower' | 'title' | 'sentence') => {
    const block = blocks.find(item => item.id === id)
    if (block) update(id, { title: formatTitle(block.title, mode) }, { label: 'Formatear título de diapositiva' })
  }
  const toggleSelection = (id: string) => setSelectedIds(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const selectAll = () => setSelectedIds(current => blocks.every(block => current.has(block.id))
    ? new Set()
    : new Set(blocks.map(block => block.id)))
  const copySelected = async (includeSlideLabels: boolean) => {
    const text = copyableBlocks.map(({ block, slideNumber }) => {
      const content = [block.title.trim(), block.text.trim()].filter(Boolean).join('\n')
      return includeSlideLabels ? `DIAPOSITIVA ${String(slideNumber).padStart(2, '0')}\n${content}` : content
    }).join('\n\n')
    if (!text) return
    await runWithErrorReporting(async () => {
      await window.planner.clipboard.write(text)
      setSelectionFeedback(includeSlideLabels ? 'Diapositivas copiadas' : 'Texto copiado')
    }, 'No se pudieron copiar las diapositivas')
  }
  const remove = (id: string) => onChange(blocks.filter(block => block.id !== id), { label: 'Eliminar diapositiva' })
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= blocks.length) return
    const reordered = [...blocks]
    const [block] = reordered.splice(index, 1)
    reordered.splice(target, 0, block)
    onChange(reordered, { label: offset < 0 ? 'Subir diapositiva' : 'Bajar diapositiva' })
  }

  return <section className="idea-blocks">
    <header><div><span>DIAPOSITIVAS</span><strong>{blocks.length} {blocks.length === 1 ? 'diapositiva' : 'diapositivas'}</strong></div><div className="idea-blocks-actions">
      <button type="button" className={`idea-selection-toggle${selectionMode ? ' active' : ''}`} aria-pressed={selectionMode} disabled={!selectionMode && blocks.length === 0} onClick={() => { setSelectionMode(mode => !mode); setSelectedIds(new Set()); setSelectionFeedback('') }}><CheckSquare size={13} /> {selectionMode ? 'Cancelar' : 'Seleccionar'}</button>
      <button type="button" className="new-button" onClick={add}><Plus size={15} /> Nueva diapositiva</button>
    </div></header>
    {selectionMode && <div className="idea-selection-toolbar" role="toolbar" aria-label="Acciones para las diapositivas">
      <div><span>{selectedBlocks.length} de {blocks.length} seleccionadas</span><button type="button" onClick={selectAll}>{selectedBlocks.length === blocks.length ? 'Quitar selección' : 'Seleccionar todas'}</button></div>
      <div>
        <button type="button" disabled={!copyableBlocks.length} onClick={() => void copySelected(true)}><ClipboardCopy size={13} /> Copiar diapositivas</button>
        <button type="button" disabled={!copyableBlocks.length} onClick={() => void copySelected(false)}><Clipboard size={13} /> Copiar solo texto</button>
      </div>
      {selectionFeedback && <span className="idea-selection-feedback" role="status" aria-live="polite">{selectionFeedback}</span>}
    </div>}
    {blocks.length === 0 && <button type="button" className="empty-ideas" onClick={add}><Lightbulb size={24} /><span>Añadir primera idea</span></button>}
    {blocks.map((block, index) => <article className={`idea-block${selectedIds.has(block.id) ? ' selected' : ''}`} key={block.id}>
      <header><span>DIAPOSITIVA {String(index + 1).padStart(2, '0')}</span><div>
        {selectionMode && <input type="checkbox" className="idea-selection-checkbox" aria-label={`Seleccionar diapositiva ${index + 1}`} checked={selectedIds.has(block.id)} onChange={() => toggleSelection(block.id)} />}
        <button type="button" title="Subir idea" aria-label="Subir idea" disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp size={15} /></button>
        <button type="button" title="Bajar idea" aria-label="Bajar idea" disabled={index === blocks.length - 1} onClick={() => move(index, 1)}><ChevronDown size={15} /></button>
        <button type="button" title="Eliminar idea" aria-label="Eliminar idea" onClick={() => remove(block.id)}><Trash2 size={14} /></button>
      </div></header>
      <label>Título<input data-undo-control value={block.title} maxLength={160} onChange={event => update(block.id, { title: event.target.value }, { label: 'Editar título de diapositiva', groupKey: `slide:${block.id}:title` })} placeholder="Ej. Apertura, argumento, cierre" /></label>
      <div className="title-format-actions"><span>Formato rápido</span><button type="button" onClick={() => format(block.id, 'upper')}>MAYÚS</button><button type="button" onClick={() => format(block.id, 'lower')}>minús</button><button type="button" onClick={() => format(block.id, 'title')}>Título</button><button type="button" onClick={() => format(block.id, 'sentence')}>Oración</button></div>
      <label>Texto<textarea data-undo-control value={block.text} maxLength={10_000} onChange={event => update(block.id, { text: event.target.value }, { label: 'Editar texto de diapositiva', groupKey: `slide:${block.id}:text` })} placeholder="Texto que luego irá en la imagen" /></label>
    </article>)}
  </section>
}

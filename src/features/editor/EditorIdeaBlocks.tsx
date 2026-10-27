import { ChevronDown, ChevronUp, Lightbulb, Plus, Trash2 } from 'lucide-react'
import type { IdeaBlock } from '../../shared/types'
import type { UndoableChange } from '../../app/useUndoableState'
import { formatTitle } from './editor-utils'

export function EditorIdeaBlocks({ blocks, onChange }: { blocks: IdeaBlock[]; onChange(blocks: IdeaBlock[], change: UndoableChange): void }) {
  const add = () => onChange([...blocks, { id: crypto.randomUUID(), title: '', text: '' }], { label: 'Añadir diapositiva' })
  const update = (id: string, patch: Partial<IdeaBlock>, change: UndoableChange) => onChange(blocks.map(block => block.id === id ? { ...block, ...patch } : block), change)
  const format = (id: string, mode: 'upper' | 'lower' | 'title' | 'sentence') => {
    const block = blocks.find(item => item.id === id)
    if (block) update(id, { title: formatTitle(block.title, mode) }, { label: 'Formatear título de diapositiva' })
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
    <header><div><span>DIAPOSITIVAS</span><strong>{blocks.length} {blocks.length === 1 ? 'diapositiva' : 'diapositivas'}</strong></div><button type="button" className="new-button" onClick={add}><Plus size={15} /> Nueva diapositiva</button></header>
    {blocks.length === 0 && <button type="button" className="empty-ideas" onClick={add}><Lightbulb size={24} /><span>Añadir primera idea</span></button>}
    {blocks.map((block, index) => <article className="idea-block" key={block.id}>
      <header><span>DIAPOSITIVA {String(index + 1).padStart(2, '0')}</span><div>
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

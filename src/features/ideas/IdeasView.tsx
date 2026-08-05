import { useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, Lightbulb, Pencil, Plus, Trash2, X } from 'lucide-react'
import { ViewHeading } from '../../components/layout/AppShell'
import { usePlanner } from '../../app/store'
import type { Idea, IdeaInput, IdeaPriority, IdeaStatus } from '../../shared/types'
import './ideas.css'

const blankIdea = (space: string): IdeaInput => ({
  space, title: '', body: '', tags: [], media: [], status: 'inbox', priority: 'normal', dueDate: null,
})

const priorityLabels: Record<IdeaPriority, string> = { low: 'Baja', normal: 'Normal', high: 'Alta' }
const statusLabels: Record<IdeaStatus, string> = { inbox: 'Nueva', developing: 'En desarrollo', ready: 'Lista', converted: 'Convertida', archived: 'Archivada' }

export function IdeasView() {
  const { ideas, activeSpace, saveIdea, removeIdea, convertIdea, select, setView } = usePlanner()
  const [draft, setDraft] = useState<IdeaInput | null>(null)
  const ideasInSpace = useMemo(() => activeSpace ? ideas.filter(idea => idea.space === activeSpace) : ideas, [activeSpace, ideas])
  const edit = (idea: Idea) => setDraft({ ...idea })
  const save = async () => {
    if (!draft?.title.trim()) return
    await saveIdea({ ...draft, title: draft.title.trim(), body: draft.body.trim() })
    setDraft(null)
  }
  const convert = async (idea: Idea) => {
    const post = await convertIdea(idea.id)
    select(post.id)
    setView('board')
  }

  return <section className="workspace ideas-workspace">
    <ViewHeading title="Ideas" subtitle="Captura, desarrolla y convierte tus ideas en contenido.">
      <button className="new-button" onClick={() => setDraft(blankIdea(activeSpace || 'Mi contenido'))}><Plus size={17} /> Nueva idea</button>
    </ViewHeading>
    {ideasInSpace.length ? <div className="ideas-grid">{ideasInSpace.map(idea => <article className="idea-card" key={idea.id}>
      <header><span className={'idea-priority ' + idea.priority}>{priorityLabels[idea.priority]}</span><div><button title="Editar idea" onClick={() => edit(idea)}><Pencil size={15} /></button><button title="Eliminar idea" className="idea-delete" onClick={() => { if (window.confirm('Eliminar esta idea?')) void removeIdea(idea.id) }}><Trash2 size={15} /></button></div></header>
      <span className="idea-status">{statusLabels[idea.status]}</span><h2>{idea.title || 'Idea sin titulo'}</h2><p>{idea.body || 'Sin desarrollo todavia.'}</p>
      <footer>{idea.dueDate && <span><CalendarDays size={13} />{new Date(idea.dueDate).toLocaleDateString()}</span>}<small>{idea.space}</small>{idea.status !== 'converted' && <button onClick={() => void convert(idea)}>Convertir <ArrowRight size={14} /></button>}</footer>
    </article>)}</div> : <div className="ideas-empty"><Lightbulb size={34} /><strong>No hay ideas en este espacio</strong><span>Crea una idea o cambia de espacio para verla aqui.</span><button className="new-button" onClick={() => setDraft(blankIdea(activeSpace || 'Mi contenido'))}><Plus size={17} /> Nueva idea</button></div>}
    {draft && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDraft(null) }}><form className="space-dialog idea-dialog" onSubmit={event => { event.preventDefault(); void save() }}><header><div><span>{draft.id ? 'EDITAR IDEA' : 'NUEVA IDEA'}</span><h2>{draft.title || 'Idea sin titulo'}</h2></div><button type="button" className="icon-button" onClick={() => setDraft(null)}><X size={18} /></button></header><label>Titulo<input autoFocus value={draft.title} maxLength={240} onChange={event => setDraft(current => current ? { ...current, title: event.target.value } : current)} placeholder="Describe la idea" /></label><label>Desarrollo<textarea value={draft.body} maxLength={20_000} onChange={event => setDraft(current => current ? { ...current, body: event.target.value } : current)} placeholder="Anota el enfoque, datos o una primera version" /></label><div className="idea-dialog-row"><label>Estado<select value={draft.status} onChange={event => setDraft(current => current ? { ...current, status: event.target.value as IdeaStatus } : current)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Prioridad<select value={draft.priority} onChange={event => setDraft(current => current ? { ...current, priority: event.target.value as IdeaPriority } : current)}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label>Espacio<input value={draft.space} maxLength={200} onChange={event => setDraft(current => current ? { ...current, space: event.target.value } : current)} /></label><footer><button type="button" className="ghost-button" onClick={() => setDraft(null)}>Cancelar</button><button className="save-button" disabled={!draft.title.trim()}>Guardar idea</button></footer></form></div>}
  </section>
}

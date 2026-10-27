import { ArrowRight, CalendarDays, ExternalLink, Pencil, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { Idea } from '../../shared/types'
import { ideaFamily, priorityLabels, statusLabels } from './idea-utils'

export function IdeaCard({ idea, selected, hasSelection, onToggleSelected, onEdit, onDelete, onOpenPost, onConvert }: {
  idea: Idea
  selected: boolean
  hasSelection: boolean
  onToggleSelected(): void
  onEdit(): void
  onDelete(): void
  onOpenPost(postId: string): void
  onConvert(): void
}) {
  const family = ideaFamily(idea.title, idea.sourceName)
  const combinedPostIds = idea.combinedPostIds.length > 0 ? idea.combinedPostIds : idea.combinedPostId ? [idea.combinedPostId] : []

  const handleCardClick = (event: MouseEvent<HTMLElement>) => {
    if (event.shiftKey || event.ctrlKey || event.metaKey || hasSelection) onToggleSelected()
  }
  const stopAndRun = (event: MouseEvent, action: () => void) => {
    event.stopPropagation()
    action()
  }

  return <article className={'idea-card ' + (selected ? 'selected' : '')} onClick={handleCardClick}>
    <header><label className="idea-select" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selected} onChange={onToggleSelected} /> {idea.priority !== 'normal' && <span className={'idea-priority ' + idea.priority}>{priorityLabels[idea.priority]}</span>}</label><div><button type="button" title="Editar idea" onClick={event => stopAndRun(event, onEdit)}><Pencil size={15} /></button><button type="button" title="Eliminar idea" className="idea-delete" onClick={event => stopAndRun(event, onDelete)}><Trash2 size={15} /></button></div></header>
    {family.family && <span className="idea-family-chip">{family.family}</span>} {idea.status !== 'inbox' && <span className={'idea-status ' + idea.status}>{statusLabels[idea.status]}</span>}{combinedPostIds.length > 0 && <span className="idea-combined-badge">{combinedPostIds.length > 1 ? `${combinedPostIds.length} combinaciones` : 'Combinada'}</span>}<h2>{family.title || 'Idea sin título'}</h2><p>{idea.body || 'Sin desarrollo todavía.'}</p>
    <footer>{idea.dueDate && <span><CalendarDays size={13} />{new Date(idea.dueDate).toLocaleDateString()}</span>}<small>{idea.space}</small><div className="idea-links">{combinedPostIds.map((postId, index) => <button type="button" key={postId} onClick={event => stopAndRun(event, () => onOpenPost(postId))} title="Abrir publicación combinada"><ExternalLink size={13} /> {index === 0 ? 'Ver combinado' : `Ver combinado ${index + 1}`}</button>)}{idea.postId ? <button type="button" onClick={event => stopAndRun(event, () => onOpenPost(idea.postId!))} title="Abrir publicación individual"><ExternalLink size={13} /> Ver publicación</button> : <button type="button" onClick={event => stopAndRun(event, onConvert)}>Convertir <ArrowRight size={14} /></button>}</div></footer>
  </article>
}

import { useState } from 'react'
import { BoardCardColorPicker, MobileCardStatus, type BoardCardDetailLevel, type MobilePublicationState } from './BoardCardDecorations'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowDown, ArrowUp, CalendarDays, ChevronDown, ChevronRight, FileText, Film, FolderOpen, FolderPlus, Images, Layers3 } from 'lucide-react'
import { contentLabels, stages, statusMeta } from '../../shared/constants'
import { postColors } from '../../shared/postColors'
import { PlatformMark } from '../../components/layout/AppShell'
import type { Post, WorkGroup } from '../../shared/types'


export type BoardLane = { id: string; name: string; postIds: string[]; group: WorkGroup | null }

export function BoardLanes({ lanes, posts, activeGroups, selected, collapsedLanes, toggleLane, reorderLane, visiblePerColumn, mobilePublicationState, boardCardDetailLevel, dragIds, onToggle, onSelect, onColor, onMove, onSelectStatus }: {
  lanes: BoardLane[]; posts: Post[]; activeGroups: WorkGroup[]; selected: Set<string>; collapsedLanes: Set<string>
  toggleLane(id: string): void; reorderLane(id: string, delta: number): void; visiblePerColumn: number
  mobilePublicationState: MobilePublicationState | null; boardCardDetailLevel: BoardCardDetailLevel
  dragIds: React.MutableRefObject<string[]>
  onToggle(id: string, range?: boolean, order?: string[]): void; onSelect(id: string | null): void
  onColor(post: Post, color: string): void; onMove(status: Post['status']): void; onSelectStatus(ids: string[]): void
}) {
  const [openCells, setOpenCells] = useState<Set<string>>(new Set())
  const showBand = lanes.length > 1
  const CELL_LIMIT = 8
  const postById = new Map(posts.map(post => [post.id, post]))
  const statusIds = new Map(stages.map(status => [status, posts.filter(post => post.status === status).map(post => post.id)]))
  return <div className={`board-lanes${selected.size ? ' selection-active' : ''}`} role="grid" aria-label="Tablero Kanban por etapas">
    {stages.map(status => {
      const ids = statusIds.get(status) || []
      const selectedCount = ids.filter(id => selected.has(id)).length
      return <div className={`board-status-heading status-${status}`} role="columnheader" key={status} style={{ '--status-color': statusMeta[status].color } as React.CSSProperties}>
        <label title={`Seleccionar todas las publicaciones en ${statusMeta[status].label}`}>
          <input type="checkbox" checked={ids.length > 0 && selectedCount === ids.length} ref={input => { if (input) input.indeterminate = selectedCount > 0 && selectedCount < ids.length }} disabled={!ids.length} onChange={() => onSelectStatus(ids)} aria-label={`Seleccionar todas las publicaciones en ${statusMeta[status].label}`} />
          <span>{statusMeta[status].label}</span><em>{ids.length}</em>
        </label>
      </div>
    })}
    {lanes.map((lane, laneIndex) => {
      const isCollapsed = showBand && collapsedLanes.has(lane.id)
      const lanePosts = [...new Set(lane.postIds)].map(id => postById.get(id)).filter((post): post is Post => Boolean(post))
      return <div className={`board-lane-row${isCollapsed ? ' collapsed' : ''}`} role="row" key={lane.id}>
        {showBand && <div className="board-lane-band" role="rowheader">
          <button type="button" className="board-lane-toggle" aria-expanded={!isCollapsed} onClick={() => toggleLane(lane.id)}>
            {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}{lane.group ? <FolderOpen size={15} /> : <FolderPlus size={15} />}
            <strong>{lane.name}</strong><em>{lanePosts.length}</em>
          </button>
          {isCollapsed && <div className="board-lane-pips">
            {stages.map(status => {
              const n = lanePosts.filter(post => post.status === status).length
              return n ? <span key={status} title={`${n} en ${statusMeta[status].label}`}><i className={`status-mark ${status}`} style={{ background: statusMeta[status].color }} />{n}</span> : null
            })}
          </div>}
          <div className="board-lane-order"><button type="button" aria-label={`Subir ${lane.name}`} title="Subir carril" disabled={laneIndex === 0} onClick={() => reorderLane(lane.id, -1)}><ArrowUp size={12} /></button><button type="button" aria-label={`Bajar ${lane.name}`} title="Bajar carril" disabled={laneIndex === lanes.length - 1} onClick={() => reorderLane(lane.id, 1)}><ArrowDown size={12} /></button></div>
        </div>}
        {!isCollapsed && stages.map(status => {
          const columnPosts = lanePosts.filter(post => post.status === status)
          const order = columnPosts.map(post => post.id)
          const cellKey = `${lane.id}-${status}`
          const limit = openCells.has(cellKey) ? visiblePerColumn : Math.min(CELL_LIMIT, visiblePerColumn)
          const visiblePosts = columnPosts.slice(0, limit)
          return <div className={`board-lane-cell${columnPosts.length ? '' : ' empty'}`} role="gridcell" key={cellKey} onDragOver={event => event.preventDefault()} onDrop={() => onMove(status)}>
              {visiblePosts.map(post => {
                const otherMemberships = activeGroups.filter(group => group.id !== lane.group?.id && group.postIds.includes(post.id)).map(group => group.name)
                const overdue = (post.status === 'idea' || post.status === 'draft') && post.scheduledAt && parseISO(post.scheduledAt).getTime() < Date.now()
                const ContentIcon = post.contentType === 'reel' ? Film : post.contentType === 'carousel' ? Images : FileText
                return <div className="board-card-slot" key={post.id}><article tabIndex={0} className={`board-card${selected.has(post.id) ? ' selected' : ''}${post.color !== postColors[0].value ? ' has-custom-color' : ''}`} style={{ '--post-color': post.color } as React.CSSProperties} draggable onDragStart={event => { dragIds.current = selected.has(post.id) ? [...selected] : [post.id]; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', post.id); event.dataTransfer.setData('application/x-caballocci-post-ids', JSON.stringify(dragIds.current)) }} onDragEnd={() => { dragIds.current = [] }} onClick={event => { if (event.shiftKey || event.ctrlKey || event.metaKey || selected.size > 0) onToggle(post.id, event.shiftKey, order); else onSelect(post.id) }}>
                  <div className="board-card-top"><label className="board-select-hit" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selected.has(post.id)} onChange={event => onToggle(post.id, event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey, order)} aria-label={`Seleccionar ${post.title || 'publicación'}`} /></label><span className="board-platforms">{post.platforms.map(platform => <PlatformMark key={platform} platform={platform} small />)}</span>{otherMemberships.length > 0 && <span className="board-duplicate-marker" role="img" title={`La misma publicación también está en: ${otherMemberships.join(', ')}`} aria-label={`También en ${otherMemberships.join(', ')}`}><Layers3 size={12} /><span>{otherMemberships.length + 1}</span></span>}<span className="board-content-type" title={contentLabels[post.contentType]}><ContentIcon size={12} /><span>{contentLabels[post.contentType].slice(0, 5)}</span></span><div className="board-card-mobile-slot"><MobileCardStatus state={mobilePublicationState} postId={post.id} detailLevel={boardCardDetailLevel} /></div>{selected.has(post.id) && <BoardCardColorPicker post={post} onColor={color => onColor(post, color)} />}</div>
                  <h3>{post.title || 'Publicación sin título'}</h3><div className="board-card-meta">{post.scheduledAt && <small className={overdue ? 'overdue' : ''} title={format(parseISO(post.scheduledAt), 'd MMMM yyyy · HH:mm', { locale: es })}><CalendarDays size={12} /><span>{format(parseISO(post.scheduledAt), 'd MMM', { locale: es })}</span><time dateTime={post.scheduledAt}>{format(parseISO(post.scheduledAt), 'HH:mm')}</time>{overdue && <b>Atrasada</b>}</small>}</div>
                </article></div>
              })}
              {!columnPosts.length && <div className="board-drop-hint">Arrastrá una publicación acá</div>}
              {columnPosts.length > visiblePosts.length && <button type="button" className="board-more-btn" onClick={() => setOpenCells(current => new Set(current).add(cellKey))}>Ver {columnPosts.length - visiblePosts.length} más</button>}
          </div>
        })}
      </div>
    })}
  </div>
}
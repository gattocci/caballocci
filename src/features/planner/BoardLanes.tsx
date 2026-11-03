import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BoardCardColorPicker, MobileCardStatus, type BoardCardDetailLevel, type MobilePublicationState } from './BoardCardDecorations'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowDown, ArrowUp, CalendarDays, ChevronDown, ChevronRight, ClipboardCopy, Copy, FileText, Film, FolderOpen, FolderPlus, Images, Layers3, MoreHorizontal, Trash2 } from 'lucide-react'
import { contentLabels, stages, statusMeta } from '../../shared/constants'
import { postColors } from '../../shared/postColors'
import { runWithErrorReporting } from '../../app/errors'
import { PlatformMark } from '../../components/layout/AppShell'
import type { Post, WorkGroup } from '../../shared/types'

const POST_IDS_MIME = 'application/x-caballocci-post-ids'

export type BoardLane = { id: string; name: string; postIds: string[]; group: WorkGroup | null }

/** Solo reaccionamos a arrastres de publicaciones, no a archivos u otros elementos externos. */
const carriesPosts = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes(POST_IDS_MIME)

/**
 * Reemplaza el "fantasma" por defecto del navegador por un clon de la tarjeta (con borde dorado y sombra),
 * y si se arrastran varias muestra un contador. El clon vive un instante dentro del mismo carril
 * para heredar los estilos de `.board-lane-cell article`.
 */
function setCardDragImage(event: React.DragEvent<HTMLElement>, count: number) {
  const card = event.currentTarget
  const host = card.parentElement
  if (!host) return
  const rect = card.getBoundingClientRect()
  const ghost = card.cloneNode(true) as HTMLElement
  ghost.classList.add('board-drag-ghost')
  ghost.classList.remove('is-dragging')
  ;['data-area-select-id', 'draggable', 'tabindex'].forEach(name => ghost.removeAttribute(name))
  if (count > 1) ghost.dataset.count = String(count)
  host.appendChild(ghost)
  event.dataTransfer.setDragImage(ghost, event.clientX - rect.left, event.clientY - rect.top)
  setTimeout(() => ghost.remove(), 0)
}

export function BoardLanes({ lanes, posts, activeGroups, selected, collapsedLanes, toggleLane, reorderLane, visiblePerColumn, mobilePublicationState, boardCardDetailLevel, dragIds, onToggle, onSelect, onPickPost, pickedPostIds = new Set<string>(), onColor, onMove, onSelectStatus, onDuplicate, onDelete, onStatus, onEditSelection }: {
  lanes: BoardLane[]; posts: Post[]; activeGroups: WorkGroup[]; selected: Set<string>; collapsedLanes: Set<string>
  toggleLane(id: string): void; reorderLane(id: string, delta: number): void; visiblePerColumn: number
  mobilePublicationState: MobilePublicationState | null; boardCardDetailLevel: BoardCardDetailLevel
  dragIds: React.MutableRefObject<string[]>
  onToggle(id: string, range?: boolean, order?: string[]): void; onSelect(id: string | null): void; onPickPost?(id: string): boolean; pickedPostIds?: Set<string>
  onColor(post: Post, color: string): void; onMove(status: Post['status']): void; onSelectStatus(ids: string[]): void
  onDuplicate(post: Post): Promise<Post | undefined>; onDelete(post: Post): void; onStatus(post: Post, status: Post['status']): void
  onEditSelection(): void
}) {
  const [context, setContext] = useState<{ post: Post; x: number; y: number } | null>(null)
  const [showStatuses, setShowStatuses] = useState(false)
  const [openCells, setOpenCells] = useState<Set<string>>(new Set())
  const [duplicatedPostId, setDuplicatedPostId] = useState<string | null>(null)
  const duplicateFeedbackTimer = useRef<number | null>(null)
  // Feedback del drag & drop: tarjetas que se están moviendo y destino bajo el cursor.
  const [dragging, setDragging] = useState<Set<string>>(new Set())
  const [dropTarget, setDropTarget] = useState<{ key: string; status: Post['status'] } | null>(null)
  const showBand = lanes.length > 1
  const CELL_LIMIT = 8
  const postById = new Map(posts.map(post => [post.id, post]))
  const statusIds = new Map(stages.map(status => [status, posts.filter(post => post.status === status).map(post => post.id)]))

  const resetDrag = useCallback(() => {
    setDragging(current => current.size ? new Set() : current)
    setDropTarget(null)
  }, [])

  // Si la tarjeta de origen se desmonta al moverse, su `dragend` no llega: usamos también `drop` global.
  useEffect(() => {
    window.addEventListener('dragend', resetDrag)
    window.addEventListener('drop', resetDrag)
    return () => { window.removeEventListener('dragend', resetDrag); window.removeEventListener('drop', resetDrag) }
  }, [resetDrag])

  useEffect(() => {
    if (!context) return
    const dismiss = () => { setContext(null); setShowStatuses(false) }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', onKeyDown) }
  }, [context])

  useEffect(() => () => {
    if (duplicateFeedbackTimer.current !== null) window.clearTimeout(duplicateFeedbackTimer.current)
  }, [])

  const duplicatePost = async (post: Post) => {
    const duplicate = await onDuplicate(post)
    if (!duplicate) return
    setDuplicatedPostId(duplicate.id)
    if (duplicateFeedbackTimer.current !== null) window.clearTimeout(duplicateFeedbackTimer.current)
    duplicateFeedbackTimer.current = window.setTimeout(() => setDuplicatedPostId(null), 2500)
  }

  const openContextMenu = (event: React.MouseEvent<HTMLElement>, post: Post) => {
    event.preventDefault()
    event.stopPropagation()
    setShowStatuses(false)
    setContext({ post, x: Math.min(event.clientX, window.innerWidth - 224), y: Math.min(event.clientY, window.innerHeight - 280) })
  }

  const startDrag = (event: React.DragEvent<HTMLElement>, post: Post) => {
    const ids = selected.has(post.id) ? [...selected] : [post.id]
    dragIds.current = ids
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', post.id)
    event.dataTransfer.setData(POST_IDS_MIME, JSON.stringify(ids))
    setCardDragImage(event, ids.length)
    // Se atenúan las tarjetas de origen DESPUÉS de que el navegador captura la imagen, para que el fantasma no salga apagado.
    requestAnimationFrame(() => setDragging(new Set(ids)))
  }

  return <><div className={`board-lanes${selected.size ? ' selection-active' : ''}${dragging.size ? ' is-dragging-cards' : ''}`} role="grid" aria-label="Tablero Kanban por etapas">
    {stages.map(status => {
      const ids = statusIds.get(status) || []
      const selectedCount = ids.filter(id => selected.has(id)).length
      return <div className={`board-status-heading status-${status}${dropTarget?.status === status ? ' drop-target' : ''}`} role="columnheader" key={status} style={{ '--status-color': statusMeta[status].color } as React.CSSProperties}>
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
          const inDropColumn = dropTarget?.status === status
          const cellClass = `board-lane-cell${columnPosts.length ? '' : ' empty'}${inDropColumn ? ' drop-column' : ''}${dropTarget?.key === cellKey ? ' drop-over' : ''}`
          return <div
            className={cellClass}
            style={{ '--status-color': statusMeta[status].color } as React.CSSProperties}
            role="gridcell"
            key={cellKey}
            onDragOver={event => {
              event.preventDefault()
              if (!carriesPosts(event)) return
              event.dataTransfer.dropEffect = 'move'
              if (dropTarget?.key !== cellKey) setDropTarget({ key: cellKey, status })
            }}
            onDragLeave={event => {
              // dragleave también se dispara al pasar sobre hijos: solo limpiamos si realmente salimos de la celda.
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(current => current?.key === cellKey ? null : current)
            }}
            onDrop={() => { resetDrag(); onMove(status) }}
          >
            {visiblePosts.map(post => {
              const otherMemberships = activeGroups.filter(group => group.id !== lane.group?.id && group.postIds.includes(post.id)).map(group => group.name)
              const overdue = (post.status === 'idea' || post.status === 'draft') && post.scheduledAt && parseISO(post.scheduledAt).getTime() < Date.now()
              const ContentIcon = post.contentType === 'reel' ? Film : post.contentType === 'carousel' ? Images : FileText
              const cardClass = `board-card${selected.has(post.id) ? ' selected' : ''}${pickedPostIds.has(post.id) ? ' session-picked' : ''}${post.color !== postColors[0].value ? ' has-custom-color' : ''}${dragging.has(post.id) ? ' is-dragging' : ''}${duplicatedPostId === post.id ? ' just-duplicated' : ''}`
              return <div className="board-card-slot" key={post.id}>
                <article
                  data-area-select-id={post.id}
                  tabIndex={0}
                  className={cardClass}
                  style={{ '--post-color': post.color } as React.CSSProperties}
                  draggable
                  onDragStart={event => startDrag(event, post)}
                  onDragEnd={() => { dragIds.current = []; resetDrag() }}
                  onContextMenu={event => openContextMenu(event, post)}
                  onClick={event => { if (onPickPost?.(post.id)) return; if (event.shiftKey || event.ctrlKey || event.metaKey || selected.size > 0) onToggle(post.id, event.shiftKey, order); else onSelect(post.id) }}
                >
                  <div className="board-card-top">
                    <label className="board-select-hit" onClick={event => event.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(post.id)} onChange={event => onToggle(post.id, event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey, order)} aria-label={`Seleccionar ${post.title || 'publicación'}`} />
                    </label>
                    <span className="board-platforms">{post.platforms.map(platform => <PlatformMark key={platform} platform={platform} small />)}</span>
                    {otherMemberships.length > 0 && <span className="board-duplicate-marker" role="img" title={`La misma publicación también está en: ${otherMemberships.join(', ')}`} aria-label={`También en ${otherMemberships.join(', ')}`}><Layers3 size={12} /><span>{otherMemberships.length + 1}</span></span>}
                    <span className="board-content-type" title={contentLabels[post.contentType]}><ContentIcon size={12} /><span>{contentLabels[post.contentType].slice(0, 5)}</span></span>
                    <div className="board-card-mobile-slot"><MobileCardStatus state={mobilePublicationState} postId={post.id} detailLevel={boardCardDetailLevel} /></div>
                    {selected.has(post.id) && <BoardCardColorPicker post={post} onColor={color => onColor(post, color)} />}
                  </div>
                  <h3>{post.title || 'Publicación sin título'}</h3>
                  <div className="board-card-meta">
                    {post.scheduledAt && <small className={overdue ? 'overdue' : ''} title={format(parseISO(post.scheduledAt), 'd MMMM yyyy · HH:mm', { locale: es })}>
                      <CalendarDays size={12} /><span>{format(parseISO(post.scheduledAt), 'd MMM', { locale: es })}</span><time dateTime={post.scheduledAt}>{format(parseISO(post.scheduledAt), 'HH:mm')}</time>{overdue && <b>Atrasada</b>}
                    </small>}
                  </div>
                </article>
              </div>
            })}
            {!columnPosts.length && <div className="board-drop-hint">{inDropColumn ? 'Soltá acá' : 'Arrastrá una publicación acá'}</div>}
            {columnPosts.length > visiblePosts.length && <button type="button" className="board-more-btn" onClick={() => setOpenCells(current => new Set(current).add(cellKey))}>Ver {columnPosts.length - visiblePosts.length} más</button>}
          </div>
        })}
      </div>
    })}
  </div>
  {context ? createPortal(<div className="board-context-menu" role="menu" aria-label={`Acciones para ${context.post.title || 'publicación'}`} style={{ left: Math.max(8, context.x), top: Math.max(8, context.y) }} onPointerDown={event => event.stopPropagation()}>
    {selected.size > 1 && selected.has(context.post.id) && <div className="board-context-selection-note">{selected.size} publicaciones seleccionadas</div>}
    <button type="button" role="menuitem" onClick={() => { onSelect(context.post.id); setContext(null) }}>{selected.size > 1 && selected.has(context.post.id) ? 'Editar esta publicación' : 'Abrir / editar publicación'}</button>
    {selected.size > 1 && selected.has(context.post.id) && <button type="button" role="menuitem" onClick={() => { onEditSelection(); setContext(null) }}>Editar selección en pestañas</button>}
    <button type="button" role="menuitem" onClick={() => { void duplicatePost(context.post); setContext(null) }}><Copy size={14} />Duplicar publicación</button>
    <button type="button" role="menuitem" onClick={() => { onDelete(context.post); setContext(null) }}><Trash2 size={14} />Eliminar publicación</button>
    <button type="button" role="menuitem" disabled={!context.post.caption.trim()} onClick={() => { void runWithErrorReporting(() => window.planner.clipboard.write(context.post.caption), 'No se pudo copiar el texto'); setContext(null) }}><ClipboardCopy size={14} />Copiar texto</button>
    <button type="button" role="menuitem" aria-expanded={showStatuses} onClick={() => setShowStatuses(value => !value)}><MoreHorizontal size={14} />Cambiar etapa…</button>
    {showStatuses && <div className="board-context-statuses" role="group" aria-label="Cambiar etapa">{stages.filter(status => status !== context.post.status && (status !== 'scheduled' || Boolean(context.post.scheduledAt))).map(status => <button type="button" key={status} onClick={() => { onStatus(context.post, status); setContext(null); setShowStatuses(false) }}>{statusMeta[status].label}</button>)}</div>}
  </div>, document.body) : null}</>
}

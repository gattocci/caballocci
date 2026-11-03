import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Trash2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { contentLabels, statusMeta } from '../../shared/constants'
import type { Post, WorkGroup } from '../../shared/types'
import { AreaSelectionSurface } from './AreaSelectionSurface'

export type BoardListSort = 'title' | 'status' | 'format' | 'collection' | 'date'
type BoardListSortDirection = 'asc' | 'desc'

type BoardListViewProps = {
  listPosts: Post[]
  visibleListPosts: Post[]
  workGroups: WorkGroup[]
  selected: Set<string>
  toggle(id: string, range?: boolean, order?: string[]): void
  select(id: string | null): void
  onPickPost?(id: string): boolean
  pickedPostIds?: Set<string>
  query: string
  listSort: BoardListSort
  setListSort: Dispatch<SetStateAction<BoardListSort>>
  setListSortDirection: Dispatch<SetStateAction<BoardListSortDirection>>
  listPage: number
  setListPage: Dispatch<SetStateAction<number>>
  listPageCount: number
  setSelected(ids: string[]): void
  onDuplicate(post: Post): Promise<Post | undefined>
  onDelete(post: Post): void
  onEditSelection(): void
}

export function BoardListView({
  listPosts,
  visibleListPosts,
  workGroups,
  selected,
  toggle,
  select,
  onPickPost,
  pickedPostIds = new Set<string>(),
  query,
  listSort,
  setListSort,
  setListSortDirection,
  listPage,
  setListPage,
  listPageCount,
  setSelected,
  onDuplicate,
  onDelete,
  onEditSelection,
}: BoardListViewProps) {
  const [context, setContext] = useState<{ post: Post; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!context) return
    const dismiss = () => setContext(null)
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', onKeyDown) }
  }, [context])

  const changeSort = (sort: BoardListSort) => {
    setListSort(sort)
    setListSortDirection(current => listSort === sort && current === 'asc' ? 'desc' : 'asc')
  }

  return <AreaSelectionSurface className="board-list-view" selected={selected} setSelected={setSelected} startOnItems>
    {!listPosts.length ? <div className="planner-empty-inline" role="status"><strong>{query.trim() ? 'No hay publicaciones que coincidan' : 'No hay publicaciones para estos filtros'}</strong><span>Ajusta la búsqueda o los filtros para ver resultados.</span></div> : <>
      <div className="board-list-scroll"><table><thead><tr>
        <th><button type="button" onClick={() => changeSort('title')}>Título</button></th>
        <th><button type="button" onClick={() => changeSort('status')}>Etapa</button></th>
        <th><button type="button" onClick={() => changeSort('format')}>Formato</button></th>
        <th><button type="button" onClick={() => changeSort('collection')}>Colección</button></th>
        <th><button type="button" onClick={() => changeSort('date')}>Fecha</button></th>
        <th>Destinos</th>
      </tr></thead><tbody>{visibleListPosts.map(post => {
        const memberships = workGroups.filter(group => group.postIds.includes(post.id))
        return <tr data-area-select-id={post.id} key={post.id} className={`${selected.has(post.id) ? 'selected' : ''}${pickedPostIds.has(post.id) ? ' session-picked' : ''}`} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setContext({ post, x: Math.min(event.clientX, window.innerWidth - 224), y: Math.min(event.clientY, window.innerHeight - 160) }) }}>
          <td><label className="board-list-select"><input type="checkbox" checked={selected.has(post.id)} onChange={event => toggle(post.id, event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey, listPosts.map(item => item.id))} aria-label={`Seleccionar ${post.title || 'publicación'}`} /><button type="button" onClick={() => { if (!onPickPost?.(post.id)) select(post.id) }}>{post.title || 'Publicación sin título'}</button></label></td>
          <td><span className="board-list-stage"><i style={{ background: statusMeta[post.status].color }} />{statusMeta[post.status].label}</span></td>
          <td>{contentLabels[post.contentType]}</td>
          <td>{memberships.length ? memberships.map(group => group.name).join(', ') : '—'}</td>
          <td>{post.scheduledAt ? format(parseISO(post.scheduledAt), 'd MMM yyyy · HH:mm', { locale: es }) : 'Sin fecha'}</td>
          <td>{post.distribution?.length ? post.distribution.map(target => target.name).join(', ') : post.platforms.join(', ') || '—'}</td>
        </tr>
      })}</tbody></table></div>
      <div className="board-list-pagination"><span>{listPosts.length} publicaciones · página {listPage + 1} de {listPageCount}</span><div><button type="button" className="settings-button" disabled={listPage === 0} onClick={() => setListPage(current => current - 1)}>Anterior</button><button type="button" className="settings-button" disabled={listPage + 1 >= listPageCount} onClick={() => setListPage(current => current + 1)}>Siguiente</button></div></div>
    </>}
    {context ? createPortal(<div className="board-context-menu" role="menu" aria-label={`Acciones para ${context.post.title || 'publicación'}`} style={{ left: Math.max(8, context.x), top: Math.max(8, context.y) }} onPointerDown={event => event.stopPropagation()}>
      {selected.size > 1 && selected.has(context.post.id) && <div className="board-context-selection-note">{selected.size} publicaciones seleccionadas</div>}
      <button type="button" role="menuitem" onClick={() => { select(context.post.id); setContext(null) }}>{selected.size > 1 && selected.has(context.post.id) ? 'Editar esta publicación' : 'Abrir / editar publicación'}</button>
      {selected.size > 1 && selected.has(context.post.id) && <button type="button" role="menuitem" onClick={() => { onEditSelection(); setContext(null) }}>Editar selección en pestañas</button>}
      <button type="button" role="menuitem" onClick={() => { void onDuplicate(context.post); setContext(null) }}><Copy size={14} />Duplicar publicación</button>
      <button type="button" role="menuitem" onClick={() => { onDelete(context.post); setContext(null) }}><Trash2 size={14} />Eliminar publicación</button>
    </div>, document.body) : null}
  </AreaSelectionSurface>
}

import type { Dispatch, SetStateAction } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { contentLabels, statusMeta } from '../../shared/constants'
import type { Post, WorkGroup } from '../../shared/types'

export type BoardListSort = 'title' | 'status' | 'format' | 'collection' | 'date'
type BoardListSortDirection = 'asc' | 'desc'

type BoardListViewProps = {
  listPosts: Post[]
  visibleListPosts: Post[]
  workGroups: WorkGroup[]
  selected: Set<string>
  toggle(id: string, range?: boolean, order?: string[]): void
  select(id: string | null): void
  query: string
  listSort: BoardListSort
  setListSort: Dispatch<SetStateAction<BoardListSort>>
  setListSortDirection: Dispatch<SetStateAction<BoardListSortDirection>>
  listPage: number
  setListPage: Dispatch<SetStateAction<number>>
  listPageCount: number
}

export function BoardListView({
  listPosts,
  visibleListPosts,
  workGroups,
  selected,
  toggle,
  select,
  query,
  listSort,
  setListSort,
  setListSortDirection,
  listPage,
  setListPage,
  listPageCount,
}: BoardListViewProps) {
  const changeSort = (sort: BoardListSort) => {
    setListSort(sort)
    setListSortDirection(current => listSort === sort && current === 'asc' ? 'desc' : 'asc')
  }

  return <section className="board-list-view" aria-label="Publicaciones en lista">
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
        return <tr key={post.id} className={selected.has(post.id) ? 'selected' : ''}>
          <td><label className="board-list-select"><input type="checkbox" checked={selected.has(post.id)} onChange={event => toggle(post.id, event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey, listPosts.map(item => item.id))} aria-label={`Seleccionar ${post.title || 'publicación'}`} /><button type="button" onClick={() => select(post.id)}>{post.title || 'Publicación sin título'}</button></label></td>
          <td><span className="board-list-stage"><i style={{ background: statusMeta[post.status].color }} />{statusMeta[post.status].label}</span></td>
          <td>{contentLabels[post.contentType]}</td>
          <td>{memberships.length ? memberships.map(group => group.name).join(', ') : '—'}</td>
          <td>{post.scheduledAt ? format(parseISO(post.scheduledAt), 'd MMM yyyy · HH:mm', { locale: es }) : 'Sin fecha'}</td>
          <td>{post.distribution?.length ? post.distribution.map(target => target.name).join(', ') : post.platforms.join(', ') || '—'}</td>
        </tr>
      })}</tbody></table></div>
      <div className="board-list-pagination"><span>{listPosts.length} publicaciones · página {listPage + 1} de {listPageCount}</span><div><button type="button" className="settings-button" disabled={listPage === 0} onClick={() => setListPage(current => current - 1)}>Anterior</button><button type="button" className="settings-button" disabled={listPage + 1 >= listPageCount} onClick={() => setListPage(current => current + 1)}>Siguiente</button></div></div>
    </>}
  </section>
}

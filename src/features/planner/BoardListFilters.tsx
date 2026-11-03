import type { Dispatch, SetStateAction } from 'react'
import { contentLabels, stages, statusMeta } from '../../shared/constants'
import type { Post, WorkGroup } from '../../shared/types'

type BoardListFiltersProps = {
  workGroups: WorkGroup[]
  status: string
  setStatus: Dispatch<SetStateAction<string>>
  format: string
  setFormat: Dispatch<SetStateAction<string>>
  group: string
  setGroup: Dispatch<SetStateAction<string>>
  from: string
  setFrom: Dispatch<SetStateAction<string>>
  to: string
  setTo: Dispatch<SetStateAction<string>>
}

export function BoardListFilters({ workGroups, status, setStatus, format, setFormat, group, setGroup, from, setFrom, to, setTo }: BoardListFiltersProps) {
  const hasFilters = Boolean(status || format || group || from || to)

  const clearFilters = () => {
    setStatus('')
    setFormat('')
    setGroup('')
    setFrom('')
    setTo('')
  }

  return <div className="board-list-filters" aria-label="Filtros de publicaciones">
    <label>Etapa<select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todas</option>{[...stages, 'archived' as Post['status']].map(item => <option key={item} value={item}>{statusMeta[item].label}</option>)}</select></label>
    <label>Formato<select value={format} onChange={event => setFormat(event.target.value)}><option value="">Todos</option>{Object.entries(contentLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label>Colección<select value={group} onChange={event => setGroup(event.target.value)}><option value="">Todas</option>{workGroups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Desde<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
    <label>Hasta<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
    {hasFilters && <button type="button" className="settings-button" onClick={clearFilters}>Limpiar filtros</button>}
  </div>
}

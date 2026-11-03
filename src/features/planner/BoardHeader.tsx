import { CalendarDays, List } from 'lucide-react'
import { ViewHeading } from '../../components/layout/AppShell'
import type { BoardCardDetailLevel } from './BoardCardDecorations'

type BoardMode = 'kanban' | 'list' | 'calendar'

type BoardHeaderProps = {
  boardMode: BoardMode
  changeBoardMode(mode: BoardMode): void
  visiblePerColumn: number
  loadMore(): void
  detailLevel: BoardCardDetailLevel
  changeDetailLevel(level: BoardCardDetailLevel): void
}

export function BoardHeader({ boardMode, changeBoardMode, visiblePerColumn, loadMore, detailLevel, changeDetailLevel }: BoardHeaderProps) {
  return <ViewHeading title="Tablero de contenido" subtitle="Gestiona publicaciones por etapas, en lista o por fecha.">
    <div className="segmented board-mode-switch" role="group" aria-label="Vista del tablero">
      <button type="button" aria-pressed={boardMode === 'kanban'} className={boardMode === 'kanban' ? 'active' : ''} onClick={() => changeBoardMode('kanban')}>Kanban</button>
      <button type="button" aria-pressed={boardMode === 'list'} className={boardMode === 'list' ? 'active' : ''} onClick={() => changeBoardMode('list')}><List size={13} /> Lista</button>
      <button type="button" aria-pressed={boardMode === 'calendar'} className={boardMode === 'calendar' ? 'active' : ''} onClick={() => changeBoardMode('calendar')}><CalendarDays size={13} /> Calendario</button>
    </div>
    {boardMode === 'kanban' && <button className="settings-button" type="button" disabled={visiblePerColumn >= 100} onClick={loadMore}>{visiblePerColumn >= 100 ? 'Límite de tarjetas' : `Cargar ${Math.min(30, 100 - visiblePerColumn)} más por etapa`}</button>}
    {boardMode === 'kanban' && <label className="board-card-detail-control">Detalles técnicos<select aria-label="Nivel de detalles técnicos en las tarjetas" value={detailLevel} onChange={event => changeDetailLevel(event.target.value as BoardCardDetailLevel)}><option value="discreet">Discretos</option><option value="full">Completos</option><option value="hidden">Ocultos</option></select></label>}
  </ViewHeading>
}

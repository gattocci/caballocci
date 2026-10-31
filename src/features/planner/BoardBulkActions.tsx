import type { Dispatch, SetStateAction } from 'react'
import { Smartphone } from 'lucide-react'
import type { Post, WorkGroup } from '../../shared/types'

type BoardBulkActionsProps = {
  selected: Set<string>
  workGroups: WorkGroup[]
  selectedWorkGroup: WorkGroup | null
  membershipTargetGroupId: string
  setMembershipTargetGroupId: Dispatch<SetStateAction<string>>
  updateGroupMembership(groupId: string, add: boolean): Promise<unknown>
  openGroupForm(): void
  clear(): void
  boardMode: 'kanban' | 'list' | 'calendar'
  mobileExportBusy: boolean
  exportSelectedToMobile(): Promise<unknown>
  bulkScheduleAt: string
  setBulkScheduleAt: Dispatch<SetStateAction<string>>
  setBulkScheduleWarning: Dispatch<SetStateAction<string>>
  bulkSchedule(): void
  bulkMove(status: Post['status']): Promise<unknown>
  spaces: string[]
  moveToSpace(space: string): Promise<unknown>
  bulkScheduleWarning: string
}

export function BoardBulkActions({ selected, workGroups, selectedWorkGroup, membershipTargetGroupId, setMembershipTargetGroupId, updateGroupMembership, openGroupForm, clear, boardMode, mobileExportBusy, exportSelectedToMobile, bulkScheduleAt, setBulkScheduleAt, setBulkScheduleWarning, bulkSchedule, bulkMove, bulkScheduleWarning, spaces, moveToSpace }: BoardBulkActionsProps) {
  if (!selected.size) return null

  return <div className="board-bulk-actions">
    <strong>{selected.size} seleccionadas</strong>
    {workGroups.some(group => !group.archivedAt) && <><select aria-label="Colección de destino" value={membershipTargetGroupId} onChange={event => setMembershipTargetGroupId(event.target.value)}><option value="">Añadir a una colección…</option>{workGroups.filter(group => !group.archivedAt).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button type="button" disabled={!membershipTargetGroupId} onClick={() => void updateGroupMembership(membershipTargetGroupId, true)}>Añadir</button></>}
    {selectedWorkGroup && !selectedWorkGroup.archivedAt && selectedWorkGroup.postIds.some(id => selected.has(id)) && <button type="button" onClick={() => void updateGroupMembership(selectedWorkGroup.id, false)}>Quitar de esta colección</button>}
    <button type="button" onClick={openGroupForm}>Crear colección</button>
    {spaces.length > 0 && <label className="bulk-space-control">Mover a proyecto<select aria-label="Mover selección a proyecto" defaultValue="" onChange={event => { const space = event.target.value; if (space) void moveToSpace(space); event.target.value = '' }}><option value="">Elegir…</option>{spaces.map(space => <option key={space} value={space}>{space}</option>)}</select></label>}
    <button type="button" onClick={clear}>Limpiar</button>
    <details className="board-bulk-more"><summary>Más acciones</summary><div>
      <button type="button" disabled={mobileExportBusy} onClick={() => void exportSelectedToMobile()}><Smartphone size={14} /> {mobileExportBusy ? 'Enviando…' : 'Enviar al celular'}</button>
      {boardMode === 'list' && <div className="bulk-schedule-control"><label htmlFor="bulk-schedule-at">Fecha y hora</label><input id="bulk-schedule-at" type="datetime-local" value={bulkScheduleAt} onChange={event => { setBulkScheduleAt(event.target.value); setBulkScheduleWarning('') }} /><button type="button" disabled={!bulkScheduleAt} onClick={bulkSchedule}>Programar</button></div>}
      <button type="button" onClick={() => void bulkMove('draft')}>Borrador</button><button type="button" onClick={() => void bulkMove('review')}>Revisión</button><button type="button" onClick={() => void bulkMove('approved')}>Aprobadas</button><button type="button" onClick={() => void bulkMove('archived')}>Archivar</button>
    </div></details>
    {bulkScheduleWarning && <span className="bulk-schedule-warning" role="alert">{bulkScheduleWarning}</span>}
  </div>
}

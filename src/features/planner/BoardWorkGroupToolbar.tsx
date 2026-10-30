import type { Dispatch, SetStateAction } from 'react'
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, FolderPlus, Pencil, Trash2 } from 'lucide-react'
import type { BoardLane } from './BoardLanes'
import type { WorkGroup } from '../../shared/types'

type PendingGroupAction = { type: 'archive' | 'restore' | 'delete'; group: WorkGroup }
type PendingMediaCompression = { target: 'group' | 'post'; id: string; name: string; mediaCount: number }

type BoardWorkGroupToolbarProps = {
  boardMode: 'kanban' | 'list' | 'calendar'
  selectedWorkGroup: WorkGroup | null
  archivedCount: number
  showArchivedPosts: boolean
  setShowArchivedPosts: Dispatch<SetStateAction<boolean>>
  boardLanes: BoardLane[]
  collapsedLanes: Set<string>
  toggleAllLanes(): void
  openGroupForm(group?: WorkGroup | null): void
  setActiveWorkGroup(id: string | null): void
  setPendingGroupAction: Dispatch<SetStateAction<PendingGroupAction | null>>
  groupUncompressedMediaCount: number
  setPendingMediaCompression: Dispatch<SetStateAction<PendingMediaCompression | null>>
  restoreGroupMedia(): void
}

export function BoardWorkGroupToolbar({ boardMode, selectedWorkGroup, archivedCount, showArchivedPosts, setShowArchivedPosts, boardLanes, collapsedLanes, toggleAllLanes, openGroupForm, setActiveWorkGroup, setPendingGroupAction, groupUncompressedMediaCount, setPendingMediaCompression, restoreGroupMedia }: BoardWorkGroupToolbarProps) {
  const allLanesCollapsed = boardLanes.length > 0 && boardLanes.every(lane => collapsedLanes.has(lane.id))

  return <div className="work-group-toolbar">
    <button type="button" className="settings-button" onClick={() => openGroupForm()}><FolderPlus size={14} /> Nueva colección</button>
    {boardMode === 'kanban' && archivedCount > 0 && <button type="button" className="settings-button board-archive-toggle" aria-expanded={showArchivedPosts} onClick={() => setShowArchivedPosts(current => !current)}><Archive size={13} /> Archivadas <span>{archivedCount}</span>{showArchivedPosts ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>}
    {boardMode === 'kanban' && <div className="board-lane-controls"><span>{selectedWorkGroup ? `Viendo solo «${selectedWorkGroup.name}»` : `${boardLanes.length} carriles`}</span>{selectedWorkGroup && <button type="button" className="settings-button" onClick={() => setActiveWorkGroup(null)}>Mostrar todos</button>}<button type="button" className="settings-button" onClick={toggleAllLanes}>{allLanesCollapsed ? 'Expandir todos' : 'Colapsar todos'}</button></div>}
    {selectedWorkGroup && <div className="work-group-actions">
      <button type="button" className="settings-button" onClick={() => openGroupForm(selectedWorkGroup)}><Pencil size={13} /> Editar</button>
      <button type="button" className="settings-button" onClick={() => setPendingGroupAction({ type: selectedWorkGroup.archivedAt ? 'restore' : 'archive', group: selectedWorkGroup })}>{selectedWorkGroup.archivedAt ? <><ArchiveRestore size={14} /> Restaurar colección</> : <><Archive size={14} /> Archivar colección</>}</button>
      {selectedWorkGroup.archivedAt && <>{groupUncompressedMediaCount > 0 && <button type="button" className="settings-button" onClick={() => setPendingMediaCompression({ target: 'group', id: selectedWorkGroup.id, name: selectedWorkGroup.name, mediaCount: groupUncompressedMediaCount })}><Archive size={14} /> Comprimir medios</button>}{selectedWorkGroup.compressedMediaCount > 0 && <button type="button" className="settings-button" onClick={() => void restoreGroupMedia()}><ArchiveRestore size={14} /> Restaurar {selectedWorkGroup.compressedMediaCount} medios</button>}</>}
      <button type="button" className="settings-button work-group-delete-button" onClick={() => setPendingGroupAction({ type: 'delete', group: selectedWorkGroup })}><Trash2 size={14} /> Borrar colección</button>
    </div>}
  </div>
}

import type { Dispatch, SetStateAction } from 'react'
import { Archive, ChevronDown, ChevronRight, FolderPlus } from 'lucide-react'
import type { WorkGroup } from '../../shared/types'

type BoardWorkGroupToolbarProps = {
  boardMode: 'kanban' | 'list' | 'calendar'
  selectedWorkGroup: WorkGroup | null
  archivedCount: number
  showArchivedPosts: boolean
  setShowArchivedPosts: Dispatch<SetStateAction<boolean>>
  openGroupForm(group?: WorkGroup | null): void
}

export function BoardWorkGroupToolbar({ boardMode, selectedWorkGroup, archivedCount, showArchivedPosts, setShowArchivedPosts, openGroupForm }: BoardWorkGroupToolbarProps) {
  const showNewCollection = boardMode !== 'kanban' && !selectedWorkGroup
  const showArchivedToggle = boardMode === 'kanban' && archivedCount > 0
  if (!showNewCollection && !showArchivedToggle) return null
  return <div className="work-group-toolbar">
    {showNewCollection && <button type="button" className="settings-button" onClick={() => openGroupForm()}><FolderPlus size={14} /> Nueva colección</button>}
    {showArchivedToggle && <button type="button" className="settings-button board-archive-toggle" aria-expanded={showArchivedPosts} onClick={() => setShowArchivedPosts(current => !current)}><Archive size={13} /> Archivadas <span>{archivedCount}</span>{showArchivedPosts ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>}
  </div>
}

import type { DragEvent, ReactNode } from 'react'
import { Archive, ArchiveRestore, FolderOpen, Inbox, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Post, WorkGroup } from '../../shared/types'

export function BoardCollectionNav({ groups, posts, selectedWorkGroup, setActiveWorkGroup, openGroupForm, onDropPosts, onEditGroup, onGroupAction, groupUncompressedMediaCount, setPendingMediaCompression, restoreGroupMedia, trailing }: {
  groups: WorkGroup[]
  posts: Post[]
  selectedWorkGroup: WorkGroup | null
  setActiveWorkGroup(id: string | null): void
  openGroupForm(): void
  onDropPosts(groupId: string, ids: string[]): void
  onEditGroup(group: WorkGroup): void
  onGroupAction(type: 'archive' | 'restore' | 'delete', group: WorkGroup): void
  groupUncompressedMediaCount: number
  setPendingMediaCompression(id: string, name: string, mediaCount: number): void
  restoreGroupMedia(): void
  trailing?: ReactNode
}) {
  const activeGroups = groups.filter(group => !group.archivedAt)
  const groupPosts = (group: WorkGroup) => posts.filter(post => group.postIds.includes(post.id) && (group.archivedAt || post.status !== 'archived'))
  const unassignedCount = posts.filter(post => post.status !== 'archived' && !activeGroups.some(group => group.postIds.includes(post.id))).length
  const dropProps = (group: WorkGroup) => ({
    onDragOver: (event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); event.currentTarget.classList.add('drag-over') },
    onDragLeave: (event: DragEvent<HTMLButtonElement>) => event.currentTarget.classList.remove('drag-over'),
    onDrop: (event: DragEvent<HTMLButtonElement>) => {
      event.preventDefault(); event.currentTarget.classList.remove('drag-over')
      const raw = event.dataTransfer.getData('application/x-caballocci-post-ids')
      let ids: string[] = []
      try { ids = JSON.parse(raw) as string[] } catch { const singleId = event.dataTransfer.getData('text/plain'); if (singleId) ids = [singleId] }
      onDropPosts(group.id, ids)
    },
  })
  return <nav className="board-collection-nav" aria-label="Colecciones">
    <div className="board-collection-tabs">
      <button type="button" className="board-collection-tab" aria-current={!selectedWorkGroup ? 'page' : undefined} onClick={() => setActiveWorkGroup(null)} title="Publicaciones que no pertenecen a ninguna colección">
        <Inbox size={14} /><span className="board-collection-tab-name">Sin colección</span><em>{unassignedCount}</em>
      </button>
      {activeGroups.length > 0 && <span className="board-collection-divider" aria-hidden="true" />}
      {activeGroups.map(group => {
        const items = groupPosts(group)
        return <button type="button" className="board-collection-tab" key={group.id} aria-current={selectedWorkGroup?.id === group.id ? 'page' : undefined} onClick={() => setActiveWorkGroup(group.id)} {...dropProps(group)} title={`${group.name}: suelta publicaciones para añadirlas`}>
          <FolderOpen size={14} /><span className="board-collection-tab-name">{group.name}</span><em>{items.length}</em>
        </button>
      })}
      <button type="button" className="board-collection-add" onClick={openGroupForm} aria-label="Nueva colección" title="Nueva colección"><Plus size={15} /></button>
    </div>
    <div className="board-collection-aside">
      {selectedWorkGroup && <div className="board-collection-header-actions">
        <button type="button" className="settings-button" onClick={() => onEditGroup(selectedWorkGroup)}><Pencil size={13} /> Editar</button>
        <button type="button" className="settings-button" onClick={() => onGroupAction(selectedWorkGroup.archivedAt ? 'restore' : 'archive', selectedWorkGroup)}>{selectedWorkGroup.archivedAt ? <ArchiveRestore size={13} /> : <Archive size={13} />}{selectedWorkGroup.archivedAt ? 'Restaurar colección' : 'Archivar colección'}</button>
        <details className="board-collection-menu"><summary aria-label="Más opciones de la colección" title="Más opciones"><MoreHorizontal size={16} /></summary><div>
          {selectedWorkGroup.archivedAt && groupUncompressedMediaCount > 0 && <button type="button" onClick={() => setPendingMediaCompression(selectedWorkGroup.id, selectedWorkGroup.name, groupUncompressedMediaCount)}><Archive size={14} /> Comprimir medios</button>}
          {selectedWorkGroup.archivedAt && selectedWorkGroup.compressedMediaCount > 0 && <button type="button" onClick={restoreGroupMedia}><ArchiveRestore size={14} /> Restaurar {selectedWorkGroup.compressedMediaCount} medios</button>}
          <button type="button" className="danger-menu-item" onClick={() => onGroupAction('delete', selectedWorkGroup)}><Trash2 size={14} /> Borrar colección</button>
        </div></details>
      </div>}
      {trailing}
    </div>
  </nav>
}
import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { Archive, ArchiveRestore, FolderOpen, Inbox, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Post, WorkGroup } from '../../shared/types'
import { BoardContextMenu } from './BoardContextMenu'

const workGroupDragType = 'application/x-caballocci-work-group-id'

export function BoardCollectionNav({ groups, posts, selectedWorkGroup, setActiveWorkGroup, openGroupForm, onDropPosts, onEditGroup, onGroupAction, reorderGroups, groupUncompressedMediaCount, setPendingMediaCompression, restoreGroupMedia, trailing }: {
  groups: WorkGroup[]
  posts: Post[]
  selectedWorkGroup: WorkGroup | null
  setActiveWorkGroup(id: string | null): void
  openGroupForm(): void
  onDropPosts(groupId: string, ids: string[]): void
  onEditGroup(group: WorkGroup): void
  onGroupAction(type: 'archive' | 'restore' | 'delete', group: WorkGroup): void
  reorderGroups(draggedId: string, targetId: string): void
  groupUncompressedMediaCount: number
  setPendingMediaCompression(id: string, name: string, mediaCount: number): void
  restoreGroupMedia(): void
  trailing?: ReactNode
}) {
  const [collectionMenu, setCollectionMenu] = useState<{ group: WorkGroup; x: number; y: number } | null>(null)
  const [draggingPosts, setDraggingPosts] = useState(false)
  useEffect(() => {
    if (!collectionMenu) return
    const dismiss = () => setCollectionMenu(null)
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [collectionMenu])

  const activeGroups = groups.filter(group => !group.archivedAt)
  const groupPosts = (group: WorkGroup) => posts.filter(post => group.postIds.includes(post.id) && (group.archivedAt || post.status !== 'archived'))
  const unassignedCount = posts.filter(post => post.status !== 'archived' && !activeGroups.some(group => group.postIds.includes(post.id))).length
  const dropProps = (group: WorkGroup) => ({
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      const types = Array.from(event.dataTransfer.types)
      const isPostDrag = types.includes('application/x-caballocci-post-ids')
      if (!isPostDrag && !types.includes(workGroupDragType)) return
      event.preventDefault()
      event.currentTarget.classList.add('drag-over')
      event.currentTarget.classList.toggle('post-drag-over', isPostDrag)
      if (isPostDrag) setDraggingPosts(true)
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      event.currentTarget.classList.remove('drag-over', 'post-drag-over')
      if (event.relatedTarget instanceof Node && event.currentTarget.parentElement?.contains(event.relatedTarget)) return
      setDraggingPosts(false)
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault(); event.currentTarget.classList.remove('drag-over', 'post-drag-over'); setDraggingPosts(false)
      const draggedGroupId = event.dataTransfer.getData(workGroupDragType)
      if (draggedGroupId) {
        reorderGroups(draggedGroupId, group.id)
        return
      }
      const raw = event.dataTransfer.getData('application/x-caballocci-post-ids')
      let ids: string[] = []
      try { ids = JSON.parse(raw) as string[] } catch { const singleId = event.dataTransfer.getData('text/plain'); if (singleId) ids = [singleId] }
      onDropPosts(group.id, ids)
    },
  })
  return <nav className="board-collection-nav" aria-label="Colecciones">
    <div className="board-collection-tabs">
      <button type="button" className="board-collection-tab" aria-current={!selectedWorkGroup ? 'page' : undefined} onClick={() => setActiveWorkGroup(null)}>
        <Inbox size={14} /><span className="board-collection-tab-name">Sin colección</span><em>{unassignedCount}</em>
      </button>
      {activeGroups.length > 0 && <span className="board-collection-divider" aria-hidden="true" />}
      {activeGroups.map(group => {
        const items = groupPosts(group)
        return <div className="board-collection-item" key={group.id} {...dropProps(group)}>
          <button type="button" draggable className="board-collection-tab" aria-current={selectedWorkGroup?.id === group.id ? 'page' : undefined} onClick={() => setActiveWorkGroup(group.id)} onDragStart={event => event.dataTransfer.setData(workGroupDragType, group.id)}>
            <FolderOpen size={14} /><span className="board-collection-tab-name">{group.name}</span><em>{items.length}</em>
          </button>
          <button type="button" className="board-collection-item-menu" aria-label={`Opciones de ${group.name}`} onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect()
            setCollectionMenu({ group, x: rect.right, y: rect.bottom + 4 })
          }}><MoreHorizontal size={14} /></button>
        </div>
      })}
      <button type="button" className="board-collection-add" onClick={openGroupForm} aria-label="Nueva colección"><Plus size={15} /></button>
      {draggingPosts && <span className="board-collection-drop-guidance" role="status">Soltá una publicación sobre una colección para añadirla</span>}
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
    {collectionMenu && <BoardContextMenu x={collectionMenu.x} y={collectionMenu.y} label={`Opciones de ${collectionMenu.group.name}`}>
      <button type="button" role="menuitem" onClick={() => { setCollectionMenu(null); onEditGroup(collectionMenu.group) }}><Pencil size={14} />Editar colección</button>
      <button type="button" role="menuitem" onClick={() => { setCollectionMenu(null); onGroupAction('archive', collectionMenu.group) }}><Archive size={14} />Archivar colección</button>
      <button type="button" role="menuitem" className="danger-menu-item" onClick={() => { setCollectionMenu(null); onGroupAction('delete', collectionMenu.group) }}><Trash2 size={14} />Borrar colección…</button>
    </BoardContextMenu>}
  </nav>
}
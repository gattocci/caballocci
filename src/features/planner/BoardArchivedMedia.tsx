import type { Dispatch, SetStateAction } from 'react'
import { Archive, ArchiveRestore, FolderOpen } from 'lucide-react'
import { statusMeta } from '../../shared/constants'
import type { Post, WorkGroup } from '../../shared/types'

type PendingMediaCompression = { target: 'group' | 'post'; id: string; name: string; mediaCount: number }

type BoardArchivedMediaProps = {
  archivedPosts: Post[]
  archivedGroups: WorkGroup[]
  collectionPosts: Post[]
  compressedPosts: Post[]
  showArchivedPosts: boolean
  showCompressedPosts: boolean
  setShowCompressedPosts: Dispatch<SetStateAction<boolean>>
  select(id: string): void
  setPendingMediaCompression: Dispatch<SetStateAction<PendingMediaCompression | null>>
  restorePostMedia(post: Post): void
  restoreGroup(group: WorkGroup): void
  openGroup(group: WorkGroup): void
}

export function BoardArchivedMedia({ archivedPosts, archivedGroups, collectionPosts, compressedPosts, showArchivedPosts, showCompressedPosts, setShowCompressedPosts, select, setPendingMediaCompression, restorePostMedia, restoreGroup, openGroup }: BoardArchivedMediaProps) {
  const archivedGroupPostIds = new Set(archivedGroups.flatMap(group => group.postIds))
  const ungroupedArchivedPosts = archivedPosts.filter(post => !archivedGroupPostIds.has(post.id))
  return <>
    {showArchivedPosts && archivedGroups.length > 0 && <section className="board-archived-posts board-archived-collections" aria-label="Colecciones archivadas"><div className="board-archived-post-list">{archivedGroups.map(group => {
      const posts = collectionPosts.filter(post => group.postIds.includes(post.id))
      return <article className="board-archived-collection" key={group.id}>
        <header><div><button type="button" className="board-archived-collection-open" onClick={() => openGroup(group)} title={`Abrir colección ${group.name}`}><FolderOpen size={14} /><strong>{group.name}</strong></button><span>{posts.length} {posts.length === 1 ? 'publicación' : 'publicaciones'}</span></div><button type="button" className="settings-button" onClick={() => restoreGroup(group)}><ArchiveRestore size={13} /> Restaurar colección</button></header>
        {posts.length > 0
          ? <div className="board-archived-collection-posts">{posts.map(post => <button type="button" className="board-archived-collection-post" key={post.id} onClick={() => select(post.id)}><strong>{post.title || 'Publicación sin título'}</strong></button>)}</div>
          : <p className="board-archived-collection-empty">No hay publicaciones que coincidan con la búsqueda actual.</p>}
      </article>
    })}</div></section>}
    {ungroupedArchivedPosts.length > 0 && showArchivedPosts && <section className="board-archived-posts"><div className="board-archived-post-list">{ungroupedArchivedPosts.map(post => {
      const compressedCount = post.media.filter(asset => asset.compressed).length
      return <article key={post.id}><button type="button" className="board-archived-post-title" onClick={() => select(post.id)}><strong>{post.title || 'Publicación sin título'}</strong><span>{post.media.length} medios · {compressedCount} comprimidos</span></button><div>{post.media.length > compressedCount && <button type="button" className="settings-button" onClick={() => setPendingMediaCompression({ target: 'post', id: post.id, name: post.title || 'Publicación sin título', mediaCount: post.media.length - compressedCount })}><Archive size={13} /> Comprimir medios</button>}{compressedCount > 0 && <button type="button" className="settings-button" onClick={() => void restorePostMedia(post)}><ArchiveRestore size={13} /> Restaurar medios</button>}</div></article>
    })}</div></section>}
    {compressedPosts.length > 0 && <section className="board-archived-posts"><header><div><strong>Medios comprimidos</strong><span>{compressedPosts.length}</span></div><button type="button" className="settings-button" onClick={() => setShowCompressedPosts(current => !current)}>{showCompressedPosts ? 'Ocultar' : 'Mostrar'}</button></header>{showCompressedPosts && <div className="board-archived-post-list">{compressedPosts.map(post => <article key={post.id}><div className="board-archived-post-title"><strong>{post.title || 'Publicación sin título'}</strong><span>{post.media.filter(asset => asset.compressed).length} medios dentro de archivo ZIP · {statusMeta[post.status].label}</span></div><div><button type="button" className="settings-button" onClick={() => void restorePostMedia(post)}><ArchiveRestore size={13} /> Restaurar medios</button></div></article>)}</div>}</section>}
  </>
}

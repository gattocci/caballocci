import type { Dispatch, SetStateAction } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import { statusMeta } from '../../shared/constants'
import type { Post } from '../../shared/types'

type PendingMediaCompression = { target: 'group' | 'post'; id: string; name: string; mediaCount: number }

type BoardArchivedMediaProps = {
  archivedPosts: Post[]
  compressedPosts: Post[]
  showArchivedPosts: boolean
  showCompressedPosts: boolean
  setShowCompressedPosts: Dispatch<SetStateAction<boolean>>
  select(id: string): void
  setPendingMediaCompression: Dispatch<SetStateAction<PendingMediaCompression | null>>
  restorePostMedia(post: Post): void
}

export function BoardArchivedMedia({ archivedPosts, compressedPosts, showArchivedPosts, showCompressedPosts, setShowCompressedPosts, select, setPendingMediaCompression, restorePostMedia }: BoardArchivedMediaProps) {
  return <>
    {archivedPosts.length > 0 && showArchivedPosts && <section className="board-archived-posts"><div className="board-archived-post-list">{archivedPosts.map(post => {
      const compressedCount = post.media.filter(asset => asset.compressed).length
      return <article key={post.id}><button type="button" className="board-archived-post-title" onClick={() => select(post.id)}><strong>{post.title || 'Publicación sin título'}</strong><span>{post.media.length} medios · {compressedCount} comprimidos</span></button><div>{post.media.length > compressedCount && <button type="button" className="settings-button" onClick={() => setPendingMediaCompression({ target: 'post', id: post.id, name: post.title || 'Publicación sin título', mediaCount: post.media.length - compressedCount })}><Archive size={13} /> Comprimir medios</button>}{compressedCount > 0 && <button type="button" className="settings-button" onClick={() => void restorePostMedia(post)}><ArchiveRestore size={13} /> Restaurar medios</button>}</div></article>
    })}</div></section>}
    {compressedPosts.length > 0 && <section className="board-archived-posts"><header><div><strong>Medios comprimidos</strong><span>{compressedPosts.length}</span></div><button type="button" className="settings-button" onClick={() => setShowCompressedPosts(current => !current)}>{showCompressedPosts ? 'Ocultar' : 'Mostrar'}</button></header>{showCompressedPosts && <div className="board-archived-post-list">{compressedPosts.map(post => <article key={post.id}><div className="board-archived-post-title"><strong>{post.title || 'Publicación sin título'}</strong><span>{post.media.filter(asset => asset.compressed).length} medios dentro de archivo ZIP · {statusMeta[post.status].label}</span></div><div><button type="button" className="settings-button" onClick={() => void restorePostMedia(post)}><ArchiveRestore size={13} /> Restaurar medios</button></div></article>)}</div>}</section>}
  </>
}

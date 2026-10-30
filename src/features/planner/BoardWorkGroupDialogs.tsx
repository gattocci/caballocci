import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { Post, WorkGroup } from '../../shared/types'

type PendingGroupAction = { type: 'archive' | 'restore' | 'delete'; group: WorkGroup }
type PendingMediaCompression = { target: 'group' | 'post'; id: string; name: string; mediaCount: number }

type BoardWorkGroupDialogsProps = {
  selectedCount: number
  allPosts: Post[]
  groupFormOpen: boolean
  setGroupFormOpen: Dispatch<SetStateAction<boolean>>
  editingGroupId: string | null
  groupName: string
  setGroupName: Dispatch<SetStateAction<string>>
  groupDescription: string
  setGroupDescription: Dispatch<SetStateAction<string>>
  savingGroup: boolean
  submitGroupForm(event: FormEvent<HTMLFormElement>): void
  pendingGroupAction: PendingGroupAction | null
  setPendingGroupAction: Dispatch<SetStateAction<PendingGroupAction | null>>
  groupDeleteMode: 'group' | 'all-posts' | 'selected-posts'
  setGroupDeleteMode: Dispatch<SetStateAction<'group' | 'all-posts' | 'selected-posts'>>
  groupPostsToDelete: string[]
  setGroupPostsToDelete: Dispatch<SetStateAction<string[]>>
  workingOnGroup: boolean
  confirmGroupAction(): void
  pendingMediaCompression: PendingMediaCompression | null
  setPendingMediaCompression: Dispatch<SetStateAction<PendingMediaCompression | null>>
  confirmMediaCompression(): void
}

export function BoardWorkGroupDialogs({
  selectedCount, allPosts, groupFormOpen, setGroupFormOpen, editingGroupId,
  groupName, setGroupName, groupDescription, setGroupDescription, savingGroup,
  submitGroupForm, pendingGroupAction, setPendingGroupAction, groupDeleteMode,
  setGroupDeleteMode, groupPostsToDelete, setGroupPostsToDelete, workingOnGroup,
  confirmGroupAction, pendingMediaCompression, setPendingMediaCompression,
  confirmMediaCompression,
}: BoardWorkGroupDialogsProps) {
  return <>
    {groupFormOpen && <div className="work-group-form-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !savingGroup) setGroupFormOpen(false) }}>
      <form className="work-group-form" role="dialog" aria-modal="true" aria-labelledby="work-group-form-title" onSubmit={submitGroupForm}>
        <header><span>COLECCIÓN DE TRABAJO</span><button type="button" aria-label="Cerrar" disabled={savingGroup} onClick={() => setGroupFormOpen(false)}>×</button></header>
        <h2 id="work-group-form-title">{editingGroupId ? 'Editar colección' : 'Crear colección'}</h2>
        <p>Reúne publicaciones de una campaña, serie o proyecto. Sus estados no se modifican.</p>
        <label htmlFor="work-group-name">Nombre</label>
        <input id="work-group-name" autoFocus maxLength={120} required value={groupName} onChange={event => setGroupName(event.target.value)} placeholder="Ej. Lanzamiento de primavera" />
        <label htmlFor="work-group-description">Descripción <span>Opcional</span></label>
        <textarea id="work-group-description" maxLength={2000} rows={3} value={groupDescription} onChange={event => setGroupDescription(event.target.value)} placeholder="¿Qué tienen en común estas publicaciones?" />
        {!editingGroupId && <div className="work-group-form-hint">{selectedCount
          ? `Se añadirán automáticamente ${selectedCount} publicaciones seleccionadas.`
          : 'Después de crearla, selecciona publicaciones en el tablero y usa “Añadir a colección”.'}</div>}
        <footer><button type="button" className="settings-button" disabled={savingGroup} onClick={() => setGroupFormOpen(false)}>Cancelar</button><button type="submit" className="new-button" disabled={savingGroup || !groupName.trim()}>{savingGroup ? 'Guardando…' : editingGroupId ? 'Guardar cambios' : 'Crear colección'}</button></footer>
      </form>
    </div>}
    {pendingGroupAction && <div className="work-group-form-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !workingOnGroup) setPendingGroupAction(null) }}>
      <section className="work-group-form work-group-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="work-group-confirm-title" aria-describedby="work-group-confirm-description">
        <header><span>CONFIRMAR ACCIÓN</span><button type="button" aria-label="Cerrar" disabled={workingOnGroup} onClick={() => setPendingGroupAction(null)}>×</button></header>
        <h2 id="work-group-confirm-title">{pendingGroupAction.type === 'delete' ? '¿Borrar esta colección?' : pendingGroupAction.type === 'archive' ? '¿Archivar esta colección?' : '¿Restaurar esta colección?'}</h2>
        <p id="work-group-confirm-description">{pendingGroupAction.type === 'delete'
          ? <>Se borrará <strong>{pendingGroupAction.group.name}</strong> y sus vínculos. Elige qué hacer con sus {pendingGroupAction.group.postIds.length} publicaciones:</>
          : pendingGroupAction.type === 'archive'
            ? <>Se archivará <strong>{pendingGroupAction.group.name}</strong>. Sus publicaciones y estados permanecerán intactos; podrás restaurarla después.</>
            : <>Se restaurará <strong>{pendingGroupAction.group.name}</strong> y volverá a aparecer entre las colecciones activas.</>}</p>
        {pendingGroupAction.type === 'delete' && <div className="work-group-delete-options" role="radiogroup" aria-label="Qué borrar">
          <label><input type="radio" name="group-delete-mode" checked={groupDeleteMode === 'group'} onChange={() => setGroupDeleteMode('group')} /><span><strong>Borrar solo la colección</strong><small>Conserva publicaciones y archivos.</small></span></label>
          <label><input type="radio" name="group-delete-mode" checked={groupDeleteMode === 'all-posts'} onChange={() => setGroupDeleteMode('all-posts')} /><span><strong>Borrar colección y todas las publicaciones ({pendingGroupAction.group.postIds.length})</strong><small>Se quitarán también de otras colecciones.</small></span></label>
          <label><input type="radio" name="group-delete-mode" checked={groupDeleteMode === 'selected-posts'} onChange={() => setGroupDeleteMode('selected-posts')} /><span><strong>Borrar colección y algunas publicaciones</strong><small>Elige cuáles borrar; las demás se conservan.</small></span></label>
          {groupDeleteMode === 'selected-posts' && <div className="work-group-delete-post-list">{allPosts.filter(post => pendingGroupAction.group.postIds.includes(post.id)).map(post => <label key={post.id}><input type="checkbox" checked={groupPostsToDelete.includes(post.id)} onChange={event => setGroupPostsToDelete(current => event.target.checked ? [...current, post.id] : current.filter(id => id !== post.id))} /><span>{post.title || 'Publicación sin título'}</span></label>)}</div>}
          <p>{groupDeleteMode === 'group' ? 'No se eliminará ninguna publicación.' : `Se eliminarán ${groupDeleteMode === 'all-posts' ? pendingGroupAction.group.postIds.length : groupPostsToDelete.length} publicaciones y sus vínculos. Esta acción no se puede deshacer.`}{pendingGroupAction.group.compressedMediaCount ? ' Los medios comprimidos se restaurarán antes del borrado.' : ''}</p>
        </div>}
        <footer><button type="button" className="settings-button" disabled={workingOnGroup} onClick={() => setPendingGroupAction(null)}>Cancelar</button><button type="button" className={pendingGroupAction.type === 'delete' && groupDeleteMode !== 'group' ? 'work-group-danger-button' : 'new-button'} disabled={workingOnGroup || pendingGroupAction.type === 'delete' && groupDeleteMode === 'selected-posts' && !groupPostsToDelete.length} onClick={confirmGroupAction}>{workingOnGroup ? 'Procesando…' : pendingGroupAction.type === 'delete' ? groupDeleteMode === 'group' ? 'Borrar solo colección' : 'Borrar colección y publicaciones' : pendingGroupAction.type === 'archive' ? 'Archivar colección' : 'Restaurar colección'}</button></footer>
      </section>
    </div>}
    {pendingMediaCompression && <div className="work-group-form-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPendingMediaCompression(null) }}>
      <section className="work-group-form work-group-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="media-compress-title" aria-describedby="media-compress-description">
        <header><span>AHORRAR ESPACIO</span><button type="button" aria-label="Cerrar" onClick={() => setPendingMediaCompression(null)}>×</button></header>
        <h2 id="media-compress-title">¿Comprimir medios?</h2>
        <p id="media-compress-description">Se guardarán hasta {pendingMediaCompression.mediaCount} medios de <strong>{pendingMediaCompression.name}</strong> en un ZIP interno con su manifiesto. Tras verificarlo, Caballocci eliminará los originales que administra para liberar espacio. Los medios compartidos o referenciados externamente se conservarán. Podrás restaurarlos después.</p>
        <footer><button type="button" className="settings-button" onClick={() => setPendingMediaCompression(null)}>Cancelar</button><button type="button" className="work-group-danger-button" onClick={confirmMediaCompression}>Comprimir y liberar espacio</button></footer>
      </section>
    </div>}
  </>
}

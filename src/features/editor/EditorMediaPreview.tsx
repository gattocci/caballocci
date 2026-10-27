import { useEffect, useState } from 'react'
import { Archive, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clipboard, Database, Edit3, ExternalLink, FileImage, FolderOpen, FolderPlus, GripVertical, Hash, Instagram, Lightbulb, MessageCircle, MoreHorizontal, Plus, Redo2, Smartphone, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import { contentLabels, getPlatformMeta, platformMeta, statusMeta } from '../../shared/constants'
import { PlatformMark } from '../../components/layout/AppShell'
import { MobileAppDownload } from '../../components/MobileAppDownload'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { useUndoableState, type UndoableChange } from '../../app/useUndoableState'
import { usePlanner } from '../../app/store'
import type { CatalogSync, ContentRecord, ContentType, IdeaBlock, MediaAsset, Platform, Post, PostInput, PostStatus } from '../../shared/types'

import { errorMessage, inferredVisual, visualSequence } from './editor-utils'

export function Preview({ draft, onMediaChange, onError }: { draft: PostInput; onMediaChange(media: NonNullable<PostInput['media']>): void; onError(message: string): void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [folderAssets, setFolderAssets] = useState<MediaAsset[]>([])
  const [folderBusy, setFolderBusy] = useState(false)
  const [selectedAssets, setSelectedAssets] = useState<string[]>([])
  const [organizeMessage, setOrganizeMessage] = useState('')
  const [groupDialog, setGroupDialog] = useState<{ currentName?: string; name: string } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const refreshFolder = async () => {
    setFolderBusy(true)
    try {
      const scanned = await window.planner.media.scanPostFolder(draft.id || '', draft.project || '')
      setFolderAssets(scanned)
      const linked = new Map((draft.media || []).map(asset => [asset.id, asset]))
      onMediaChange([...draft.media || [], ...scanned.filter(asset => !linked.has(asset.id))])
    } catch (error) { setFolderAssets([]); reportAppError(error, 'No se pudo cargar la carpeta de medios'); onError(errorMessage(error)) } finally { setFolderBusy(false) }
  }
  useEffect(() => { void refreshFolder() }, [draft.id, draft.project])
  const platform = draft.platforms[0] || 'instagram'
  const text = [draft.caption, ...draft.hashtags].join(' ').trim()
  const images = folderAssets.map(asset => {
    const linked = (draft.media || []).find(item => item.id === asset.id)
    return linked ? { ...asset, presentationRole: linked.presentationRole, sequence: linked.sequence } : asset
  })
  const roleOf = (asset: typeof images[number]) => asset.presentationRole || inferredVisual(asset).role
  const presentation = images.filter(asset => !['representative', 'other'].includes(roleOf(asset))).sort((a, b) => (visualSequence(a) ?? Number.MAX_SAFE_INTEGER) - (visualSequence(b) ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  const image = images.find(asset => asset.id === selectedId) || presentation[0] || images.find(asset => roleOf(asset) === 'representative')
  const sequenceIndex = Math.max(0, presentation.findIndex(asset => asset.id === image?.id))
  const isSequenceImage = presentation.some(asset => asset.id === image?.id)
  const firstIdea = draft.ideaBlocks?.[0]
  const updateVisual = (id: string, role: NonNullable<typeof images[number]['presentationRole']>, sequence?: number | null) => {
    const current = images.find(asset => asset.id === id)
    const currentRole = current ? roleOf(current) : undefined
    const nextSequence = sequence === undefined && currentRole !== role
      ? role === 'cover' ? 0 : role === 'closing' ? 10000 : role === 'slide' ? Math.max(0, ...presentation.map(asset => visualSequence(asset) || 0)) + 1 : undefined
      : sequence
    onMediaChange((draft.media || []).map(asset => asset.id === id ? { ...asset, presentationRole: role, sequence: nextSequence } : asset))
  }
  const saveVisualOrder = (next: typeof presentation, addedId?: string) => {
    const orders = new Map(next.map((asset, position) => [asset.id, position + 1]))
    onMediaChange((draft.media || []).map(asset => orders.has(asset.id) ? { ...asset, presentationRole: asset.id === addedId ? 'slide' : roleOf(images.find(imageAsset => imageAsset.id === asset.id) || asset), sequence: orders.get(asset.id) } : asset))
  }
  const moveVisual = (id: string, offset: -1 | 1) => {
    const next = [...presentation]
    const index = next.findIndex(asset => asset.id === id)
    const target = index + offset
    if (index < 0 || target < 0 || target >= next.length) return
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    saveVisualOrder(next)
  }
  const moveVisualBefore = (id: string, targetId: string) => {
    if (id === targetId) return
    const next = [...presentation]
    let index = next.findIndex(asset => asset.id === id)
    const item = index < 0 ? images.find(asset => asset.id === id) : next[index]
    if (!item || !next.some(asset => asset.id === targetId)) return
    if (index >= 0) next.splice(index, 1)
    index = next.findIndex(asset => asset.id === targetId)
    next.splice(index, 0, item)
    saveVisualOrder(next, presentation.some(asset => asset.id === id) ? undefined : id)
  }
  const moveVisualToEnd = (id: string) => {
    const next = [...presentation]
    const index = next.findIndex(asset => asset.id === id)
    const item = index < 0 ? images.find(asset => asset.id === id) : next[index]
    if (!item) return
    if (index >= 0) next.splice(index, 1)
    next.push(item)
    saveVisualOrder(next, presentation.some(asset => asset.id === id) ? undefined : id)
  }
  const excludeVisual = (id: string) => {
    if (!presentation.some(asset => asset.id === id)) return
    onMediaChange((draft.media || []).map(asset => asset.id === id ? { ...asset, presentationRole: 'other', sequence: null } : asset))
  }
  const groupSelected = async () => {
    if (!selectedAssets.length) return
    if (!draft.id) {
      const message = 'Guarda la publicaci\u00f3n antes de crear una carpeta de diapositivas.'
      setOrganizeMessage(message)
      onError(message)
      return
    }
    if (!draft.id) { setOrganizeMessage('Guarda la publicación antes de crear una carpeta de diapositivas.'); return }
    setGroupDialog({ name: 'Grupo de diapositivas' })
  }
  const saveGroup = async () => {
    if (!groupDialog?.name.trim()) return
    if (!draft.id) {
      const message = 'Guarda la publicacion antes de crear una carpeta de diapositivas.'
      setOrganizeMessage(message)
      onError(message)
      return
    }
    setOrganizeMessage('')
    try {
      await window.planner.media.organizePost(draft.id, draft.project || '', selectedAssets, groupDialog.name.trim(), groupDialog.currentName)
      setSelectedAssets([])
      setGroupDialog(null)
      await refreshFolder()
    } catch (error) { const message = errorMessage(error); reportAppError(error, 'No se pudieron organizar los medios'); setOrganizeMessage(message); onError(message) }
  }
  const renameGroup = async (currentName: string) => {
    if (!draft.id) return
    setGroupDialog({ currentName, name: currentName })
  }
  const groups = Array.from(new Set(images.map(asset => asset.groupName).filter((name): name is string => Boolean(name))))
  const groupedCount = images.filter(asset => Boolean(asset.groupName)).length
  const ungroupedCount = images.length - groupedCount
  const presentationIds = new Set(presentation.map(asset => asset.id))
  const orderedImages = [...presentation, ...images.filter(asset => !presentationIds.has(asset.id))]
  const statusColor = statusMeta[draft.status].color
  return <div className="preview-wrap">
    <div className="visual-folder-summary"><span><FolderOpen size={12} /> {groupedCount} en carpeta</span><span><FileImage size={12} /> {ungroupedCount} sin agrupar</span></div>
    <section className="visual-assets">
      <header><div><span>RECURSOS DE ESTA PUBLICACIÓN</span><strong>{images.length} {images.length === 1 ? 'imagen' : 'imágenes'}</strong></div><button type="button" className="visual-refresh" onClick={() => void refreshFolder()} disabled={folderBusy}><FolderOpen size={13} /> {folderBusy ? 'Leyendo…' : 'Actualizar carpeta'}</button></header>
      <small className="visual-folder-hint">Selecciona varias imágenes para agruparlas en una carpeta; el orden se ajusta aquí sin renombrar archivos.</small>
      {images.length > 0 && <div className="visual-sequence-overview" aria-label={`Orden visual: ${presentation.length ? presentation.map(asset => visualSequence(asset) ?? 'sin número').join(', ') : 'sin diapositivas'}`}>
        <header><span>ORDEN VISUAL</span><strong>{presentation.length ? presentation.map(asset => visualSequence(asset) ?? '—').join(', ') : 'Sin diapositivas'}</strong></header>
        <div className="visual-sequence-items">{presentation.map((asset, index) => <div key={asset.id} title={asset.name}><img src={window.planner.media.imageUrl(asset.id)} alt="" /><span>{visualSequence(asset) ?? index + 1}</span></div>)}
          <div className={'visual-sequence-drop-end' + (dragOverId === 'sequence-end' ? ' drop-target' : '')} onDragOver={event => { if (draggingId) { event.preventDefault(); setDragOverId('sequence-end') } }} onDragLeave={() => setDragOverId(current => current === 'sequence-end' ? null : current)} onDrop={event => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggingId; if (sourceId) moveVisualToEnd(sourceId); setDraggingId(null); setDragOverId(null) }}><span>+</span><small>{presentation.length ? 'Al final' : 'Primera'}</small></div>
        </div>
        {presentation.length > 0 && <div className={'visual-sequence-exclude' + (dragOverId === 'sequence-exclude' ? ' drop-target' : '')} onDragOver={event => { if (draggingId) { event.preventDefault(); setDragOverId('sequence-exclude') } }} onDragLeave={() => setDragOverId(current => current === 'sequence-exclude' ? null : current)} onDrop={event => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggingId; if (sourceId) excludeVisual(sourceId); setDraggingId(null); setDragOverId(null) }}>Arrastra aquí para sacar una imagen de la secuencia</div>}
      </div>}
      {selectedAssets.length > 0 && <div className="visual-group-actions"><span>{selectedAssets.length} seleccionadas</span><button type="button" onClick={() => void groupSelected()}><FolderPlus size={13} /> Crear carpeta</button></div>}
      {organizeMessage && <p className="media-import-error" role="alert">{organizeMessage}</p>}
      {groups.map(group => <div className="visual-group-heading" key={group}><FolderOpen size={13} /><strong>{group}</strong><button type="button" title={`Renombrar ${group}`} onClick={() => void renameGroup(group)}><Edit3 size={13} /></button></div>)}
      {images.length ? <div className="visual-asset-list">{orderedImages.map(asset => {
        const role = roleOf(asset)
        const order = visualSequence(asset)
        const position = presentation.findIndex(item => item.id === asset.id)
        const isDraggable = position >= 0
        return <article
          className={'visual-asset-row' + (image?.id === asset.id ? ' selected' : '') + (draggingId === asset.id ? ' dragging' : '') + (dragOverId === asset.id ? ' drop-target' : '')}
          key={asset.id}
          onDragOver={event => { if (draggingId && isDraggable) { event.preventDefault(); setDragOverId(asset.id) } }}
          onDrop={event => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggingId; if (sourceId && isDraggable) moveVisualBefore(sourceId, asset.id); setDraggingId(null); setDragOverId(null) }}
        >
          <input type="checkbox" className="visual-asset-check" aria-label={`Seleccionar ${asset.name} para agrupar`} checked={selectedAssets.includes(asset.id)} onChange={event => setSelectedAssets(current => event.target.checked ? [...current, asset.id] : current.filter(id => id !== asset.id))} />
          <button type="button" className="visual-asset-thumb" onClick={() => setSelectedId(asset.id)} draggable onDragStart={event => { event.dataTransfer.setData('text/plain', asset.id); event.dataTransfer.effectAllowed = 'move'; setDraggingId(asset.id) }} onDragEnd={() => { setDraggingId(null); setDragOverId(null) }} title={isDraggable ? `Arrastrar para reordenar · Orden ${order ?? 'sin número'}` : `Arrastrar para incluir en la secuencia · ${asset.name}`}>
            <img src={window.planner.media.imageUrl(asset.id)} alt="" />
            {isDraggable && <><span className="visual-asset-order">{order ?? position + 1}</span><span className="visual-asset-grip" aria-hidden="true"><GripVertical size={13} /></span></>}
          </button>
          <div className="visual-asset-meta"><strong title={asset.name}>{asset.groupName ? `${asset.groupName} / ${asset.name}` : asset.name}</strong><select aria-label={`Uso de ${asset.name}`} value={role} onChange={event => updateVisual(asset.id, event.target.value as NonNullable<typeof asset.presentationRole>, order)}><option value="representative">Representativa</option><option value="cover">Portada</option><option value="slide">Diapositiva</option><option value="closing">Cierre</option><option value="other">Excluir de la secuencia</option></select></div>
          {!['representative', 'other'].includes(role) && <div className="visual-order-controls"><input aria-label={`Orden de ${asset.name}`} className="visual-order" type="number" min="1" max="10000" value={order ?? ''} placeholder="Sin orden" onChange={event => updateVisual(asset.id, role, event.target.value === '' ? null : Number(event.target.value))} /><button type="button" title="Subir en la secuencia" aria-label={`Subir ${asset.name}`} disabled={position <= 0} onClick={() => moveVisual(asset.id, -1)}><ChevronUp size={13} /></button><button type="button" title="Bajar en la secuencia" aria-label={`Bajar ${asset.name}`} disabled={position < 0 || position === presentation.length - 1} onClick={() => moveVisual(asset.id, 1)}><ChevronDown size={13} /></button></div>}
        </article>
      })}</div> : <p className="visual-assets-empty">No hay PNG, JPG o WebP en la carpeta de esta publicación.</p>}
    </section>
    <div className="preview-platforms">{draft.platforms.map(p => <button key={p}><PlatformMark platform={p} />{getPlatformMeta(p).label}</button>)}</div>
    <div className={'social-preview ' + platform}>
      <header><div className="preview-avatar" aria-label="Caballocci"><i /><i /><i /></div><div><strong>tu_cuenta</strong><span><i className="preview-local-dot" style={{ backgroundColor: statusColor, boxShadow: `0 0 0 2px ${statusColor}33` }} /> Vista previa local · {getPlatformMeta(platform).label} · {statusMeta[draft.status].label}</span></div><MoreHorizontal size={17} /></header>
      <div className="preview-media">
        {image
          ? <img src={window.planner.media.imageUrl(image.id)} alt={image.name} />
          : <div className="preview-placeholder"><Instagram size={38} />{firstIdea ? <><strong>{firstIdea.title || 'Idea 1'}</strong><p>{firstIdea.text || 'Texto pendiente'}</p></> : <span>{contentLabels[draft.contentType]}</span>}</div>}
        <span className="preview-dimensions">{image ? `${roleOf(image) === 'representative' ? 'Imagen representativa' : roleOf(image) === 'cover' ? 'Portada' : roleOf(image) === 'closing' ? 'Cierre' : 'Diapositiva'}${image.sequence ? ` · ${image.sequence}` : ''}` : 'Sin recurso visual'}</span>
      </div>
      {presentation.length > 1 && isSequenceImage && <div className="preview-sequence"><button type="button" title="Imagen anterior" onClick={() => setSelectedId(presentation[(sequenceIndex - 1 + presentation.length) % presentation.length].id)}><ChevronLeft size={15} /></button><span>{sequenceIndex + 1} / {presentation.length}</span><button type="button" title="Imagen siguiente" onClick={() => setSelectedId(presentation[(sequenceIndex + 1) % presentation.length].id)}><ChevronRight size={15} /></button></div>}
      <div className="preview-actions"><MessageCircle /><Archive /><Clipboard /></div>
      <p><strong>tu_cuenta </strong>{text || 'Aquí aparecerá el texto de tu publicación.'}</p>
    </div>
    <button className="copy-helper" onClick={() => window.planner.clipboard.write(text)}><Clipboard size={16} /> Copiar texto para publicar</button>
    {groupDialog && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setGroupDialog(null) }}><form className="space-dialog" onSubmit={event => { event.preventDefault(); void saveGroup() }}><header><div><span>{groupDialog.currentName ? 'RENOMBRAR CARPETA' : 'NUEVA CARPETA'}</span><h2>Carpeta de diapositivas</h2></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={() => setGroupDialog(null)}><X size={18} /></button></header><label>Nombre<input autoFocus maxLength={120} value={groupDialog.name} onChange={event => setGroupDialog(current => current ? { ...current, name: event.target.value } : current)} /></label><footer><button type="button" className="ghost-button" onClick={() => setGroupDialog(null)}>Cancelar</button><button className="save-button" disabled={!groupDialog.name.trim() || groupDialog.name.trim() === groupDialog.currentName}>Guardar carpeta</button></footer></form></div>}
  </div>
}


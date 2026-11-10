import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, FileImage, FileText, Film, Images, LoaderCircle, Plus, Search, Upload, X } from 'lucide-react'
import { reportAppError } from '../../app/errors'
import type { MediaAsset, Post } from '../../shared/types'
import './editor-media-picker.css'

type MediaAttachmentTarget = Pick<Post, 'id' | 'project' | 'media'>
type MultiAttachment = { postId: string; assets: MediaAsset[] }

export function EditorMediaPicker({ media, postId, project, targets, onAttach, onAttachMany }: { media: MediaAsset[]; postId?: string; project: string; targets?: MediaAttachmentTarget[]; onAttach(assets: MediaAsset[]): void; onAttachMany?(attachments: MultiAttachment[]): void | Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [attachError, setAttachError] = useState('')
  const [usageByName, setUsageByName] = useState<Record<string, Array<{ postId: string; title: string }>>>({})
  const targetKey = targets?.length
    ? targets.map(target => `${target.id}|${target.project}|${target.media.map(asset => asset.id).join(',')}`).join(';')
    : postId ? `${postId}|${project}|${media.map(asset => asset.id).join(',')}` : ''
  const targetList = useMemo(() => targets?.length ? targets : postId ? [{ id: postId, project, media }] : [], [targetKey])
  const [attachedByPost, setAttachedByPost] = useState<Record<string, MediaAsset[]>>({})
  const attachmentTargets = targetList.map(target => ({ ...target, media: attachedByPost[target.id] || target.media }))
  const linkedIds = useMemo(() => new Set((postId ? attachedByPost[postId] || media : media).map(asset => asset.id)), [attachedByPost, media, postId])
  const isAssetAttachedTo = (target: MediaAttachmentTarget, asset: MediaAsset) => target.media.some(attached =>
    attached.id === (asset.sourceId || asset.id) ||
    attached.sourceId === (asset.sourceId || asset.id) ||
    (attached.kind === asset.kind && attached.size === asset.size && normalizedMediaName(attached.name) === normalizedMediaName(asset.name)),
  )

  const loadAssets = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      if (targetList.length) {
        const result = await window.planner.media.listForPosts(targetList.map(({ id, project }) => ({ id, project })))
        setAttachedByPost(result.attached)
        setUsageByName(result.usages)
        const attached = [...new Map(Object.values(result.attached).flat().map(asset => [asset.id, asset])).values()]
        const attachedSources = new Set(attached.flatMap(asset => [asset.id, asset.sourceId].filter((id): id is string => Boolean(id))))
        setAssets([...attached, ...result.library.filter(asset => !attachedSources.has(asset.id))])
      } else {
        setAttachedByPost({})
        setUsageByName({})
        setAssets(await window.planner.media.list())
      }
    } catch (error) {
      reportAppError(error, 'No se pudo cargar la biblioteca multimedia')
      setLoadError('No se pudo cargar la biblioteca. Inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }, [targetList])

  useEffect(() => {
    if (!open) return
    void loadAssets()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, loadAssets])

  const upload = async () => {
    setUploading(true)
    setUploadError('')
    try {
      const imported = await window.planner.media.choose('copy', postId, project)
      setAssets(current => [...imported, ...current.filter(asset => !imported.some(next => next.id === asset.id))])
      setSelectedIds(current => [...new Set([...current, ...imported.filter(asset => !linkedIds.has(asset.id)).map(asset => asset.id)])])
    } catch (error) {
      reportAppError(error, 'No se pudieron añadir archivos a la biblioteca')
      setUploadError('No se pudieron subir los archivos.')
    } finally {
      setUploading(false)
    }
  }

  const isAttachedEverywhere = (asset: MediaAsset) => attachmentTargets.length > 0
    ? attachmentTargets.every(target => isAssetAttachedTo(target, asset))
    : media.some(attached => attached.id === asset.id || attached.sourceId === asset.id || (attached.kind === asset.kind && attached.size === asset.size && normalizedMediaName(attached.name) === normalizedMediaName(asset.name)))
  const isAttachedSomewhere = (asset: MediaAsset) => attachmentTargets.some(target => isAssetAttachedTo(target, asset))
  const visibleAssets = assets.filter(asset => asset.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const groupedAssets = [...visibleAssets.reduce((groups, asset) => {
    const group = groups.get(asset.name) || []
    group.push(asset)
    groups.set(asset.name, group)
    return groups
  }, new Map<string, MediaAsset[]>()).values()]
  const attachedAssets = groupedAssets.filter(group => group.some(isAttachedSomewhere))
  const otherAssets = groupedAssets.filter(group => !group.some(isAttachedSomewhere))
  const toggle = (id: string) => setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  const attachSelected = async () => {
    const selected = assets.filter(asset => selectedIds.includes(asset.id) && !isAttachedEverywhere(asset))
    if (!selected.length) return
    setAttaching(true)
    setAttachError('')
    try {
      if (targets?.length) {
        const attachments: MultiAttachment[] = []
        for (const target of attachmentTargets) {
          const targetAssets = selected.filter(asset => !isAssetAttachedTo(target, asset))
          if (!targetAssets.length) continue
          attachments.push({
            postId: target.id,
            assets: await window.planner.media.copyToPost(target.id, target.project, targetAssets.map(asset => asset.id)),
          })
        }
        if (!onAttachMany) throw new Error('No se pudo guardar la selección de publicaciones.')
        await onAttachMany(attachments)
      } else {
        const postAssets = postId
          ? await window.planner.media.copyToPost(postId, project, selected.map(asset => asset.id))
          : selected
        onAttach(postAssets)
      }
      setSelectedIds([])
      setOpen(false)
    } catch (error) {
      reportAppError(error, 'No se pudieron copiar los medios a la publicación')
      setAttachError('No se pudieron copiar los medios a la carpeta de esta publicación.')
    } finally {
      setAttaching(false)
    }
  }
  const renderAsset = (asset: MediaAsset) => {
    const attached = isAttachedSomewhere(asset)
    const attachedEverywhere = isAttachedEverywhere(asset)
    const usageCount = Math.max(usageByName[asset.name]?.length || 0, attachmentTargets.filter(target => isAssetAttachedTo(target, asset)).length)
    const selected = selectedIds.includes(asset.id)
    const Icon = asset.kind === 'image' ? FileImage : asset.kind === 'video' ? Film : FileText
    return <button type="button" className={`media-picker-item${selected ? ' selected' : ''}${attached ? ' attached' : ''}`} key={asset.id} aria-pressed={selected || attachedEverywhere} disabled={attachedEverywhere || attaching} onClick={() => toggle(asset.id)}>
      <span className="media-picker-thumb">{asset.kind === 'image' ? <img src={window.planner.media.imageUrl(asset.id)} alt="" /> : <Icon size={20} aria-hidden="true" />}</span>
      <span className="media-picker-meta"><strong title={asset.name}>{asset.name}</strong><small>{asset.kind === 'image' ? 'Imagen' : asset.kind === 'video' ? 'Vídeo' : 'Documento'} · {(asset.size / 1024 / 1024).toFixed(1)} MB</small></span>
      <span className="media-picker-state">{attachedEverywhere ? (attachmentTargets.length > 1 ? `En todas · ${usageCount} usos` : `En carpeta · ${usageCount} usos`) : attached ? `${attachmentTargets.filter(target => isAssetAttachedTo(target, asset)).length}/${attachmentTargets.length} carpetas · ${usageCount} usos` : selected ? <Check size={16} /> : <Plus size={16} />}</span>
    </button>
  }
  const renderAssetGroup = (group: MediaAsset[]) => {
    const name = group[0]!.name
    const usages = usageByName[name] || []
    if (group.length === 1 && usages.length <= 1) return renderAsset(group[0]!)
    return <details className="media-picker-duplicate-group" key={name}>
      <summary><span title={name}>{name}</span><small>{usages.length || group.length} publicaciones</small></summary>
      <div className="media-picker-duplicate-content">
        {group.map(renderAsset)}
        {usages.length > 1 && <ul aria-label={`Publicaciones que usan ${name}`}>{usages.map(usage => <li key={usage.postId}>{usage.title}</li>)}</ul>}
      </div>
    </details>
  }

  return <>
    <button type="button" className="media-library-button" onClick={() => { setOpen(true); setSelectedIds([]); setQuery(''); setUploadError(''); setAttachError('') }} aria-label={targets?.length ? `Adjuntar medios a ${targets.length} publicaciones` : 'Abrir biblioteca multimedia'} title={targets?.length ? 'Adjuntar medios a las publicaciones seleccionadas' : 'Biblioteca multimedia'}>
      <Images size={18} aria-hidden="true" />
    </button>
    {open && createPortal(<div className="media-picker-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false) }}>
      <section className="media-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="media-picker-title">
        <header className="media-picker-header">
          <div><span>{targets?.length ? `MEDIOS PARA ${targets.length} PUBLICACIONES` : 'MEDIOS DE LA PUBLICACIÓN'}</span><h2 id="media-picker-title">Biblioteca multimedia</h2></div>
          <button type="button" className="icon-button" aria-label="Cerrar biblioteca" onClick={() => setOpen(false)}><X size={18} /></button>
        </header>
        <div className="media-picker-toolbar">
          <label className="media-picker-search"><Search size={15} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nombre..." aria-label="Buscar medios" /></label>
          <button type="button" className="media-picker-upload" disabled={uploading || attaching} onClick={() => void upload()}>{uploading ? <LoaderCircle size={15} className="media-picker-spinner" /> : <Upload size={15} />}{uploading ? 'Subiendo…' : 'Subir archivos'}</button>
        </div>
        {uploadError && <p className="media-picker-error" role="alert">{uploadError}</p>}
        {attachError && <p className="media-picker-error" role="alert">{attachError}</p>}
        <div className="media-picker-list" aria-busy={loading}>
          {loading
            ? <p className="media-picker-message" role="status">Cargando biblioteca…</p>
            : loadError
              ? <div className="media-picker-message media-picker-load-error" role="alert"><p>{loadError}</p><button type="button" onClick={() => void loadAssets()}>Reintentar</button></div>
              : visibleAssets.length
                ? <>
                  {attachedAssets.length > 0 && <section className="media-picker-group"><h3>{targets?.length ? 'Ya en carpetas seleccionadas' : 'Archivos de esta publicación'} <span>{attachedAssets.length}</span></h3>{attachedAssets.map(renderAssetGroup)}</section>}
                  {otherAssets.length > 0 && <section className="media-picker-group"><h3>Resto de la biblioteca <span>{otherAssets.length}</span></h3>{otherAssets.map(renderAssetGroup)}</section>}
                </>
                : <p className="media-picker-message">{assets.length ? 'No hay resultados para esta búsqueda.' : 'La biblioteca está vacía. Sube archivos para empezar.'}</p>}
        </div>
        <footer className="media-picker-footer">
          <span>{selectedIds.filter(id => { const asset = assets.find(item => item.id === id); return asset && !isAttachedEverywhere(asset) }).length} seleccionados</span>
          <div><button type="button" className="media-picker-cancel" disabled={attaching} onClick={() => setOpen(false)}>Cancelar</button><button type="button" className="media-picker-attach" disabled={attaching || !selectedIds.some(id => { const asset = assets.find(item => item.id === id); return asset && !isAttachedEverywhere(asset) })} onClick={() => void attachSelected()}>{attaching ? <><LoaderCircle size={13} className="media-picker-spinner" /> Copiando…</> : targets?.length ? `Adjuntar a ${targets.length} publicaciones` : 'Adjuntar seleccionados'}</button></div>
        </footer>
      </section>
    </div>, document.body)}
  </>
}

function normalizedMediaName(name: string) {
  return name.replace(/ \(\d+\)(?=\.[^.]+$|$)/, '').toLocaleLowerCase()
}

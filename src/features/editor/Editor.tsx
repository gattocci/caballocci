import { useEffect, useState } from 'react'
import { Archive, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clipboard, Database, Edit3, ExternalLink, FileImage, FolderOpen, FolderPlus, Hash, Instagram, Lightbulb, MessageCircle, MoreHorizontal, Plus, Smartphone, Sparkles, Trash2, X } from 'lucide-react'
import { contentLabels, getPlatformMeta, platformMeta, statusMeta } from '../../shared/constants'
import { PlatformMark } from '../../components/layout/AppShell'
import { MobileAppDownload } from '../../components/MobileAppDownload'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { usePlanner } from '../../app/store'
import type { CatalogSync, ContentRecord, ContentType, IdeaBlock, MediaAsset, Platform, Post, PostInput, PostStatus } from '../../shared/types'
import './editor.css'

const blankPost = (project: string): PostInput => ({
  id: crypto.randomUUID(),
  title: '', caption: '', notes: '', hashtags: [], mentions: [], platforms: ['instagram'],
  contentType: 'reel', status: 'idea', scheduledAt: null, durationMinutes: 60,
  project, color: '#e76042', ideaBlocks: [],
})

function parseTitleCandidates(value: string) {
  const candidateLines = value.split(/\r?\n/).filter(line => /^\s*(?:[-*]|\d+[.)])\s+/.test(line) || /\*\*[“\"]/.test(line))
  const quoted = candidateLines.flatMap(line => [...line.matchAll(/[“\"]([^“\"]+)[”\"]/g)].map(match => match[1].trim())).filter(Boolean)
  if (quoted.length) return Array.from(new Set(quoted))
  return value.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*\d.)]+)\s*/, '').replace(/\*\*/g, '').trim()).filter(line => line.length > 8 && !/^\w+\s+(puede|suena|mantiene|ajustando)/i.test(line))
}

function parseMasterSlides(value: string): IdeaBlock[] {
  const lines = value.replace(/\r/g, '').split('\n')
  const blocks: { label: string; heading: string; lines: string[] }[] = []
  let current: { label: string; heading: string; lines: string[] } | null = null
  for (const line of lines) {
    const match = line.match(/^\s*(?:#{1,4}\s*)?(?:slide|diapositiva)\s*([0-9]+|final|cierre)\s*[:.)\-]?\s*(.*)$/i)
      || line.match(/^\s*([0-9]+|final|cierre)\s*[:.)\-]?\s+(.*)$/i)
    if (match) {
      if (current) blocks.push(current)
      const heading = (match[2] || '').replace(/^[\s:.)\-–—]+/, '').trim()
      current = { label: match[1], heading: /^\([^)]*\)$/.test(heading) ? '' : heading, lines: [] }
    } else if (current) current.lines.push(line)
  }
  if (current) blocks.push(current)
  return blocks.filter(block => !/final|cierre/i.test(block.label)).map((block, index) => {
    const content = block.lines.join('\n').trim()
    const labeled = content.match(/\*\*(?:TITULO|TÍTULO):\*\*\s*(.+?)(?=\s+\*\*(?:BAJADA|SUBT[IÍ]TULO):|$)/i)
    const bold = content.match(/\*\*([^*]+)\*\*/)
    const title = block.heading || labeled?.[1].trim() || (bold && !/^(?:TITULO|TÍTULO|BAJADA|SUBT[IÍ]TULO):?$/i.test(bold[1]) ? bold[1].trim() : '') || `Slide ${index + 1}`
    const text = content.replace(/^\([^)]*\)\s*/, '').replace(labeled?.[0] || (block.heading ? '' : (bold?.[0] || '')), '').replace(/^\s*\n/, '').trim()
    return { id: crypto.randomUUID(), title, text }
  }).filter(block => block.title || block.text)
}

function formatTitle(value: string, mode: 'upper' | 'lower' | 'title' | 'sentence') {
  const text = value.trim()
  if (mode === 'upper') return text.toLocaleUpperCase()
  if (mode === 'lower') return text.toLocaleLowerCase()
  if (mode === 'sentence') return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1).toLocaleLowerCase() : text
  return text.toLocaleLowerCase().replace(/(^|[\s¡¿])([\p{L}\d])/gu, (_, prefix: string, character: string) => prefix + character.toLocaleUpperCase())
}

type NoteItem = { id: string; title: string; text: string }

function toLocalDateTimeInput(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function fromLocalDateTimeInput(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function notesToItems(value: string): NoteItem[] {
  if (!value.trim()) return [{ id: crypto.randomUUID(), title: '', text: '' }]
  return value.split(/\n\s*---\s*\n/).map(part => {
    const lines = part.split('\n')
    const title = lines[0]?.match(/^\[(.*)\]$/)?.[1] || ''
    return { id: crypto.randomUUID(), title, text: (title ? lines.slice(1) : lines).join('\n').trim() }
  })
}

function itemsToNotes(items: NoteItem[]) {
  return items.filter(item => item.title.trim() || item.text.trim()).map(item => `${item.title.trim() ? `[${item.title.trim()}]\n` : ''}${item.text.trim()}`).join('\n\n---\n\n')
}

function inferredVisual(asset: NonNullable<PostInput['media']>[number]) {
  const name = asset.name.toLocaleLowerCase()
  const numbered = name.match(/^(\d+)[-_ .]/)
  if (/representative|representativa|portada/.test(name)) return { role: 'representative' as const, sequence: undefined }
  if (/cover/.test(name)) return { role: 'cover' as const, sequence: 0 }
  if (/cierre|closing|final/.test(name)) return { role: 'closing' as const, sequence: 10000 }
  if (numbered) return { role: 'slide' as const, sequence: Number(numbered[1]) }
  return { role: asset.presentationRole || 'other' as const, sequence: asset.sequence }
}

function visualSequence(asset: NonNullable<PostInput['media']>[number]) {
  return asset.sequence === null ? null : asset.sequence ?? inferredVisual(asset).sequence
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) } catch { return String(error) }
}

function Preview({ draft, onMediaChange, onError }: { draft: PostInput; onMediaChange(media: NonNullable<PostInput['media']>): void; onError(message: string): void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [folderAssets, setFolderAssets] = useState<MediaAsset[]>([])
  const [folderBusy, setFolderBusy] = useState(false)
  const [selectedAssets, setSelectedAssets] = useState<string[]>([])
  const [organizeMessage, setOrganizeMessage] = useState('')
  const [groupDialog, setGroupDialog] = useState<{ currentName?: string; name: string } | null>(null)
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
  const moveVisual = (id: string, offset: -1 | 1) => {
    const next = [...presentation]
    const index = next.findIndex(asset => asset.id === id)
    const target = index + offset
    if (index < 0 || target < 0 || target >= next.length) return
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    const orders = new Map(next.map((asset, position) => [asset.id, position + 1]))
    onMediaChange((draft.media || []).map(asset => orders.has(asset.id) ? { ...asset, presentationRole: roleOf(images.find(imageAsset => imageAsset.id === asset.id) || asset), sequence: orders.get(asset.id) } : asset))
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
  return <div className="preview-wrap">
    <div className="visual-folder-summary"><span><FolderOpen size={12} /> {groupedCount} en carpeta</span><span><FileImage size={12} /> {ungroupedCount} sin agrupar</span></div>
    <section className="visual-assets"><header><div><span>RECURSOS DE ESTA PUBLICACIÓN</span><strong>{images.length} {images.length === 1 ? 'imagen' : 'imágenes'}</strong></div><button type="button" className="visual-refresh" onClick={() => void refreshFolder()} disabled={folderBusy}><FolderOpen size={13} /> {folderBusy ? 'Leyendo…' : 'Actualizar carpeta'}</button></header><small className="visual-folder-hint">Selecciona varias imágenes para agruparlas en una carpeta; el orden se ajusta aquí sin renombrar archivos.</small>{selectedAssets.length > 0 && <div className="visual-group-actions"><span>{selectedAssets.length} seleccionadas</span><button type="button" onClick={() => void groupSelected()}><FolderPlus size={13} /> Crear carpeta</button></div>}{organizeMessage && <p className="media-import-error" role="alert">{organizeMessage}</p>}{groups.map(group => <div className="visual-group-heading" key={group}><FolderOpen size={13} /><strong>{group}</strong><button type="button" title={`Renombrar ${group}`} onClick={() => void renameGroup(group)}><Edit3 size={13} /></button></div>)}{images.length ? <div className="visual-asset-list">{images.map(asset => { const role = roleOf(asset); const order = visualSequence(asset); const position = presentation.findIndex(item => item.id === asset.id); return <article className={'visual-asset-row' + (image?.id === asset.id ? ' selected' : '')} key={asset.id}><input type="checkbox" className="visual-asset-check" aria-label={`Seleccionar ${asset.name} para agrupar`} checked={selectedAssets.includes(asset.id)} onChange={event => setSelectedAssets(current => event.target.checked ? [...current, asset.id] : current.filter(id => id !== asset.id))} /><button type="button" className="visual-asset-thumb" onClick={() => setSelectedId(asset.id)}><img src={window.planner.media.imageUrl(asset.id)} alt="" /></button><div className="visual-asset-meta"><strong title={asset.name}>{asset.groupName ? `${asset.groupName} / ${asset.name}` : asset.name}</strong><select aria-label={`Uso de ${asset.name}`} value={role} onChange={event => updateVisual(asset.id, event.target.value as NonNullable<typeof asset.presentationRole>, order)}><option value="representative">Representativa</option><option value="cover">Portada</option><option value="slide">Diapositiva</option><option value="closing">Cierre</option><option value="other">Excluir de la secuencia</option></select></div>{!['representative', 'other'].includes(role) && <div className="visual-order-controls"><input aria-label={`Orden de ${asset.name}`} className="visual-order" type="number" min="1" max="10000" value={order ?? ''} placeholder="Sin orden" onChange={event => updateVisual(asset.id, role, event.target.value === '' ? null : Number(event.target.value))} /><button type="button" title="Subir en la secuencia" aria-label={`Subir ${asset.name}`} disabled={position <= 0} onClick={() => moveVisual(asset.id, -1)}><ChevronUp size={13} /></button><button type="button" title="Bajar en la secuencia" aria-label={`Bajar ${asset.name}`} disabled={position < 0 || position === presentation.length - 1} onClick={() => moveVisual(asset.id, 1)}><ChevronDown size={13} /></button></div>}</article>})}</div> : <p className="visual-assets-empty">No hay PNG, JPG o WebP en la carpeta de esta publicación.</p>}</section>
    <div className="preview-platforms">{draft.platforms.map(p => <button key={p}><PlatformMark platform={p} />{getPlatformMeta(p).label}</button>)}</div>
    <div className={'social-preview ' + platform}>
      <header><div className="preview-avatar" aria-label="Caballocci"><i /><i /><i /></div><div><strong>tu_cuenta</strong><span><i className="preview-local-dot" /> Vista previa local · {getPlatformMeta(platform).label}</span></div><MoreHorizontal size={17} /></header>
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

function IdeaBlocks({ blocks, onChange }: { blocks: IdeaBlock[]; onChange(blocks: IdeaBlock[]): void }) {
  const add = () => onChange([...blocks, { id: crypto.randomUUID(), title: '', text: '' }])
  const update = (id: string, patch: Partial<IdeaBlock>) => onChange(blocks.map(block => block.id === id ? { ...block, ...patch } : block))
  const format = (id: string, mode: 'upper' | 'lower' | 'title' | 'sentence') => {
    const block = blocks.find(item => item.id === id)
    if (block) update(id, { title: formatTitle(block.title, mode) })
  }
  const remove = (id: string) => onChange(blocks.filter(block => block.id !== id))
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= blocks.length) return
    const reordered = [...blocks]
    const [block] = reordered.splice(index, 1)
    reordered.splice(target, 0, block)
    onChange(reordered)
  }

  return <section className="idea-blocks">
    <header><div><span>DIAPOSITIVAS</span><strong>{blocks.length} {blocks.length === 1 ? 'diapositiva' : 'diapositivas'}</strong></div><button type="button" className="new-button" onClick={add}><Plus size={15} /> Nueva diapositiva</button></header>
    {blocks.length === 0 && <button type="button" className="empty-ideas" onClick={add}><Lightbulb size={24} /><span>Añadir primera idea</span></button>}
    {blocks.map((block, index) => <article className="idea-block" key={block.id}>
      <header><span>DIAPOSITIVA {String(index + 1).padStart(2, '0')}</span><div>
        <button type="button" title="Subir idea" aria-label="Subir idea" disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp size={15} /></button>
        <button type="button" title="Bajar idea" aria-label="Bajar idea" disabled={index === blocks.length - 1} onClick={() => move(index, 1)}><ChevronDown size={15} /></button>
        <button type="button" title="Eliminar idea" aria-label="Eliminar idea" onClick={() => remove(block.id)}><Trash2 size={14} /></button>
      </div></header>
      <label>Título<input value={block.title} maxLength={160} onChange={event => update(block.id, { title: event.target.value })} placeholder="Ej. Apertura, argumento, cierre" /></label>
      <div className="title-format-actions"><span>Formato rápido</span><button type="button" onClick={() => format(block.id, 'upper')}>MAYÚS</button><button type="button" onClick={() => format(block.id, 'lower')}>minús</button><button type="button" onClick={() => format(block.id, 'title')}>Título</button><button type="button" onClick={() => format(block.id, 'sentence')}>Oración</button></div>
      <label>Texto<textarea value={block.text} maxLength={10_000} onChange={event => update(block.id, { text: event.target.value })} placeholder="Texto que luego irá en la imagen" /></label>
    </article>)}
  </section>
}

export function Editor({ initial, scheduledAtForNew = null, onClose }: { initial: Post | null; scheduledAtForNew?: string | null; onClose(): void }) {
  const { save, remove, uncombinePost, activeSpace, ideas, selectIdea, setView } = usePlanner()
  const draftKey = `caballocci.draft.${initial?.id || 'new'}`
  const [draft, setDraft] = useState<PostInput>(() => {
    if (initial) return { ...initial }
    try { const saved = JSON.parse(localStorage.getItem(draftKey) || '') as PostInput; if (saved && typeof saved === 'object') return scheduledAtForNew ? { ...saved, scheduledAt: scheduledAtForNew, status: 'scheduled' } : saved } catch { /* Ignore invalid drafts. */ }
    return { ...blankPost(activeSpace || 'Mi contenido'), ...(scheduledAtForNew ? { scheduledAt: scheduledAtForNew, status: 'scheduled' as const } : {}) }
  })
  const [tab, setTab] = useState<'content' | 'ideas' | 'preview' | 'notes' | 'assistant' | 'external' | 'catalog'>('content')
  const [assistantIdea, setAssistantIdea] = useState('')
  const [assistantTitles, setAssistantTitles] = useState('')
  const [assistantMaster, setAssistantMaster] = useState('')
  const [assistantMessage, setAssistantMessage] = useState('')
  const [noteItems, setNoteItems] = useState<NoteItem[]>(() => notesToItems(initial?.notes || ''))
  const [saving, setSaving] = useState(false)
  const [phoneExportBusy, setPhoneExportBusy] = useState(false)
  const [phoneExportFolder, setPhoneExportFolder] = useState<string | null>(null)
  const [phoneExportMessage, setPhoneExportMessage] = useState('')
  const [phoneExportError, setPhoneExportError] = useState(false)
  const [externalRecord, setExternalRecord] = useState<ContentRecord | null>(null)
  const [catalogConfig, setCatalogConfig] = useState<{ configured: boolean; endpoint: string; createdBy: string; defaultKind: 'resource' | 'resource_lite' }>({ configured: false, endpoint: '', createdBy: '', defaultKind: 'resource' })
  const [catalogToken, setCatalogToken] = useState('')
  const [catalogKind, setCatalogKind] = useState<'resource' | 'resource_lite'>('resource')
  const [catalogSync, setCatalogSync] = useState<CatalogSync | null>(null)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [catalogPublish, setCatalogPublish] = useState(false)
  const [catalogMessage, setCatalogMessage] = useState('')
  const [catalogEndpoint, setCatalogEndpoint] = useState('')
  const [catalogCreatedBy, setCatalogCreatedBy] = useState('')
  const [catalogSummary, setCatalogSummary] = useState('')
  const [catalogContent, setCatalogContent] = useState('')
  const [catalogUseHashtags, setCatalogUseHashtags] = useState(false)
  const [catalogCategoryId, setCatalogCategoryId] = useState('')
  const [catalogCategorySlug, setCatalogCategorySlug] = useState('')
  useEffect(() => {
    let active = true
    if (!initial) { setExternalRecord(null); return () => { active = false } }
    void window.planner.contentRecords.byPost(initial.id).then(record => { if (active) setExternalRecord(record) }).catch(error => { if (active) { setExternalRecord(null); reportAppError(error, 'No se pudo cargar el registro externo') } })
    return () => { active = false }
  }, [initial?.id])
  useEffect(() => {
    const scope = initial?.project || activeSpace || ''
    void window.planner.catalog.config(scope).then(config => { setCatalogConfig(config); setCatalogEndpoint(config.endpoint); setCatalogCreatedBy(config.createdBy); setCatalogKind(config.defaultKind) }).catch(error => reportAppError(error, 'No se pudo cargar la configuración del catálogo'))
    if (initial) {
      void window.planner.catalog.syncState(initial.id).then(setCatalogSync).catch(error => { setCatalogSync(null); reportAppError(error, 'No se pudo cargar el estado de sincronización') })
      void window.planner.catalog.postFields(initial.id).then(fields => { setCatalogSummary(fields.summary || initial.notes || ''); setCatalogContent(fields.content || initial.caption || ''); setCatalogUseHashtags(fields.useHashtags); setCatalogCategoryId(fields.categoryId == null ? '' : String(fields.categoryId)); setCatalogCategorySlug(fields.categorySlug || ''); setCatalogKind(fields.kind) }).catch(error => reportAppError(error, 'No se pudieron cargar los campos del catálogo'))
    }
    else setCatalogSync(null)
  }, [initial?.id])
  useEffect(() => {
    void window.planner.mobileSync.folder()
      .then(setPhoneExportFolder)
      .catch(error => reportAppError(error, 'No se pudo consultar la carpeta de exportación al celular'))
  }, [])
  const update = <K extends keyof PostInput>(key: K, value: PostInput[K]) => setDraft(d => ({ ...d, [key]: value }))
  const updateNotes = (items: NoteItem[]) => { setNoteItems(items); update('notes', itemsToNotes(items)) }
  const formatPostTitle = (mode: 'upper' | 'lower' | 'title' | 'sentence') => update('title', formatTitle(draft.title, mode))
  const togglePlatform = (platform: Platform) => {
    const enabled = draft.platforms.includes(platform)
    const platforms = enabled ? draft.platforms.filter(p => p !== platform) : [...draft.platforms, platform]
    const existing = draft.distribution || draft.platforms.map(id => ({ id, name: getPlatformMeta(id).label, status: 'pending' as const }))
    const distribution = enabled
      ? existing.map(target => target.id === platform ? { ...target, status: 'not_applicable' as const } : target)
      : [...existing.filter(target => target.id !== platform), { id: platform, name: getPlatformMeta(platform).label, status: 'pending' as const }]
    setDraft(d => ({ ...d, platforms, distribution }))
  }
  const [platformOptions, setPlatformOptions] = useState<string[]>(() => { try { const saved = JSON.parse(localStorage.getItem('caballocci.platforms') || '') as string[]; return saved.length ? saved : ['instagram', 'facebook', 'x'] } catch { return ['instagram', 'facebook', 'x'] } })
  const [newPlatformName, setNewPlatformName] = useState('')
  const [addingPlatform, setAddingPlatform] = useState(false)
  const [scheduleWarning, setScheduleWarning] = useState('')
  const addPlatform = () => { const name = newPlatformName.trim(); const id = name.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); if (!name || !id || platformOptions.includes(id)) return; const next = [...platformOptions, id]; setPlatformOptions(next); localStorage.setItem('caballocci.platforms', JSON.stringify(next)); setDraft(d => ({ ...d, platforms: d.platforms.includes(id) ? d.platforms : [...d.platforms, id], distribution: [...(d.distribution || []), { id, name, status: 'pending' as const }] })); setNewPlatformName(''); setAddingPlatform(false) }
  const submit = async () => {
    setSaving(true)
    try {
      await save(draft)
      onClose()
      return true
    } catch (error) {
      reportAppError(error, 'No se pudo guardar la publicación')
      return false
    } finally {
      setSaving(false)
    }
  }
  const exportToPhone = async (chooseFolder = false) => {
    if (!initial || !draft.id) return
    setPhoneExportBusy(true)
    setSaving(true)
    setPhoneExportMessage('')
    setPhoneExportError(false)
    try {
      let scanned: MediaAsset[]
      try {
        scanned = await window.planner.media.scanPostFolder(draft.id, draft.project || '')
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? ` (${String((error as { code: unknown }).code)})` : ''
        throw new Error(`No se pudo leer la carpeta de medios${code}.`)
      }
      const linkedIds = new Set((draft.media || []).map(asset => asset.id))
      const exportDraft = { ...draft, media: [...draft.media || [], ...scanned.filter(asset => !linkedIds.has(asset.id))] }
      setDraft(exportDraft)
      const savedPost = await save(exportDraft)
      if (chooseFolder) {
        const folder = await window.planner.mobileSync.chooseFolder()
        if (!folder) {
          setPhoneExportMessage('Se guardaron los cambios, pero no se cambió la carpeta compartida.')
          return
        }
        setPhoneExportFolder(folder)
        setPhoneExportMessage('Raíz compartida configurada. Pulsa “Guardar y enviar al celular” para añadir esta publicación al catálogo.')
        return
      }
      const result = await window.planner.mobileSync.exportSelected([savedPost.id])
      if (!result) {
        setPhoneExportMessage('Se guardaron los cambios, pero se canceló la exportación.')
        return
      }
      setPhoneExportFolder(await window.planner.mobileSync.folder())
      setPhoneExportMessage(result.publications
        ? `Lote ${result.batch}: publicación añadida al catálogo (${result.destinations} destinos).`
        : `No se exportó la publicación.${result.skipped[0] ? ` ${result.skipped[0].reason}` : ''}`)
    } catch (error) {
      reportAppError(error, 'No se pudieron enviar los medios al celular')
      setPhoneExportError(true)
      setPhoneExportMessage(errorMessage(error))
    } finally {
      if (chooseFolder) {
        try {
          setPhoneExportFolder(await window.planner.mobileSync.folder())
        } catch (error) {
          reportAppError(error, 'No se pudo consultar la carpeta de exportación al celular')
        }
      }
      setPhoneExportBusy(false)
      setSaving(false)
    }
  }
  useEffect(() => { if (!initial) localStorage.setItem(draftKey, JSON.stringify(draft)) }, [draft, draftKey, initial])
  const close = () => {
    const changed = !initial && Boolean(draft.title || draft.caption || draft.notes || draft.media?.length || draft.ideaBlocks?.length)
    if (changed && !window.confirm('Hay cambios sin guardar. ¿Quieres salir y conservar el borrador?')) return
    onClose()
  }
  const submitAndClear = async () => {
    if (!await submit()) return
    try {
      localStorage.removeItem(draftKey)
      await window.planner.preferences.remove(draftKey)
    } catch (error) {
      reportAppError(error, 'No se pudo limpiar el borrador guardado')
    }
  }
  const attach = async () => {
    try { update('media', [...(draft.media || []), ...await window.planner.media.choose('copy', draft.id, draft.project)]) }
    catch (error) { reportAppError(error, 'No se pudieron adjuntar los medios') }
  }
  const applyAssistant = () => {
    const titles = parseTitleCandidates(assistantTitles)
    const blocks = parseMasterSlides(assistantMaster)
    if (!assistantIdea.trim() && !titles.length && !blocks.length) { setAssistantMessage('Pega al menos un resultado.'); return }
    setDraft(current => ({ ...current, caption: assistantIdea.trim() || current.caption, title: titles[0] || current.title, contentType: blocks.length ? 'carousel' : current.contentType, ideaBlocks: blocks.length ? blocks : current.ideaBlocks }))
    setAssistantMessage(`${blocks.length} slides cargadas${titles.length ? ` · ${titles.length} títulos detectados` : ''}. El cierre fue omitido.`)
  }
  const copyObsidianMark = async () => {
    if (!assistantIdea.trim()) { setAssistantMessage('Pega primero el idea-párrafo para generar su marca.'); return }
    await window.planner.clipboard.write(`==${assistantIdea.trim()}==`)
    setAssistantMessage('Marca copiada. Pégala en tu archivo de Obsidian.')
  }
  const saveCatalog = async () => { setCatalogBusy(true); setCatalogMessage(''); try { const config = await window.planner.catalog.saveConfig({ endpoint: catalogEndpoint, createdBy: catalogCreatedBy, token: catalogToken, defaultKind: catalogKind, scope: draft.project || activeSpace || '' }); setCatalogConfig(config); setCatalogToken(''); if (initial) await window.planner.catalog.savePostFields({ postId: initial.id, summary: catalogSummary, content: catalogContent, useHashtags: catalogUseHashtags, categoryId: catalogCategoryId ? Number(catalogCategoryId) : null, categorySlug: catalogCategorySlug, kind: catalogKind }); setCatalogMessage('Configuracion guardada') } catch (error) { reportAppError(error, 'No se pudo guardar la configuración del catálogo'); setCatalogMessage(error instanceof Error ? error.message : 'No se pudo guardar la configuracion') } finally { setCatalogBusy(false) } }
  const syncCatalog = async (dryRun: boolean, publishOverride = catalogPublish) => { if (!initial) { setCatalogMessage('Guarda la publicacion antes de sincronizar'); return }; let category = catalogCategoryId; let slug = catalogCategorySlug.trim(); if (catalogKind === 'resource' && !category && !slug) { const value = window.prompt('Escribe category_id numerico o category_slug:', '') || ''; if (/^\d+$/.test(value)) category = value; else slug = value.trim() } if (catalogKind === 'resource' && ((!category || !/^\d+$/.test(category) || Number(category) < 1) && !slug)) { setCatalogMessage('Resource requiere category_id o category_slug valido'); return }; if (category && slug) { setCatalogMessage('Usa category_id o category_slug, no ambos'); return }; setCatalogCategoryId(category); setCatalogCategorySlug(slug); setCatalogBusy(true); setCatalogMessage(dryRun ? 'Validando en la API...' : 'Sincronizando...'); try { await save(draft); await window.planner.catalog.savePostFields({ postId: initial.id, summary: catalogSummary, content: catalogContent, useHashtags: catalogUseHashtags, categoryId: category ? Number(category) : null, categorySlug: slug, kind: catalogKind }); const result = await window.planner.catalog.sync(initial.id, catalogKind, dryRun, publishOverride); setCatalogSync(result.sync); setCatalogMessage(dryRun ? `Simulacion: ${result.sync.action}` : `Catalogo: ${result.sync.action}`) } catch (error) { reportAppError(error, 'No se pudo sincronizar el catálogo'); setCatalogMessage(error instanceof Error ? error.message : 'No se pudo sincronizar') } finally { setCatalogBusy(false) } }
  const catalogPreview = { source: 'caballocci', dry_run: true, publish: false, items: [{ kind: catalogKind, external_id: `post-${initial?.id || ''}`, title: draft.title, ...(catalogKind === 'resource' && catalogCategorySlug ? { category_slug: catalogCategorySlug } : catalogKind === 'resource' && catalogCategoryId ? { category_id: Number(catalogCategoryId) } : {}), summary: catalogSummary, content: catalogContent }] }
  const sourceIdea = initial?.sourceIdeaId ? ideas.find(idea => idea.id === initial.sourceIdeaId) : undefined

  return <div className="editor-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close() }}><aside className="editor" role="dialog" aria-modal="true" aria-label={initial ? 'Editar publicación' : 'Nueva publicación'}>
    <header><div><span>{initial ? 'EDITAR PUBLICACIÓN' : 'NUEVA PUBLICACIÓN'}</span><h2>{draft.title || 'Sin título todavía'}</h2>{sourceIdea && <button type="button" className="source-idea-link" onClick={() => { selectIdea(sourceIdea.id); setView('ideas') }}><Lightbulb size={13} /> Desde idea · {sourceIdea.title || 'Ver idea'}</button>}</div><button className="icon-button" onClick={close}><X size={19} /></button></header>
    <div className="editor-tabs editor-main-tabs" role="group" aria-label="Secciones de edición"><button type="button" aria-pressed={tab === 'content'} className={tab === 'content' ? 'active' : ''} onClick={() => setTab('content')}>Contenido</button><button type="button" aria-pressed={tab === 'ideas'} className={tab === 'ideas' ? 'active' : ''} onClick={() => setTab('ideas')}>Diapositivas{draft.ideaBlocks?.length ? ` ${draft.ideaBlocks.length}` : ''}</button><button type="button" aria-pressed={tab === 'preview'} className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Vista previa</button><button type="button" aria-pressed={tab === 'notes'} className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>Notas</button><button type="button" aria-pressed={tab === 'assistant'} className={tab === 'assistant' ? 'active' : ''} onClick={() => setTab('assistant')}><Sparkles size={13} /> Asistente IA</button>{externalRecord && <button type="button" aria-pressed={tab === 'external'} className={tab === 'external' ? 'active' : ''} onClick={() => setTab('external')}><Database size={13} /> Datos externos</button>}{initial && <button type="button" aria-pressed={tab === 'catalog'} className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}><Database size={13} /> Catálogo</button>}</div>
    <div className="post-title-toolbar"><span>Título rápido</span><button type="button" onClick={() => formatPostTitle('upper')}>MAYÚS</button><button type="button" onClick={() => formatPostTitle('lower')}>minús</button><button type="button" onClick={() => formatPostTitle('title')}>Título</button><button type="button" onClick={() => formatPostTitle('sentence')}>Oración</button></div>
    <div className="editor-body">
      {tab === 'content' && <>
        <label>Título<input value={draft.title} onChange={e => update('title', e.target.value)} placeholder="Nombra esta pieza de contenido" /></label>
        <div className="field-row"><label>Formato<select value={draft.contentType} onChange={e => update('contentType', e.target.value as ContentType)}>{Object.entries(contentLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Estado<select value={draft.status} onChange={e => { const status = e.target.value as PostStatus; if (status === 'scheduled' && !draft.scheduledAt) { setScheduleWarning('Asigna una fecha y hora antes de marcarla como programada.'); return } setScheduleWarning(''); update('status', status) }}>{Object.entries(statusMeta).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}</select></label></div>
        {scheduleWarning && <p className="schedule-warning" role="alert">{scheduleWarning}</p>}
        <label>Destinos de distribución<div className="platform-selector">{platformOptions.map(p => <button type="button" className={draft.platforms.includes(p) ? 'active' : ''} key={p} onClick={() => togglePlatform(p)}><PlatformMark platform={p} />{getPlatformMeta(p).label}</button>)}<button type="button" onClick={() => setAddingPlatform(true)}><Plus size={13} /> Añadir destino</button></div>{addingPlatform && <div className="inline-add-platform"><input autoFocus value={newPlatformName} onChange={event => setNewPlatformName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addPlatform(); if (event.key === 'Escape') setAddingPlatform(false) }} placeholder="Blog, newsletter, Discord..." /><button type="button" className="save-button" onClick={addPlatform}>Añadir</button><button type="button" className="ghost-button" onClick={() => setAddingPlatform(false)}>Cancelar</button></div>}</label>
        <section className="distribution-panel"><header><strong>Estado por destino</strong><small>Marca dónde está publicada cada versión.</small></header>{(draft.distribution || draft.platforms.map(id => ({ id, name: getPlatformMeta(id).label, status: 'pending' as const }))).map((target, index) => <div className="distribution-row" key={target.id}><span>{target.name}</span><select value={target.status} onChange={event => { const current = draft.distribution || draft.platforms.map(id => ({ id, name: getPlatformMeta(id).label, status: 'pending' as const })); update('distribution', current.map((item, i) => i === index ? { ...item, status: event.target.value as any } : item)) }}><option value="pending">Pendiente</option><option value="preparing">En preparación</option><option value="scheduled">Programado</option><option value="published">Publicado</option><option value="not_applicable">No aplica</option><option value="failed">Requiere atención</option></select></div>)}</section>
        <label>Texto de la publicación<div className="caption-box"><textarea value={draft.caption} onChange={e => update('caption', e.target.value)} placeholder="Escribe pensando en la persona que lo leerá..." /><span>{draft.caption.length} caracteres</span></div></label>
        <label><span className="label-icon"><Hash size={14} /> Hashtags</span><input value={draft.hashtags.join(' ')} onChange={e => update('hashtags', e.target.value.split(/\s+/).filter(Boolean))} placeholder="#contenido #campaña" /></label>
        <div className="field-row"><label>Fecha y hora<input type="datetime-local" value={toLocalDateTimeInput(draft.scheduledAt)} onChange={e => { const scheduledAt = fromLocalDateTimeInput(e.target.value); update('scheduledAt', scheduledAt); if (!scheduledAt && draft.status === 'scheduled') { update('status', 'approved'); setScheduleWarning('Al quitar la fecha, el estado volvió a Aprobado.') } else setScheduleWarning('') }} /><small className="field-hint">La hora se muestra en tu zona horaria. Sin fecha, no se añade al calendario.</small></label><label>Proyecto<input value={draft.project} onChange={e => update('project', e.target.value)} /></label></div>
        <div className="media-actions"><button className="media-drop" onClick={attach}><FileImage size={23} /><span><strong>Añadir imágenes o ZIP</strong><small>PNG, JPG, WebP o un ZIP con imágenes en la raíz</small></span><Plus size={18} /></button><button type="button" className="media-folder-button" title="Abrir carpeta de media" onClick={() => void window.planner.media.openFolder(draft.id, draft.project)}><FolderOpen size={17} /> Abrir carpeta</button></div>
        <details className="media-export-section" open>
          <summary><Smartphone size={15} /> Enviar álbumes al celular</summary>
          <div className="media-export-section-content">
            <p className="media-export-note">Esta acción envía <strong>solo esta publicación</strong> al mismo catálogo que usa la app Android. Sus medios se exportan con la misma rutina y orden visual que en los envíos por lote; el álbum queda dentro de <code>pc-outbox/publications/</code> y se registra en <code>pc-outbox/catalog.json</code>.</p>
            <p className="media-export-folder"><FolderOpen size={13} /><strong>{phoneExportFolder || 'Aún no elegiste una carpeta de destino'}</strong></p>
            <div className="media-export-actions"><button type="button" className="media-phone-button" disabled={!initial || !draft.id || saving || phoneExportBusy} onClick={() => void exportToPhone()}><Smartphone size={15} /> {phoneExportBusy ? 'Enviando…' : 'Guardar y enviar al celular'}</button><button type="button" className="media-export-destination" disabled={saving || phoneExportBusy} onClick={() => void exportToPhone(true)}><FolderOpen size={15} /> Elegir raíz compartida</button></div>
            <p className="media-export-note">La raíz compartida se configura una sola vez y se usa también en <strong>Acerca de / Actualizaciones</strong>; no hacen falta dos carpetas. Comparte la raíz como <strong>Enviar y recibir</strong> en Syncthing del PC y Android. En la app móvil selecciona esa raíz, no <code>pc-outbox/</code>.</p>
            <details className="media-transfer-help">
              <summary>Configurar el envío de álbumes con Syncthing</summary>
              <ol>
                <li>Instala Syncthing en el PC y un cliente compatible en Android; conecta los dispositivos con su QR o identificador.</li>
                <li>En caballocci, pulsa <strong>Elegir raíz compartida</strong> para seleccionar la carpeta de Syncthing que se configura también en Acerca de / Actualizaciones.</li>
                <li>En Syncthing del PC y Android, comparte/acepta esa misma raíz en modo <strong>Enviar y recibir</strong>. En Android, elige una ubicación local, por ejemplo <code>Pictures/Caballocci</code>; las rutas pueden ser distintas.</li>
                <li>Pulsa <strong>Guardar y enviar al celular</strong>. caballocci crea el álbum bajo <code>pc-outbox/publications/</code> y actualiza el catálogo que lee la app.</li>
              </ol>
              <pre className="media-folder-tree">{`PC: Caballocci-Sync/              ← única raíz compartida
└── pc-outbox/
    ├── catalog.json
    └── publications/
        └── a-marketing-1-titulo-2026-10-24/ ← lote-espacio-orden-título-fecha
            ├── 01-imagen.jpg
            ├── caption.txt
            └── manifest.json

Android: Pictures/Caballocci/     ← ubicación local de esa raíz
└── pc-outbox/publications/...     ← Syncthing replica catálogo y álbumes`}</pre>
              <p>No crees las subcarpetas: caballocci las genera. El nombre sigue el formato <code>lote-espacio-orden-título-listo-fecha</code>: el orden es consecutivo dentro del espacio y no se reinicia al cambiar de tanda. Las carpetas marcadas con <code>listo</code> corresponden a publicaciones confirmadas como usadas, no necesariamente publicadas. La ubicación local de Android se elige al aceptar la carpeta en Syncthing.</p>
              <button type="button" className="media-transfer-download" onClick={() => void runWithErrorReporting(() => window.planner.system.openSyncthingDownloads(), 'No se pudo abrir la página de descarga de Syncthing')}><ExternalLink size={13} /> Descargar Syncthing para PC</button>
              <details className="media-mobile-app-help">
                <summary>Usar la app Android de caballocci</summary>
                <div>
                  <p>La app muestra publicaciones por destino y permite devolver a caballocci las confirmaciones de uso. El editor, la selección del tablero y la exportación global comparten la raíz y el catálogo:</p>
                  <ol>
                    <li>Instala la app en Android con el APK oficial.</li>
                    <li>En <strong>Acerca de / Actualizaciones → App Android de caballocci</strong>, configura la raíz compartida. Es la misma carpeta que aparece arriba; no configures otra raíz para el editor.</li>
                    <li>Pulsa <strong>Exportar todas las publicaciones</strong>. caballocci recorre las publicaciones no archivadas con medios y al menos un destino cuyo estado no sea Publicado ni No aplica; genera <code>pc-outbox/catalog.json</code> y los álbumes que referencia.</li>
                    <li>Configura esa raíz como <strong>Enviar y recibir</strong> en Syncthing del PC y Android, y selecciónala en la app móvil. Syncthing replica <code>pc-outbox/</code>; la app escribe las confirmaciones en <code>android-inbox/</code>.</li>
                  </ol>
                  <div className="media-mobile-app-actions">
                    <MobileAppDownload className="media-transfer-download" label="Descargar app Android (APK)" />
                    <span>La configuración se hace en Acerca de / Actualizaciones.</span>
                  </div>
                  <p>Si usas ambas opciones con la misma raíz, los álbumes exportados por separado quedan fuera de <code>pc-outbox/</code> y no aparecen en el catálogo móvil. Para que la app Android muestre una publicación, exporta desde Acerca de / Actualizaciones. No compartas la base de datos del PC.</p>
                </div>
              </details>
            </details>
            {phoneExportMessage && <p className={'media-export-feedback' + (phoneExportError ? ' error' : '')} role={phoneExportError ? 'alert' : 'status'}>{phoneExportMessage}</p>}
            <p className="media-folder-hint"><FolderOpen size={13} /> También puedes copiar imágenes directamente en la carpeta de esta publicación y pulsar “Actualizar carpeta” en Vista previa.</p>
          </div>
        </details>
        {draft.media?.map(media => <div className="media-row" key={media.id}><FileImage size={18} /><span>{media.name}</span><small>{(media.size / 1024 / 1024).toFixed(1)} MB</small></div>)}
      </>}
      {tab === 'content' && <section className="notes-quick"><header><span>NOTAS</span><button type="button" onClick={() => setTab('notes')}>{noteItems.length} {noteItems.length === 1 ? 'nota' : 'notas'} <ChevronDown size={13} /></button></header>{noteItems.filter(note => note.title.trim() || note.text.trim()).slice(0, 2).map(note => <p key={note.id}><strong>{note.title || 'Sin título'}</strong>{note.text || 'Nota vacía'}</p>)}{!noteItems.some(note => note.title.trim() || note.text.trim()) && <small>Añade datos sueltos, referencias o pendientes en la pestaña Notas.</small>}</section>}
      {tab === 'ideas' && <IdeaBlocks blocks={draft.ideaBlocks || []} onChange={blocks => update('ideaBlocks', blocks)} />}
      {tab === 'notes' && <section className="notes-editor"><header><div><span>APUNTES INTERNOS</span><strong>{noteItems.length} {noteItems.length === 1 ? 'nota' : 'notas'}</strong></div><button type="button" className="new-button" onClick={() => updateNotes([...noteItems, { id: crypto.randomUUID(), title: '', text: '' }])}><Plus size={15} /> Nueva nota</button></header>{noteItems.map((note, index) => <article className="note-item" key={note.id}><div className="note-item-heading"><span>NOTA {String(index + 1).padStart(2, '0')}</span>{noteItems.length > 1 && <button type="button" onClick={() => updateNotes(noteItems.filter(item => item.id !== note.id))}><Trash2 size={14} /></button>}</div><input value={note.title} onChange={event => updateNotes(noteItems.map(item => item.id === note.id ? { ...item, title: event.target.value } : item))} placeholder="Nombre opcional" /><textarea value={note.text} onChange={event => updateNotes(noteItems.map(item => item.id === note.id ? { ...item, text: event.target.value } : item))} placeholder="Dato, referencia, pendiente o contexto..." /></article>)}</section>}
      {tab === 'assistant' && <section className="ai-assistant"><header><div><span>INGESTA DE RESPUESTAS</span><strong>Convierte tus textos en una publicación</strong></div><Sparkles size={19} /></header><p className="assistant-hint">Se detectan títulos y slides numeradas; las secciones “final” o “cierre” se descartan.</p><label>Original<textarea value={assistantIdea} onChange={event => setAssistantIdea(event.target.value)} placeholder="Pega aquí el texto seleccionado" /></label><label>Títulos<textarea value={assistantTitles} onChange={event => setAssistantTitles(event.target.value)} placeholder="Un título por línea" /></label>{parseTitleCandidates(assistantTitles).length > 0 && <div className="assistant-candidates"><span>Elegir título</span>{parseTitleCandidates(assistantTitles).map(title => <button type="button" key={title} onClick={() => update('title', title)}>{title}</button>)}</div>}<label>Respuesta del p1<textarea value={assistantMaster} onChange={event => setAssistantMaster(event.target.value)} placeholder={'Slide 0: ...\nSlide 1: ...\nFinal: ...'} /></label><div className="assistant-actions"><button type="button" className="save-button" onClick={applyAssistant}><Sparkles size={15} /> Aplicar a la publicación</button><button type="button" className="ghost-button" onClick={() => void copyObsidianMark()}><Clipboard size={15} /> Copiar marca</button></div>{assistantMessage && <p className="assistant-message">{assistantMessage}</p>}</section>}
      {tab === 'preview' && <Preview draft={draft} onMediaChange={media => update('media', media)} onError={message => reportAppError(message, 'Error en medios')} />}
      {tab === 'notes' && <label>Notas internas<textarea className="notes-area" value={draft.notes} onChange={e => update('notes', e.target.value)} placeholder="Instrucciones, observaciones, comentarios del cliente..." /></label>}
      {tab === 'external' && externalRecord && <section className="external-data"><header><div><span>FUENTE EXTERNA</span><strong>{externalRecord.externalRef}</strong></div><small>{externalRecord.lastSeenAt ? `Visto por ultima vez: ${new Date(externalRecord.lastSeenAt).toLocaleString()}` : ''}</small></header><details open><summary>Registro original</summary><pre>{JSON.stringify(externalRecord.raw, null, 2)}</pre></details><details><summary>Registro normalizado</summary><pre>{JSON.stringify(externalRecord.normalized, null, 2)}</pre></details><details><summary>Enriquecimiento interno</summary><pre>{JSON.stringify(externalRecord.enriched, null, 2)}</pre></details></section>}
      {tab === 'catalog' && <div className="catalog-fields"><label>category_id (solo Resource)<input type="number" min="1" step="1" value={catalogCategoryId} onChange={event => setCatalogCategoryId(event.target.value)} placeholder="Ej. 4" /></label><label>Resumen del catalogo<textarea value={catalogSummary} onChange={event => setCatalogSummary(event.target.value)} placeholder="Resumen breve; conserva saltos de linea y Markdown pegado." /></label><label>Contenido del catalogo<textarea value={catalogContent} onChange={event => setCatalogContent(event.target.value)} placeholder="Pega aqui el Markdown completo." /></label><label><input type="checkbox" checked={catalogUseHashtags} onChange={event => setCatalogUseHashtags(event.target.checked)} /> Convertir hashtags a tags (requiere IDs)</label></div>}
      {tab === 'catalog' && <section className="external-data catalog-panel"><header><div><span>INTEGRACION DE CONTENIDO</span><strong>{catalogSync ? `Estado: ${catalogSync.action}` : 'Sin sincronizar'}</strong></div>{catalogSync?.updatedAt && <small>{new Date(catalogSync.updatedAt).toLocaleString()}</small>}</header><label>Endpoint<input value={catalogEndpoint} onChange={event => setCatalogEndpoint(event.target.value)} placeholder="https://dominio.tld/api/integrations/content/batch" /></label><label>CONTENT_INTEGRATION_CREATED_BY<input value={catalogCreatedBy} onChange={event => setCatalogCreatedBy(event.target.value)} placeholder="UUID del administrador" /></label><label>Token de integracion<input type="password" value={catalogToken} onChange={event => setCatalogToken(event.target.value)} placeholder={catalogConfig.configured ? 'Guardado de forma segura; deja vacio para conservarlo' : 'Token largo'} /></label><label>Tipo<select value={catalogKind} onChange={event => setCatalogKind(event.target.value as 'resource' | 'resource_lite')}><option value="resource">Resource</option><option value="resource_lite">Resource Lite</option></select></label><div className="source-actions"><button className="settings-button" disabled={catalogBusy || !catalogEndpoint || !catalogCreatedBy} onClick={() => void saveCatalog()}>Guardar configuracion</button><button className="settings-button" disabled={catalogBusy || !catalogConfig.configured} onClick={() => void syncCatalog(true)}>Probar (dry run)</button><button className="save-button" disabled={catalogBusy || !catalogConfig.configured} onClick={() => void syncCatalog(false)}>Sincronizar</button></div>{catalogMessage && <p className="source-message">{catalogMessage}</p>}{catalogSync?.publicUrl && <a href={catalogSync.publicUrl} target="_blank" rel="noreferrer">Abrir contenido remoto</a>}{catalogSync?.error && <pre>{catalogSync.error}</pre>}<details><summary>Payload generado</summary><pre>{JSON.stringify(catalogPreview, null, 2)}</pre></details></section>}
    </div>
    <footer>{initial ? <div className="editor-footer-actions"><button className="danger-button" title="Eliminar" onClick={() => void runWithErrorReporting(async () => { await remove(initial.id); onClose() }, 'No se pudo eliminar la publicación')}><Trash2 size={16} /></button>{initial.isCombined && <button className="ghost-button" onClick={async () => { if (!window.confirm('¿Deshacer esta combinación? La publicación se conserva y las ideas recuperan su estado anterior.')) return; try { await uncombinePost(initial.id); onClose() } catch (error) { reportAppError(error, 'No se pudo deshacer la combinación') } }}>Deshacer combinación</button>}</div> : <span />}<div><button className="ghost-button" onClick={close}>Salir</button><button className="save-button" disabled={!draft.title.trim() || saving} onClick={() => void submitAndClear()}>{saving ? 'Guardando...' : 'Guardar publicación'}</button></div></footer>
  </aside></div>
}

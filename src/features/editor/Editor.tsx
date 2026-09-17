import { useEffect, useState } from 'react'
import { Archive, ChevronDown, ChevronUp, Clipboard, Database, FileImage, FolderOpen, Hash, Instagram, Lightbulb, MessageCircle, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import { contentLabels, platformMeta, statusMeta } from '../../shared/constants'
import { PlatformMark } from '../../components/layout/AppShell'
import { usePlanner } from '../../app/store'
import type { CatalogSync, ContentRecord, ContentType, IdeaBlock, Platform, Post, PostInput, PostStatus } from '../../shared/types'
import './editor.css'

const blankPost = (project: string): PostInput => ({
  id: crypto.randomUUID(),
  title: '', caption: '', notes: '', hashtags: [], mentions: [], platforms: ['instagram'],
  contentType: 'reel', status: 'idea', scheduledAt: new Date().toISOString(), durationMinutes: 60,
  project, color: '#e76042', ideaBlocks: [],
})

function Preview({ draft }: { draft: PostInput }) {
  const platform = draft.platforms[0] || 'instagram'
  const text = [draft.caption, ...draft.hashtags].join(' ').trim()
  const image = draft.media?.find(asset => asset.kind === 'image')
  const firstIdea = draft.ideaBlocks?.[0]
  return <div className="preview-wrap">
    <div className="preview-platforms">{draft.platforms.map(p => <button key={p}><PlatformMark platform={p} />{platformMeta[p].label}</button>)}</div>
    <div className={'social-preview ' + platform}>
      <header><div className="preview-avatar">CP</div><div><strong>tu_cuenta</strong><span>Vista previa local</span></div><MoreHorizontal size={17} /></header>
      <div className="preview-media">
        {image
          ? <img src={window.planner.media.imageUrl(image.id)} alt={image.name} />
          : <div className="preview-placeholder"><Instagram size={38} />{firstIdea ? <><strong>{firstIdea.title || 'Idea 1'}</strong><p>{firstIdea.text || 'Texto pendiente'}</p></> : <span>{contentLabels[draft.contentType]}</span>}</div>}
        <span className="preview-dimensions">1080 × 1350</span>
      </div>
      <div className="preview-actions"><MessageCircle /><Archive /><Clipboard /></div>
      <p><strong>tu_cuenta </strong>{text || 'Aquí aparecerá el texto de tu publicación.'}</p>
    </div>
    <button className="copy-helper" onClick={() => window.planner.clipboard.write(text)}><Clipboard size={16} /> Copiar texto para publicar</button>
  </div>
}

function IdeaBlocks({ blocks, onChange }: { blocks: IdeaBlock[]; onChange(blocks: IdeaBlock[]): void }) {
  const add = () => onChange([...blocks, { id: crypto.randomUUID(), title: '', text: '' }])
  const update = (id: string, patch: Partial<IdeaBlock>) => onChange(blocks.map(block => block.id === id ? { ...block, ...patch } : block))
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
    <header><div><span>IDEAS AGRUPADAS</span><strong>{blocks.length} {blocks.length === 1 ? 'bloque' : 'bloques'}</strong></div><button type="button" className="new-button" onClick={add}><Plus size={15} /> Nueva idea</button></header>
    {blocks.length === 0 && <button type="button" className="empty-ideas" onClick={add}><Lightbulb size={24} /><span>Añadir primera idea</span></button>}
    {blocks.map((block, index) => <article className="idea-block" key={block.id}>
      <header><span>IDEA {String(index + 1).padStart(2, '0')}</span><div>
        <button type="button" title="Subir idea" aria-label="Subir idea" disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp size={15} /></button>
        <button type="button" title="Bajar idea" aria-label="Bajar idea" disabled={index === blocks.length - 1} onClick={() => move(index, 1)}><ChevronDown size={15} /></button>
        <button type="button" title="Eliminar idea" aria-label="Eliminar idea" onClick={() => remove(block.id)}><Trash2 size={14} /></button>
      </div></header>
      <label>Título<input value={block.title} maxLength={160} onChange={event => update(block.id, { title: event.target.value })} placeholder="Ej. Apertura, argumento, cierre" /></label>
      <label>Texto<textarea value={block.text} maxLength={10_000} onChange={event => update(block.id, { text: event.target.value })} placeholder="Texto que luego irá en la imagen" /></label>
    </article>)}
  </section>
}

export function Editor({ initial, onClose }: { initial: Post | null; onClose(): void }) {
  const { save, remove, activeSpace } = usePlanner()
  const draftKey = `caballocci.draft.${initial?.id || 'new'}`
  const [draft, setDraft] = useState<PostInput>(() => {
    if (initial) return { ...initial }
    try { const saved = JSON.parse(localStorage.getItem(draftKey) || '') as PostInput; if (saved && typeof saved === 'object') return saved } catch { /* Ignore invalid drafts. */ }
    return blankPost(activeSpace || 'Mi contenido')
  })
  const [tab, setTab] = useState<'content' | 'ideas' | 'preview' | 'notes' | 'external' | 'catalog'>('content')
  const [saving, setSaving] = useState(false)
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
  useEffect(() => {
    let active = true
    if (!initial) { setExternalRecord(null); return () => { active = false } }
    void window.planner.contentRecords.byPost(initial.id).then(record => { if (active) setExternalRecord(record) }).catch(() => { if (active) setExternalRecord(null) })
    return () => { active = false }
  }, [initial?.id])
  useEffect(() => {
    const scope = initial?.project || activeSpace || ''
    void window.planner.catalog.config(scope).then(config => { setCatalogConfig(config); setCatalogEndpoint(config.endpoint); setCatalogCreatedBy(config.createdBy); setCatalogKind(config.defaultKind) })
    if (initial) { void window.planner.catalog.syncState(initial.id).then(setCatalogSync).catch(() => setCatalogSync(null)); void window.planner.catalog.postFields(initial.id).then(fields => { setCatalogSummary(fields.summary || initial.notes || ''); setCatalogContent(fields.content || initial.caption || ''); setCatalogUseHashtags(fields.useHashtags); setCatalogKind(fields.kind) }) }
    else setCatalogSync(null)
  }, [initial?.id])
  const update = <K extends keyof PostInput>(key: K, value: PostInput[K]) => setDraft(d => ({ ...d, [key]: value }))
  const togglePlatform = (platform: Platform) => update('platforms', draft.platforms.includes(platform) ? draft.platforms.filter(p => p !== platform) : [...draft.platforms, platform])
  const submit = async () => { setSaving(true); await save(draft); setSaving(false); onClose() }
  useEffect(() => { if (!initial) localStorage.setItem(draftKey, JSON.stringify(draft)) }, [draft, draftKey, initial])
  const close = () => {
    const changed = !initial && Boolean(draft.title || draft.caption || draft.notes || draft.media?.length || draft.ideaBlocks?.length)
    if (changed && !window.confirm('Hay cambios sin guardar. ¿Quieres salir y conservar el borrador?')) return
    onClose()
  }
  const submitAndClear = async () => { await submit(); localStorage.removeItem(draftKey) }
  const attach = async () => update('media', [...(draft.media || []), ...await window.planner.media.choose('copy', draft.id)])
  const saveCatalog = async () => { setCatalogBusy(true); setCatalogMessage(''); try { const config = await window.planner.catalog.saveConfig({ endpoint: catalogEndpoint, createdBy: catalogCreatedBy, token: catalogToken, defaultKind: catalogKind, scope: draft.project || activeSpace || '' }); setCatalogConfig(config); setCatalogToken(''); if (initial) await window.planner.catalog.savePostFields({ postId: initial.id, summary: catalogSummary, content: catalogContent, useHashtags: catalogUseHashtags, kind: catalogKind }); setCatalogMessage('Configuracion guardada') } catch (error) { setCatalogMessage(error instanceof Error ? error.message : 'No se pudo guardar la configuracion') } finally { setCatalogBusy(false) } }
  const syncCatalog = async (dryRun: boolean, publishOverride = catalogPublish) => { if (!initial) { setCatalogMessage('Guarda la publicacion antes de sincronizar'); return }; setCatalogBusy(true); setCatalogMessage(dryRun ? 'Validando en la API...' : 'Sincronizando...'); try { await save(draft); await window.planner.catalog.savePostFields({ postId: initial.id, summary: catalogSummary, content: catalogContent, useHashtags: catalogUseHashtags, kind: catalogKind }); const result = await window.planner.catalog.sync(initial.id, catalogKind, dryRun, publishOverride); setCatalogSync(result.sync); setCatalogMessage(dryRun ? `Simulacion: ${result.sync.action}` : `Catalogo: ${result.sync.action}`) } catch (error) { setCatalogMessage(error instanceof Error ? error.message : 'No se pudo sincronizar') } finally { setCatalogBusy(false) } }

  return <div className="editor-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close() }}><aside className="editor">
    <header><div><span>{initial ? 'EDITAR PUBLICACIÓN' : 'NUEVA PUBLICACIÓN'}</span><h2>{draft.title || 'Sin título todavía'}</h2></div><button className="icon-button" onClick={close}><X size={19} /></button></header>
    <div className="editor-tabs"><button className={tab === 'content' ? 'active' : ''} onClick={() => setTab('content')}>Contenido</button><button className={tab === 'ideas' ? 'active' : ''} onClick={() => setTab('ideas')}>Ideas{draft.ideaBlocks?.length ? ` ${draft.ideaBlocks.length}` : ''}</button><button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Vista previa</button><button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>Notas</button>{externalRecord && <button className={tab === 'external' ? 'active' : ''} onClick={() => setTab('external')}><Database size={13} /> Datos externos</button>}{initial && <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}><Database size={13} /> Catálogo</button>}</div>
    <div className="editor-body">
      {tab === 'content' && <>
        <label>Título<input value={draft.title} onChange={e => update('title', e.target.value)} placeholder="Nombra esta pieza de contenido" /></label>
        <div className="field-row"><label>Formato<select value={draft.contentType} onChange={e => update('contentType', e.target.value as ContentType)}>{Object.entries(contentLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Estado<select value={draft.status} onChange={e => update('status', e.target.value as PostStatus)}>{Object.entries(statusMeta).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}</select></label></div>
        <label>Plataformas<div className="platform-selector">{(['instagram', 'facebook', 'x'] as Platform[]).map(p => <button type="button" className={draft.platforms.includes(p) ? 'active' : ''} key={p} onClick={() => togglePlatform(p)}><PlatformMark platform={p} />{platformMeta[p].label}</button>)}</div></label>
        <label>Texto de la publicación<div className="caption-box"><textarea value={draft.caption} onChange={e => update('caption', e.target.value)} placeholder="Escribe pensando en la persona que lo leerá..." /><span>{draft.caption.length} caracteres</span></div></label>
        <label><span className="label-icon"><Hash size={14} /> Hashtags</span><input value={draft.hashtags.join(' ')} onChange={e => update('hashtags', e.target.value.split(/\s+/).filter(Boolean))} placeholder="#contenido #campaña" /></label>
        <div className="field-row"><label>Fecha y hora<input type="datetime-local" value={draft.scheduledAt?.slice(0, 16) || ''} onChange={e => update('scheduledAt', e.target.value ? new Date(e.target.value).toISOString() : null)} /></label><label>Proyecto<input value={draft.project} onChange={e => update('project', e.target.value)} /></label></div>
        <div className="media-actions"><button className="media-drop" onClick={attach}><FileImage size={23} /><span><strong>Añadir material</strong><small>Se guardará en la carpeta de esta publicación</small></span><Plus size={18} /></button><button type="button" className="media-folder-button" title="Abrir carpeta de media" onClick={() => void window.planner.media.openFolder(draft.id)}><FolderOpen size={17} /> Abrir carpeta</button></div>
        {draft.media?.map(media => <div className="media-row" key={media.id}><FileImage size={18} /><span>{media.name}</span><small>{(media.size / 1024 / 1024).toFixed(1)} MB</small></div>)}
      </>}
      {tab === 'ideas' && <IdeaBlocks blocks={draft.ideaBlocks || []} onChange={blocks => update('ideaBlocks', blocks)} />}
      {tab === 'preview' && <Preview draft={draft} />}
      {tab === 'notes' && <label>Notas internas<textarea className="notes-area" value={draft.notes} onChange={e => update('notes', e.target.value)} placeholder="Instrucciones, observaciones, comentarios del cliente..." /></label>}
      {tab === 'external' && externalRecord && <section className="external-data"><header><div><span>FUENTE EXTERNA</span><strong>{externalRecord.externalRef}</strong></div><small>{externalRecord.lastSeenAt ? `Visto por ultima vez: ${new Date(externalRecord.lastSeenAt).toLocaleString()}` : ''}</small></header><details open><summary>Registro original</summary><pre>{JSON.stringify(externalRecord.raw, null, 2)}</pre></details><details><summary>Registro normalizado</summary><pre>{JSON.stringify(externalRecord.normalized, null, 2)}</pre></details><details><summary>Enriquecimiento interno</summary><pre>{JSON.stringify(externalRecord.enriched, null, 2)}</pre></details></section>}
      {tab === 'catalog' && <div className="catalog-fields"><label>Resumen del catalogo<textarea value={catalogSummary} onChange={event => setCatalogSummary(event.target.value)} placeholder="Resumen breve; conserva saltos de linea y Markdown pegado." /></label><label>Contenido del catalogo<textarea value={catalogContent} onChange={event => setCatalogContent(event.target.value)} placeholder="Pega aqui el Markdown completo." /></label><label><input type="checkbox" checked={catalogUseHashtags} onChange={event => setCatalogUseHashtags(event.target.checked)} /> Convertir hashtags a tags (requiere IDs)</label></div>}
      {tab === 'catalog' && <section className="external-data catalog-panel"><header><div><span>INTEGRACION DE CONTENIDO</span><strong>{catalogSync ? `Estado: ${catalogSync.action}` : 'Sin sincronizar'}</strong></div>{catalogSync?.updatedAt && <small>{new Date(catalogSync.updatedAt).toLocaleString()}</small>}</header><label>Endpoint<input value={catalogEndpoint} onChange={event => setCatalogEndpoint(event.target.value)} placeholder="https://dominio.tld/api/integrations/content/batch" /></label><label>CONTENT_INTEGRATION_CREATED_BY<input value={catalogCreatedBy} onChange={event => setCatalogCreatedBy(event.target.value)} placeholder="UUID del administrador" /></label><label>Token de integracion<input type="password" value={catalogToken} onChange={event => setCatalogToken(event.target.value)} placeholder={catalogConfig.configured ? 'Guardado de forma segura; deja vacio para conservarlo' : 'Token largo'} /></label><label>Tipo<select value={catalogKind} onChange={event => setCatalogKind(event.target.value as 'resource' | 'resource_lite')}><option value="resource">Resource</option><option value="resource_lite">Resource Lite</option></select></label><div className="source-actions"><button className="settings-button" disabled={catalogBusy || !catalogEndpoint || !catalogCreatedBy} onClick={() => void saveCatalog()}>Guardar configuracion</button><button className="settings-button" disabled={catalogBusy || !catalogConfig.configured} onClick={() => void syncCatalog(true)}>Probar (dry run)</button><button className="save-button" disabled={catalogBusy || !catalogConfig.configured} onClick={() => void syncCatalog(false)}>Sincronizar</button></div>{catalogMessage && <p className="source-message">{catalogMessage}</p>}{catalogSync?.publicUrl && <a href={catalogSync.publicUrl} target="_blank" rel="noreferrer">Abrir contenido remoto</a>}{catalogSync?.error && <pre>{JSON.stringify(catalogSync.error, null, 2)}</pre>}<details><summary>Payload generado</summary><pre>{JSON.stringify({ source: 'caballocci', dry_run: true, publish: false, items: [{ kind: catalogKind, external_id: `post-${initial?.id || ''}`, title: draft.title, summary: draft.notes, content: draft.caption }] }, null, 2)}</pre></details></section>}
    </div>
    <footer>{initial ? <button className="danger-button" title="Eliminar" onClick={async () => { await remove(initial.id); onClose() }}><Trash2 size={16} /></button> : <span />}<div><button className="ghost-button" onClick={close}>Salir</button><button className="save-button" disabled={!draft.title || saving} onClick={() => void submitAndClear()}>{saving ? 'Guardando...' : 'Guardar publicación'}</button></div></footer>
  </aside></div>
}

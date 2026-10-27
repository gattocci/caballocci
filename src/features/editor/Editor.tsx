import { useEffect, useState } from 'react'
import { Archive, ChevronDown, ChevronLeft, ChevronRight, Database, Edit3, ExternalLink, FileImage, FolderOpen, FolderPlus, GripVertical, Hash, Instagram, Lightbulb, MessageCircle, MoreHorizontal, Plus, Redo2, Smartphone, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import { contentLabels, getPlatformMeta, platformMeta, statusMeta } from '../../shared/constants'
import { PlatformMark } from '../../components/layout/AppShell'
import { MobileAppDownload } from '../../components/MobileAppDownload'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { useUndoableState, type UndoableChange } from '../../app/useUndoableState'
import { usePlanner } from '../../app/store'
import type { CatalogSync, ContentRecord, ContentType, MediaAsset, Platform, Post, PostInput, PostStatus } from '../../shared/types'
import { blankPost, errorMessage, formatTitle, fromLocalDateTimeInput, itemsToNotes, notesToItems, parseMasterSlides, parseTitleCandidates, toLocalDateTimeInput, type NoteItem } from './editor-utils'
import { EditorIdeaBlocks } from './EditorIdeaBlocks'
import { EditorNotes } from './EditorNotes'
import { EditorAssistantPanel } from './EditorAssistantPanel'
import { EditorCatalogPanel } from './EditorCatalogPanel'
import { EditorExternalRecordPanel } from './EditorExternalRecordPanel'
import { Preview } from './EditorMediaPreview'
import './editor.css'

export function Editor({ initial, scheduledAtForNew = null, onClose }: { initial: Post | null; scheduledAtForNew?: string | null; onClose(): void }) {
  const { save, remove, uncombinePost, activeSpace, ideas, selectIdea, setView } = usePlanner()
  const draftKey = `caballocci.draft.${initial?.id || 'new'}`
  const initialDraft = useState<PostInput>(() => {
    if (initial) return { ...initial }
    try { const saved = JSON.parse(localStorage.getItem(draftKey) || '') as PostInput; if (saved && typeof saved === 'object') return scheduledAtForNew ? { ...saved, scheduledAt: scheduledAtForNew, status: 'scheduled' } : saved } catch { /* Ignore invalid drafts. */ }
    return { ...blankPost(activeSpace || 'Mi contenido'), ...(scheduledAtForNew ? { scheduledAt: scheduledAtForNew, status: 'scheduled' as const } : {}) }
  })[0]
  const { value: draft, setValue: setDraft, undo, redo, canUndo, canRedo } = useUndoableState<PostInput>(initialDraft)
  const [tab, setTab] = useState<'content' | 'ideas' | 'preview' | 'notes' | 'assistant' | 'external' | 'catalog'>('content')
  const [assistantIdea, setAssistantIdea] = useState('')
  const [assistantTitles, setAssistantTitles] = useState('')
  const [assistantMaster, setAssistantMaster] = useState('')
  const [assistantMessage, setAssistantMessage] = useState('')
  const [noteItems, setNoteItems] = useState<NoteItem[]>(() => notesToItems(initial?.notes || ''))
  const [historyNotice, setHistoryNotice] = useState<{ id: string; text: string; direction: 'undo' | 'redo' } | null>(null)
  const showHistoryNotice = (direction: 'undo' | 'redo', label: string) => setHistoryNotice({ id: crypto.randomUUID(), text: `${direction === 'undo' ? 'Deshecho' : 'Rehecho'}: ${label}`, direction })
  const undoDraft = () => { const previous = undo(); if (previous) { setNoteItems(notesToItems(previous.value.notes || '')); showHistoryNotice('undo', previous.label) } }
  const redoDraft = () => { const next = redo(); if (next) { setNoteItems(notesToItems(next.value.notes || '')); showHistoryNotice('redo', next.label) } }
  useEffect(() => {
    if (!historyNotice) return
    const timeout = window.setTimeout(() => setHistoryNotice(null), 1700)
    return () => window.clearTimeout(timeout)
  }, [historyNotice])
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
  const update = <K extends keyof PostInput>(key: K, value: PostInput[K], change?: UndoableChange) => {
    const labels: Partial<Record<keyof PostInput, string>> = { title: 'Editar título', caption: 'Editar texto', notes: 'Editar notas', hashtags: 'Editar hashtags', project: 'Editar proyecto', scheduledAt: 'Cambiar fecha', status: 'Cambiar estado', contentType: 'Cambiar formato', distribution: 'Cambiar distribución', media: 'Cambiar medios', ideaBlocks: 'Editar diapositivas' }
    setDraft(d => ({ ...d, [key]: value }), change || { label: labels[key] || 'Editar publicación' })
  }
  const updateNotes = (items: NoteItem[], change: UndoableChange = { label: 'Editar notas' }) => { setNoteItems(items); update('notes', itemsToNotes(items), change) }
  const formatPostTitle = (mode: 'upper' | 'lower' | 'title' | 'sentence') => update('title', formatTitle(draft.title, mode), { label: 'Formatear título' })
  const togglePlatform = (platform: Platform) => {
    const enabled = draft.platforms.includes(platform)
    const platforms = enabled ? draft.platforms.filter(p => p !== platform) : [...draft.platforms, platform]
    const existing = draft.distribution || draft.platforms.map(id => ({ id, name: getPlatformMeta(id).label, status: 'pending' as const }))
    const distribution = enabled
      ? existing.map(target => target.id === platform ? { ...target, status: 'not_applicable' as const } : target)
      : [...existing.filter(target => target.id !== platform), { id: platform, name: getPlatformMeta(platform).label, status: 'pending' as const }]
    setDraft(d => ({ ...d, platforms, distribution }), { label: 'Cambiar destinos' })
  }
  const [platformOptions, setPlatformOptions] = useState<string[]>(() => { try { const saved = JSON.parse(localStorage.getItem('caballocci.platforms') || '') as string[]; return saved.length ? saved : ['instagram', 'facebook', 'x'] } catch { return ['instagram', 'facebook', 'x'] } })
  const [newPlatformName, setNewPlatformName] = useState('')
  const [addingPlatform, setAddingPlatform] = useState(false)
  const [scheduleWarning, setScheduleWarning] = useState('')
  const addPlatform = () => { const name = newPlatformName.trim(); const id = name.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); if (!name || !id || platformOptions.includes(id)) return; const next = [...platformOptions, id]; setPlatformOptions(next); localStorage.setItem('caballocci.platforms', JSON.stringify(next)); setDraft(d => ({ ...d, platforms: d.platforms.includes(id) ? d.platforms : [...d.platforms, id], distribution: [...(d.distribution || []), { id, name, status: 'pending' as const }] }), { label: 'Añadir destino' }); setNewPlatformName(''); setAddingPlatform(false) }
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
      setDraft(exportDraft, { label: 'Añadir medios detectados' })
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
      if (result.missingAlbums.length) setPhoneExportMessage(value => value + ` Se detectaron y retiraron ${result.missingAlbums.length} carpetas ausentes del snapshot.`)
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
    try { update('media', [...(draft.media || []), ...await window.planner.media.choose('copy', draft.id, draft.project)], { label: 'Adjuntar medios' }) }
    catch (error) { reportAppError(error, 'No se pudieron adjuntar los medios') }
  }
  const applyAssistant = () => {
    const titles = parseTitleCandidates(assistantTitles)
    const blocks = parseMasterSlides(assistantMaster)
    if (!assistantIdea.trim() && !titles.length && !blocks.length) { setAssistantMessage('Pega al menos un resultado.'); return }
    setDraft(current => ({ ...current, caption: assistantIdea.trim() || current.caption, title: titles[0] || current.title, contentType: blocks.length ? 'carousel' : current.contentType, ideaBlocks: blocks.length ? blocks : current.ideaBlocks }), { label: 'Aplicar contenido del asistente' })
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

  return <div className="editor-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close() }}><aside className="editor" role="dialog" aria-modal="true" aria-label={initial ? 'Editar publicación' : 'Nueva publicación'} onKeyDownCapture={event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    const key = event.key.toLocaleLowerCase()
    if (key !== 'z' && key !== 'y') return
    const target = event.target instanceof HTMLElement ? event.target : null
    const textEntry = Boolean(target && (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName)))
    if (textEntry && !target?.closest('[data-undo-control]')) return
    const redoing = key === 'y' || (key === 'z' && event.shiftKey)
    if (textEntry && (redoing ? !canRedo : !canUndo)) return
    event.preventDefault()
    event.stopPropagation()
    if (redoing) redoDraft()
    else undoDraft()
  }}>
    {historyNotice && <div key={historyNotice.id} className={`undo-notice ${historyNotice.direction}`} role="status" aria-live="polite">{historyNotice.direction === 'undo' ? <Undo2 size={13} aria-hidden="true" /> : <Redo2 size={13} aria-hidden="true" />}<span>{historyNotice.text}</span></div>}
    <header><div><span>{initial ? 'EDITAR PUBLICACIÓN' : 'NUEVA PUBLICACIÓN'}</span><h2>{draft.title || 'Sin título todavía'}</h2>{sourceIdea && <button type="button" className="source-idea-link" onClick={() => { selectIdea(sourceIdea.id); setView('ideas') }}><Lightbulb size={13} /> Desde idea · {sourceIdea.title || 'Ver idea'}</button>}</div><button className="icon-button" onClick={close}><X size={19} /></button></header>
    <div className="editor-tabs editor-main-tabs" role="group" aria-label="Secciones de edición"><button type="button" aria-pressed={tab === 'content'} className={tab === 'content' ? 'active' : ''} onClick={() => setTab('content')}>Contenido</button><button type="button" aria-pressed={tab === 'ideas'} className={tab === 'ideas' ? 'active' : ''} onClick={() => setTab('ideas')}>Diapositivas{draft.ideaBlocks?.length ? ` ${draft.ideaBlocks.length}` : ''}</button><button type="button" aria-pressed={tab === 'preview'} className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Vista previa</button><button type="button" aria-pressed={tab === 'notes'} className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>Notas</button><button type="button" aria-pressed={tab === 'assistant'} className={tab === 'assistant' ? 'active' : ''} onClick={() => setTab('assistant')}><Sparkles size={13} /> Asistente IA</button>{externalRecord && <button type="button" aria-pressed={tab === 'external'} className={tab === 'external' ? 'active' : ''} onClick={() => setTab('external')}><Database size={13} /> Datos externos</button>}{initial && <button type="button" aria-pressed={tab === 'catalog'} className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}><Database size={13} /> Catálogo</button>}</div>
    <div className="post-title-toolbar"><span>Título rápido</span><button type="button" onClick={() => formatPostTitle('upper')}>MAYÚS</button><button type="button" onClick={() => formatPostTitle('lower')}>minús</button><button type="button" onClick={() => formatPostTitle('title')}>Título</button><button type="button" onClick={() => formatPostTitle('sentence')}>Oración</button></div>
    <div className="editor-body">
      {tab === 'content' && <>
        <label>Título<input data-undo-control value={draft.title} onChange={e => update('title', e.target.value, { label: 'Editar título', groupKey: 'post:title' })} placeholder="Nombra esta pieza de contenido" /></label>
        <div className="field-row"><label>Formato<select value={draft.contentType} onChange={e => update('contentType', e.target.value as ContentType)}>{Object.entries(contentLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Estado<select value={draft.status} onChange={e => { const status = e.target.value as PostStatus; if (status === 'scheduled' && !draft.scheduledAt) { setScheduleWarning('Asigna una fecha y hora antes de marcarla como programada.'); return } setScheduleWarning(''); update('status', status) }}>{Object.entries(statusMeta).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}</select></label></div>
        {scheduleWarning && <p className="schedule-warning" role="alert">{scheduleWarning}</p>}
        <label>Destinos de distribución<div className="platform-selector">{platformOptions.map(p => <button type="button" className={draft.platforms.includes(p) ? 'active' : ''} key={p} onClick={() => togglePlatform(p)}><PlatformMark platform={p} />{getPlatformMeta(p).label}</button>)}<button type="button" onClick={() => setAddingPlatform(true)}><Plus size={13} /> Añadir destino</button></div>{addingPlatform && <div className="inline-add-platform"><input autoFocus value={newPlatformName} onChange={event => setNewPlatformName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addPlatform(); if (event.key === 'Escape') setAddingPlatform(false) }} placeholder="Blog, newsletter, Discord..." /><button type="button" className="save-button" onClick={addPlatform}>Añadir</button><button type="button" className="ghost-button" onClick={() => setAddingPlatform(false)}>Cancelar</button></div>}</label>
        <section className="distribution-panel"><header><strong>Estado por destino</strong><small>Marca dónde está publicada cada versión.</small></header>{(draft.distribution || draft.platforms.map(id => ({ id, name: getPlatformMeta(id).label, status: 'pending' as const }))).map((target, index) => <div className="distribution-row" key={target.id}><span>{target.name}</span><select value={target.status} onChange={event => { const current = draft.distribution || draft.platforms.map(id => ({ id, name: getPlatformMeta(id).label, status: 'pending' as const })); update('distribution', current.map((item, i) => i === index ? { ...item, status: event.target.value as any } : item)) }}><option value="pending">Pendiente</option><option value="preparing">En preparación</option><option value="scheduled">Programado</option><option value="published">Publicado</option><option value="not_applicable">No aplica</option><option value="failed">Requiere atención</option></select></div>)}</section>
        <label>Texto de la publicación<div className="caption-box"><textarea data-undo-control value={draft.caption} onChange={e => update('caption', e.target.value, { label: 'Editar texto', groupKey: 'post:caption' })} placeholder="Escribe pensando en la persona que lo leerá..." /><span>{draft.caption.length} caracteres</span></div></label>
        <label><span className="label-icon"><Hash size={14} /> Hashtags</span><input data-undo-control value={draft.hashtags.join(' ')} onChange={e => update('hashtags', e.target.value.split(/\s+/).filter(Boolean), { label: 'Editar hashtags', groupKey: 'post:hashtags' })} placeholder="#contenido #campaña" /></label>
        <div className="field-row"><label>Fecha y hora<input data-undo-control type="datetime-local" value={toLocalDateTimeInput(draft.scheduledAt)} onChange={e => { const scheduledAt = fromLocalDateTimeInput(e.target.value); setDraft(current => ({ ...current, scheduledAt, ...(!scheduledAt && current.status === 'scheduled' ? { status: 'approved' as const } : {}) }), { label: !scheduledAt && draft.status === 'scheduled' ? 'Quitar fecha y volver a Aprobado' : 'Cambiar fecha', groupKey: 'post:scheduledAt' }); if (!scheduledAt && draft.status === 'scheduled') setScheduleWarning('Al quitar la fecha, el estado volvió a Aprobado.'); else setScheduleWarning('') }} /><small className="field-hint">La hora se muestra en tu zona horaria. Sin fecha, no se añade al calendario.</small></label><label>Proyecto<input data-undo-control value={draft.project} onChange={e => update('project', e.target.value, { label: 'Editar proyecto', groupKey: 'post:project' })} /></label></div>
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
      {tab === 'ideas' && <EditorIdeaBlocks blocks={draft.ideaBlocks || []} onChange={(blocks, change) => update('ideaBlocks', blocks, change)} />}
      {tab === 'notes' && <EditorNotes items={noteItems} onChange={updateNotes} />}
      {tab === 'assistant' && <EditorAssistantPanel idea={assistantIdea} onIdeaChange={setAssistantIdea} titles={assistantTitles} onTitlesChange={setAssistantTitles} onSelectTitle={title => update('title', title)} master={assistantMaster} onMasterChange={setAssistantMaster} message={assistantMessage} onApply={applyAssistant} onCopyMark={() => void copyObsidianMark()} />}
      {tab === 'preview' && <Preview draft={draft} onMediaChange={media => update('media', media)} onError={message => reportAppError(message, 'Error en medios')} />}
      {tab === 'notes' && <label>Notas internas<textarea data-undo-control className="notes-area" value={draft.notes} onChange={e => update('notes', e.target.value, { label: 'Editar notas', groupKey: 'post:notes' })} placeholder="Instrucciones, observaciones, comentarios del cliente..." /></label>}
      {tab === 'external' && externalRecord && <EditorExternalRecordPanel record={externalRecord} />}
      {tab === 'catalog' && <EditorCatalogPanel categoryId={catalogCategoryId} onCategoryIdChange={setCatalogCategoryId} summary={catalogSummary} onSummaryChange={setCatalogSummary} content={catalogContent} onContentChange={setCatalogContent} useHashtags={catalogUseHashtags} onUseHashtagsChange={setCatalogUseHashtags} sync={catalogSync} endpoint={catalogEndpoint} onEndpointChange={setCatalogEndpoint} createdBy={catalogCreatedBy} onCreatedByChange={setCatalogCreatedBy} token={catalogToken} onTokenChange={setCatalogToken} configured={catalogConfig.configured} kind={catalogKind} onKindChange={setCatalogKind} busy={catalogBusy} message={catalogMessage} onSaveConfig={() => void saveCatalog()} onSync={dryRun => void syncCatalog(dryRun)} preview={catalogPreview} />}
    </div>
    <footer><div className="editor-footer-actions"><button type="button" className="ghost-button" title="Deshacer (Ctrl+Z)" aria-label="Deshacer" disabled={!canUndo} onClick={undoDraft}><Undo2 size={15} /></button><button type="button" className="ghost-button" title="Rehacer (Ctrl+Shift+Z o Ctrl+Y)" aria-label="Rehacer" disabled={!canRedo} onClick={redoDraft}><Redo2 size={15} /></button>{initial && <><button className="danger-button" title="Eliminar" onClick={() => void runWithErrorReporting(async () => { await remove(initial.id); onClose() }, 'No se pudo eliminar la publicación')}><Trash2 size={16} /></button>{initial.isCombined && <button className="ghost-button" onClick={async () => { if (!window.confirm('¿Deshacer esta combinación? La publicación se conserva y las ideas recuperan su estado anterior.')) return; try { await uncombinePost(initial.id); onClose() } catch (error) { reportAppError(error, 'No se pudo deshacer la combinación') } }}>Deshacer combinación</button>}</>}</div><div><button className="ghost-button" onClick={close}>Salir</button><button className="save-button" disabled={!draft.title.trim() || saving} onClick={() => void submitAndClear()}>{saving ? 'Guardando...' : 'Guardar publicación'}</button></div></footer>
  </aside></div>
}

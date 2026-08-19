import { useEffect, useMemo, useState } from 'react'
import { Check, Database, Download, Play, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { usePlanner } from '../../app/store'
import { ViewHeading } from '../../components/layout/AppShell'
import type { ContentRecord, ContentTypeTemplate, ExportProfile, ImportReport, Source, SourceDefinition } from '../../shared/types'
import './sources.css'

type SourceDraft = { name: string; baseUrl: string; method: Source['method']; format: Source['format']; recordsPath: string; bodyTemplate: string; authType: Source['authType']; maxRecords: number; targetProject: string; importMode: Source['importMode']; initialStatus: Source['initialStatus'] }
type MappingSuggestion = { externalRef: string; title: string; sourceKindField: string; hashFields: string[]; contentTypeMap: Record<string, string> }
const emptySource: SourceDraft = { name: '', baseUrl: '', method: 'GET', format: 'json', recordsPath: '', bodyTemplate: '', authType: 'none', maxRecords: 500, targetProject: 'Mi contenido', importMode: 'post', initialStatus: 'idea' }
const emptyDefinition = { externalRef: '', title: '', sourceKindField: '', hashFields: '', contentTypeMapText: '{}', customDefaultsText: '{}' }
const exportFieldOptions = [
  ['Título de publicación', 'post.title'], ['Texto de publicación', 'post.caption'], ['Notas', 'post.notes'], ['Tipo de contenido', 'post.contentType'], ['Estado', 'planning.status'], ['Fecha de planificación', 'planning.date'], ['Proyecto / espacio', 'planning.project'], ['Hashtags', 'post.hashtags'], ['Plataformas', 'post.platforms'], ['Media', 'post.media'], ['Datos de media', 'post.mediaAssets'], ['Ideas agrupadas', 'ideas'], ['Idea 1: título', 'ideas.0.title'], ['Idea 1: texto', 'ideas.0.body'], ['Idea 2: título', 'ideas.1.title'], ['Idea 2: texto', 'ideas.1.body'], ['Referencia externa', 'externalRef'], ['JSON raw', 'raw'],
] as const

function blockRecipeColumns(includeTitle: boolean, includeIntro: boolean, ideaCount: number): ExportProfile['columns'] {
  const columns: ExportProfile['columns'] = []
  if (includeTitle) columns.push({ header: 'Title', source: 'post.title', order: columns.length })
  if (includeIntro) columns.push({ header: 'Texto inicial', source: 'post.caption', order: columns.length })
  for (let index = 0; index < ideaCount; index += 1) {
    columns.push({ header: `Idea ${index + 1}`, source: `ideas.${index}.text`, order: columns.length })
  }
  return columns
}

function parseObject(text: string, label: string): Record<string, string> {
  const value = JSON.parse(text || '{}') as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} debe ser un objeto JSON`)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]))
}

function parseAuth(text: string, authType: Source['authType']): Record<string, string> {
  const raw = text.trim()
  if (authType === 'bearer' && raw && !raw.startsWith('{')) return { token: raw }
  return parseObject(text, 'Autenticacion')
}

function parseRecord(text: string, label: string): Record<string, unknown> {
  const value = JSON.parse(text || '{}') as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} debe ser un objeto JSON`)
  return value as Record<string, unknown>
}

function EnrichmentEditor({ record, template, onSave }: { record: ContentRecord; template: ContentTypeTemplate | undefined; onSave(record: ContentRecord, value: Record<string, unknown>): void }) {
  const [draft, setDraft] = useState<Record<string, unknown>>(record.enriched)
  useEffect(() => setDraft(record.enriched), [record])
  if (!template?.fields.length) return <details className="advanced-enrichment"><summary>Editar JSON avanzado</summary><textarea defaultValue={JSON.stringify(record.enriched, null, 2)} onBlur={event => { try { const value = JSON.parse(event.target.value) as unknown; if (typeof value === 'object' && value && !Array.isArray(value)) onSave(record, value as Record<string, unknown>) } catch { /* The JSON editor preserves its invalid value for correction. */ } }} aria-label={`Enriquecimiento de ${record.externalRef}`} /></details>
  return <div className="enrichment-fields">{template.fields.map(field => <label key={field.key}>{field.label}{field.type === 'textarea' ? <textarea value={String(draft[field.key] || '')} onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} /> : <input value={String(draft[field.key] || '')} onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} />}</label>)}<button className="settings-button" onClick={() => onSave(record, draft)}><Save size={13} /> Guardar</button></div>
}

export function SourcesView() {
  const { load: reloadPlanner } = usePlanner()
  const [sources, setSources] = useState<Source[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sourceDraft, setSourceDraft] = useState(emptySource)
  const [headersText, setHeadersText] = useState('{}')
  const [authText, setAuthText] = useState('{}')
  const [definition, setDefinition] = useState<SourceDefinition | null>(null)
  const [definitionDraft, setDefinitionDraft] = useState(emptyDefinition)
  const [preview, setPreview] = useState<{ previewId: string; truncated: boolean; records: Record<string, unknown>[]; report: { summary: ImportReport } } | null>(null)
  const [contentRecords, setContentRecords] = useState<ContentRecord[]>([])
  const [templates, setTemplates] = useState<ContentTypeTemplate[]>([])
  const [templateType, setTemplateType] = useState('post')
  const [templateFieldsText, setTemplateFieldsText] = useState('[{"key":"text1","label":"Copy corto","type":"text"}]')
  const [profiles, setProfiles] = useState<ExportProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [profileName, setProfileName] = useState('Export CSV')
  const [profileColumnsText, setProfileColumnsText] = useState(() => JSON.stringify(blockRecipeColumns(true, true, 8), null, 2))
  const [selectedExportField, setSelectedExportField] = useState('post.caption')
  const [deltaOnly, setDeltaOnly] = useState(true)
  const [exportScope, setExportScope] = useState<'all' | 'source'>('all')
  const [exportProject, setExportProject] = useState('')
  const [exportStatus, setExportStatus] = useState<'all' | 'idea' | 'draft' | 'review' | 'approved' | 'scheduled' | 'published' | 'archived'>('all')
  const [includeTitle, setIncludeTitle] = useState(true)
  const [includeIntro, setIncludeIntro] = useState(true)
  const [ideaColumns, setIdeaColumns] = useState(8)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'pending' | 'success' | 'error'>('success')
  const [connectionSample, setConnectionSample] = useState('')
  const [requestDetails, setRequestDetails] = useState('')
  const [mappingSuggestion, setMappingSuggestion] = useState<MappingSuggestion | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = sources.find(source => source.id === selectedId) || null

  const loadSources = async () => setSources(await window.planner.sources.list())
  const loadConfiguration = async () => {
    const [nextTemplates, nextProfiles] = await Promise.all([window.planner.contentTypeTemplates.list(), window.planner.exportProfiles.list()])
    setTemplates(nextTemplates); setProfiles(nextProfiles); if (!selectedProfileId && nextProfiles[0]) setSelectedProfileId(nextProfiles[0].id)
  }
  useEffect(() => { void loadSources() }, [])
  useEffect(() => { void loadConfiguration() }, [])
  useEffect(() => {
    const profile = profiles.find(item => item.id === selectedProfileId)
    if (!profile) return
    setProfileName(profile.name)
    setProfileColumnsText(JSON.stringify(profile.columns, null, 2))
  }, [profiles, selectedProfileId])
  useEffect(() => {
    if (!selected) return
    setSourceDraft({ name: selected.name, baseUrl: selected.baseUrl, method: selected.method, format: selected.format, recordsPath: selected.recordsPath || '', bodyTemplate: selected.bodyTemplate || '', authType: selected.authType, maxRecords: selected.maxRecords, targetProject: selected.targetProject, importMode: selected.importMode, initialStatus: selected.initialStatus })
    void Promise.all([window.planner.sourceDefinitions.list(selected.id), window.planner.contentRecords.list(selected.id)]).then(([items, records]) => {
      const next = items[0] || null; setDefinition(next)
      setContentRecords(records)
      if (next) setDefinitionDraft({ externalRef: next.fieldMap.externalRef, title: next.fieldMap.title, sourceKindField: next.fieldMap.sourceKindField, hashFields: (next.fieldMap.hashFields || []).join(', '), contentTypeMapText: JSON.stringify(next.contentTypeMap, null, 2), customDefaultsText: JSON.stringify(next.customFieldDefaults, null, 2) })
    })
  }, [selectedId])

  const createSource = () => { setSelectedId(null); setSourceDraft(emptySource); setHeadersText('{}'); setAuthText('{}'); setDefinition(null); setContentRecords([]); setPreview(null); setMessage(''); setConnectionSample(''); setRequestDetails(''); setMappingSuggestion(null) }
  const saveSource = async () => {
    setBusy(true); setMessage('')
    try {
      const saved = await window.planner.sources.save({ ...sourceDraft, id: selectedId || undefined, headers: parseObject(headersText, 'Headers'), authConfig: parseAuth(authText, sourceDraft.authType) })
      await loadSources(); setSelectedId(saved.id); setMessage('Fuente guardada')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar la fuente') } finally { setBusy(false) }
  }
  const applyDestination = async () => {
    if (!selectedId) return
    setBusy(true); setMessageTone('pending')
    try {
      const saved = await window.planner.sources.save({ ...sourceDraft, id: selectedId, headers: parseObject(headersText, 'Headers'), authConfig: parseAuth(authText, sourceDraft.authType) })
      await loadSources()
      const result = await window.planner.sources.applyDestination(saved.id)
      await reloadPlanner()
      setContentRecords(await window.planner.contentRecords.list(saved.id))
      setMessageTone('success')
      setMessage(`Destino aplicado en ${sourceDraft.targetProject}: ${result.postsMoved} publicaciones movidas, ${result.postsCreated} creadas, ${result.ideasMoved} ideas movidas y ${result.ideasCreated} creadas`)
    } catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : 'No se pudo aplicar el destino') } finally { setBusy(false) }
  }
  const testSource = async () => {
    setBusy(true); setMessageTone('pending'); setMessage('Probando conexion...'); setConnectionSample(''); setRequestDetails('')
    try {
      const result = await window.planner.sources.test({ ...sourceDraft, headers: parseObject(headersText, 'Headers'), authConfig: parseAuth(authText, sourceDraft.authType) })
      setConnectionSample(result.sample); setRequestDetails(result.requestDetails); setMappingSuggestion(result.suggestion)
      if (result.suggestion && !definition) setDefinitionDraft({ externalRef: result.suggestion.externalRef, title: result.suggestion.title, sourceKindField: result.suggestion.sourceKindField, hashFields: result.suggestion.hashFields.join(', '), contentTypeMapText: JSON.stringify(result.suggestion.contentTypeMap, null, 2), customDefaultsText: '{}' })
      setMessageTone(result.parseWarning ? 'error' : 'success')
      setMessage(result.parseWarning ? `Conexion correcta, pero no se pudo interpretar la respuesta: ${result.parseWarning}` : `Conexion correcta Â· HTTP ${result.status} Â· ${result.recordCount} registros detectados`)
      setMessageTone('success'); setMessage(`Conexion correcta · HTTP ${result.status} · ${result.bytes} bytes · ${result.contentType}`)
      if (result.parseWarning) { setMessageTone('error'); setMessage(`Conexion correcta, pero no se pudo interpretar la respuesta: ${result.parseWarning}`) }
      if (!result.parseWarning && result.recordCount > 0 && window.confirm('La conexion funciono. ¿Quieres guardar esta configuracion para reutilizarla en la proxima sincronizacion?')) {
        const saved = await window.planner.sources.save({ ...sourceDraft, id: selectedId || undefined, headers: parseObject(headersText, 'Headers'), authConfig: parseAuth(authText, sourceDraft.authType) })
        await loadSources(); setSelectedId(saved.id); setMessage('Conexion correcta y configuracion guardada')
      }
    } catch (error) {
      setMessageTone('error'); setMessage(error instanceof Error ? error.message : 'La conexion fallo')
    } finally { setBusy(false) }
  }
  const saveDefinition = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      const saved = await window.planner.sourceDefinitions.save({ id: definition?.id, sourceId: selectedId, fieldMap: { externalRef: definitionDraft.externalRef, title: definitionDraft.title, sourceKindField: definitionDraft.sourceKindField }, hashFields: definitionDraft.hashFields.split(',').map(item => item.trim()).filter(Boolean), contentTypeMap: parseObject(definitionDraft.contentTypeMapText, 'Mapa de tipos'), customFieldDefaults: parseRecord(definitionDraft.customDefaultsText, 'Valores iniciales') })
      setDefinition(saved); setMessage('Mapeo guardado')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar el mapeo') } finally { setBusy(false) }
  }
  const runPreview = async () => {
    if (!selectedId || !definition) return
    setBusy(true); setMessage('Consultando fuente...')
    try { setPreview(await window.planner.imports.preview(selectedId, definition.id)); setMessage('Preview listo') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo importar') } finally { setBusy(false) }
  }
  const confirmImport = async () => {
    if (!preview) return
    setBusy(true)
    try { const report = await window.planner.imports.confirm(preview.previewId); await reloadPlanner(); setContentRecords(selectedId ? await window.planner.contentRecords.list(selectedId) : []); setMessage(`Importacion confirmada: ${report.new} nuevos, ${report.updated} actualizados y ${report.unchanged} revisados en ${sourceDraft.targetProject}`); setPreview(null) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo confirmar') } finally { setBusy(false) }
  }
  const saveEnriched = async (record: ContentRecord, value: Record<string, unknown> | string) => {
    try {
      const enriched = typeof value === 'string' ? JSON.parse(value) as unknown : value
      if (typeof enriched !== 'object' || enriched === null || Array.isArray(enriched)) throw new Error('El enriquecimiento debe ser un objeto JSON')
      const saved = await window.planner.contentRecords.saveEnriched({ id: record.id, enriched: enriched as Record<string, unknown> })
      setContentRecords(current => current.map(item => item.id === saved.id ? saved : item)); setMessage('Enriquecimiento guardado')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar el enriquecimiento') }
  }
  const saveTemplate = async () => {
    try {
      const fields = JSON.parse(templateFieldsText) as unknown
      if (!Array.isArray(fields)) throw new Error('Los campos deben ser un array JSON')
      const saved = await window.planner.contentTypeTemplates.save({ contentType: templateType, fields: fields as ContentTypeTemplate['fields'] })
      setTemplates(current => [...current.filter(item => item.id !== saved.id && item.contentType !== saved.contentType), saved]); setMessage('Plantilla guardada')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar la plantilla') }
  }
  const saveProfile = async () => {
    try {
      const columns = JSON.parse(profileColumnsText) as unknown
      if (!Array.isArray(columns)) throw new Error('Las columnas deben ser un array JSON')
      const saved = await window.planner.exportProfiles.save({ id: selectedProfileId || undefined, name: profileName, appliesToContentType: 'all', columns: columns as ExportProfile['columns'] })
      setProfiles(current => [...current.filter(item => item.id !== saved.id), saved]); setSelectedProfileId(saved.id); setMessage('Perfil de exportacion guardado')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar el perfil') }
  }
  const applyBlockRecipe = () => {
    const count = Math.max(0, Math.min(30, Math.trunc(ideaColumns) || 0))
    if (!includeTitle && !includeIntro && count === 0) { setMessage('Elige al menos un campo para exportar'); return }
    setIdeaColumns(count)
    setProfileColumnsText(JSON.stringify(blockRecipeColumns(includeTitle, includeIntro, count), null, 2))
    setMessage('Receta aplicada. Guarda el perfil para reutilizarla.')
  }
  const addExportField = () => {
    try {
      const columns = JSON.parse(profileColumnsText) as unknown
      if (!Array.isArray(columns)) throw new Error('Las columnas deben ser un array JSON')
      const option = exportFieldOptions.find(([, source]) => source === selectedExportField)
      if (!option || columns.some(column => typeof column === 'object' && column !== null && (column as { source?: unknown }).source === option[1])) return
      const nextOrder = columns.length
      setProfileColumnsText(JSON.stringify([...columns, { header: option[0], source: option[1], order: nextOrder }], null, 2))
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo agregar el campo') }
  }
  const downloadCsv = async () => {
    if (!selectedProfileId) return
    try {
      const result = await window.planner.exports.csv(exportScope === 'source' ? selectedId : null, selectedProfileId, deltaOnly, exportProject.trim() || undefined, exportStatus === 'all' ? undefined : exportStatus)
      const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a')
      link.href = url; link.download = result.filename; link.click(); URL.revokeObjectURL(url); setMessage(`CSV exportado: ${result.count} filas${result.delta ? ` de ${result.total} con cambios` : ''}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo exportar el CSV') }
  }
  const columns = useMemo(() => Array.from(new Set(preview?.records.flatMap(record => Object.keys(record)) || [])).slice(0, 8), [preview])

  return <section className="workspace sources-workspace">
    <ViewHeading title="Fuentes externas" subtitle="Consulta datos externos, mapealos y traelos al planner."><button className="new-button" onClick={createSource}><Plus size={16} /> Nueva fuente</button><button className="icon-button" title="Actualizar fuentes" onClick={() => void loadSources()}><RefreshCw size={16} /></button></ViewHeading>
    <div className="sources-layout">
      <aside className="sources-list"><span className="sources-label">FUENTES CONFIGURADAS</span>{sources.map(source => <button key={source.id} className={selectedId === source.id ? 'source-item active' : 'source-item'} onClick={() => setSelectedId(source.id)}><Database size={15} /><span><strong>{source.name}</strong><small>{source.method} · {source.format}</small></span></button>)}{!sources.length && <p className="sources-empty">Todavia no hay fuentes.</p>}</aside>
      <div className="source-editor">
        <section className="source-panel"><header><div><span>CONEXION</span><h2>{selected ? selected.name : 'Nueva fuente'}</h2>{selected && <small className="source-config-status">Configuracion guardada · {selected.method} · {selected.format} · {selected.authType === 'none' ? 'sin autenticacion' : selected.authType}{selected.hasStoredHeaders ? ' · headers protegidos' : ''}{selected.hasStoredAuth ? ' · credenciales protegidas' : ''}</small>}</div>{selected && <button className="icon-button" title="Eliminar fuente" onClick={async () => { if (window.confirm('Eliminar esta fuente y sus registros importados?')) { await window.planner.sources.remove(selected.id); createSource(); await loadSources() } }}><Trash2 size={16} /></button>}</header>
          <div className="source-grid"><label>Nombre<input value={sourceDraft.name} onChange={event => setSourceDraft({ ...sourceDraft, name: event.target.value })} placeholder="Resource API" /></label><label>URL<input value={sourceDraft.baseUrl} onChange={event => setSourceDraft({ ...sourceDraft, baseUrl: event.target.value })} placeholder="https://..." /></label><label>Metodo<select value={sourceDraft.method} onChange={event => setSourceDraft({ ...sourceDraft, method: event.target.value as 'GET' | 'POST' })}><option>GET</option><option>POST</option></select></label><label>Formato<select value={sourceDraft.format} onChange={event => setSourceDraft({ ...sourceDraft, format: event.target.value as 'json' | 'ndjson' | 'csv' })}><option value="json">JSON</option><option value="ndjson">NDJSON</option><option value="csv">CSV</option></select></label><label>Autenticacion<select value={sourceDraft.authType} onChange={event => setSourceDraft({ ...sourceDraft, authType: event.target.value as Source['authType'] })}><option value="none">Ninguna</option><option value="bearer">Bearer token</option><option value="apiKey">API key</option><option value="basic">Basic</option></select></label><label>Ruta de registros<input value={sourceDraft.recordsPath} onChange={event => setSourceDraft({ ...sourceDraft, recordsPath: event.target.value })} placeholder="data.items (opcional)" /></label><label>Maximo de registros<input type="number" min="1" max="10000" value={sourceDraft.maxRecords} onChange={event => setSourceDraft({ ...sourceDraft, maxRecords: Number(event.target.value) })} /></label></div>
          <div className="source-grid"><label>Proyecto / espacio destino<input value={sourceDraft.targetProject} onChange={event => setSourceDraft({ ...sourceDraft, targetProject: event.target.value })} placeholder="Mi contenido" /></label><label>Destino<select value={sourceDraft.importMode} onChange={event => setSourceDraft({ ...sourceDraft, importMode: event.target.value as Source['importMode'] })}><option value="post">Publicaciones</option><option value="idea">Ideas</option><option value="both">Publicaciones e ideas</option></select></label><label>Estado inicial<select value={sourceDraft.initialStatus} onChange={event => setSourceDraft({ ...sourceDraft, initialStatus: event.target.value as Source['initialStatus'] })}><option value="idea">Idea</option><option value="draft">Borrador</option><option value="review">Revision</option><option value="approved">Aprobado</option></select></label></div>
          <div className="source-grid"><label>Headers JSON<textarea value={headersText} onChange={event => setHeadersText(event.target.value)} placeholder={'{"Authorization":"Bearer ..."}'} /></label><label>Auth JSON<textarea value={authText} onChange={event => setAuthText(event.target.value)} placeholder={'{"token":"..."} o token directo'} /></label></div><label>Body JSON para POST<textarea value={sourceDraft.bodyTemplate} onChange={event => setSourceDraft({ ...sourceDraft, bodyTemplate: event.target.value })} placeholder="{ }" /></label>
          <div className="source-actions"><button className="settings-button" disabled={busy} onClick={() => void testSource()}><Play size={15} /> Probar conexion</button><button className="save-button" disabled={busy || !sourceDraft.name || !sourceDraft.baseUrl} onClick={() => void saveSource()}><Save size={15} /> Guardar fuente</button>{selectedId && <button className="settings-button" disabled={busy || !sourceDraft.targetProject.trim()} onClick={() => void applyDestination()}><RefreshCw size={15} /> Aplicar destino a registros</button>}</div>
          {message && <p role="status" className={`source-message ${messageTone}`}>{message}</p>}
          {requestDetails && <pre className="source-request-details">Peticion efectiva:{'\n'}{requestDetails}</pre>}
          {connectionSample && <pre className="source-response-preview">{connectionSample}</pre>}
          {mappingSuggestion && <p className="source-suggestion">Sugerencia detectada: <b>{mappingSuggestion.externalRef}</b> como referencia, <b>{mappingSuggestion.title}</b> como titulo{mappingSuggestion.sourceKindField ? ` y ${mappingSuggestion.sourceKindField} como tipo` : ''}. El mapeo se completo en el formulario inferior; revisalo antes de guardarlo.</p>}
        </section>
        {selectedId && <section className="source-panel"><header><div><span>MAPEO REUTILIZABLE</span><h2>{definition ? 'Definicion activa' : 'Configura el primer mapeo'}</h2></div></header><div className="source-grid"><label>External ref<input value={definitionDraft.externalRef} onChange={event => setDefinitionDraft({ ...definitionDraft, externalRef: event.target.value })} placeholder="id" /></label><label>Titulo<input value={definitionDraft.title} onChange={event => setDefinitionDraft({ ...definitionDraft, title: event.target.value })} placeholder="title" /></label><label>Tipo de fuente<input value={definitionDraft.sourceKindField} onChange={event => setDefinitionDraft({ ...definitionDraft, sourceKindField: event.target.value })} placeholder="kind" /></label><label>Campos para hash<input value={definitionDraft.hashFields} onChange={event => setDefinitionDraft({ ...definitionDraft, hashFields: event.target.value })} placeholder="title, url" /></label></div><div className="source-actions"><button className="save-button" disabled={busy || !definitionDraft.externalRef || !definitionDraft.title} onClick={() => void saveDefinition()}><Save size={15} /> Guardar mapeo</button>{definition && <button className="settings-button" disabled={busy} onClick={() => void runPreview()}><Play size={15} /> Preview de importacion</button>}</div></section>}
        {selectedId && <section className="source-panel"><header><div><span>REGLAS DE CONTENIDO</span><h2>Tipos y valores iniciales</h2></div></header><div className="source-grid"><label>Mapa de tipos JSON<textarea value={definitionDraft.contentTypeMapText} onChange={event => setDefinitionDraft({ ...definitionDraft, contentTypeMapText: event.target.value })} placeholder={'{"resource":"post"}'} /></label><label>Valores iniciales JSON<textarea value={definitionDraft.customDefaultsText} onChange={event => setDefinitionDraft({ ...definitionDraft, customDefaultsText: event.target.value })} placeholder={'{"text1":""}'} /></label></div><div className="source-actions"><button className="save-button" disabled={busy || !definitionDraft.externalRef || !definitionDraft.title} onClick={() => void saveDefinition()}><Save size={15} /> Guardar reglas</button></div></section>}
        {preview && <section className="source-panel import-preview"><header><div><span>PREVIEW</span><h2>{preview.report.summary.total} registros recibidos</h2></div><button className="save-button" disabled={busy || preview.report.summary.total === 0} onClick={() => void confirmImport()}><Check size={15} /> Confirmar sincronizacion</button></header><div className="import-summary"><b>{preview.report.summary.new} nuevos</b><b>{preview.report.summary.updated} actualizados</b><b>{preview.report.summary.unchanged} sin cambios</b><b>{preview.report.summary.invalid} invalidos</b></div>{(preview.truncated || preview.report.summary.total === 0 || preview.report.summary.unchanged === preview.report.summary.total) && <p className="source-warning">{preview.truncated ? 'La respuesta supero el limite configurado y fue recortada.' : preview.report.summary.total === 0 ? 'La fuente devolvio cero registros. No se aplicaron cambios.' : 'No hay cambios en los datos, pero puedes confirmar para actualizar la ultima sincronizacion y completar destinos faltantes.'}</p>}<div className="preview-table-wrap"><table><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.records.map((record, index) => <tr key={index}>{columns.map(column => <td key={column}>{String(record[column] ?? '')}</td>)}</tr>)}</tbody></table></div></section>}
        {contentRecords.length > 0 && <section className="source-panel"><header><div><span>CAMPOS EXTRA</span><h2>{contentRecords.length} registros importados</h2></div></header><p className="export-copy">Usa estos campos solo para metadatos internos. El titulo, texto e ideas agrupadas se editan directamente en cada publicacion y se exportan con el guion por bloques.</p><div className="content-record-list">{contentRecords.map(record => <article key={record.id}><div><strong>{record.normalized.title ? String(record.normalized.title) : record.externalRef}</strong><small>{record.externalRef} · {record.titleManuallyEdited ? 'titulo protegido' : 'titulo sincronizable'}</small><small>{record.postId ? 'publicacion vinculada al tablero' : 'sin publicacion vinculada'} · {record.ideaId ? 'idea vinculada' : 'sin idea vinculada'}</small></div><EnrichmentEditor record={record} template={undefined} onSave={saveEnriched} /></article>)}</div></section>}
        {contentRecords.length > 0 && <section className="source-panel"><header><div><span>DATOS RECIBIDOS</span><h2>Originales y normalizados</h2></div></header><div className="source-data-list">{contentRecords.map(record => <details className="source-data" key={record.id}><summary>{record.normalized.title ? String(record.normalized.title) : record.externalRef}</summary><pre>{JSON.stringify({ original: record.raw, normalizado: record.normalized }, null, 2)}</pre></details>)}</div></section>}
        {contentRecords.some(record => templates.some(template => template.contentType === String(record.normalized.contentType || 'post'))) && <section className="source-panel"><header><div><span>FORMULARIOS DE PLANTILLA</span><h2>Campos por tipo de contenido</h2></div></header><div className="content-record-list">{contentRecords.map(record => { const template = templates.find(item => item.contentType === String(record.normalized.contentType || 'post')); return template ? <article key={record.id}><div><strong>{record.normalized.title ? String(record.normalized.title) : record.externalRef}</strong><small>{template.contentType}</small></div><EnrichmentEditor record={record} template={template} onSave={saveEnriched} /></article> : null })}</div></section>}
        <section className="source-panel configuration-panel"><header><div><span>PLANTILLAS</span><h2>Campos de enriquecimiento</h2></div></header><div className="source-grid"><label>Tipo de contenido<input value={templateType} onChange={event => setTemplateType(event.target.value)} placeholder="post" /></label><label>Campos JSON<textarea value={templateFieldsText} onChange={event => setTemplateFieldsText(event.target.value)} /></label></div><div className="source-actions"><button className="save-button" onClick={() => void saveTemplate()}><Save size={15} /> Guardar plantilla</button></div></section>
        <section className="source-panel configuration-panel"><header><div><span>EXPORTACION CSV</span><h2>Guion por bloques</h2></div>{profiles.length > 0 && <select value={selectedProfileId} onChange={event => setSelectedProfileId(event.target.value)}>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>}</header><p className="export-copy">Una fila por publicacion: titulo, texto inicial y los textos de sus ideas agrupadas en el orden del editor.</p><div className="export-recipe"><label className="export-check"><input type="checkbox" checked={includeTitle} onChange={event => setIncludeTitle(event.target.checked)} /> Titulo</label><label className="export-check"><input type="checkbox" checked={includeIntro} onChange={event => setIncludeIntro(event.target.checked)} /> Texto inicial</label><label>Columnas de ideas<input type="number" min="0" max="30" value={ideaColumns} onChange={event => setIdeaColumns(Number(event.target.value))} /></label><button type="button" className="settings-button" onClick={applyBlockRecipe}><RefreshCw size={14} /> Aplicar receta</button></div><div className="source-grid"><label>Nombre del perfil<input value={profileName} onChange={event => setProfileName(event.target.value)} /></label><label>Agregar campo adicional<select value={selectedExportField} onChange={event => setSelectedExportField(event.target.value)}>{exportFieldOptions.map(([label, source]) => <option value={source} key={source}>{label}</option>)}</select><button type="button" className="settings-button" onClick={addExportField}><Plus size={14} /> Agregar campo</button></label></div><details className="export-advanced"><summary>Columnas avanzadas</summary><textarea value={profileColumnsText} onChange={event => setProfileColumnsText(event.target.value)} /></details><div className="source-actions"><button className="save-button" onClick={() => void saveProfile()}><Save size={15} /> Guardar perfil</button><label className="export-mode"><span>Alcance</span><select value={exportScope} onChange={event => setExportScope(event.target.value as 'all' | 'source')}><option value="all">Todo el planner</option><option value="source" disabled={!selectedId}>Fuente actual</option></select></label><label className="export-mode"><span>Proyecto / espacio</span><input value={exportProject} onChange={event => setExportProject(event.target.value)} placeholder="Todos" /></label><label className="export-mode"><span>Estado</span><select value={exportStatus} onChange={event => setExportStatus(event.target.value as typeof exportStatus)}><option value="all">Todos</option><option value="idea">Ideas</option><option value="draft">Borradores</option><option value="review">En revision</option><option value="approved">Aprobados</option><option value="scheduled">Programados</option><option value="published">Publicados</option><option value="archived">Archivados</option></select></label><label className="export-mode"><input type="checkbox" checked={deltaOnly} onChange={event => setDeltaOnly(event.target.checked)} /> Solo nuevos o modificados</label><button className="settings-button" disabled={!selectedProfileId} onClick={() => void downloadCsv()}><Download size={15} /> Descargar CSV</button></div></section>
      </div>
    </div>
  </section>
}

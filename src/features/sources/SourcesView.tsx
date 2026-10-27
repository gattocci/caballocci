import { useEffect, useState } from 'react'
import { Database, Plus, RefreshCw, Save } from 'lucide-react'
import { usePlanner } from '../../app/store'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { ViewHeading } from '../../components/layout/AppShell'
import type { ContentRecord, ContentTypeTemplate, ExportProfile, ImportReport, Source, SourceDefinition } from '../../shared/types'
import { SourceExportPanel, exportFieldOptions } from './SourceExportPanel'
import { SourceImportPreview } from './SourceImportPreview'
import { SourceDefinitionPanel } from './SourceDefinitionPanel'
import { ImportedSourceRecords } from './ImportedSourceRecords'
import { SourceConnectionPanel, type MappingSuggestion, type SourceDraft } from './SourceConnectionPanel'
import { blockRecipeColumns, parseAuth, parseObject, parseRecord } from './source-utils'
import './sources.css'

const emptySource: SourceDraft = { name: '', baseUrl: '', method: 'GET', format: 'json', recordsPath: '', bodyTemplate: '', authType: 'none', maxRecords: 500, targetProject: 'Mi contenido', importMode: 'post', initialStatus: 'idea' }
const emptyDefinition = { externalRef: '', title: '', sourceKindField: '', hashFields: '', contentTypeMapText: '{}', customDefaultsText: '{}' }

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
  useEffect(() => { void loadSources().catch(error => reportAppError(error, 'No se pudieron cargar las fuentes')) }, [])
  useEffect(() => { void loadConfiguration().catch(error => reportAppError(error, 'No se pudo cargar la configuración de fuentes')) }, [])
  useEffect(() => {
    const profile = profiles.find(item => item.id === selectedProfileId)
    if (!profile) return
    setProfileName(profile.name)
    setProfileColumnsText(JSON.stringify(profile.columns, null, 2))
  }, [profiles, selectedProfileId])
  useEffect(() => {
    if (!selected) return
    let active = true
    setDefinition(null)
    setDefinitionDraft(emptyDefinition)
    setContentRecords([])
    setPreview(null)
    setMessage('')
    setSourceDraft({ name: selected.name, baseUrl: selected.baseUrl, method: selected.method, format: selected.format, recordsPath: selected.recordsPath || '', bodyTemplate: selected.bodyTemplate || '', authType: selected.authType, maxRecords: selected.maxRecords, targetProject: selected.targetProject, importMode: selected.importMode, initialStatus: selected.initialStatus })
    void Promise.all([window.planner.sourceDefinitions.list(selected.id), window.planner.contentRecords.list(selected.id)]).then(([items, records]) => {
      if (!active) return
      const next = items[0] || null; setDefinition(next)
      setContentRecords(records)
      if (next) setDefinitionDraft({ externalRef: next.fieldMap.externalRef, title: next.fieldMap.title, sourceKindField: next.fieldMap.sourceKindField, hashFields: (next.fieldMap.hashFields || []).join(', '), contentTypeMapText: JSON.stringify(next.contentTypeMap, null, 2), customDefaultsText: JSON.stringify(next.customFieldDefaults, null, 2) })
    }).catch(error => { if (active) { reportAppError(error, 'No se pudo cargar la configuración de la fuente'); setMessageTone('error'); setMessage(error instanceof Error ? error.message : 'No se pudo cargar la fuente') } })
    return () => { active = false }
  }, [selectedId])

  const createSource = () => { setSelectedId(null); setSourceDraft(emptySource); setHeadersText('{}'); setAuthText('{}'); setDefinition(null); setContentRecords([]); setPreview(null); setMessage(''); setConnectionSample(''); setRequestDetails(''); setMappingSuggestion(null) }
  const saveSource = async () => {
    setBusy(true); setMessage('')
    try {
      const saved = await window.planner.sources.save({ ...sourceDraft, id: selectedId || undefined, headers: parseObject(headersText, 'Headers'), authConfig: parseAuth(authText, sourceDraft.authType) })
      await loadSources(); setSelectedId(saved.id); setMessage('Fuente guardada')
    } catch (error) { reportAppError(error, 'No se pudo guardar la fuente'); setMessage(error instanceof Error ? error.message : 'No se pudo guardar la fuente') } finally { setBusy(false) }
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
    } catch (error) { reportAppError(error, 'No se pudo aplicar el destino'); setMessageTone('error'); setMessage(error instanceof Error ? error.message : 'No se pudo aplicar el destino') } finally { setBusy(false) }
  }
  const testSource = async () => {
    setBusy(true); setMessageTone('pending'); setMessage('Probando conexion...'); setConnectionSample(''); setRequestDetails('')
    try {
      const result = await window.planner.sources.test({ ...sourceDraft, headers: parseObject(headersText, 'Headers'), authConfig: parseAuth(authText, sourceDraft.authType) })
      setConnectionSample(result.sample); setRequestDetails(result.requestDetails); setMappingSuggestion(result.suggestion)
      if (result.suggestion && !definition) setDefinitionDraft({ externalRef: result.suggestion.externalRef, title: result.suggestion.title, sourceKindField: result.suggestion.sourceKindField, hashFields: result.suggestion.hashFields.join(', '), contentTypeMapText: JSON.stringify(result.suggestion.contentTypeMap, null, 2), customDefaultsText: '{}' })
      setMessageTone(result.parseWarning ? 'error' : 'success')
      setMessage(result.parseWarning ? `Conexion correcta, pero no se pudo interpretar la respuesta: ${result.parseWarning}` : `Conexion correcta · HTTP ${result.status} · ${result.recordCount} registros detectados`)
      setMessageTone('success'); setMessage(`Conexion correcta · HTTP ${result.status} · ${result.bytes} bytes · ${result.contentType}`)
      if (result.parseWarning) { setMessageTone('error'); setMessage(`Conexion correcta, pero no se pudo interpretar la respuesta: ${result.parseWarning}`) }
      if (!result.parseWarning && result.recordCount > 0 && window.confirm('La conexion funciono. ¿Quieres guardar esta configuracion para reutilizarla en la proxima sincronizacion?')) {
        const saved = await window.planner.sources.save({ ...sourceDraft, id: selectedId || undefined, headers: parseObject(headersText, 'Headers'), authConfig: parseAuth(authText, sourceDraft.authType) })
        await loadSources(); setSelectedId(saved.id); setMessage('Conexion correcta y configuracion guardada')
      }
    } catch (error) {
      reportAppError(error, 'Falló la conexión con la fuente')
      setMessageTone('error'); setMessage(error instanceof Error ? error.message : 'La conexion fallo')
    } finally { setBusy(false) }
  }
  const saveDefinition = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      const saved = await window.planner.sourceDefinitions.save({ id: definition?.id, sourceId: selectedId, fieldMap: { externalRef: definitionDraft.externalRef, title: definitionDraft.title, sourceKindField: definitionDraft.sourceKindField }, hashFields: definitionDraft.hashFields.split(',').map(item => item.trim()).filter(Boolean), contentTypeMap: parseObject(definitionDraft.contentTypeMapText, 'Mapa de tipos'), customFieldDefaults: parseRecord(definitionDraft.customDefaultsText, 'Valores iniciales') })
      setDefinition(saved); setMessage('Mapeo guardado')
    } catch (error) { reportAppError(error, 'No se pudo guardar el mapeo'); setMessage(error instanceof Error ? error.message : 'No se pudo guardar el mapeo') } finally { setBusy(false) }
  }
  const runPreview = async () => {
    if (!selectedId || !definition) return
    setBusy(true); setMessage('Consultando fuente...')
    try { setPreview(await window.planner.imports.preview(selectedId, definition.id)); setMessage('Preview listo') }
    catch (error) { reportAppError(error, 'No se pudo preparar la importación'); setMessage(error instanceof Error ? error.message : 'No se pudo importar') } finally { setBusy(false) }
  }
  const confirmImport = async () => {
    if (!preview) return
    setBusy(true)
    try { const report = await window.planner.imports.confirm(preview.previewId); await reloadPlanner(); setContentRecords(selectedId ? await window.planner.contentRecords.list(selectedId) : []); setMessage(`Importacion confirmada: ${report.new} nuevos, ${report.updated} actualizados y ${report.unchanged} revisados en ${sourceDraft.targetProject}`); setPreview(null) }
    catch (error) { reportAppError(error, 'No se pudo confirmar la importación'); setMessage(error instanceof Error ? error.message : 'No se pudo confirmar') } finally { setBusy(false) }
  }
  const saveEnriched = async (record: ContentRecord, value: Record<string, unknown> | string) => {
    try {
      const enriched = typeof value === 'string' ? JSON.parse(value) as unknown : value
      if (typeof enriched !== 'object' || enriched === null || Array.isArray(enriched)) throw new Error('El enriquecimiento debe ser un objeto JSON')
      const saved = await window.planner.contentRecords.saveEnriched({ id: record.id, enriched: enriched as Record<string, unknown> })
      setContentRecords(current => current.map(item => item.id === saved.id ? saved : item)); setMessage('Enriquecimiento guardado')
    } catch (error) { reportAppError(error, 'No se pudo guardar el enriquecimiento'); setMessage(error instanceof Error ? error.message : 'No se pudo guardar el enriquecimiento') }
  }
  const saveTemplate = async () => {
    try {
      const fields = JSON.parse(templateFieldsText) as unknown
      if (!Array.isArray(fields)) throw new Error('Los campos deben ser un array JSON')
      const saved = await window.planner.contentTypeTemplates.save({ contentType: templateType, fields: fields as ContentTypeTemplate['fields'] })
      setTemplates(current => [...current.filter(item => item.id !== saved.id && item.contentType !== saved.contentType), saved]); setMessage('Plantilla guardada')
    } catch (error) { reportAppError(error, 'No se pudo guardar la plantilla'); setMessage(error instanceof Error ? error.message : 'No se pudo guardar la plantilla') }
  }
  const saveProfile = async () => {
    try {
      const columns = JSON.parse(profileColumnsText) as unknown
      if (!Array.isArray(columns)) throw new Error('Las columnas deben ser un array JSON')
      const saved = await window.planner.exportProfiles.save({ id: selectedProfileId || undefined, name: profileName, appliesToContentType: 'all', columns: columns as ExportProfile['columns'] })
      setProfiles(current => [...current.filter(item => item.id !== saved.id), saved]); setSelectedProfileId(saved.id); setMessage('Perfil de exportacion guardado')
    } catch (error) { reportAppError(error, 'No se pudo guardar el perfil'); setMessage(error instanceof Error ? error.message : 'No se pudo guardar el perfil') }
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
    } catch (error) { reportAppError(error, 'No se pudo agregar el campo de exportación'); setMessage(error instanceof Error ? error.message : 'No se pudo agregar el campo') }
  }
  const downloadCsv = async () => {
    if (!selectedProfileId) return
    try {
      const result = await window.planner.exports.csv(exportScope === 'source' ? selectedId : null, selectedProfileId, deltaOnly, exportProject.trim() || undefined, exportStatus === 'all' ? undefined : exportStatus)
      const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a')
      link.href = url; link.download = result.filename; link.click(); URL.revokeObjectURL(url); setMessage(`CSV exportado: ${result.count} filas${result.delta ? ` de ${result.total} con cambios` : ''}`)
    } catch (error) { reportAppError(error, 'No se pudo exportar el CSV'); setMessage(error instanceof Error ? error.message : 'No se pudo exportar el CSV') }
  }
  return <section className="workspace sources-workspace">
    <ViewHeading title="Fuentes externas" subtitle="Consulta datos externos, mapéalos y tráelos al planificador."><button type="button" className="new-button" onClick={createSource}><Plus size={16} /> Nueva fuente</button><button type="button" className="icon-button" aria-label="Actualizar fuentes" title="Actualizar fuentes" onClick={() => void runWithErrorReporting(loadSources, 'No se pudieron actualizar las fuentes')}><RefreshCw size={16} /></button></ViewHeading>
    <div className="sources-layout">
      <aside className="sources-list"><span className="sources-label">FUENTES CONFIGURADAS <small>{sources.length}</small></span>{sources.map(source => <button type="button" key={source.id} aria-pressed={selectedId === source.id} className={selectedId === source.id ? 'source-item active' : 'source-item'} onClick={() => setSelectedId(source.id)}><Database size={15} /><span><strong>{source.name}</strong><small>{source.method} · {source.format}</small></span></button>)}{!sources.length && <div className="sources-empty"><strong>Crea tu primera fuente</strong><p>Conecta una API o archivo compatible y define qué datos quieres importar.</p><button type="button" className="settings-button" onClick={createSource}><Plus size={14} /> Nueva fuente</button></div>}</aside>
      <div className="source-editor">
        <SourceConnectionPanel selected={selected} draft={sourceDraft} onDraftChange={setSourceDraft} headersText={headersText} onHeadersChange={setHeadersText} authText={authText} onAuthChange={setAuthText} busy={busy} message={message} messageTone={messageTone} requestDetails={requestDetails} connectionSample={connectionSample} mappingSuggestion={mappingSuggestion} onTest={() => void testSource()} onSave={() => void saveSource()} onApplyDestination={() => void applyDestination()} onDelete={() => void runWithErrorReporting(async () => { if (selected && window.confirm('Eliminar esta fuente y sus registros importados?')) { await window.planner.sources.remove(selected.id); createSource(); await loadSources() } }, 'No se pudo eliminar la fuente')} />
        {selectedId && <SourceDefinitionPanel draft={definitionDraft} onDraftChange={setDefinitionDraft} definition={definition} busy={busy} onSave={() => void saveDefinition()} onPreview={() => void runPreview()} />}
        {preview && <SourceImportPreview preview={preview} busy={busy} onConfirm={() => void confirmImport()} />}
        {contentRecords.length > 0 && <ImportedSourceRecords records={contentRecords} templates={templates} onSaveEnriched={saveEnriched} />}
        <section className="source-panel configuration-panel"><header><div><span>PLANTILLAS</span><h2>Campos de enriquecimiento</h2></div></header><div className="source-grid"><label>Tipo de contenido<input value={templateType} onChange={event => setTemplateType(event.target.value)} placeholder="post" /></label><label>Campos JSON<textarea value={templateFieldsText} onChange={event => setTemplateFieldsText(event.target.value)} /></label></div><div className="source-actions"><button className="save-button" onClick={() => void saveTemplate()}><Save size={15} /> Guardar plantilla</button></div></section>
        <SourceExportPanel profiles={profiles} selectedProfileId={selectedProfileId} onProfileChange={setSelectedProfileId} includeTitle={includeTitle} onIncludeTitleChange={setIncludeTitle} includeIntro={includeIntro} onIncludeIntroChange={setIncludeIntro} ideaColumns={ideaColumns} onIdeaColumnsChange={setIdeaColumns} onApplyRecipe={applyBlockRecipe} profileName={profileName} onProfileNameChange={setProfileName} selectedExportField={selectedExportField} onExportFieldChange={setSelectedExportField} profileColumnsText={profileColumnsText} onProfileColumnsChange={setProfileColumnsText} onAddField={addExportField} onSaveProfile={() => void saveProfile()} exportScope={exportScope} onExportScopeChange={setExportScope} hasSelectedSource={Boolean(selectedId)} exportProject={exportProject} onExportProjectChange={setExportProject} exportStatus={exportStatus} onExportStatusChange={setExportStatus} deltaOnly={deltaOnly} onDeltaOnlyChange={setDeltaOnly} onDownload={() => void downloadCsv()} />
      </div>
    </div>
  </section>
}

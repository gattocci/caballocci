import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, Combine, ExternalLink, Layers3, Lightbulb, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { ViewHeading } from '../../components/layout/AppShell'
import { ideaMatchesQuery, usePlanner } from '../../app/store'
import type { Idea, IdeaAnalysisOptions, IdeaCluster, IdeaInput, IdeaNeighbor, IdeaPriority, IdeaStatus } from '../../shared/types'
import './ideas.css'

const blankIdea = (space: string): IdeaInput => ({
  space, title: '', body: '', tags: [], media: [], status: 'inbox', priority: 'normal', dueDate: null,
})

const priorityLabels: Record<IdeaPriority, string> = { low: 'Baja', normal: 'Normal', high: 'Alta' }
const statusLabels: Record<IdeaStatus, string> = { inbox: 'Nueva', developing: 'En desarrollo', ready: 'Lista', converted: 'Convertida', archived: 'Archivada' }
const statusFilters: Array<{ value: 'active' | IdeaStatus; label: string }> = [
  { value: 'active', label: 'Activas' }, { value: 'inbox', label: 'Nuevas' }, { value: 'developing', label: 'En desarrollo' },
  { value: 'ready', label: 'Listas' }, { value: 'converted', label: 'Convertidas' }, { value: 'archived', label: 'Archivadas' },
]

const defaultAnalysisOptions: IdeaAnalysisOptions = { editorialPrefixes: [], stripColonPrefixes: true, stripBracketedText: true, stripNumbers: true, ignoreTitleNumbersInClusterNames: true, minTokenLength: 3, genericTermThreshold: 0.08 }
function migrateAnalysisPreferences() {
  const migrationKey = 'caballocci.ideas.analysis-preferences-migrated-v1'
  try {
    if (localStorage.getItem(migrationKey)) return
    const ignoredKey = 'caballocci.ideas.analysis-ignored-terms'
    const ignored = (localStorage.getItem(ignoredKey) || '').split(/[\n,;]+/).map(term => term.trim().toLocaleLowerCase()).filter(Boolean).sort().join('|')
    if (ignored === ['modo dios', 'prompt', 'prohibido'].sort().join('|')) localStorage.setItem(ignoredKey, '')

    const optionsKey = 'caballocci.ideas.analysis-options'
    const stored = JSON.parse(localStorage.getItem(optionsKey) || '{}')
    if (Array.isArray(stored.editorialPrefixes) && stored.editorialPrefixes.map((term: string) => term.trim().toLocaleLowerCase()).sort().join('|') === ['modo dios', 'prompt', 'prompt prohibido'].sort().join('|')) {
      stored.editorialPrefixes = []
      localStorage.setItem(optionsKey, JSON.stringify(stored))
    }
    localStorage.setItem(migrationKey, '1')
  } catch { /* Optional local preference migration. */ }
}
migrateAnalysisPreferences()
function readIgnoredTerms() {
  try { return localStorage.getItem('caballocci.ideas.analysis-ignored-terms') || '' } catch { return '' }
}
function readAnalysisOptions(): IdeaAnalysisOptions {
  try {
    const stored = JSON.parse(localStorage.getItem('caballocci.ideas.analysis-options') || '{}')
    return { ...defaultAnalysisOptions, ...stored }
  } catch { return defaultAnalysisOptions }
}

function parseTextFile(text: string, sourceName: string, space: string): IdeaInput[] {
  const normalizedText = text.replace(/^\uFEFF/, '').replace(/\r/g, '')
  const frontmatter = normalizedText.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  const hasYamlFrontmatter = Boolean(frontmatter && frontmatter[1].split('\n').some(line => /^[A-Za-z0-9_-]+\s*:\s*/.test(line.trim())))
  const cleaned = (hasYamlFrontmatter ? normalizedText.slice(frontmatter![0].length) : normalizedText).trim()
  const marked = [...cleaned.matchAll(/==\s*([^=]+?)\s*==/g)]
  const numbered = [...cleaned.matchAll(/(?:^|\n)\s*(?:#{1,6}\s*)?\*\*\s*(\d+[.)]?\s*[^*\n]+?)\s*\*\*/gm)]
  const chunks = numbered.length
    ? numbered.map((match, index) => {
      const start = (match.index ?? 0) + match[0].length
      const end = numbered[index + 1]?.index ?? cleaned.length
      const title = match[1].replace(/^\d+[.)]?\s*/, '').replace(/^['“”\"]|['“”\"]$/g, '').trim()
      return { title, body: cleaned.slice(start, end).trim() }
    })
    : marked.length
    ? marked.map((match, index) => cleaned.slice(match.index! + match[0].length, marked[index + 1]?.index ?? cleaned.length).trim()).map((body, index) => ({ title: marked[index][1].trim(), body }))
    : cleaned.split(/\n\s*\n+/).map(chunk => chunk.trim()).filter(Boolean).map(chunk => {
      const lines = chunk.split('\n'); const first = lines.shift()?.trim() || ''
      const bold = first.match(/^(?:#{1,6}\s*)?\*\*\s*(?:\d+[.)]?\s*)?(.+?)\s*\*\*\s*(.*)$/)
      if (bold) return { title: bold[1].replace(/^['“”\"]|['“”\"]$/g, '').trim(), body: [bold[2], ...lines].filter(Boolean).join('\n').trim() }
      const heading = first.replace(/^#{1,6}\s*/, '').trim()
      return { title: heading.length <= 180 ? heading : '', body: heading.length <= 180 ? lines.join('\n').trim() : [first, ...lines].join('\n').trim() }
    })
  return chunks.filter(item => item.body.trim()).map(item => ({ space, title: item.title || sourceName, body: item.body, tags: [sourceName], sourceName, media: [], status: 'inbox' as const, priority: 'normal' as const, dueDate: null }))
}

function ideaKey(idea: Pick<IdeaInput, 'title' | 'body'>) {
  void idea.title
  return idea.body.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function IdeasView() {
  const { ideas, activeSpace, saveIdea, saveIdeasMany, removeIdea, convertIdea, combineIdeas, ideaNeighbors, proposeClusters, select, setView, query } = usePlanner()
  const [draft, setDraft] = useState<IdeaInput | null>(null)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [importDuplicates, setImportDuplicates] = useState<Array<{ title: string; existingTitle: string; existingSourceName: string }>>([])
  const [statusFilter, setStatusFilter] = useState<'active' | IdeaStatus>('active')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [neighbors, setNeighbors] = useState<IdeaNeighbor[]>([])
  const [clusters, setClusters] = useState<IdeaCluster[]>([])
  const [clusterSelection, setClusterSelection] = useState(false)
  const [selectedOnly, setSelectedOnly] = useState(false)
  const [analysisMessage, setAnalysisMessage] = useState('')
  const [ignoredTermsText, setIgnoredTermsText] = useState(readIgnoredTerms)
  const [analysisOptions, setAnalysisOptions] = useState<IdeaAnalysisOptions>(readAnalysisOptions)
  const [automaticTerms, setAutomaticTerms] = useState<string[]>([])
  const ignoredTerms = useMemo(() => Array.from(new Set(ignoredTermsText.split(/[\n,;]+/).map(term => term.trim().toLocaleLowerCase()).filter(Boolean))), [ignoredTermsText])
  const ideasInSpace = useMemo(() => (activeSpace ? ideas.filter(idea => idea.space === activeSpace) : ideas).filter(idea => statusFilter === 'active' ? idea.status === 'inbox' || idea.status === 'developing' || idea.status === 'ready' : idea.status === statusFilter).filter(idea => ideaMatchesQuery(idea, query)).filter(idea => !selectedOnly || selectedIds.includes(idea.id)), [activeSpace, ideas, query, selectedIds, selectedOnly, statusFilter])
  const pageSize = 40
  const pageCount = Math.max(1, Math.ceil(ideasInSpace.length / pageSize))
  const visibleIdeas = ideasInSpace.slice((page - 1) * pageSize, page * pageSize)
  useEffect(() => { setPage(1); setSelectedIds([]); setSelectedOnly(false) }, [query, statusFilter, activeSpace])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])
  useEffect(() => { try { localStorage.setItem('caballocci.ideas.analysis-ignored-terms', ignoredTermsText) } catch { /* Optional local preference. */ } }, [ignoredTermsText])
  useEffect(() => { try { localStorage.setItem('caballocci.ideas.analysis-options', JSON.stringify(analysisOptions)) } catch { /* Optional local preference. */ } }, [analysisOptions])
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => { void window.planner.ideas.analysisPreview(ignoredTerms, analysisOptions).then(result => { if (active) setAutomaticTerms(result.automaticTerms) }).catch(() => { if (active) setAutomaticTerms([]) }) }, 180)
    return () => { active = false; window.clearTimeout(timer) }
  }, [ignoredTermsText, analysisOptions, ideas.length])
  const edit = (idea: Idea) => setDraft({ ...idea })
  const save = async () => {
    if (!draft?.title.trim()) return
    await saveIdea({ ...draft, title: draft.title.trim(), body: draft.body.trim() })
    setDraft(null)
  }
  const convert = async (idea: Idea) => {
    const post = await convertIdea(idea.id)
    select(post.id)
    setView('board')
  }
  const importFile = async () => {
    setImporting(true)
    try {
      const file = await window.planner.files.readText()
      if (!file) return
      const parsed = parseTextFile(file.text, file.name, activeSpace || 'Mi contenido')
      if (!parsed.length) { setImportMessage('No se encontraron bloques con contenido.'); return }
      const sourceHeaders = [...file.text.matchAll(/(?:^|\n)\s*(?:#{1,6}\s*)?\*\*\s*(\d+[.)]?\s*[^*\n]+?)\s*\*\*/gm)].length
      if (sourceHeaders !== parsed.length) setImportMessage(`Aviso: el archivo contiene ${sourceHeaders} encabezados numerados y se pudieron preparar ${parsed.length} Ideas.`)
      if (!window.confirm(`Preview: ${parsed.length} bloques detectados.\nLa base verificará duplicados contra todas las Ideas existentes.\n\n¿Importar este lote?`)) return
      const result = await saveIdeasMany(parsed)
      setImportMessage(`${result.created.length} de ${parsed.length} ideas importadas${result.skipped ? ` · ${result.skipped} duplicadas omitidas` : ''}.`)
      setImportDuplicates(result.duplicates)
    } finally { setImporting(false) }
  }
  const toggleSelected = (id: string) => setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  const clearClusterView = () => {
    setClusterSelection(false)
    setSelectedOnly(false)
    setSelectedIds([])
    setPage(1)
  }
  const selectVisible = () => setSelectedIds(current => current.length === visibleIdeas.length ? [] : visibleIdeas.map(idea => idea.id))
  const bulkStatus = async (status: IdeaStatus) => {
    if (!selectedIds.length) return
    for (const id of selectedIds) { const idea = ideas.find(item => item.id === id); if (idea) await saveIdea({ ...idea, status }) }
    setSelectedIds([])
    setClusterSelection(false)
  }
  const bulkConvert = async () => {
    if (!selectedIds.length) return
    for (const id of selectedIds) await convertIdea(id)
    setSelectedIds([])
  }
  const bulkCombine = async () => {
    if (selectedIds.length < 2) return
    const combined = await combineIdeas(selectedIds)
    setSelectedIds([])
    select(combined.post.id)
    setView('board')
  }
  const findNeighbors = async () => {
    if (selectedIds.length !== 1) return
    setAnalysisMessage('Buscando ideas parecidas... Esto puede tardar un momento.')
    setNeighbors(await ideaNeighbors(selectedIds[0], 8, ignoredTerms, analysisOptions))
    setAnalysisMessage('')
  }
  const makeClusters = async () => {
    setClusters([])
    setAnalysisMessage('Calculando clusters... Esto puede tardar un momento. No cierres la ventana ni cambies de filtro hasta que termine.')
    try {
      const proposed = await proposeClusters(0.65, ignoredTerms, analysisOptions)
      setClusters(proposed)
      setAnalysisMessage(proposed.length ? '' : 'No se encontraron grupos suficientemente relacionados con estos términos.')
    } catch (error) {
      setAnalysisMessage(error instanceof Error ? error.message : 'No se pudieron proponer clusters.')
    }
  }
  const bulkRemove = async () => {
    if (!selectedIds.length || !window.confirm(`¿Eliminar ${selectedIds.length} ideas seleccionadas?`)) return
    for (const id of selectedIds) await removeIdea(id)
    setSelectedIds([])
  }

  return <section className="workspace ideas-workspace">
    <ViewHeading title="Ideas" subtitle="Captura, desarrolla y convierte tus ideas en contenido.">
      <button className="settings-button" disabled={importing} onClick={() => void importFile()}>{importing ? 'Importando...' : 'Importar .md / .txt'}</button><button className="settings-button" disabled={importing} onClick={() => void makeClusters()}><Layers3 size={14} /> Proponer clusters</button><button className="new-button" onClick={() => setDraft(blankIdea(activeSpace || 'Mi contenido'))}><Plus size={17} /> Nueva idea</button>
    </ViewHeading>
    {importMessage && <div className="ideas-import-result"><p className="ideas-import-message">{importMessage}</p>{importDuplicates.length > 0 && <details><summary>Ver {importDuplicates.length} coincidencias existentes</summary><ul>{importDuplicates.map((duplicate, index) => <li key={`${duplicate.title}-${index}`}><strong>{duplicate.title}</strong><span>ya existe como “{duplicate.existingTitle}”{duplicate.existingSourceName ? ` · ${duplicate.existingSourceName}` : ''}</span></li>)}</ul></details>}</div>}
    <div className="ideas-toolbar"><div className="idea-status-filters" role="group" aria-label="Filtrar ideas por estado">{statusFilters.map(filter => <button type="button" key={filter.value} aria-pressed={statusFilter === filter.value} className={statusFilter === filter.value ? 'active' : ''} onClick={() => { setStatusFilter(filter.value); setPage(1); setSelectedIds([]); setSelectedOnly(false); setClusterSelection(false) }}>{filter.label}</button>)}</div><span>{selectedOnly ? `${ideasInSpace.length} seleccionadas` : `${ideasInSpace.length} ideas`} · página {page} de {pageCount}</span>{selectedOnly && <button type="button" className="settings-button" onClick={clearClusterView}>Ver todas</button>}<button type="button" className="settings-button" onClick={selectVisible}>{selectedIds.length === visibleIdeas.length && visibleIdeas.length ? 'Quitar selección' : 'Seleccionar página'}</button></div>
    <details className="idea-analysis-settings"><summary>Configuración del análisis local</summary>
      <label>Términos que quieres ignorar<textarea value={ignoredTermsText} onChange={event => setIgnoredTermsText(event.target.value)} placeholder="ejemplo, ejemplo, ejemplo" /></label>
      <label>Prefijos editoriales que quieres ignorar<textarea value={analysisOptions.editorialPrefixes.join('\n')} onChange={event => setAnalysisOptions(current => ({ ...current, editorialPrefixes: event.target.value.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean) }))} placeholder={'ejemplo\nejemplo'} /></label>
      <div className="idea-analysis-options"><label><input type="checkbox" checked={analysisOptions.stripColonPrefixes} onChange={event => setAnalysisOptions(current => ({ ...current, stripColonPrefixes: event.target.checked }))} /> Quitar prefijo antes de dos puntos en títulos</label><label><input type="checkbox" checked={analysisOptions.stripBracketedText} onChange={event => setAnalysisOptions(current => ({ ...current, stripBracketedText: event.target.checked }))} /> Excluir texto entre corchetes</label><label><input type="checkbox" checked={analysisOptions.stripNumbers} onChange={event => setAnalysisOptions(current => ({ ...current, stripNumbers: event.target.checked }))} /> Excluir números de los embeddings</label><label><input type="checkbox" checked={analysisOptions.ignoreTitleNumbersInClusterNames} onChange={event => setAnalysisOptions(current => ({ ...current, ignoreTitleNumbersInClusterNames: event.target.checked }))} /> Ignorar números de títulos al nombrar clusters</label></div>
      <div className="idea-analysis-numeric"><label>Longitud mínima de palabra<input type="number" min="1" max="10" value={analysisOptions.minTokenLength} onChange={event => setAnalysisOptions(current => ({ ...current, minTokenLength: Math.max(1, Math.min(10, Number(event.target.value) || 1)) }))} /></label><label>Umbral de términos repetidos (%)<input type="number" min="1" max="100" value={Math.round(analysisOptions.genericTermThreshold * 100)} onChange={event => setAnalysisOptions(current => ({ ...current, genericTermThreshold: Math.max(0.01, Math.min(1, (Number(event.target.value) || 1) / 100)) }))} /></label></div>
      <div className="idea-analysis-preview"><strong>Excluir automáticamente ({automaticTerms.length})</strong><span>{automaticTerms.slice(0, 80).join(', ') || 'No se detectaron términos frecuentes'}{automaticTerms.length > 80 ? ', …' : ''}</span></div>
      <small>La configuración se guarda en este dispositivo. Los originales no se modifican; el siguiente análisis regenerará los vectores si cambian las reglas.</small>
    </details>
    {selectedIds.length > 0 && <div className="ideas-bulk-actions"><strong>{selectedIds.length} seleccionadas</strong>{selectedIds.length === 1 && <button type="button" onClick={() => void findNeighbors()}><Search size={13} /> Ideas parecidas</button>}{selectedIds.length >= 2 && <button type="button" onClick={() => void bulkCombine()}><Combine size={13} /> Combinar</button>}<button type="button" onClick={() => void bulkStatus('developing')}>Desarrollar</button><button type="button" onClick={() => void bulkStatus('ready')}>Marcar listas</button><button type="button" onClick={() => void bulkConvert()}>Convertir</button><button type="button" onClick={() => void bulkStatus('archived')}>Archivar</button><button type="button" onClick={() => void bulkRemove()}>Eliminar</button></div>}
    {analysisMessage && <p className="ideas-analysis-message">{analysisMessage}</p>}
    {neighbors.length > 0 && <section className="ideas-analysis-panel"><header><strong>Ideas parecidas</strong><button type="button" className="icon-button" onClick={() => setNeighbors([])}><X size={14} /></button></header><div>{neighbors.map(idea => <button type="button" key={idea.id} onClick={() => { setSelectedIds([idea.id]); setNeighbors([]) }}><span>{idea.title || 'Idea sin titulo'}</span><small>{Math.round(idea.similarity * 100)}% de similitud</small></button>)}</div></section>}
    {clusters.length > 0 && <section className="ideas-analysis-panel"><header><strong>Clusters sugeridos</strong><button type="button" className="icon-button" onClick={() => setClusters([])}><X size={14} /></button></header><div>{clusters.map(cluster => <article key={cluster.id}><strong>{cluster.name}</strong><small>{cluster.ideaIds.length} ideas</small><button type="button" onClick={() => { setSelectedIds(cluster.ideaIds); setSelectedOnly(true); setClusterSelection(true); setPage(1) }}>Seleccionar y ver</button></article>)}</div></section>}
    {clusterSelection && selectedIds.length > 0 && <section className="ideas-analysis-panel ideas-selection-preview"><header><strong>{selectedIds.length} ideas del cluster</strong><button type="button" className="settings-button" onClick={clearClusterView}>Ver todas</button><button type="button" className="icon-button" onClick={clearClusterView}><X size={14} /></button></header><div>{selectedIds.map(id => ideas.find(idea => idea.id === id)).filter(Boolean).map(idea => <button type="button" key={idea!.id} onClick={() => edit(idea!)}><strong>{idea!.title || 'Idea sin título'}</strong><small>{idea!.body.slice(0, 150)}{idea!.body.length > 150 ? '…' : ''}</small></button>)}</div></section>}
    {ideasInSpace.length ? <div className="ideas-grid">{visibleIdeas.map(idea => <article className={'idea-card ' + (selectedIds.includes(idea.id) ? 'selected' : '')} key={idea.id} onClick={event => { if (event.shiftKey || event.ctrlKey || event.metaKey || selectedIds.length > 0) toggleSelected(idea.id) }}>
      <header><label className="idea-select" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(idea.id)} onChange={() => toggleSelected(idea.id)} /> <span className={'idea-priority ' + idea.priority}>{priorityLabels[idea.priority]}</span></label><div><button title="Editar idea" onClick={event => { event.stopPropagation(); edit(idea) }}><Pencil size={15} /></button><button title="Eliminar idea" className="idea-delete" onClick={event => { event.stopPropagation(); if (window.confirm('Eliminar esta idea?')) void removeIdea(idea.id) }}><Trash2 size={15} /></button></div></header>
      <span className="idea-status">{statusLabels[idea.status]}</span>{(idea.combinedPostIds.length > 0 || idea.combinedPostId) && <span className="idea-combined-badge">{idea.combinedPostIds.length > 1 ? `${idea.combinedPostIds.length} combinaciones` : 'Combinada'}</span>}<h2>{idea.title || 'Idea sin titulo'}</h2><p>{idea.body || 'Sin desarrollo todavia.'}</p>
      <footer>{idea.dueDate && <span><CalendarDays size={13} />{new Date(idea.dueDate).toLocaleDateString()}</span>}<small>{idea.space}</small><div className="idea-links">{(idea.combinedPostIds.length > 0 ? idea.combinedPostIds : (idea.combinedPostId ? [idea.combinedPostId] : [])).map((postId, index) => <button key={postId} onClick={event => { event.stopPropagation(); select(postId); setView('board') }} title="Abrir publicacion combinada"><ExternalLink size={13} /> {index === 0 ? 'Ver combinado' : `Ver combinado ${index + 1}`}</button>)}{idea.postId ? <button onClick={event => { event.stopPropagation(); select(idea.postId!); setView('board') }} title="Abrir publicacion individual"><ExternalLink size={13} /> Ver publicacion</button> : <button onClick={event => { event.stopPropagation(); void convert(idea) }}>Convertir <ArrowRight size={14} /></button>}</div></footer>
    </article>)}</div> : <div className="ideas-empty"><Lightbulb size={34} /><strong>No hay ideas en este filtro</strong><span>Importa un archivo o cambia el estado seleccionado.</span><button className="new-button" onClick={() => setDraft(blankIdea(activeSpace || 'Mi contenido'))}><Plus size={17} /> Nueva idea</button></div>}
    {ideasInSpace.length > 0 && <div className="ideas-pagination"><button disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Anterior</button><span>{page} / {pageCount}</span><button disabled={page >= pageCount} onClick={() => setPage(current => current + 1)}>Siguiente</button></div>}
    {draft && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDraft(null) }}><form className="space-dialog idea-dialog" onSubmit={event => { event.preventDefault(); void save() }}><header><div><span>{draft.id ? 'EDITAR IDEA' : 'NUEVA IDEA'}</span><h2>{draft.title || 'Idea sin titulo'}</h2></div><button type="button" className="icon-button" onClick={() => setDraft(null)}><X size={18} /></button></header><label>Titulo<input autoFocus value={draft.title} maxLength={240} onChange={event => setDraft(current => current ? { ...current, title: event.target.value } : current)} placeholder="Describe la idea" /></label><label>Desarrollo<textarea value={draft.body} maxLength={20_000} onChange={event => setDraft(current => current ? { ...current, body: event.target.value } : current)} placeholder="Anota el enfoque, datos o una primera version" /></label><div className="idea-dialog-row"><label>Estado<select value={draft.status} onChange={event => setDraft(current => current ? { ...current, status: event.target.value as IdeaStatus } : current)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Prioridad<select value={draft.priority} onChange={event => setDraft(current => current ? { ...current, priority: event.target.value as IdeaPriority } : current)}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label>Espacio<input value={draft.space} maxLength={200} onChange={event => setDraft(current => current ? { ...current, space: event.target.value } : current)} /></label><footer><button type="button" className="ghost-button" onClick={() => setDraft(null)}>Cancelar</button><button className="save-button" disabled={!draft.title.trim()}>Guardar idea</button></footer></form></div>}
  </section>
}

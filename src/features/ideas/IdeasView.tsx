import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, Combine, ExternalLink, Layers3, Lightbulb, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { ViewHeading } from '../../components/layout/AppShell'
import { ideaMatchesQuery, usePlanner } from '../../app/store'
import type { Idea, IdeaAnalysisOptions, IdeaCluster, IdeaImportRun, IdeaInput, IdeaNeighbor, IdeaPriority, IdeaStatus } from '../../shared/types'
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
function readFamilyPatterns(): Record<string, string> {
  try { const parsed = JSON.parse(localStorage.getItem('caballocci.ideas.family-patterns') || '{}'); return parsed && typeof parsed === 'object' ? parsed : {} } catch { return {} }
}
function ideaFamily(title: string, sourceName?: string, patterns = readFamilyPatterns()) {
  const configured = sourceName ? patterns[sourceName] : undefined
  if (configured) {
    try { const match = title.match(new RegExp(configured, 'i')); if (match?.[0]) return { family: match[0].replace(/\s*\+\d+\s*:?[ \t]*/g, '').replace(/\s*:\s*$/, '').trim(), title: title.slice(match[0].length).trim() || title.trim() } } catch { /* Invalid local pattern: use generic detection. */ }
  }
  const match = title.match(/^\s*((?:[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\d+]*(?:\s+|$)){1,5})(?::|\s+-\s+|\s{2,})/) || title.match(/^\s*((?:[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\d+]*(?:\s+|$)){1,5})\s*\+\d+\s*:?\s*/)
  if (!match) return { family: '', title: title.trim() }
  const family = match[1].replace(/\s*\+\d+\s*$/, '').trim()
  return { family, title: title.slice(match[0].length).trim() || title.trim() }
}
function testFamilyPattern(title: string, sourceName: string, patternsText: string) {
  try { const patterns = JSON.parse(patternsText) as Record<string, unknown>; const pattern = patterns[sourceName]; if (typeof pattern !== 'string' || !pattern) return { ok: false, message: 'No hay patrón para esa fuente.' }; const match = title.match(new RegExp(pattern, 'i')); if (!match?.[0]) return { ok: true, message: 'No coincide; se conservaría el título completo.', title }; const family = match[0].replace(/\s*\+\d+\s*:?[ \t]*/g, '').replace(/\s*:\s*$/, '').trim(); return { ok: true, message: `Familia: ${family || 'detectada'} · título resultante:`, title: title.slice(match[0].length).trim() || title.trim() } } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'JSON o regex no válidos.' } }
}
function familyPatternError(text: string) {
  try { JSON.parse(text); return '' } catch (error) {
    const message = error instanceof Error ? error.message : 'JSON no válido.'
    const position = message.match(/position\s+(\d+)/i)?.[1]
    if (!position) return message
    const index = Number(position); const before = text.slice(0, index); const line = before.split('\n').length; const column = index - (before.lastIndexOf('\n') + 1) + 1
    return `${message} · línea ${line}, columna ${column}`
  }
}

function commonTitlePrefix(titles: string[]) {
  if (titles.length < 2) return ''
  let prefix = titles[0].trim()
  for (const title of titles.slice(1)) {
    while (prefix && !title.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) prefix = prefix.slice(0, -1)
    if (!prefix) break
  }
  const boundary = prefix.lastIndexOf(' ')
  return boundary > 0 ? prefix.slice(0, boundary + 1).trim() : ''
}

function clusterTitlePreview(idea: Idea, prefix: string) {
  const title = idea.title || ''
  const remainder = prefix && title.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()) ? title.slice(prefix.length).trim() : title.trim()
  return remainder.length >= 8 ? remainder : (idea.body.trim().slice(0, 84) || 'Idea sin título')
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
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null)
  const [clusterQuery, setClusterQuery] = useState('')
  const [showSmallClusters, setShowSmallClusters] = useState(false)
  const [familyFilter, setFamilyFilter] = useState('')
  const [clusterSelection, setClusterSelection] = useState(false)
  const [selectedOnly, setSelectedOnly] = useState(false)
  const [analysisMessage, setAnalysisMessage] = useState('')
  const [ideasTab, setIdeasTab] = useState<'ideas' | 'imports'>('ideas')
  const [importHistory, setImportHistory] = useState<IdeaImportRun[]>([])
  const [ignoredTermsText, setIgnoredTermsText] = useState(readIgnoredTerms)
  const [analysisOptions, setAnalysisOptions] = useState<IdeaAnalysisOptions>(readAnalysisOptions)
  const [familyPatternsText, setFamilyPatternsText] = useState(() => { try { return localStorage.getItem('caballocci.ideas.family-patterns') || '{}' } catch { return '{}' } })
  const [familyTestSource, setFamilyTestSource] = useState('')
  const [familyTestTitle, setFamilyTestTitle] = useState('')
  const [familyTestResult, setFamilyTestResult] = useState<{ ok: boolean; message: string; title?: string } | null>(null)
  const familyPatternsState = useMemo(() => {
    try {
      const parsed = JSON.parse(familyPatternsText)
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return { valid: false, message: 'Debe ser un objeto JSON con fuente y patrón.' }
      Object.entries(parsed).forEach(([source, pattern]) => { if (typeof source !== 'string' || typeof pattern !== 'string') throw new Error('Cada fuente y patrón debe ser texto.') ; new RegExp(pattern) })
      return { valid: true, message: 'Configuración válida. Se aplicará por nombre de fuente.' }
    } catch (error) { return { valid: false, message: familyPatternError(familyPatternsText) || (error instanceof Error ? error.message : 'JSON no válido.') } }
  }, [familyPatternsText])
  const familyPatternsRef = useRef<HTMLTextAreaElement>(null)
  const insertFamilyPair = (open: string, close: string) => {
    const el = familyPatternsRef.current
    const start = el?.selectionStart ?? familyPatternsText.length
    const end = el?.selectionEnd ?? start
    const selected = familyPatternsText.slice(start, end)
    setFamilyPatternsText(familyPatternsText.slice(0, start) + open + selected + close + familyPatternsText.slice(end))
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const cursor = start + open.length + (selected ? selected.length + close.length : 0)
      el.setSelectionRange(cursor, cursor)
    })
  }
  const formatFamilyPatterns = () => {
    try { setFamilyPatternsText(JSON.stringify(JSON.parse(familyPatternsText), null, 2)) } catch { /* Invalid JSON: nothing to format. */ }
  }
  const [automaticTerms, setAutomaticTerms] = useState<string[]>([])
  const ignoredTerms = useMemo(() => Array.from(new Set(ignoredTermsText.split(/[\n,;]+/).map(term => term.trim().toLocaleLowerCase()).filter(Boolean))), [ignoredTermsText])
  const scopedIdeas = useMemo(() => activeSpace ? ideas.filter(idea => idea.space === activeSpace) : ideas, [activeSpace, ideas])
  const familyCounts = useMemo(() => { const counts = new Map<string, number>(); scopedIdeas.forEach(idea => { const family = ideaFamily(idea.title, idea.sourceName).family || 'Otras'; counts.set(family, (counts.get(family) || 0) + 1) }); return [...counts.entries()].sort((a, b) => b[1] - a[1]) }, [scopedIdeas])
  const ideasInSpace = useMemo(() => scopedIdeas.filter(idea => statusFilter === 'active' ? idea.status === 'inbox' || idea.status === 'developing' || idea.status === 'ready' : idea.status === statusFilter).filter(idea => !familyFilter || (ideaFamily(idea.title, idea.sourceName).family || 'Otras') === familyFilter).filter(idea => ideaMatchesQuery(idea, query)).filter(idea => !selectedOnly || selectedIds.includes(idea.id)), [familyFilter, query, scopedIdeas, selectedIds, selectedOnly, statusFilter])
  const pageSize = 40
  const pageCount = Math.max(1, Math.ceil(ideasInSpace.length / pageSize))
  const visibleIdeas = ideasInSpace.slice((page - 1) * pageSize, page * pageSize)
  const statusCount = (status: 'active' | IdeaStatus) => scopedIdeas.filter(idea => status === 'active' ? ['inbox', 'developing', 'ready'].includes(idea.status) : idea.status === status).filter(idea => !familyFilter || (ideaFamily(idea.title, idea.sourceName).family || 'Otras') === familyFilter).filter(idea => ideaMatchesQuery(idea, query)).length
  const clusterIdeas = (cluster: IdeaCluster) => cluster.ideaIds.map(id => ideas.find(idea => idea.id === id)).filter((idea): idea is Idea => Boolean(idea))
  const visibleClusters = useMemo(() => {
    const normalizedQuery = clusterQuery.trim().toLocaleLowerCase()
    return clusters
      .filter(cluster => showSmallClusters || cluster.ideaIds.length >= 3)
      .filter(cluster => !normalizedQuery || cluster.name.toLocaleLowerCase().includes(normalizedQuery) || clusterIdeas(cluster).some(idea => idea.title.toLocaleLowerCase().includes(normalizedQuery)))
      .sort((a, b) => b.ideaIds.length - a.ideaIds.length || a.name.localeCompare(b.name))
  }, [clusterQuery, clusters, ideas, showSmallClusters])
  const activeCluster = visibleClusters.find(cluster => cluster.id === activeClusterId) || visibleClusters[0] || null
  useEffect(() => { setPage(1); setSelectedIds([]); setSelectedOnly(false) }, [query, statusFilter, activeSpace, familyFilter])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])
  useEffect(() => { try { localStorage.setItem('caballocci.ideas.analysis-ignored-terms', ignoredTermsText) } catch { /* Optional local preference. */ } }, [ignoredTermsText])
  useEffect(() => { try { localStorage.setItem('caballocci.ideas.analysis-options', JSON.stringify(analysisOptions)) } catch { /* Optional local preference. */ } }, [analysisOptions])
  useEffect(() => { if (familyPatternsState.valid) { try { localStorage.setItem('caballocci.ideas.family-patterns', familyPatternsText) } catch { /* Optional local preference. */ } } }, [familyPatternsState.valid, familyPatternsText])
  useEffect(() => { void window.planner.ideas.importHistory().then(setImportHistory).catch(() => setImportHistory([])) }, [])
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => { void window.planner.ideas.analysisPreview(ignoredTerms, analysisOptions).then(result => { if (active) setAutomaticTerms(result.automaticTerms) }).catch(() => { if (active) setAutomaticTerms([]) }) }, 180)
    return () => { active = false; window.clearTimeout(timer) }
  }, [ignoredTermsText, analysisOptions])
  const edit = (idea: Idea) => setDraft({ ...idea })
  const save = async () => {
    if (!draft?.title.trim()) return
    await saveIdea({ ...draft, title: draft.title.trim(), body: draft.body.trim() })
    setDraft(null)
  }
  const saveAndConvert = async () => {
    if (!draft?.title.trim()) return
    const saved = await saveIdea({ ...draft, title: draft.title.trim(), body: draft.body.trim() })
    const post = await convertIdea(saved.id)
    setDraft(null)
    select(post.id)
    setView('board')
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
      setImportHistory(await window.planner.ideas.importHistory())
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
      setActiveClusterId(proposed[0]?.id || null)
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

  return <section className={`workspace ideas-workspace ${ideasTab === 'imports' ? 'show-import-history' : ''}`}>
    <ViewHeading title="Ideas" subtitle="Captura, desarrolla y convierte tus ideas en contenido.">
      <button className="settings-button" disabled={importing} onClick={() => void importFile()}>{importing ? 'Importando...' : 'Importar .md / .txt'}</button><button className="settings-button" disabled={importing} onClick={() => void makeClusters()}><Layers3 size={14} /> Proponer clusters</button><button className="new-button" onClick={() => setDraft(blankIdea(activeSpace || 'Mi contenido'))}><Plus size={17} /> Nueva idea</button>
    </ViewHeading>
    <div className="ideas-tabs" role="tablist"><button type="button" role="tab" aria-selected={ideasTab === 'ideas'} className={ideasTab === 'ideas' ? 'active' : ''} onClick={() => setIdeasTab('ideas')}>Ideas</button><button type="button" role="tab" aria-selected={ideasTab === 'imports'} className={ideasTab === 'imports' ? 'active' : ''} onClick={() => setIdeasTab('imports')}>Historial de importaciones <span>{importHistory.length}</span></button></div>
    {ideasTab === 'imports' && <section className="ideas-import-history"><header><div><span>ARCHIVOS LOCALES</span><h2>Historial de importaciones</h2></div><button type="button" className="settings-button" onClick={() => void window.planner.ideas.importHistory().then(setImportHistory)}>Actualizar</button></header>{importHistory.length ? <div className="ideas-import-history-list">{importHistory.map(run => <article key={run.id}><div><strong>{run.fileName}</strong><small>{new Date(run.importedAt).toLocaleString()} · {run.space || 'Todos los contenidos'}</small></div><div className="ideas-import-stats"><span>{run.total} detectadas</span><span>{run.created} nuevas</span><span>{run.skipped} duplicadas</span></div></article>)}</div> : <p className="ideas-import-history-empty">Todavía no hay importaciones registradas.</p>}</section>}
    {importMessage && <div className="ideas-import-result"><p className="ideas-import-message">{importMessage}</p>{importDuplicates.length > 0 && <details><summary>Ver {importDuplicates.length} coincidencias existentes</summary><ul>{importDuplicates.map((duplicate, index) => <li key={`${duplicate.title}-${index}`}><strong>{duplicate.title}</strong><span>ya existe como “{duplicate.existingTitle}”{duplicate.existingSourceName ? ` · ${duplicate.existingSourceName}` : ''}</span></li>)}</ul></details>}</div>}
    <div className="ideas-toolbar"><div className="idea-status-filters" role="group" aria-label="Filtrar ideas por estado">{statusFilters.map(filter => <button type="button" key={filter.value} aria-pressed={statusFilter === filter.value} className={statusFilter === filter.value ? 'active' : ''} onClick={() => { setStatusFilter(filter.value); setPage(1); setSelectedIds([]); setSelectedOnly(false); setClusterSelection(false) }}>{filter.label} <span>{statusCount(filter.value)}</span></button>)}</div><span>{selectedOnly ? `${ideasInSpace.length} seleccionadas` : `${ideasInSpace.length} ideas`} · página {page} de {pageCount}</span>{selectedOnly && <button type="button" className="settings-button" onClick={clearClusterView}>Ver todas</button>}<button type="button" className="settings-button" onClick={selectVisible}>{selectedIds.length === visibleIdeas.length && visibleIdeas.length ? 'Quitar selección' : 'Seleccionar página'}</button></div>
    <div className="ideas-family-filters" role="group" aria-label="Filtrar ideas por familia"><button type="button" className={!familyFilter ? 'active' : ''} onClick={() => setFamilyFilter('')}>Todas <span>{scopedIdeas.length}</span></button>{familyCounts.map(([family, count]) => <button type="button" key={family} className={familyFilter === family ? 'active' : ''} onClick={() => setFamilyFilter(family)}>{family} <span>{count}</span></button>)}</div>
    <details className="idea-analysis-settings"><summary>Configuración del análisis local</summary>
      <details className="family-pattern-advanced"><summary>Avanzado · patrones de familia por fuente</summary><div className="family-pattern-field"><span>Configuración JSON</span><div className={`family-pattern-editor ${familyPatternsState.valid ? 'valid' : 'invalid'}`}><div className="family-pattern-tools"><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertFamilyPair('[', ']')} title="Insertar corchetes">{'[ ]'}</button><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertFamilyPair('{', '}')} title="Insertar llaves">{'{ }'}</button><button type="button" onMouseDown={event => event.preventDefault()} onClick={formatFamilyPatterns} disabled={!familyPatternsState.valid} title="Dar formato al JSON">Formatear</button></div><textarea aria-label="Configuración JSON" ref={familyPatternsRef} value={familyPatternsText} onChange={event => setFamilyPatternsText(event.target.value)} placeholder={'{\n  "TikTok": "^(HOOK|CTA)\\s*:",\n  "Newsletter": "^\\[\\w+\\]"\n}'} /><span className={familyPatternsState.valid ? 'family-pattern-badge valid' : 'family-pattern-badge invalid'}>{familyPatternsState.valid ? '✓ JSON válido' : '✕ JSON inválido'}</span></div><small>La clave es el nombre exacto de la fuente.</small><small>El valor es una regex; se retira del título lo que coincida.</small>{!familyPatternsState.valid && <small className="family-pattern-status invalid">{familyPatternsState.message}</small>}</div><div className="family-pattern-tester"><strong>Probar patrón</strong><div><input value={familyTestSource} onChange={event => { setFamilyTestSource(event.target.value); setFamilyTestResult(null) }} placeholder="Fuente" /><input value={familyTestTitle} onChange={event => { setFamilyTestTitle(event.target.value); setFamilyTestResult(null) }} placeholder="Pega un título de ejemplo" /><button type="button" className="settings-button" onClick={() => setFamilyTestResult(testFamilyPattern(familyTestTitle, familyTestSource, familyPatternsText))}>Probar</button></div>{familyTestResult && <small className={familyTestResult.ok ? 'family-test-result valid' : 'family-test-result invalid'}>{familyTestResult.message}{familyTestResult.title !== undefined && <><br /><strong>{familyTestResult.title}</strong></>}</small>}</div></details>
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
    {clusters.length > 0 && <section className="ideas-analysis-panel clusters-panel">
      <header className="clusters-panel-header"><div><strong>Clusters sugeridos</strong><small>{visibleClusters.length} grupos visibles · ordenados por tamaño</small></div><div className="clusters-panel-actions"><label className="clusters-search"><Search size={13} /><input value={clusterQuery} onChange={event => setClusterQuery(event.target.value)} placeholder="Buscar cluster" /></label><button type="button" className={showSmallClusters ? 'settings-button active' : 'settings-button'} onClick={() => setShowSmallClusters(current => !current)}>{showSmallClusters ? 'Ocultar grupos de 2' : 'Ver grupos de 2'}</button><button type="button" className="icon-button" onClick={() => { setClusters([]); setActiveClusterId(null) }}><X size={14} /></button></div></header>
      <div className="clusters-layout">
        <nav className="clusters-list" aria-label="Lista de clusters">{visibleClusters.map(cluster => { const items = clusterIdeas(cluster); const prefix = commonTitlePrefix(items.map(idea => idea.title)); const isSeries = prefix.length > 0 && items.every(idea => idea.title.length > 0) && prefix.length / Math.max(...items.map(idea => idea.title.length)) > .6; return <button type="button" key={cluster.id} className={activeCluster?.id === cluster.id ? 'active' : ''} onClick={() => setActiveClusterId(cluster.id)}><span>{cluster.name}</span><small>{items.length} ideas{isSeries ? ' · Serie' : ''}</small><em>{items.slice(0, 2).map(idea => clusterTitlePreview(idea, prefix)).join(' · ')}</em></button> })}{!visibleClusters.length && <p className="clusters-empty">No hay clusters que coincidan.</p>}</nav>
        {activeCluster && <div className="cluster-detail"><div className="cluster-detail-heading"><div><span>CLUSTER SELECCIONADO</span><h3>{activeCluster.name}</h3><small>{clusterIdeas(activeCluster).length} ideas relacionadas</small></div><div className="cluster-detail-actions"><button type="button" className="settings-button" onClick={() => { const ids = activeCluster.ideaIds; setSelectedIds(current => current.length === ids.length && ids.every(id => current.includes(id)) ? [] : ids); setSelectedOnly(false); setClusterSelection(true) }}>{activeCluster.ideaIds.every(id => selectedIds.includes(id)) ? 'Quitar selección' : 'Seleccionar todas'}</button><button type="button" className="new-button" onClick={() => { setSelectedIds(activeCluster.ideaIds); setSelectedOnly(true); setClusterSelection(true); setPage(1) }}>Ver ideas</button></div></div><div className="cluster-ideas-list">{(() => { const items = clusterIdeas(activeCluster); const prefix = commonTitlePrefix(items.map(idea => idea.title)); const isSeries = prefix.length > 0 && items.every(idea => idea.title.length > 0) && prefix.length / Math.max(...items.map(idea => idea.title.length)) > .6; return <>{isSeries && <div className="cluster-series-label"><span>Serie</span>{prefix}</div>}{items.map(idea => <article className={'cluster-idea-card ' + (selectedIds.includes(idea.id) ? 'selected' : '')} key={idea.id} onClick={() => edit(idea)}><header><label onClick={event => event.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(idea.id)} onChange={() => toggleSelected(idea.id)} /><span>{idea.status === 'converted' ? 'Convertida' : statusLabels[idea.status]}</span></label><div><button type="button" title="Editar idea" onClick={event => { event.stopPropagation(); edit(idea) }}><Pencil size={13} /></button></div></header><strong>{clusterTitlePreview(idea, prefix)}</strong><small>{idea.body.slice(0, 130)}{idea.body.length > 130 ? '…' : ''}</small><footer>{idea.status === 'converted' ? <span className="cluster-converted">Convertida</span> : <button type="button" onClick={event => { event.stopPropagation(); void convert(idea) }}>Convertir <ArrowRight size={13} /></button>}</footer></article>)}</> })()}</div></div>}
      </div>
      {visibleClusters.some(cluster => cluster.ideaIds.length < 3) && !showSmallClusters && <button type="button" className="clusters-small-note" onClick={() => setShowSmallClusters(true)}>Hay {clusters.filter(cluster => cluster.ideaIds.length < 3).length} posibles duplicados o series de 2 ideas. Verlos.</button>}
    </section>}
    {ideasInSpace.length ? <div className="ideas-grid">{visibleIdeas.map(idea => <article className={'idea-card ' + (selectedIds.includes(idea.id) ? 'selected' : '')} key={idea.id} onClick={event => { if (event.shiftKey || event.ctrlKey || event.metaKey || selectedIds.length > 0) toggleSelected(idea.id) }}>
      <header><label className="idea-select" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(idea.id)} onChange={() => toggleSelected(idea.id)} /> {idea.priority !== 'normal' && <span className={'idea-priority ' + idea.priority}>{priorityLabels[idea.priority]}</span>}</label><div><button title="Editar idea" onClick={event => { event.stopPropagation(); edit(idea) }}><Pencil size={15} /></button><button title="Eliminar idea" className="idea-delete" onClick={event => { event.stopPropagation(); if (window.confirm('Eliminar esta idea?')) void removeIdea(idea.id) }}><Trash2 size={15} /></button></div></header>
      {ideaFamily(idea.title, idea.sourceName).family && <span className="idea-family-chip">{ideaFamily(idea.title, idea.sourceName).family}</span>} {idea.status !== 'inbox' && <span className={'idea-status ' + idea.status}>{statusLabels[idea.status]}</span>}{(idea.combinedPostIds.length > 0 || idea.combinedPostId) && <span className="idea-combined-badge">{idea.combinedPostIds.length > 1 ? `${idea.combinedPostIds.length} combinaciones` : 'Combinada'}</span>}<h2>{ideaFamily(idea.title, idea.sourceName).title || 'Idea sin titulo'}</h2><p>{idea.body || 'Sin desarrollo todavia.'}</p>
      <footer>{idea.dueDate && <span><CalendarDays size={13} />{new Date(idea.dueDate).toLocaleDateString()}</span>}<small>{idea.space}</small><div className="idea-links">{(idea.combinedPostIds.length > 0 ? idea.combinedPostIds : (idea.combinedPostId ? [idea.combinedPostId] : [])).map((postId, index) => <button key={postId} onClick={event => { event.stopPropagation(); select(postId); setView('board') }} title="Abrir publicacion combinada"><ExternalLink size={13} /> {index === 0 ? 'Ver combinado' : `Ver combinado ${index + 1}`}</button>)}{idea.postId ? <button onClick={event => { event.stopPropagation(); select(idea.postId!); setView('board') }} title="Abrir publicacion individual"><ExternalLink size={13} /> Ver publicacion</button> : <button onClick={event => { event.stopPropagation(); void convert(idea) }}>Convertir <ArrowRight size={14} /></button>}</div></footer>
    </article>)}</div> : <div className="ideas-empty"><Lightbulb size={34} /><strong>No hay ideas en este filtro</strong><span>Importa un archivo o cambia el estado seleccionado.</span><button className="new-button" onClick={() => setDraft(blankIdea(activeSpace || 'Mi contenido'))}><Plus size={17} /> Nueva idea</button></div>}
    {ideasInSpace.length > 0 && <div className="ideas-pagination"><button disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Anterior</button><span>{page} / {pageCount}</span><button disabled={page >= pageCount} onClick={() => setPage(current => current + 1)}>Siguiente</button></div>}
    {draft && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDraft(null) }}><form className="space-dialog idea-dialog" onSubmit={event => { event.preventDefault(); void save() }}><header><div><span>{draft.id ? 'EDITAR IDEA' : 'NUEVA IDEA'}</span><h2>{draft.title || 'Idea sin titulo'}</h2></div><button type="button" className="icon-button" onClick={() => setDraft(null)}><X size={18} /></button></header><label>Titulo<input autoFocus value={draft.title} maxLength={240} onChange={event => setDraft(current => current ? { ...current, title: event.target.value } : current)} placeholder="Describe la idea" /></label><label>Desarrollo<textarea value={draft.body} maxLength={20_000} onChange={event => setDraft(current => current ? { ...current, body: event.target.value } : current)} placeholder="Anota el enfoque, datos o una primera version" /></label><div className="idea-dialog-row"><label>Estado<select value={draft.status} onChange={event => setDraft(current => current ? { ...current, status: event.target.value as IdeaStatus } : current)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Prioridad<select value={draft.priority} onChange={event => setDraft(current => current ? { ...current, priority: event.target.value as IdeaPriority } : current)}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label>Espacio<input value={draft.space} maxLength={200} onChange={event => setDraft(current => current ? { ...current, space: event.target.value } : current)} /></label><footer><button type="button" className="ghost-button" onClick={() => setDraft(null)}>Cancelar</button><button type="button" className="ghost-button" disabled={!draft.title.trim()} onClick={() => void saveAndConvert()}>Guardar y convertir</button><button className="save-button" disabled={!draft.title.trim()}>Guardar idea</button></footer></form></div>}
  </section>
}
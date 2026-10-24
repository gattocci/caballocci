import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, Combine, ExternalLink, Layers3, Lightbulb, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { ViewHeading } from '../../components/layout/AppShell'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { ideaMatchesQuery, usePlanner } from '../../app/store'
import type { Idea, IdeaAnalysisOptions, IdeaAnalysisProgress, IdeaCluster, IdeaImportRun, IdeaInput, IdeaNeighbor, IdeaPriority, IdeaStatus } from '../../shared/types'
import { buildClusterReview, developSelectedClusterIdeas, ideaCorpusSignature } from './cluster-triage'
import './ideas.css'

const blankIdea = (space: string): IdeaInput => ({
  space, title: '', body: '', tags: [], media: [], status: 'inbox', priority: 'normal', dueDate: null,
})

const priorityLabels: Record<IdeaPriority, string> = { low: 'Baja', normal: 'Normal', high: 'Alta' }
const statusLabels: Record<IdeaStatus, string> = { inbox: 'Nueva', developing: 'En desarrollo', ready: 'Lista', converted: 'Convertida', archived: 'Archivada' }
const analysisProgressLabels: Record<IdeaAnalysisProgress['stage'], string> = {
  'loading-model': 'Cargando modelo de embeddings',
  embeddings: 'Preparando embeddings',
  comparing: 'Comparando similitudes entre ideas',
  grouping: 'Formando grupos con las coincidencias',
  saving: 'Guardando resultados',
  done: 'Análisis completado',
}
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
function readMarkedSeries(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('caballocci.ideas.marked-series') || '[]')
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []
  } catch { return [] }
}
function clusterMembershipKey(ideaIds: string[]) {
  return JSON.stringify([...ideaIds].sort())
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

function previewImportDuplicates(inputs: IdeaInput[], existingIdeas: Idea[]) {
  const knownBodies = new Map<string, { title: string; sourceName: string; source: 'workspace' | 'file' }>()
  existingIdeas.forEach(idea => knownBodies.set(ideaKey(idea), { title: idea.title || '', sourceName: idea.sourceName || '', source: 'workspace' }))
  const duplicates: Array<{ incomingTitle: string; existingTitle: string; sourceName: string; existingSourceName: string; source: 'workspace' | 'file' }> = []
  const newCount = inputs.reduce((count, idea) => {
    const existing = knownBodies.get(ideaKey(idea))
    if (existing) {
      duplicates.push({
        incomingTitle: idea.title,
        existingTitle: existing.title,
        sourceName: idea.sourceName || '',
        existingSourceName: existing.sourceName || '',
        source: existing.source,
      })
      return count
    }
    knownBodies.set(ideaKey(idea), { title: idea.title, sourceName: idea.sourceName || '', source: 'file' })
    return count + 1
  }, 0)
  return { newCount, duplicates }
}

function exploratoryDuplicateKey(idea: Idea) {
  const title = idea.title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  const body = idea.body.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  return title || body ? JSON.stringify([title, body]) : ''
}

export function IdeasView() {
  const { ideas, activeSpace, setActiveSpace, saveIdea, saveIdeasMany, removeIdea, convertIdea, combineIdeas, ideaNeighbors, proposeClusters, select, setView, query, setQuery, selectedIdeaId, selectIdea } = usePlanner()
  const [draft, setDraft] = useState<IdeaInput | null>(null)
  const runSafely = (action: () => Promise<unknown>, context: string) => { void runWithErrorReporting(action, context) }
  useEffect(() => {
    if (!selectedIdeaId) return
    const idea = ideas.find(item => item.id === selectedIdeaId)
    if (idea) setDraft({ ...idea })
    selectIdea(null)
  }, [ideas, selectedIdeaId, selectIdea])
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState<{ fileName: string; ideas: IdeaInput[]; warning: string } | null>(null)
  const [importMessage, setImportMessage] = useState('')
  const [importDuplicates, setImportDuplicates] = useState<Array<{ title: string; existingTitle: string; existingSourceName: string }>>([])
  const [statusFilter, setStatusFilter] = useState<'active' | IdeaStatus>('active')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [neighbors, setNeighbors] = useState<IdeaNeighbor[]>([])
  const [clusters, setClusters] = useState<IdeaCluster[]>([])
  const [reportGeneratedAt, setReportGeneratedAt] = useState<string | null>(null)
  const [analysisRunning, setAnalysisRunning] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<IdeaAnalysisProgress | null>(null)
  const [expandedReportGroups, setExpandedReportGroups] = useState<string[]>([])
  const [suggestedVisibleCount, setSuggestedVisibleCount] = useState(3)
  const [suggestionSort, setSuggestionSort] = useState<'size' | 'affinity' | 'name'>('size')
  const [suggestionOrder, setSuggestionOrder] = useState<string[]>([])
  const [isolatedVisibleCount, setIsolatedVisibleCount] = useState(8)
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null)
  const [markedSeries, setMarkedSeries] = useState(readMarkedSeries)
  const clusterPanelRef = useRef<HTMLElement>(null)
  const [clusterQuery, setClusterQuery] = useState('')
  const [showSmallClusters, setShowSmallClusters] = useState(false)
  const [clusterAffinityFilter, setClusterAffinityFilter] = useState<'all' | '65' | '75' | '85'>('all')
  const [clusterSort, setClusterSort] = useState<'size' | 'affinity' | 'name'>('size')
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
  const ideasListRef = useRef<HTMLDivElement>(null)
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
  const ideasInSpace = useMemo(() => selectedOnly
    ? ideas.filter(idea => selectedIds.includes(idea.id))
    : scopedIdeas.filter(idea => statusFilter === 'active' ? idea.status === 'inbox' || idea.status === 'developing' || idea.status === 'ready' : idea.status === statusFilter).filter(idea => !familyFilter || (ideaFamily(idea.title, idea.sourceName).family || 'Otras') === familyFilter).filter(idea => ideaMatchesQuery(idea, query)), [familyFilter, ideas, query, scopedIdeas, selectedIds, selectedOnly, statusFilter])
  const pageSize = 40
  const importDuplicatePreview = useMemo(() => importPreview ? previewImportDuplicates(importPreview.ideas, ideas) : null, [ideas, importPreview])
  const pageCount = Math.max(1, Math.ceil(ideasInSpace.length / pageSize))
  const visibleIdeas = ideasInSpace.slice((page - 1) * pageSize, page * pageSize)
  const statusCount = (status: 'active' | IdeaStatus) => scopedIdeas.filter(idea => status === 'active' ? ['inbox', 'developing', 'ready'].includes(idea.status) : idea.status === status).filter(idea => !familyFilter || (ideaFamily(idea.title, idea.sourceName).family || 'Otras') === familyFilter).filter(idea => ideaMatchesQuery(idea, query)).length
  const clusterIdeas = (cluster: IdeaCluster) => cluster.ideaIds.map(id => ideas.find(idea => idea.id === id)).filter((idea): idea is Idea => Boolean(idea))
  const clusterAverageAffinity = (cluster: IdeaCluster) => {
    const scores = cluster.memberScores?.filter(score => Number.isFinite(score)) || []
    return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null
  }
  const visibleClusters = useMemo(() => {
    const normalizedQuery = clusterQuery.trim().toLocaleLowerCase()
    return clusters
      .filter(cluster => showSmallClusters || cluster.ideaIds.length >= 3)
      .filter(cluster => {
        if (clusterAffinityFilter === 'all') return true
        const affinity = clusterAverageAffinity(cluster)
        return affinity !== null && affinity >= Number(clusterAffinityFilter) / 100
      })
      .filter(cluster => !normalizedQuery || cluster.name.toLocaleLowerCase().includes(normalizedQuery) || clusterIdeas(cluster).some(idea => idea.title.toLocaleLowerCase().includes(normalizedQuery)))
      .sort((a, b) => {
        if (clusterSort === 'name') return a.name.localeCompare(b.name)
        if (clusterSort === 'affinity') return (clusterAverageAffinity(b) ?? -1) - (clusterAverageAffinity(a) ?? -1) || b.ideaIds.length - a.ideaIds.length
        return b.ideaIds.length - a.ideaIds.length || a.name.localeCompare(b.name)
      })
  }, [clusterAffinityFilter, clusterQuery, clusterSort, clusters, ideas, showSmallClusters])
  const activeCluster = visibleClusters.find(cluster => cluster.id === activeClusterId) || visibleClusters[0] || null
  const clusterReview = activeCluster ? (() => {
    const review = buildClusterReview(activeCluster, ideas)
    const members = review.members
    const prefix = commonTitlePrefix(members.map(member => member.idea.title))
    const isSeries = prefix.length > 0 && members.every(member => member.idea.title.length > 0) && prefix.length / Math.max(...members.map(member => member.idea.title.length)) > .6
    return {
      ...review,
      prefix: isSeries ? prefix : '',
    }
  })() : null
  const activeClusterSeriesKey = clusterReview ? clusterMembershipKey(clusterReview.members.map(({ idea }) => idea.id)) : ''
  const isActiveClusterMarkedSeries = Boolean(activeClusterSeriesKey && markedSeries.includes(activeClusterSeriesKey))
  const reportSummary = useMemo(() => {
    if (!reportGeneratedAt) return null
    const clusteredIds = new Set(clusters.flatMap(cluster => cluster.ideaIds))
    const duplicateMap = new Map<string, Idea[]>()
    for (const idea of ideas) {
      const key = exploratoryDuplicateKey(idea)
      if (key) duplicateMap.set(key, [...(duplicateMap.get(key) || []), idea])
    }
    return {
      total: ideas.length,
      grouped: ideas.filter(idea => clusteredIds.has(idea.id)).length,
      distribution: (['inbox', 'developing', 'ready', 'converted', 'archived'] as const).map(status => ({
        status,
        count: ideas.filter(idea => idea.status === status).length,
      })),
      isolated: ideas.filter(idea => !clusteredIds.has(idea.id)),
      duplicates: [...duplicateMap.values()].filter(group => group.length > 1).sort((a, b) => b.length - a.length),
      developmentGroups: [...clusters],
    }
  }, [clusters, ideas, reportGeneratedAt])
  const suggestedGroups = useMemo(() => {
    const sorted = [...(reportSummary?.developmentGroups || [])].sort((a, b) => {
      if (suggestionSort === 'name') return a.name.localeCompare(b.name)
      if (suggestionSort === 'affinity') return (clusterAverageAffinity(b) ?? -1) - (clusterAverageAffinity(a) ?? -1) || b.ideaIds.length - a.ideaIds.length
      return b.ideaIds.length - a.ideaIds.length || a.name.localeCompare(b.name)
    })
    if (!suggestionOrder.length) return sorted
    const byId = new Map(sorted.map(cluster => [cluster.id, cluster]))
    return [...suggestionOrder.map(id => byId.get(id)).filter((cluster): cluster is IdeaCluster => Boolean(cluster)), ...sorted.filter(cluster => !suggestionOrder.includes(cluster.id))]
  }, [reportSummary, suggestionOrder, suggestionSort])
  const analysisCorpusSignature = useMemo(() => ideaCorpusSignature(ideas), [ideas])
  const corpusRevision = useRef(0)
  useEffect(() => {
    corpusRevision.current += 1
    setClusters([])
    setActiveClusterId(null)
    setReportGeneratedAt(null)
  }, [analysisCorpusSignature])
  useEffect(() => { setPage(1); setSelectedIds([]); setSelectedOnly(false) }, [query, statusFilter, activeSpace, familyFilter])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])
  useEffect(() => { try { localStorage.setItem('caballocci.ideas.analysis-ignored-terms', ignoredTermsText) } catch { /* Optional local preference. */ } }, [ignoredTermsText])
  useEffect(() => { try { localStorage.setItem('caballocci.ideas.analysis-options', JSON.stringify(analysisOptions)) } catch { /* Optional local preference. */ } }, [analysisOptions])
  useEffect(() => { try { localStorage.setItem('caballocci.ideas.marked-series', JSON.stringify(markedSeries)) } catch { /* Optional local preference. */ } }, [markedSeries])
  useEffect(() => { if (familyPatternsState.valid) { try { localStorage.setItem('caballocci.ideas.family-patterns', familyPatternsText) } catch { /* Optional local preference. */ } } }, [familyPatternsState.valid, familyPatternsText])
  useEffect(() => {
    let active = true
    void window.planner.ideas.importHistory()
      .then(history => { if (active) setImportHistory(history) })
      .catch(error => { if (active) reportAppError(error, 'No se pudo cargar el historial de importaciones') })
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      void window.planner.ideas.analysisPreview(ignoredTerms, analysisOptions)
        .then(result => { if (active) setAutomaticTerms(result.automaticTerms) })
        .catch(error => { if (active) reportAppError(error, 'No se pudo preparar la vista previa del análisis') })
    }, 180)
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
      if (!parsed.length) { reportAppError('No se encontraron ideas con contenido en el archivo. Comprueba el formato e inténtalo de nuevo.', 'No se pudo importar el archivo'); return }
      const sourceHeaders = [...file.text.matchAll(/(?:^|\n)\s*(?:#{1,6}\s*)?\*\*\s*(\d+[.)]?\s*[^*\n]+?)\s*\*\*/gm)].length
      const warning = sourceHeaders > 0 && sourceHeaders !== parsed.length
        ? `El archivo contiene ${sourceHeaders} encabezados numerados y se pudieron preparar ${parsed.length} ideas.`
        : ''
      setIdeasTab('ideas')
      setImportMessage('')
      setImportDuplicates([])
      setImportPreview({ fileName: file.name, ideas: parsed, warning })
    } finally { setImporting(false) }
  }
  const confirmImport = async () => {
    if (!importPreview) return
    setImporting(true)
    try {
      const result = await saveIdeasMany(importPreview.ideas)
      setImportMessage(`${result.created.length} de ${importPreview.ideas.length} ideas importadas${result.skipped ? ` · ${result.skipped} duplicadas omitidas` : ''}.`)
      setImportDuplicates(result.duplicates)
      setImportPreview(null)
      setImportHistory(await window.planner.ideas.importHistory())
    } finally { setImporting(false) }
  }
  const toggleSelected = (id: string) => setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  const updateSelectedIdeas = (ids: string[], selected: boolean) => setSelectedIds(current => selected
    ? [...new Set([...current, ...ids])]
    : current.filter(id => !ids.includes(id)))
  const showSelectedIdeas = () => {
    setSelectedOnly(true)
    setPage(1)
    setClusterSelection(true)
    requestAnimationFrame(() => ideasListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const selectIsolatedIdeas = () => {
    if (!reportSummary) return
    const isolatedIds = reportSummary.isolated.map(idea => idea.id)
    const allSelected = isolatedIds.every(id => selectedIds.includes(id))
    updateSelectedIdeas(isolatedIds, !allSelected)
  }
  const reviewCluster = (clusterId: string) => {
    const cluster = clusters.find(item => item.id === clusterId)
    if (cluster && cluster.ideaIds.length < 3) setShowSmallClusters(true)
    setClusterQuery('')
    setActiveClusterId(clusterId)
    requestAnimationFrame(() => clusterPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const replaceSuggestedGroup = (clusterId: string) => {
    const allGroups = suggestedGroups
    const shown = allGroups.slice(0, suggestedVisibleCount)
    const alternatives = allGroups.filter(cluster => !shown.some(item => item.id === cluster.id))
    if (!alternatives.length) return
    const replacement = alternatives[Math.floor(Math.random() * alternatives.length)]
    const nextVisibleIds = shown.map(cluster => cluster.id === clusterId ? replacement.id : cluster.id)
    const visibleIds = new Set(nextVisibleIds)
    setSuggestionOrder([...nextVisibleIds, ...allGroups.filter(cluster => !visibleIds.has(cluster.id)).map(cluster => cluster.id)])
  }
  const clearClusterView = () => {
    setClusterSelection(false)
    setSelectedOnly(false)
    setSelectedIds([])
    setPage(1)
  }
  const resetIdeaFilters = () => {
    setStatusFilter('active')
    setFamilyFilter('')
    setQuery('')
    setPage(1)
    setSelectedIds([])
    setSelectedOnly(false)
    setClusterSelection(false)
    if (ideas.length && activeSpace && scopedIdeas.length === 0) setActiveSpace(null)
  }
  const selectVisible = () => setSelectedIds(current => current.length === visibleIdeas.length ? [] : visibleIdeas.map(idea => idea.id))
  const bulkStatus = async (status: IdeaStatus) => {
    if (!selectedIds.length) return
    for (const id of selectedIds) { const idea = ideas.find(item => item.id === id); if (idea) await saveIdea({ ...idea, status }) }
    setSelectedIds([])
    setClusterSelection(false)
  }
  const developClusterSelection = async (cluster: IdeaCluster) => {
    const count = await developSelectedClusterIdeas(cluster, ideas, selectedIds, saveIdea)
    if (!count) return
    setAnalysisMessage(`${count} ${count === 1 ? 'idea pasó' : 'ideas pasaron'} a En desarrollo.`)
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
    try {
      setNeighbors(await ideaNeighbors(selectedIds[0], 8, ignoredTerms, analysisOptions))
    } finally {
      setAnalysisMessage('')
    }
  }
  const generateExploratoryReport = async () => {
    const startingRevision = corpusRevision.current
    setAnalysisRunning(true)
    setAnalysisProgress({ stage: 'loading-model', completed: 0, total: 0 })
    setIsolatedVisibleCount(8)
    setAnalysisMessage('')
    setSuggestedVisibleCount(3)
    setSuggestionOrder([])
    try {
      if (!ideas.length) {
        setClusters([])
        setReportGeneratedAt(new Date().toISOString())
        setAnalysisProgress({ stage: 'done', completed: 1, total: 1 })
        setAnalysisMessage('')
        return
      }
      const proposed = await proposeClusters(0.65, ignoredTerms, analysisOptions, setAnalysisProgress)
      if (startingRevision !== corpusRevision.current) {
        setAnalysisMessage('El corpus cambió durante el análisis. Vuelve a generar el informe para incluir los cambios.')
        return
      }
      setClusters(proposed)
      setActiveClusterId(proposed[0]?.id || null)
      setReportGeneratedAt(new Date().toISOString())
      setAnalysisMessage(proposed.length ? '' : 'No se encontraron grupos suficientemente relacionados; los fragmentos sin grupo siguen disponibles en el informe.')
    } finally {
      setAnalysisRunning(false)
    }
  }
  const bulkRemove = async () => {
    if (!selectedIds.length || !window.confirm(`¿Eliminar ${selectedIds.length} ideas seleccionadas?`)) return
    for (const id of selectedIds) await removeIdea(id)
    setSelectedIds([])
  }

  return <section className={`workspace ideas-workspace ${ideasTab === 'imports' ? 'show-import-history' : ''}`}>
    <ViewHeading title="Ideas" subtitle="Captura, desarrolla y convierte tus ideas en contenido.">
      <button type="button" className="settings-button" disabled={importing} onClick={() => runSafely(importFile, 'No se pudo importar el archivo')}>{importing ? 'Importando...' : 'Importar .md / .txt'}</button><button type="button" className="settings-button" disabled={importing || analysisRunning} onClick={() => runSafely(generateExploratoryReport, 'No se pudo generar el análisis')}><Layers3 size={14} /> {analysisRunning ? 'Generando clústers...' : 'Generar clústers'}</button><button type="button" className="new-button" onClick={() => setDraft(blankIdea(activeSpace || 'Mi contenido'))}><Plus size={17} /> Nueva idea</button>
    </ViewHeading>
    <div className="ideas-tabs" role="tablist"><button type="button" role="tab" aria-selected={ideasTab === 'ideas'} className={ideasTab === 'ideas' ? 'active' : ''} onClick={() => setIdeasTab('ideas')}>Ideas</button><button type="button" role="tab" aria-selected={ideasTab === 'imports'} className={ideasTab === 'imports' ? 'active' : ''} onClick={() => setIdeasTab('imports')}>Historial de importaciones <span>{importHistory.length}</span></button></div>
    {ideasTab === 'imports' && <section className="ideas-import-history"><header><div><span>ARCHIVOS LOCALES</span><h2>Historial de importaciones</h2></div><button type="button" className="settings-button" onClick={() => runSafely(async () => setImportHistory(await window.planner.ideas.importHistory()), 'No se pudo actualizar el historial')}>Actualizar</button></header>{importHistory.length ? <div className="ideas-import-history-list">{importHistory.map(run => <article key={run.id}><div><strong>{run.fileName}</strong><small>{new Date(run.importedAt).toLocaleString()} · {run.space || 'Todos los contenidos'}</small></div><div className="ideas-import-stats"><span>{run.total} detectadas</span><span>{run.created} nuevas</span><span>{run.skipped} duplicadas</span></div></article>)}</div> : <p className="ideas-import-history-empty">Todavía no hay importaciones registradas.</p>}</section>}
    {importMessage && <div className="ideas-import-result"><p className="ideas-import-message">{importMessage}</p>{importDuplicates.length > 0 && <details><summary>Ver {importDuplicates.length} coincidencias existentes</summary><ul>{importDuplicates.map((duplicate, index) => <li key={`${duplicate.title}-${index}`}><strong>{duplicate.title}</strong><span>ya existe como “{duplicate.existingTitle}”{duplicate.existingSourceName ? ` · ${duplicate.existingSourceName}` : ''}</span></li>)}</ul></details>}</div>}
    {importPreview && importDuplicatePreview && <section className="ideas-import-preview" aria-label="Vista previa de importación">
      <header><div><span>VISTA PREVIA</span><h2>{importPreview.fileName}</h2><p>Revisa qué se añadirá antes de guardar. Las coincidencias se vuelven a comprobar al importar.</p></div><button type="button" className="icon-button" aria-label="Cancelar importación" onClick={() => setImportPreview(null)}><X size={16} /></button></header>
      {importPreview.warning && <p className="ideas-import-warning" role="status">{importPreview.warning}</p>}
      <div className="ideas-import-preview-stats"><article><strong>{importPreview.ideas.length}</strong><span>ideas detectadas</span></article><article><strong>{importDuplicatePreview.newCount}</strong><span>nuevas</span></article><article><strong>{importDuplicatePreview.duplicates.length}</strong><span>duplicadas que se omitirán</span></article></div>
      <details className="ideas-import-preview-list"><summary>Revisar {importPreview.ideas.length} ideas preparadas</summary><ul>{importPreview.ideas.map((idea, index) => <li key={`${index}-${idea.title}`}><strong>{idea.title || 'Idea sin título'}</strong><span>{idea.body.slice(0, 220)}{idea.body.length > 220 ? '…' : ''}</span></li>)}</ul></details>
      {importDuplicatePreview.duplicates.length > 0 && <details className="ideas-import-preview-list"><summary>Ver {importDuplicatePreview.duplicates.length} coincidencias</summary><ul>{importDuplicatePreview.duplicates.map((duplicate, index) => <li key={`${index}-${duplicate.incomingTitle}`}><strong>{duplicate.incomingTitle}</strong><span>{duplicate.source === 'file' ? `Repetida en este archivo; primera entrada: “${duplicate.existingTitle}”` : `Ya existe como “${duplicate.existingTitle}”`}{duplicate.existingSourceName ? ` · ${duplicate.existingSourceName}` : ''}</span></li>)}</ul></details>}
      <footer><button type="button" className="ghost-button" disabled={importing} onClick={() => setImportPreview(null)}>Cancelar</button><button type="button" className="save-button" disabled={importing} onClick={() => runSafely(confirmImport, 'No se pudo importar el archivo')}>{importing ? 'Importando…' : `Importar lote · ${importDuplicatePreview.newCount} nuevas`}</button></footer>
    </section>}
    <div className="ideas-toolbar">{!selectedOnly && <div className="idea-status-filters" role="group" aria-label="Filtrar ideas por estado">{statusFilters.map(filter => <button type="button" key={filter.value} aria-pressed={statusFilter === filter.value} className={statusFilter === filter.value ? 'active' : ''} onClick={() => { setStatusFilter(filter.value); setPage(1); setSelectedIds([]); setSelectedOnly(false); setClusterSelection(false) }}>{filter.label} <span>{statusCount(filter.value)}</span></button>)}</div>}<span>{selectedOnly ? `${ideasInSpace.length} seleccionadas · filtros pausados` : `${ideasInSpace.length} ideas · página ${page} de ${pageCount}`}</span>{selectedOnly ? <button type="button" className="settings-button" onClick={clearClusterView}>Ver todas</button> : <button type="button" className="settings-button" onClick={selectVisible}>{selectedIds.length === visibleIdeas.length && visibleIdeas.length ? 'Quitar selección' : 'Seleccionar página'}</button>}</div>
    {!selectedOnly && <div className="ideas-family-filters" role="group" aria-label="Filtrar ideas por familia"><button type="button" className={!familyFilter ? 'active' : ''} onClick={() => setFamilyFilter('')}>Todas <span>{scopedIdeas.length}</span></button>{familyCounts.map(([family, count]) => <button type="button" key={family} className={familyFilter === family ? 'active' : ''} onClick={() => setFamilyFilter(family)}>{family} <span>{count}</span></button>)}</div>}
    <details className="idea-analysis-settings"><summary>Configuración del análisis local</summary>
      <p className="idea-analysis-intro">Ajusta qué señales se comparan al encontrar ideas relacionadas. Estos cambios no editan tus ideas originales.</p>
      <details className="family-pattern-advanced"><summary>Avanzado · patrones de familia por fuente</summary><div className="family-pattern-field"><span>Configuración JSON</span><div className={`family-pattern-editor ${familyPatternsState.valid ? 'valid' : 'invalid'}`}><div className="family-pattern-tools"><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertFamilyPair('[', ']')} title="Insertar corchetes">{'[ ]'}</button><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertFamilyPair('{', '}')} title="Insertar llaves">{'{ }'}</button><button type="button" onMouseDown={event => event.preventDefault()} onClick={formatFamilyPatterns} disabled={!familyPatternsState.valid} title="Dar formato al JSON">Formatear</button></div><textarea aria-label="Configuración JSON" ref={familyPatternsRef} value={familyPatternsText} onChange={event => setFamilyPatternsText(event.target.value)} placeholder={'{\n  "TikTok": "^(HOOK|CTA)\\s*:",\n  "Newsletter": "^\\[\\w+\\]"\n}'} /><span className={familyPatternsState.valid ? 'family-pattern-badge valid' : 'family-pattern-badge invalid'}>{familyPatternsState.valid ? '✓ JSON válido' : '✕ JSON inválido'}</span></div><small>La clave es el nombre exacto de la fuente.</small><small>El valor es una regex; se retira del título lo que coincida.</small>{!familyPatternsState.valid && <small className="family-pattern-status invalid">{familyPatternsState.message}</small>}</div><div className="family-pattern-tester"><strong>Probar patrón</strong><div><input value={familyTestSource} onChange={event => { setFamilyTestSource(event.target.value); setFamilyTestResult(null) }} placeholder="Fuente" /><input value={familyTestTitle} onChange={event => { setFamilyTestTitle(event.target.value); setFamilyTestResult(null) }} placeholder="Pega un título de ejemplo" /><button type="button" className="settings-button" onClick={() => setFamilyTestResult(testFamilyPattern(familyTestTitle, familyTestSource, familyPatternsText))}>Probar</button></div>{familyTestResult && <small className={familyTestResult.ok ? 'family-test-result valid' : 'family-test-result invalid'}>{familyTestResult.message}{familyTestResult.title !== undefined && <><br /><strong>{familyTestResult.title}</strong></>}</small>}</div></details>
      <label>Términos que quieres ignorar<textarea value={ignoredTermsText} onChange={event => setIgnoredTermsText(event.target.value)} placeholder="ejemplo, ejemplo, ejemplo" /></label>
      <label>Prefijos editoriales que quieres ignorar<textarea value={analysisOptions.editorialPrefixes.join('\n')} onChange={event => setAnalysisOptions(current => ({ ...current, editorialPrefixes: event.target.value.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean) }))} placeholder={'ejemplo\nejemplo'} /></label>
      <div className="idea-analysis-options"><label><input type="checkbox" checked={analysisOptions.stripColonPrefixes} onChange={event => setAnalysisOptions(current => ({ ...current, stripColonPrefixes: event.target.checked }))} /> Quitar prefijo antes de dos puntos en títulos</label><label><input type="checkbox" checked={analysisOptions.stripBracketedText} onChange={event => setAnalysisOptions(current => ({ ...current, stripBracketedText: event.target.checked }))} /> Excluir texto entre corchetes</label><label><input type="checkbox" checked={analysisOptions.stripNumbers} onChange={event => setAnalysisOptions(current => ({ ...current, stripNumbers: event.target.checked }))} /> Excluir números de los embeddings</label><label><input type="checkbox" checked={analysisOptions.ignoreTitleNumbersInClusterNames} onChange={event => setAnalysisOptions(current => ({ ...current, ignoreTitleNumbersInClusterNames: event.target.checked }))} /> Ignorar números de títulos al nombrar clusters</label></div>
      <details className="idea-analysis-advanced"><summary>Avanzado · sensibilidad y términos automáticos</summary><p>Úsalo solo si los grupos incluyen demasiadas coincidencias genéricas o dejan fuera ideas relacionadas.</p>
        <div className="idea-analysis-numeric"><label>Longitud mínima de palabra<input type="number" min="1" max="10" value={analysisOptions.minTokenLength} onChange={event => setAnalysisOptions(current => ({ ...current, minTokenLength: Math.max(1, Math.min(10, Number(event.target.value) || 1)) }))} /></label><label>Umbral de términos repetidos (%)<input type="number" min="1" max="100" value={Math.round(analysisOptions.genericTermThreshold * 100)} onChange={event => setAnalysisOptions(current => ({ ...current, genericTermThreshold: Math.max(0.01, Math.min(1, (Number(event.target.value) || 1) / 100)) }))} /></label></div>
        <div className="idea-analysis-preview"><strong>Excluir automáticamente ({automaticTerms.length})</strong><span>{automaticTerms.slice(0, 80).join(', ') || 'No se detectaron términos frecuentes'}{automaticTerms.length > 80 ? ', …' : ''}</span></div>
      </details>
      <small>La configuración se guarda en este dispositivo. Los originales no se modifican; el siguiente análisis regenerará los vectores si cambian las reglas.</small>
    </details>
    {analysisRunning && analysisProgress && <div className="ideas-analysis-progress" role="status" aria-live="polite">
      <div><strong>{analysisProgressLabels[analysisProgress.stage]}</strong><span>{analysisProgress.stage === 'loading-model'
        ? 'La primera ejecución puede descargar el modelo; el tiempo depende del dispositivo y la conexión.'
        : analysisProgress.stage === 'embeddings'
        ? `${analysisProgress.completed} de ${analysisProgress.total} ideas preparadas`
        : analysisProgress.stage === 'comparing'
        ? `${analysisProgress.completed.toLocaleString()} de ${analysisProgress.total.toLocaleString()} pares comparados`
        : analysisProgress.stage === 'done'
        ? '100%'
        : 'Paso en curso'}</span></div>
      {analysisProgress.total > 0
        ? <progress max={analysisProgress.total} value={analysisProgress.completed} aria-label={analysisProgressLabels[analysisProgress.stage]} />
        : <div className="ideas-analysis-progress-bar indeterminate" role="progressbar" aria-label={analysisProgressLabels[analysisProgress.stage]} />}
      {analysisProgress.total > 0 && <small>{Math.floor(analysisProgress.completed / analysisProgress.total * 100)}% de esta fase</small>}
    </div>}
    {analysisMessage && <p className="ideas-analysis-message">{analysisMessage}</p>}
    {neighbors.length > 0 && <section className="ideas-analysis-panel"><header><strong>Ideas parecidas</strong><button type="button" className="icon-button" onClick={() => setNeighbors([])}><X size={14} /></button></header><div>{neighbors.map(idea => <button type="button" key={idea.id} onClick={() => { setSelectedIds([idea.id]); setNeighbors([]) }}><span>{idea.title || 'Idea sin titulo'}</span><small>{Math.round(idea.similarity * 100)}% de similitud</small></button>)}</div></section>}
    {reportSummary && <section className="ideas-analysis-panel exploratory-report">
      <header><div><strong>Informe del corpus</strong><small>Generado {new Date(reportGeneratedAt!).toLocaleString()}</small></div><button type="button" className="icon-button" aria-label="Cerrar informe" onClick={() => { setReportGeneratedAt(null); setClusters([]); setActiveClusterId(null) }}><X size={14} /></button></header>
      <div className="exploratory-report-stats">
        <article><strong>{reportSummary.total}</strong><small>ideas en el corpus</small></article>
        <article><strong>{reportSummary.grouped}</strong><small>ideas dentro de grupos</small></article>
        <article><strong>{reportSummary.isolated.length}</strong><small>ideas para explorar por separado</small></article>
        <article><strong>{reportSummary.duplicates.length}</strong><small>coincidencias exactas</small></article>
      </div>
      <div className="exploratory-report-distribution"><strong>Estado:</strong>{reportSummary.distribution.map(({ status, count }) => <span key={status}>{statusLabels[status]} {count}</span>)}</div>
      {reportSummary.developmentGroups.length > 0 && <section className="exploratory-report-section">
        <div className="exploratory-report-section-heading"><h3>Grupos sugeridos para revisar <small>{suggestedGroups.length} grupos detectados</small></h3><p className="exploratory-report-note">Son propuestas ordenadas, no recomendaciones automáticas. Cambiar o mostrar grupos no modifica ni deselecciona las ideas ya elegidas.</p></div>
        <div className="exploratory-report-group-controls">
          <label>Ordenar<select value={suggestionSort} onChange={event => { setSuggestionSort(event.target.value as typeof suggestionSort); setSuggestionOrder([]) }}><option value="size">Más ideas</option><option value="affinity">Mayor afinidad media</option><option value="name">Nombre</option></select></label>
          <span>Mostrando {Math.min(suggestedVisibleCount, suggestedGroups.length)} de {suggestedGroups.length}</span>
          {suggestedVisibleCount < suggestedGroups.length && <><button type="button" className="settings-button" onClick={() => setSuggestedVisibleCount(count => Math.min(count + 1, suggestedGroups.length))}>Mostrar 1 más</button><button type="button" className="settings-button" onClick={() => setSuggestedVisibleCount(count => Math.min(count + 3, suggestedGroups.length))}>Mostrar 3 más</button><button type="button" className="exploratory-report-text-button" onClick={() => setSuggestedVisibleCount(suggestedGroups.length)}>Ver todos</button></>}
          {suggestedVisibleCount > 3 && <button type="button" className="exploratory-report-text-button" onClick={() => setSuggestedVisibleCount(3)}>Volver a 3</button>}
        </div>
        <div className="exploratory-report-groups">{suggestedGroups.slice(0, suggestedVisibleCount).map(cluster => {
          const members = clusterIdeas(cluster)
          const groupIds = members.map(idea => idea.id)
          const selectedCount = groupIds.filter(id => selectedIds.includes(id)).length
          const expanded = expandedReportGroups.includes(cluster.id)
          const shownMembers = expanded ? members : members.slice(0, 3)
          const averageAffinity = clusterAverageAffinity(cluster)
          return <article key={cluster.id}>
            <div className="exploratory-report-group-heading"><strong>{cluster.name}</strong><small>{members.length} ideas · {selectedCount} seleccionadas{averageAffinity !== null ? ` · afinidad media ${Math.round(averageAffinity * 100)}%` : ''}</small></div>
            <div className="exploratory-report-members">{shownMembers.map(idea => <label className="exploratory-report-member" key={idea.id}><input type="checkbox" checked={selectedIds.includes(idea.id)} onChange={event => updateSelectedIdeas([idea.id], event.target.checked)} /><button type="button" onClick={() => edit(idea)}>{idea.title || idea.body.slice(0, 80) || 'Idea sin título'}</button></label>)}</div>
            {members.length > 3 && <button type="button" className="exploratory-report-text-button" onClick={() => setExpandedReportGroups(current => expanded ? current.filter(id => id !== cluster.id) : [...current, cluster.id])}>{expanded ? 'Mostrar menos' : `Ver las ${members.length - 3} ideas restantes`}</button>}
            <div className="exploratory-report-group-actions"><button type="button" className="settings-button" disabled={selectedCount === groupIds.length} onClick={() => updateSelectedIdeas(groupIds, true)}>Seleccionar ideas del grupo</button><button type="button" className="settings-button" disabled={!selectedCount} onClick={() => updateSelectedIdeas(groupIds, false)}>Deseleccionar ideas</button><button type="button" className="exploratory-report-text-button" disabled={suggestedGroups.length <= suggestedVisibleCount} onClick={() => replaceSuggestedGroup(cluster.id)}>Cambiar por otro grupo</button></div>
            <button type="button" className="exploratory-report-text-button" onClick={() => reviewCluster(cluster.id)}>Ver afinidad y detalles del grupo</button>
          </article>
        })}</div>
        {selectedIds.length > 0 && <div className="exploratory-report-selection"><strong>{selectedIds.length} {selectedIds.length === 1 ? 'idea elegida' : 'ideas elegidas'}</strong><button type="button" className="new-button" onClick={showSelectedIdeas}>Ver selección en la lista</button><button type="button" className="exploratory-report-text-button" onClick={() => setSelectedIds([])}>Limpiar selección</button></div>}
      </section>}
      {reportSummary.duplicates.length > 0 && <section className="exploratory-report-section">
        <h3>Textos idénticos <small>mismo título y contenido; revisa antes de borrar</small></h3>
        <div className="exploratory-report-duplicates">{reportSummary.duplicates.slice(0, 5).map((group, index) => <article key={`${group[0].id}-${index}`}><strong>{group.length} copias</strong>{group.map(idea => <button type="button" key={idea.id} onClick={() => edit(idea)}>{idea.title || idea.body.slice(0, 90) || 'Idea sin título'}<small>{idea.sourceName || idea.space}</small></button>)}</article>)}</div>
        {reportSummary.duplicates.length > 5 && <small className="exploratory-report-more">Hay {reportSummary.duplicates.length - 5} grupos más.</small>}
      </section>}
      {reportSummary.isolated.length > 0 && <section className="exploratory-report-section">
        <div className="exploratory-report-isolated-heading"><h3>Ideas para explorar individualmente <small>{reportSummary.isolated.length}</small></h3><p className="exploratory-report-note">Estas ideas no entraron en los grupos sugeridos; no significa que sean anomalías. Puedes revisarlas aquí, editar una o seleccionarlas para verlas juntas en la lista.</p></div>
        <div className="exploratory-report-isolated-actions">
          <span>{reportSummary.isolated.filter(idea => selectedIds.includes(idea.id)).length} de {reportSummary.isolated.length} seleccionadas</span>
          <button type="button" className="settings-button" onClick={selectIsolatedIdeas}>{reportSummary.isolated.every(idea => selectedIds.includes(idea.id)) ? 'Quitar selección' : 'Seleccionar todas'}</button>
          {selectedIds.some(id => reportSummary.isolated.some(idea => idea.id === id)) && <button type="button" className="new-button" onClick={showSelectedIdeas}>Ver selección en la lista</button>}
        </div>
        <div className="exploratory-report-isolated">{reportSummary.isolated.slice(0, isolatedVisibleCount).map(idea => <article key={idea.id} className={selectedIds.includes(idea.id) ? 'selected' : ''}>
          <label aria-label={`Seleccionar ${idea.title || 'idea sin título'}`}><input type="checkbox" checked={selectedIds.includes(idea.id)} onChange={event => updateSelectedIdeas([idea.id], event.target.checked)} /></label>
          <div><strong>{idea.title || 'Idea sin título'}</strong><small>{idea.body.slice(0, 150) || 'Sin texto adicional'}{idea.body.length > 150 ? '…' : ''}</small><small>{idea.sourceName || idea.space} · {statusLabels[idea.status]}</small></div>
          <button type="button" className="exploratory-report-isolated-edit" onClick={() => edit(idea)}>Editar</button>
        </article>)}</div>
        {reportSummary.isolated.length > 8 && <div className="exploratory-report-isolated-pagination">
          <span>Mostrando {Math.min(isolatedVisibleCount, reportSummary.isolated.length)} de {reportSummary.isolated.length} ideas</span>
          {isolatedVisibleCount < reportSummary.isolated.length
            ? <><button type="button" className="settings-button" onClick={() => setIsolatedVisibleCount(count => Math.min(count + 8, reportSummary.isolated.length))}>Ver 8 más ({reportSummary.isolated.length - isolatedVisibleCount} restantes)</button><button type="button" className="exploratory-report-text-button" onClick={() => setIsolatedVisibleCount(reportSummary.isolated.length)}>Mostrar todas</button></>
            : <button type="button" className="exploratory-report-text-button" onClick={() => setIsolatedVisibleCount(8)}>Mostrar solo 8</button>}
        </div>}
      </section>}
      {!reportSummary.total && <p className="exploratory-report-empty">El corpus está vacío. Importa o crea fragmentos para generar observaciones.</p>}
    </section>}
    {clusters.length > 0 && <section className="ideas-analysis-panel clusters-panel" ref={clusterPanelRef}>
      <header className="clusters-panel-header"><div><strong>Todos los grupos</strong><small>{visibleClusters.length} grupos visibles · la afinidad media es el promedio de similitud coseno entre las ideas del grupo</small></div><div className="clusters-panel-actions"><label className="clusters-search"><Search size={13} /><input value={clusterQuery} onChange={event => setClusterQuery(event.target.value)} placeholder="Buscar grupo" /></label><label className="clusters-filter">Afinidad mínima<select value={clusterAffinityFilter} onChange={event => setClusterAffinityFilter(event.target.value as typeof clusterAffinityFilter)}><option value="all">Cualquiera</option><option value="65">65%</option><option value="75">75%</option><option value="85">85%</option></select></label><label className="clusters-filter">Ordenar<select value={clusterSort} onChange={event => setClusterSort(event.target.value as typeof clusterSort)}><option value="size">Más ideas</option><option value="affinity">Mayor afinidad</option><option value="name">Nombre</option></select></label><button type="button" className={showSmallClusters ? 'settings-button active' : 'settings-button'} onClick={() => setShowSmallClusters(current => !current)}>{showSmallClusters ? 'Ocultar grupos de 2' : 'Ver grupos de 2'}</button><button type="button" className="icon-button" onClick={() => { setClusters([]); setActiveClusterId(null); setReportGeneratedAt(null) }}><X size={14} /></button></div></header>
      <div className="clusters-layout">
        <nav className="clusters-list" aria-label="Lista de grupos">{visibleClusters.map(cluster => { const items = clusterIdeas(cluster); const prefix = commonTitlePrefix(items.map(idea => idea.title)); const isSeries = prefix.length > 0 && items.every(idea => idea.title.length > 0) && prefix.length / Math.max(...items.map(idea => idea.title.length)) > .6; const affinity = clusterAverageAffinity(cluster); return <button type="button" key={cluster.id} className={activeCluster?.id === cluster.id ? 'active' : ''} onClick={() => setActiveClusterId(cluster.id)}><span>{cluster.name}</span><small>{items.length} ideas{affinity !== null ? ` · ${Math.round(affinity * 100)}% afinidad` : ''}{isSeries ? ' · posible serie' : ''}</small><em>{items.slice(0, 2).map(idea => clusterTitlePreview(idea, prefix)).join(' · ')}</em></button> })}{!visibleClusters.length && <p className="clusters-empty">No hay grupos que coincidan con estos filtros.</p>}</nav>
        {activeCluster && clusterReview && <div className="cluster-detail">
          <div className="cluster-detail-heading">
            <div><span>TRIAGE DEL GRUPO</span><h3>{activeCluster.name}</h3><small>{clusterReview.members.length} ideas · tema sugerido por similitud</small></div>
            <div className="cluster-detail-actions">
              <button type="button" className="settings-button" onClick={() => { const selectGroup = !activeCluster.ideaIds.every(id => selectedIds.includes(id)); updateSelectedIdeas(activeCluster.ideaIds, selectGroup); setSelectedOnly(false); setClusterSelection(true) }}>{activeCluster.ideaIds.every(id => selectedIds.includes(id)) ? 'Deseleccionar ideas' : 'Seleccionar ideas'}</button>
              <button type="button" className={isActiveClusterMarkedSeries ? 'settings-button active' : 'settings-button'} aria-pressed={isActiveClusterMarkedSeries} onClick={() => setMarkedSeries(current => isActiveClusterMarkedSeries ? current.filter(key => key !== activeClusterSeriesKey) : [...current, activeClusterSeriesKey])}>{isActiveClusterMarkedSeries ? 'Quitar marca de serie' : 'Marcar como serie'}</button>
              <button type="button" className="new-button" onClick={() => { updateSelectedIdeas(activeCluster.ideaIds, true); showSelectedIdeas() }}>Ver ideas</button>
            </div>
          </div>
          <section className="cluster-triage" aria-label="Resumen del grupo">
            <div><strong>Tema</strong><span>{activeCluster.name}</span></div>
            {isActiveClusterMarkedSeries && <div><strong>Clasificación manual</strong><span>Serie marcada por ti</span></div>}
            {clusterReview.prefix && <div><strong>Posible serie</strong><span>Prefijo repetido: “{clusterReview.prefix}”</span></div>}
            {clusterReview.meanScore !== null && <div><strong>Afinidad interna media</strong><span>{Math.round(clusterReview.meanScore * 100)}% <small>similitud media entre embeddings del grupo</small></span></div>}
            {clusterReview.mostAligned && <div><strong>Más alineada con el grupo</strong><span>{clusterReview.mostAligned.idea.title || clusterReview.mostAligned.idea.body.slice(0, 90) || 'Idea sin título'} · {Math.round(clusterReview.mostAligned.score * 100)}%</span></div>}
            {clusterReview.leastAligned && <div className="cluster-triage-review"><strong>Revisar encaje</strong><span>{clusterReview.leastAligned.idea.title || clusterReview.leastAligned.idea.body.slice(0, 90) || 'Idea sin título'} · afinidad media {Math.round(clusterReview.leastAligned.score * 100)}%</span></div>}
            <p>La afinidad es similitud coseno entre embeddings del modelo {activeCluster.model || 'multilingual-e5-small'}, expresada como porcentaje (no es probabilidad ni calidad). Cada idea muestra su promedio frente al resto; “Ver comparaciones” abre los valores individuales. Un grupo requiere similitud de al menos {Math.round((activeCluster.threshold ?? 0.65) * 100)}% entre cada par y que sean vecinos mutuos entre hasta {activeCluster.neighborLimit ?? 8} candidatos cercanos.</p>
          </section>
          <div className="cluster-ideas-list">{clusterReview.prefix && <div className="cluster-series-label"><span>Posible serie</span>{clusterReview.prefix}</div>}{clusterReview.members.map(({ idea, score, comparisons }) => {
            const isOutlier = clusterReview.leastAligned?.idea.id === idea.id
            return <article className={`cluster-idea-card ${selectedIds.includes(idea.id) ? 'selected' : ''} ${isOutlier ? 'review-fit' : ''}`} key={idea.id} onClick={() => edit(idea)}>
              <header><label onClick={event => event.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(idea.id)} onChange={() => toggleSelected(idea.id)} /><span>{idea.status === 'converted' ? 'Convertida' : statusLabels[idea.status]}</span></label><div><button type="button" title="Editar idea" onClick={event => { event.stopPropagation(); edit(idea) }}><Pencil size={13} /></button></div></header>
              <strong>{clusterTitlePreview(idea, clusterReview.prefix)}</strong>
              <small>{idea.body.slice(0, 130)}{idea.body.length > 130 ? '…' : ''}</small>
              {comparisons.length > 0 && <details className="cluster-affinity-details" onClick={event => event.stopPropagation()}><summary>Ver comparaciones con {comparisons.length} {comparisons.length === 1 ? 'idea' : 'ideas'}</summary><ul>{comparisons.map(comparison => {
                const comparedIdea = ideas.find(item => item.id === comparison.ideaId)
                return <li key={comparison.ideaId}><span>{comparedIdea?.title || comparedIdea?.body.slice(0, 70) || 'Idea sin título'}</span><strong>{(comparison.score * 100).toFixed(1)}%</strong></li>
              })}</ul></details>}
              <footer>{isOutlier ? <span className="cluster-fit-warning">Revisar encaje</span> : score !== undefined ? <span className="cluster-fit-score">Afinidad {Math.round(score * 100)}%</span> : null}{idea.status === 'converted' ? <span className="cluster-converted">Convertida</span> : <button type="button" onClick={event => { event.stopPropagation(); runSafely(() => convert(idea), 'No se pudo convertir la idea') }}>Convertir <ArrowRight size={13} /></button>}</footer>
            </article>
          })}</div>
          <div className="cluster-develop-actions">
            <span>{clusterReview.members.filter(({ idea }) => selectedIds.includes(idea.id)).length} ideas de este grupo seleccionadas</span>
            <button type="button" className="new-button" disabled={!clusterReview.members.some(({ idea }) => selectedIds.includes(idea.id) && idea.status !== 'developing')} onClick={() => runSafely(() => developClusterSelection(activeCluster), 'No se pudo actualizar la selección')}>Pasar selección a En desarrollo</button>
          </div>
        </div>}
      </div>
      {visibleClusters.some(cluster => cluster.ideaIds.length < 3) && !showSmallClusters && <button type="button" className="clusters-small-note" onClick={() => setShowSmallClusters(true)}>Hay {clusters.filter(cluster => cluster.ideaIds.length < 3).length} posibles duplicados o series de 2 ideas. Verlos.</button>}
    </section>}
    {selectedIds.length > 0 && <div className={`ideas-bulk-actions ${selectedOnly ? 'selected-ideas-actions' : ''}`} ref={ideasListRef}><strong>{selectedIds.length} seleccionadas</strong>{selectedIds.length === 1 && <button type="button" onClick={() => runSafely(findNeighbors, 'No se pudieron buscar ideas parecidas')}><Search size={13} /> Ideas parecidas</button>}{selectedIds.length >= 2 && <button type="button" onClick={() => runSafely(bulkCombine, 'No se pudieron combinar las ideas')}><Combine size={13} /> Combinar</button>}<button type="button" onClick={() => runSafely(() => bulkStatus('developing'), 'No se pudieron actualizar las ideas')}>Desarrollar</button><button type="button" onClick={() => runSafely(() => bulkStatus('ready'), 'No se pudieron actualizar las ideas')}>Marcar listas</button><button type="button" onClick={() => runSafely(bulkConvert, 'No se pudieron convertir las ideas')}>Convertir</button><button type="button" onClick={() => runSafely(() => bulkStatus('archived'), 'No se pudieron actualizar las ideas')}>Archivar</button><button type="button" onClick={() => runSafely(bulkRemove, 'No se pudieron eliminar las ideas')}>Eliminar</button></div>}
    {ideasInSpace.length ? <div className="ideas-grid">{visibleIdeas.map(idea => <article className={'idea-card ' + (selectedIds.includes(idea.id) ? 'selected' : '')} key={idea.id} onClick={event => { if (event.shiftKey || event.ctrlKey || event.metaKey || selectedIds.length > 0) toggleSelected(idea.id) }}>
      <header><label className="idea-select" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(idea.id)} onChange={() => toggleSelected(idea.id)} /> {idea.priority !== 'normal' && <span className={'idea-priority ' + idea.priority}>{priorityLabels[idea.priority]}</span>}</label><div><button type="button" title="Editar idea" onClick={event => { event.stopPropagation(); edit(idea) }}><Pencil size={15} /></button><button type="button" title="Eliminar idea" className="idea-delete" onClick={event => { event.stopPropagation(); if (window.confirm('Eliminar esta idea?')) runSafely(() => removeIdea(idea.id), 'No se pudo eliminar la idea') }}><Trash2 size={15} /></button></div></header>
      {ideaFamily(idea.title, idea.sourceName).family && <span className="idea-family-chip">{ideaFamily(idea.title, idea.sourceName).family}</span>} {idea.status !== 'inbox' && <span className={'idea-status ' + idea.status}>{statusLabels[idea.status]}</span>}{(idea.combinedPostIds.length > 0 || idea.combinedPostId) && <span className="idea-combined-badge">{idea.combinedPostIds.length > 1 ? `${idea.combinedPostIds.length} combinaciones` : 'Combinada'}</span>}<h2>{ideaFamily(idea.title, idea.sourceName).title || 'Idea sin titulo'}</h2><p>{idea.body || 'Sin desarrollo todavia.'}</p>
      <footer>{idea.dueDate && <span><CalendarDays size={13} />{new Date(idea.dueDate).toLocaleDateString()}</span>}<small>{idea.space}</small><div className="idea-links">{(idea.combinedPostIds.length > 0 ? idea.combinedPostIds : (idea.combinedPostId ? [idea.combinedPostId] : [])).map((postId, index) => <button type="button" key={postId} onClick={event => { event.stopPropagation(); select(postId); setView('board') }} title="Abrir publicacion combinada"><ExternalLink size={13} /> {index === 0 ? 'Ver combinado' : `Ver combinado ${index + 1}`}</button>)}{idea.postId ? <button type="button" onClick={event => { event.stopPropagation(); select(idea.postId!); setView('board') }} title="Abrir publicacion individual"><ExternalLink size={13} /> Ver publicacion</button> : <button type="button" onClick={event => { event.stopPropagation(); runSafely(() => convert(idea), 'No se pudo convertir la idea') }}>Convertir <ArrowRight size={14} /></button>}</div></footer>
    </article>)}</div> : <div className="ideas-empty" aria-live="polite"><Lightbulb size={34} /><strong>{selectedOnly ? 'No hay ideas en la selección' : scopedIdeas.length === 0 ? activeSpace ? 'Este espacio aún no tiene ideas' : 'Aún no tienes ideas' : 'No hay ideas con estos filtros'}</strong><span>{selectedOnly ? 'Elige ideas de un grupo o vuelve a la lista completa.' : scopedIdeas.length === 0 ? 'Crea una idea o importa un archivo para empezar.' : 'Prueba otro estado, familia o término de búsqueda.'}</span>{selectedOnly ? <button type="button" className="settings-button" onClick={clearClusterView}>Volver a la lista</button> : scopedIdeas.length === 0 && ideas.length > 0 ? <button type="button" className="settings-button" onClick={resetIdeaFilters}>Ver todos los espacios</button> : scopedIdeas.length > 0 ? <button type="button" className="settings-button" onClick={resetIdeaFilters}>Quitar filtros</button> : null}<button className="new-button" onClick={() => setDraft(blankIdea(activeSpace || 'Mi contenido'))}><Plus size={17} /> Nueva idea</button></div>}
    {ideasInSpace.length > 0 && <div className="ideas-pagination"><button disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Anterior</button><span>{page} / {pageCount}</span><button disabled={page >= pageCount} onClick={() => setPage(current => current + 1)}>Siguiente</button></div>}
    {draft && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDraft(null) }}><form className="space-dialog idea-dialog" onSubmit={event => { event.preventDefault(); runSafely(save, 'No se pudo guardar la idea') }}><header><div><span>{draft.id ? 'EDITAR IDEA' : 'NUEVA IDEA'}</span><h2>{draft.title || 'Idea sin titulo'}</h2></div><button type="button" className="icon-button" onClick={() => setDraft(null)}><X size={18} /></button></header><label>Titulo<input autoFocus value={draft.title} maxLength={240} onChange={event => setDraft(current => current ? { ...current, title: event.target.value } : current)} placeholder="Describe la idea" /></label><label>Desarrollo<textarea value={draft.body} maxLength={20_000} onChange={event => setDraft(current => current ? { ...current, body: event.target.value } : current)} placeholder="Anota el enfoque, datos o una primera version" /></label><div className="idea-dialog-row"><label>Estado<select value={draft.status} onChange={event => setDraft(current => current ? { ...current, status: event.target.value as IdeaStatus } : current)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Prioridad<select value={draft.priority} onChange={event => setDraft(current => current ? { ...current, priority: event.target.value as IdeaPriority } : current)}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label>Espacio<input value={draft.space} maxLength={200} onChange={event => setDraft(current => current ? { ...current, space: event.target.value } : current)} /></label><footer><button type="button" className="ghost-button" onClick={() => setDraft(null)}>Cancelar</button><button type="button" className="ghost-button" disabled={!draft.title.trim()} onClick={() => runSafely(saveAndConvert, 'No se pudo guardar y convertir la idea')}>Guardar y convertir</button><button className="save-button" disabled={!draft.title.trim()}>Guardar idea</button></footer></form></div>}
  </section>
}

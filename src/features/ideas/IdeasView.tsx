import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, Combine, ExternalLink, Layers3, Lightbulb, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { ViewHeading } from '../../components/layout/AppShell'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { ideaMatchesQuery, usePlanner } from '../../app/store'
import type { Idea, IdeaAnalysisOptions, IdeaAnalysisProgress, IdeaCluster, IdeaImportRun, IdeaInput, IdeaNeighbor, IdeaPriority, IdeaStatus } from '../../shared/types'
import { analysisProgressLabels, clusterMembershipKey, clusterTitlePreview, commonTitlePrefix, exploratoryDuplicateKey, ideaFamily, parseTextFile, previewImportDuplicates, priorityLabels, readAnalysisOptions, readFamilyPatterns, readIgnoredTerms, readMarkedSeries, statusFilters, statusLabels, testFamilyPattern } from './idea-utils'
import { buildClusterReview, developSelectedClusterIdeas, ideaCorpusSignature } from './cluster-triage'
import { IdeaImportPanels } from './IdeaImportPanels'
import { IdeaExploratoryReport } from './IdeaExploratoryReport'
import { IdeaClustersPanel } from './IdeaClustersPanel'
import { IdeaEditorDialog } from './IdeaEditorDialog'
import { IdeaAnalysisSettingsPanel } from './IdeaAnalysisSettingsPanel'
import './ideas.css'

const blankIdea = (space: string): IdeaInput => ({
  space, title: '', body: '', tags: [], media: [], status: 'inbox', priority: 'normal', dueDate: null,
})

export function IdeasView() {
  const { ideas, activeSpace, setActiveSpace, saveIdea, saveIdeasMany, removeIdea, convertIdea, combineIdeas, ideaNeighbors, proposeClusters, select, setView, query, setQuery, selectedIdeaId, selectIdea, groupRecentUndoActions } = usePlanner()
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
  const ideasListRef = useRef<HTMLDivElement>(null)
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
    let changed = 0
    for (const id of selectedIds) { const idea = ideas.find(item => item.id === id); if (idea) { await saveIdea({ ...idea, status }); changed += 1 } }
    groupRecentUndoActions(changed, `Cambiar estado de ${changed} ideas`)
    setSelectedIds([])
    setClusterSelection(false)
  }
  const developClusterSelection = async (cluster: IdeaCluster) => {
    const count = await developSelectedClusterIdeas(cluster, ideas, selectedIds, saveIdea)
    if (!count) return
    groupRecentUndoActions(count, `Desarrollar ${count} ideas`)
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
    <IdeaImportPanels
      ideasTab={ideasTab}
      importHistory={importHistory}
      importMessage={importMessage}
      importDuplicates={importDuplicates}
      importPreview={importPreview}
      importDuplicatePreview={importDuplicatePreview}
      importing={importing}
      onRefreshHistory={() => runSafely(async () => setImportHistory(await window.planner.ideas.importHistory()), 'No se pudo actualizar el historial')}
      onCancelPreview={() => setImportPreview(null)}
      onConfirmImport={() => runSafely(confirmImport, 'No se pudo importar el archivo')}
    />
    <div className="ideas-toolbar">{!selectedOnly && <div className="idea-status-filters" role="group" aria-label="Filtrar ideas por estado">{statusFilters.map(filter => <button type="button" key={filter.value} aria-pressed={statusFilter === filter.value} className={statusFilter === filter.value ? 'active' : ''} onClick={() => { setStatusFilter(filter.value); setPage(1); setSelectedIds([]); setSelectedOnly(false); setClusterSelection(false) }}>{filter.label} <span>{statusCount(filter.value)}</span></button>)}</div>}<span>{selectedOnly ? `${ideasInSpace.length} seleccionadas · filtros pausados` : `${ideasInSpace.length} ideas · página ${page} de ${pageCount}`}</span>{selectedOnly ? <button type="button" className="settings-button" onClick={clearClusterView}>Ver todas</button> : <button type="button" className="settings-button" onClick={selectVisible}>{selectedIds.length === visibleIdeas.length && visibleIdeas.length ? 'Quitar selección' : 'Seleccionar página'}</button>}</div>
    {!selectedOnly && <div className="ideas-family-filters" role="group" aria-label="Filtrar ideas por familia"><button type="button" className={!familyFilter ? 'active' : ''} onClick={() => setFamilyFilter('')}>Todas <span>{scopedIdeas.length}</span></button>{familyCounts.map(([family, count]) => <button type="button" key={family} className={familyFilter === family ? 'active' : ''} onClick={() => setFamilyFilter(family)}>{family} <span>{count}</span></button>)}</div>}
    <IdeaAnalysisSettingsPanel ignoredTermsText={ignoredTermsText} onIgnoredTermsChange={setIgnoredTermsText} analysisOptions={analysisOptions} onAnalysisOptionsChange={setAnalysisOptions} automaticTerms={automaticTerms} />
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
    <IdeaExploratoryReport
      reportSummary={reportSummary}
      reportGeneratedAt={reportGeneratedAt}
      setReportGeneratedAt={setReportGeneratedAt}
      setClusters={setClusters}
      setActiveClusterId={setActiveClusterId}
      suggestedGroups={suggestedGroups}
      suggestionSort={suggestionSort}
      setSuggestionSort={setSuggestionSort}
      setSuggestionOrder={setSuggestionOrder}
      suggestedVisibleCount={suggestedVisibleCount}
      setSuggestedVisibleCount={setSuggestedVisibleCount}
      clusterIdeas={clusterIdeas}
      selectedIds={selectedIds}
      expandedReportGroups={expandedReportGroups}
      setExpandedReportGroups={setExpandedReportGroups}
      clusterAverageAffinity={clusterAverageAffinity}
      updateSelectedIdeas={updateSelectedIdeas}
      edit={edit}
      replaceSuggestedGroup={replaceSuggestedGroup}
      reviewCluster={reviewCluster}
      showSelectedIdeas={showSelectedIdeas}
      setSelectedIds={setSelectedIds}
      selectIsolatedIdeas={selectIsolatedIdeas}
      isolatedVisibleCount={isolatedVisibleCount}
      setIsolatedVisibleCount={setIsolatedVisibleCount}
    />    <IdeaClustersPanel
      clusters={clusters}
      visibleClusters={visibleClusters}
      clusterPanelRef={clusterPanelRef}
      clusterQuery={clusterQuery}
      setClusterQuery={setClusterQuery}
      clusterAffinityFilter={clusterAffinityFilter}
      setClusterAffinityFilter={setClusterAffinityFilter}
      clusterSort={clusterSort}
      setClusterSort={setClusterSort}
      showSmallClusters={showSmallClusters}
      setShowSmallClusters={setShowSmallClusters}
      setClusters={setClusters}
      setActiveClusterId={setActiveClusterId}
      setReportGeneratedAt={setReportGeneratedAt}
      clusterIdeas={clusterIdeas}
      commonTitlePrefix={commonTitlePrefix}
      clusterAverageAffinity={clusterAverageAffinity}
      clusterTitlePreview={clusterTitlePreview}
      activeCluster={activeCluster}
      clusterReview={clusterReview}
      isActiveClusterMarkedSeries={isActiveClusterMarkedSeries}
      activeClusterSeriesKey={activeClusterSeriesKey}
      setMarkedSeries={setMarkedSeries}
      selectedIds={selectedIds}
      updateSelectedIdeas={updateSelectedIdeas}
      setSelectedOnly={setSelectedOnly}
      setClusterSelection={setClusterSelection}
      showSelectedIdeas={showSelectedIdeas}
      ideas={ideas}
      edit={edit}
      toggleSelected={toggleSelected}
      convert={convert}
      runSafely={runSafely}
      developClusterSelection={developClusterSelection}
    />    {selectedIds.length > 0 && <div className={`ideas-bulk-actions ${selectedOnly ? 'selected-ideas-actions' : ''}`} ref={ideasListRef}><strong>{selectedIds.length} seleccionadas</strong>{selectedIds.length === 1 && <button type="button" onClick={() => runSafely(findNeighbors, 'No se pudieron buscar ideas parecidas')}><Search size={13} /> Ideas parecidas</button>}{selectedIds.length >= 2 && <button type="button" onClick={() => runSafely(bulkCombine, 'No se pudieron combinar las ideas')}><Combine size={13} /> Combinar</button>}<button type="button" onClick={() => runSafely(() => bulkStatus('developing'), 'No se pudieron actualizar las ideas')}>Desarrollar</button><button type="button" onClick={() => runSafely(() => bulkStatus('ready'), 'No se pudieron actualizar las ideas')}>Marcar listas</button><button type="button" onClick={() => runSafely(bulkConvert, 'No se pudieron convertir las ideas')}>Convertir</button><button type="button" onClick={() => runSafely(() => bulkStatus('archived'), 'No se pudieron actualizar las ideas')}>Archivar</button><button type="button" onClick={() => runSafely(bulkRemove, 'No se pudieron eliminar las ideas')}>Eliminar</button></div>}
    {ideasInSpace.length ? <div className="ideas-grid">{visibleIdeas.map(idea => <article className={'idea-card ' + (selectedIds.includes(idea.id) ? 'selected' : '')} key={idea.id} onClick={event => { if (event.shiftKey || event.ctrlKey || event.metaKey || selectedIds.length > 0) toggleSelected(idea.id) }}>
      <header><label className="idea-select" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(idea.id)} onChange={() => toggleSelected(idea.id)} /> {idea.priority !== 'normal' && <span className={'idea-priority ' + idea.priority}>{priorityLabels[idea.priority]}</span>}</label><div><button type="button" title="Editar idea" onClick={event => { event.stopPropagation(); edit(idea) }}><Pencil size={15} /></button><button type="button" title="Eliminar idea" className="idea-delete" onClick={event => { event.stopPropagation(); if (window.confirm('Eliminar esta idea?')) runSafely(() => removeIdea(idea.id), 'No se pudo eliminar la idea') }}><Trash2 size={15} /></button></div></header>
      {ideaFamily(idea.title, idea.sourceName).family && <span className="idea-family-chip">{ideaFamily(idea.title, idea.sourceName).family}</span>} {idea.status !== 'inbox' && <span className={'idea-status ' + idea.status}>{statusLabels[idea.status]}</span>}{(idea.combinedPostIds.length > 0 || idea.combinedPostId) && <span className="idea-combined-badge">{idea.combinedPostIds.length > 1 ? `${idea.combinedPostIds.length} combinaciones` : 'Combinada'}</span>}<h2>{ideaFamily(idea.title, idea.sourceName).title || 'Idea sin titulo'}</h2><p>{idea.body || 'Sin desarrollo todavia.'}</p>
      <footer>{idea.dueDate && <span><CalendarDays size={13} />{new Date(idea.dueDate).toLocaleDateString()}</span>}<small>{idea.space}</small><div className="idea-links">{(idea.combinedPostIds.length > 0 ? idea.combinedPostIds : (idea.combinedPostId ? [idea.combinedPostId] : [])).map((postId, index) => <button type="button" key={postId} onClick={event => { event.stopPropagation(); select(postId); setView('board') }} title="Abrir publicacion combinada"><ExternalLink size={13} /> {index === 0 ? 'Ver combinado' : `Ver combinado ${index + 1}`}</button>)}{idea.postId ? <button type="button" onClick={event => { event.stopPropagation(); select(idea.postId!); setView('board') }} title="Abrir publicacion individual"><ExternalLink size={13} /> Ver publicacion</button> : <button type="button" onClick={event => { event.stopPropagation(); runSafely(() => convert(idea), 'No se pudo convertir la idea') }}>Convertir <ArrowRight size={14} /></button>}</div></footer>
    </article>)}</div> : <div className="ideas-empty" aria-live="polite"><Lightbulb size={34} /><strong>{selectedOnly ? 'No hay ideas en la selección' : scopedIdeas.length === 0 ? activeSpace ? 'Este espacio aún no tiene ideas' : 'Aún no tienes ideas' : 'No hay ideas con estos filtros'}</strong><span>{selectedOnly ? 'Elige ideas de un grupo o vuelve a la lista completa.' : scopedIdeas.length === 0 ? 'Crea una idea o importa un archivo para empezar.' : 'Prueba otro estado, familia o término de búsqueda.'}</span>{selectedOnly ? <button type="button" className="settings-button" onClick={clearClusterView}>Volver a la lista</button> : scopedIdeas.length === 0 && ideas.length > 0 ? <button type="button" className="settings-button" onClick={resetIdeaFilters}>Ver todos los espacios</button> : scopedIdeas.length > 0 ? <button type="button" className="settings-button" onClick={resetIdeaFilters}>Quitar filtros</button> : null}<button className="new-button" onClick={() => setDraft(blankIdea(activeSpace || 'Mi contenido'))}><Plus size={17} /> Nueva idea</button></div>}
    {ideasInSpace.length > 0 && <div className="ideas-pagination"><button disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Anterior</button><span>{page} / {pageCount}</span><button disabled={page >= pageCount} onClick={() => setPage(current => current + 1)}>Siguiente</button></div>}
    {draft && <IdeaEditorDialog draft={draft} onChange={next => setDraft(next)} onClose={() => setDraft(null)} onSave={() => runSafely(save, 'No se pudo guardar la idea')} onSaveAndConvert={() => runSafely(saveAndConvert, 'No se pudo guardar y convertir la idea')} />}
  </section>
}

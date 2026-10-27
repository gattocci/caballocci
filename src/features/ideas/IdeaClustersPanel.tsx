import type { Dispatch, RefObject, SetStateAction } from 'react'
import { ArrowRight, Pencil, Search, X } from 'lucide-react'
import type { Idea, IdeaCluster, IdeaStatus } from '../../shared/types'
import { statusLabels } from './idea-utils'
import type { buildClusterReview } from './cluster-triage'

type ClusterReview = ReturnType<typeof buildClusterReview> & { prefix: string }
type ClusterPanelProps = {
  clusters: IdeaCluster[]
  visibleClusters: IdeaCluster[]
  clusterPanelRef: RefObject<HTMLElement>
  clusterQuery: string
  setClusterQuery(value: string): void
  clusterAffinityFilter: 'all' | '65' | '75' | '85'
  setClusterAffinityFilter(value: 'all' | '65' | '75' | '85'): void
  clusterSort: 'size' | 'affinity' | 'name'
  setClusterSort(value: 'size' | 'affinity' | 'name'): void
  showSmallClusters: boolean
  setShowSmallClusters(value: SetStateAction<boolean>): void
  setClusters(value: IdeaCluster[]): void
  setActiveClusterId(value: string | null): void
  setReportGeneratedAt(value: string | null): void
  clusterIdeas(cluster: IdeaCluster): Idea[]
  commonTitlePrefix(titles: string[]): string
  clusterAverageAffinity(cluster: IdeaCluster): number | null
  clusterTitlePreview(idea: Idea, prefix: string): string
  activeCluster: IdeaCluster | null
  clusterReview: ClusterReview | null
  isActiveClusterMarkedSeries: boolean
  activeClusterSeriesKey: string
  setMarkedSeries: Dispatch<SetStateAction<string[]>>
  selectedIds: string[]
  updateSelectedIdeas(ids: string[], selected: boolean): void
  setSelectedOnly(value: boolean): void
  setClusterSelection(value: boolean): void
  showSelectedIdeas(): void
  ideas: Idea[]
  edit(idea: Idea): void
  toggleSelected(ideaId: string): void
  convert(idea: Idea): Promise<unknown>
  runSafely(action: () => Promise<unknown>, context: string): void
  developClusterSelection(cluster: IdeaCluster): Promise<unknown>
}

export function IdeaClustersPanel({ clusters, visibleClusters, clusterPanelRef, clusterQuery, setClusterQuery, clusterAffinityFilter, setClusterAffinityFilter, clusterSort, setClusterSort, showSmallClusters, setShowSmallClusters, setClusters, setActiveClusterId, setReportGeneratedAt, clusterIdeas, commonTitlePrefix, clusterAverageAffinity, clusterTitlePreview, activeCluster, clusterReview, isActiveClusterMarkedSeries, activeClusterSeriesKey, setMarkedSeries, selectedIds, updateSelectedIdeas, setSelectedOnly, setClusterSelection, showSelectedIdeas, ideas, edit, toggleSelected, convert, runSafely, developClusterSelection }: ClusterPanelProps) {
  return <>{clusters.length > 0 && <section className="ideas-analysis-panel clusters-panel" ref={clusterPanelRef}>
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
  </>
}




import type { Dispatch, SetStateAction } from 'react'
import { X } from 'lucide-react'
import type { Idea, IdeaCluster, IdeaStatus } from '../../shared/types'
import { statusLabels } from './idea-utils'

type ReportSummary = {
  total: number
  grouped: number
  distribution: Array<{ status: IdeaStatus; count: number }>
  isolated: Idea[]
  duplicates: Idea[][]
  developmentGroups: IdeaCluster[]
}

type ExploratoryReportProps = {
  reportSummary: ReportSummary | null
  reportGeneratedAt: string | null
  setReportGeneratedAt(value: string | null): void
  setClusters(value: IdeaCluster[]): void
  setActiveClusterId(value: string | null): void
  suggestedGroups: IdeaCluster[]
  suggestionSort: 'size' | 'affinity' | 'name'
  setSuggestionSort(value: 'size' | 'affinity' | 'name'): void
  setSuggestionOrder(value: string[]): void
  suggestedVisibleCount: number
  setSuggestedVisibleCount: Dispatch<SetStateAction<number>>
  clusterIdeas(cluster: IdeaCluster): Idea[]
  selectedIds: string[]
  expandedReportGroups: string[]
  setExpandedReportGroups: Dispatch<SetStateAction<string[]>>
  clusterAverageAffinity(cluster: IdeaCluster): number | null
  updateSelectedIdeas(ids: string[], selected: boolean): void
  edit(idea: Idea): void
  replaceSuggestedGroup(clusterId: string): void
  reviewCluster(clusterId: string): void
  showSelectedIdeas(): void
  setSelectedIds(value: string[]): void
  selectIsolatedIdeas(): void
  isolatedVisibleCount: number
  setIsolatedVisibleCount: Dispatch<SetStateAction<number>>
}

export function IdeaExploratoryReport({ reportSummary, reportGeneratedAt, setReportGeneratedAt, setClusters, setActiveClusterId, suggestedGroups, suggestionSort, setSuggestionSort, setSuggestionOrder, suggestedVisibleCount, setSuggestedVisibleCount, clusterIdeas, selectedIds, expandedReportGroups, setExpandedReportGroups, clusterAverageAffinity, updateSelectedIdeas, edit, replaceSuggestedGroup, reviewCluster, showSelectedIdeas, setSelectedIds, selectIsolatedIdeas, isolatedVisibleCount, setIsolatedVisibleCount }: ExploratoryReportProps) {
  return <>{reportSummary && <section className="ideas-analysis-panel exploratory-report">
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
  </>
}



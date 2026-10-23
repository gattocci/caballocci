import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Sidebar, Topbar } from '../components/layout/AppShell'
import { Editor } from '../features/editor/Editor'
import { ConceptMap } from '../features/concept-map/ConceptMap'
import { IdeasView } from '../features/ideas/IdeasView'
import { Board, CalendarView, LibraryView, Timeline } from '../features/planner/PlannerViews'
import { AboutUpdates } from '../features/settings/AboutUpdates'
import { SourcesView } from '../features/sources/SourcesView'
import { reportAppError } from './errors'
import { postMatchesQuery, usePlanner } from './store'
import { AppErrorBoundary, GlobalErrorCenter } from '../components/layout/GlobalErrorCenter'

function AppContent() {
  const { load, loading, loadError, view, posts, selectedId, select, query, activeSpace, setView } = usePlanner()
  const [creating, setCreating] = useState(false)
  const [scheduledAtForNew, setScheduledAtForNew] = useState<string | null>(null)
  const previousView = useRef(view)
  useEffect(() => {
    let active = true
    const syncPreferences = async () => {
      try {
        const current: Record<string, string> = {}
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index)
          if (!key?.startsWith('caballocci.')) continue
          const value = localStorage.getItem(key)
          if (value !== null) current[key] = value
        }
        const merged = await window.planner.preferences.sync(current)
        if (active) for (const [key, value] of Object.entries(merged)) localStorage.setItem(key, value)
      } catch (error) {
        reportAppError(error, 'No se pudieron sincronizar las preferencias')
      }
      if (active) await load()
    }
    void syncPreferences()
    return () => { active = false }
  }, [load])
  useEffect(() => {
    if (loadError) reportAppError(loadError, 'No se pudo cargar el workspace')
  }, [loadError])
  useEffect(() => {
    if (previousView.current !== view && (selectedId || creating)) {
      if (selectedId) select(null)
      if (creating) setCreating(false)
      setScheduledAtForNew(null)
    }
    previousView.current = view
  }, [view, selectedId, creating, select])
  const filtered = useMemo(() => {
    const inSpace = activeSpace ? posts.filter(post => post.project === activeSpace) : posts
    return inSpace.filter(post => postMatchesQuery(post, query))
  }, [posts, query, activeSpace])
  const selected = posts.find(post => post.id === selectedId) || null
  const openSearchResult = (id?: string) => {
    const result = id ? filtered.find(post => post.id === id) : filtered[0]
    if (!result) return
    select(result.id)
    setView('board')
  }
  if (loading) return <div className="loading"><div className="brand-symbol"><span /><span /><span /></div><p>Preparando tu espacio local...</p></div>
  if (loadError) return <div className="loading"><div className="brand-symbol"><span /><span /><span /></div><strong>No se pudo abrir el workspace</strong><p>{loadError}</p><button className="save-button" onClick={() => void load()}>Reintentar</button></div>
  return <div className="app"><AppErrorBoundary><Sidebar /></AppErrorBoundary><main><AppErrorBoundary><Topbar onNew={() => { select(null); setScheduledAtForNew(null); setCreating(true) }} onSearchSubmit={() => openSearchResult()} /></AppErrorBoundary><div className="content"><AppErrorBoundary key={view}>{query && view !== 'about' && view !== 'concept-map' && view !== 'sources' && <div className="search-result"><div className="search-result-summary"><Search size={16} />{filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'} para "{query}"</div>{filtered.length > 0 && <div className="search-result-list">{filtered.slice(0, 6).map(post => <button key={post.id} onClick={() => openSearchResult(post.id)}><span>{post.title || 'Publicacion sin titulo'}</span><small>{post.project || 'Mi contenido'}</small></button>)}</div>}{filtered.length === 0 && <span className="search-result-empty">No encontramos una publicación con ese texto.</span>}</div>}{view === 'timeline' && <Timeline onNewScheduled={scheduledAt => { select(null); setScheduledAtForNew(scheduledAt); setCreating(true) }} />}{view === 'calendar' && <CalendarView />}{view === 'board' && <Board />}{view === 'ideas' && <IdeasView />}{view === 'concept-map' && <ConceptMap />}{view === 'library' && <LibraryView />}{view === 'sources' && <SourcesView />}{view === 'about' && <AboutUpdates />}</AppErrorBoundary></div></main>{(creating || selected) && <AppErrorBoundary key={selected?.id || 'new'}><Editor initial={selected} scheduledAtForNew={scheduledAtForNew} onClose={() => { setCreating(false); setScheduledAtForNew(null); select(null) }} /></AppErrorBoundary>}</div>
}

export default function App() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportAppError(event.error || event.message, 'Error inesperado')
    const onRejection = (event: PromiseRejectionEvent) => reportAppError(event.reason, 'Operación no completada')
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return <><GlobalErrorCenter /><AppErrorBoundary><AppContent /></AppErrorBoundary></>
}

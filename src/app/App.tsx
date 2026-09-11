import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Sidebar, Topbar } from '../components/layout/AppShell'
import { Editor } from '../features/editor/Editor'
import { ConceptMap } from '../features/concept-map/ConceptMap'
import { IdeasView } from '../features/ideas/IdeasView'
import { Board, CalendarView, LibraryView, Timeline } from '../features/planner/PlannerViews'
import { AboutUpdates } from '../features/settings/AboutUpdates'
import { SourcesView } from '../features/sources/SourcesView'
import { postMatchesQuery, usePlanner } from './store'

export default function App() {
  const { load, loading, loadError, view, posts, selectedId, select, query, activeSpace, setView } = usePlanner()
  const [creating, setCreating] = useState(false)
  useEffect(() => { void load() }, [load])
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
  return <div className="app"><Sidebar /><main><Topbar onNew={() => setCreating(true)} onSearchSubmit={() => openSearchResult()} /><div className="content">{query && view !== 'about' && view !== 'concept-map' && view !== 'sources' && <div className="search-result"><div className="search-result-summary"><Search size={16} />{filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'} para "{query}"</div>{filtered.length > 0 && <div className="search-result-list">{filtered.slice(0, 6).map(post => <button key={post.id} onClick={() => openSearchResult(post.id)}><span>{post.title || 'Publicacion sin titulo'}</span><small>{post.project || 'Mi contenido'}</small></button>)}</div>}{filtered.length === 0 && <span className="search-result-empty">No encontramos una publicación con ese texto.</span>}</div>}{view === 'timeline' && <Timeline />}{view === 'calendar' && <CalendarView />}{view === 'board' && <Board />}{view === 'ideas' && <IdeasView />}{view === 'concept-map' && <ConceptMap />}{view === 'library' && <LibraryView />}{view === 'sources' && <SourcesView />}{view === 'about' && <AboutUpdates />}</div></main>{(creating || selected) && <Editor key={selected?.id || 'new'} initial={selected} onClose={() => { setCreating(false); select(null) }} />}</div>
}

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Sidebar, Topbar } from '../components/layout/AppShell'
import { Editor } from '../features/editor/Editor'
import { ConceptMap } from '../features/concept-map/ConceptMap'
import { IdeasView } from '../features/ideas/IdeasView'
import { Board, CalendarView, LibraryView, Timeline } from '../features/planner/PlannerViews'
import { AboutUpdates } from '../features/settings/AboutUpdates'
import { SourcesView } from '../features/sources/SourcesView'
import { usePlanner } from './store'

export default function App() {
  const { load, loading, loadError, view, posts, selectedId, select, query, activeSpace } = usePlanner()
  const [creating, setCreating] = useState(false)
  useEffect(() => { void load() }, [load])
  const filtered = useMemo(() => {
    const normalized = query.toLowerCase()
    const inSpace = activeSpace ? posts.filter(post => post.project === activeSpace) : posts
    return normalized ? inSpace.filter(post => [post.title, post.caption, post.project, ...post.hashtags].join(' ').toLowerCase().includes(normalized)) : inSpace
  }, [posts, query, activeSpace])
  const selected = posts.find(post => post.id === selectedId) || null
  if (loading) return <div className="loading"><div className="brand-symbol"><span /><span /><span /></div><p>Preparando tu espacio local...</p></div>
  if (loadError) return <div className="loading"><div className="brand-symbol"><span /><span /><span /></div><strong>No se pudo abrir el workspace</strong><p>{loadError}</p><button className="save-button" onClick={() => void load()}>Reintentar</button></div>
  return <div className="app"><Sidebar /><main><Topbar onNew={() => setCreating(true)} /><div className="content">{query && view !== 'about' && view !== 'concept-map' && view !== 'sources' && <div className="search-result"><Search size={16} />{filtered.length} resultados para "{query}"</div>}{view === 'timeline' && <Timeline />}{view === 'calendar' && <CalendarView />}{view === 'board' && <Board />}{view === 'ideas' && <IdeasView />}{view === 'concept-map' && <ConceptMap />}{view === 'library' && <LibraryView />}{view === 'sources' && <SourcesView />}{view === 'about' && <AboutUpdates />}</div></main>{(creating || selected) && <Editor key={selected?.id || 'new'} initial={selected} onClose={() => { setCreating(false); select(null) }} />}</div>
}

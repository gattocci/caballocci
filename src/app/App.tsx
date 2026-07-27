import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Sidebar, Topbar } from '../components/layout/AppShell'
import { Editor } from '../features/editor/Editor'
import { usePlanner } from './store'
import { Board, CalendarView, LibraryView, Timeline } from '../features/planner/PlannerViews'

export default function App() {
  const { load, loading, view, posts, selectedId, select, query } = usePlanner()
  const [creating, setCreating] = useState(false)
  useEffect(() => { void load() }, [load])
  const filtered = useMemo(() => {
    const normalized = query.toLowerCase()
    return normalized ? posts.filter(post => [post.title, post.caption, post.project, ...post.hashtags].join(' ').toLowerCase().includes(normalized)) : posts
  }, [posts, query])
  const selected = posts.find(post => post.id === selectedId) || null
  if (loading) return <div className="loading"><div className="brand-symbol"><span /><span /><span /></div><p>Preparando tu espacio local...</p></div>
  return <div className="app"><Sidebar /><main><Topbar onNew={() => setCreating(true)} /><div className="content">{query && <div className="search-result"><Search size={16} />{filtered.length} resultados para “{query}”</div>}{view === 'timeline' && <Timeline />}{view === 'calendar' && <CalendarView />}{view === 'board' && <Board />}{view === 'library' && <LibraryView />}</div></main>{(creating || selected) && <Editor initial={selected} onClose={() => { setCreating(false); select(null) }} />}</div>
}

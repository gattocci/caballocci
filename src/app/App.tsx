import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Sidebar, Topbar } from '../components/layout/AppShell'
import { Editor } from '../features/editor/Editor'
import { ConceptMap } from '../features/concept-map/ConceptMap'
import { IdeasView } from '../features/ideas/IdeasView'
import { Board, BoardDaySwitcher, CalendarView, LibraryView, Timeline } from '../features/planner/PlannerViews'
import { AboutUpdates } from '../features/settings/AboutUpdates'
import { SourcesView } from '../features/sources/SourcesView'
import { reportAppError } from './errors'
import { postMatchesQuery, usePlanner } from './store'
import { AppErrorBoundary, GlobalErrorCenter } from '../components/layout/GlobalErrorCenter'
import { UpdateDialog } from '../components/UpdateDialog'

function AppContent() {
  const { load, loading, loadError, view, posts, selectedId, select, query, activeSpace, setView, undoHistory, redoHistory, undoNotice, undoSavedChange, redoSavedChange, clearUndoNotice } = usePlanner()
  const [creating, setCreating] = useState(false)
  const [scheduledAtForNew, setScheduledAtForNew] = useState<string | null>(null)
  const [newPostSpace, setNewPostSpace] = useState<string | null>(null)
  const [editorSessionIds, setEditorSessionIds] = useState<string[] | null>(null)
  const [editorMinimized, setEditorMinimized] = useState(false)
  const [closeWarning, setCloseWarning] = useState(false)
  const previousView = useRef(view)
  const previousSpace = useRef(activeSpace)
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
    const staysInPlanner = (previousView.current === 'board' || previousView.current === 'calendar') && (view === 'board' || view === 'calendar')
    if (previousView.current !== view && (selectedId || creating) && !(editorMinimized && staysInPlanner)) {
      if (selectedId) select(null)
      setEditorMinimized(false)
      if (editorSessionIds) setEditorSessionIds(null)
      if (creating) setCreating(false)
      setScheduledAtForNew(null)
    }
    previousView.current = view
  }, [view, selectedId, creating, editorMinimized, editorSessionIds, select])
  useEffect(() => {
    if (previousSpace.current !== activeSpace && creating) {
      setCreating(false)
      setScheduledAtForNew(null)
      setNewPostSpace(null)
    }
    previousSpace.current = activeSpace
  }, [activeSpace, creating])
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLocaleLowerCase()
      if (key !== 'z' && key !== 'y') return
      if (document.querySelector('.editor')) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      const redoing = key === 'y' || (key === 'z' && event.shiftKey)
      if (redoing ? !redoHistory.length : !undoHistory.length) return
      event.preventDefault()
      void (redoing ? redoSavedChange() : undoSavedChange()).catch(error => reportAppError(error, 'No se pudo deshacer el cambio guardado'))
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [redoHistory.length, redoSavedChange, undoHistory.length, undoSavedChange])
  useEffect(() => {
    if (!undoNotice) return
    const timeout = window.setTimeout(clearUndoNotice, 2100)
    return () => window.clearTimeout(timeout)
  }, [undoNotice, clearUndoNotice])
  useEffect(() => {
    let timer: number | undefined
    const unsubscribe = window.planner.lifecycle.onCloseWarning(() => {
      setCloseWarning(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setCloseWarning(false), 2_000)
    })
    return () => { unsubscribe(); window.clearTimeout(timer) }
  }, [])
  const filtered = useMemo(() => {
    const inSpace = activeSpace ? posts.filter(post => post.project === activeSpace) : posts
    return inSpace.filter(post => postMatchesQuery(post, query))
  }, [posts, query, activeSpace])
  const selected = posts.find(post => post.id === selectedId) || null
  const editorSession = editorSessionIds?.map(id => posts.find(post => post.id === id)).filter((post): post is NonNullable<typeof post> => Boolean(post)) || []
  const editorPickMode = editorMinimized && Boolean(selectedId)
  const editorSessionPostIds = new Set(editorPickMode ? editorSessionIds || (selectedId ? [selectedId] : []) : [])
  const closeEditor = () => { setEditorMinimized(false); setCreating(false); setScheduledAtForNew(null); setNewPostSpace(null); setEditorSessionIds(null); select(null) }
  const addEditorSessionPost = (id: string) => {
    const currentIds = editorSessionIds || (selectedId ? [selectedId] : [])
    if (!currentIds.length || currentIds.includes(id)) return
    setEditorSessionIds([...currentIds, id])
    select(id)
  }
  const pickEditorSessionPost = (id: string) => {
    if (!editorMinimized || !selectedId) return false
    const currentIds = editorSessionIds || [selectedId]
    if (!currentIds.includes(id)) setEditorSessionIds([...currentIds, id])
    return true
  }
  const closeEditorSessionPost = (id: string, nextId: string | null) => {
    const currentIds = editorSessionIds || (selectedId ? [selectedId] : [])
    const remaining = currentIds.filter(postId => postId !== id)
    if (!remaining.length) { setEditorSessionIds(null); select(null); return }
    setEditorSessionIds(remaining)
    if (selectedId === id) select(nextId && remaining.includes(nextId) ? nextId : remaining[0])
  }
  const openSearchResult = (id?: string) => {
    const result = id ? filtered.find(post => post.id === id) : filtered[0]
    if (!result) return
    setEditorMinimized(false)
    select(result.id)
    setView('board')
  }
  if (loading) return <div className="loading"><div className="brand-symbol"><span /><span /><span /></div><p>Preparando tu espacio local...</p></div>
  if (loadError) return <div className="loading"><div className="brand-symbol"><span /><span /><span /></div><strong>No se pudo abrir el workspace</strong><p>{loadError}</p><button className="save-button" onClick={() => void load()}>Reintentar</button></div>
  return <div className="app">{undoNotice && <div className="global-undo-notice" role="status" aria-live="polite">{undoNotice}</div>}{closeWarning && <div className="global-close-notice" role="status" aria-live="polite">Vuelve a pulsar cerrar en 2 segundos para salir.</div>}<AppErrorBoundary><Sidebar /></AppErrorBoundary><main><AppErrorBoundary><Topbar onNew={() => { setEditorMinimized(false); setEditorSessionIds(null); select(null); setScheduledAtForNew(null); setNewPostSpace(activeSpace); setCreating(true) }} onSearchSubmit={() => openSearchResult()} /></AppErrorBoundary><div className="content"><AppErrorBoundary key={view}>{query && view !== 'about' && view !== 'concept-map' && view !== 'sources' && <div className="search-result"><div className="search-result-summary"><Search size={16} />{filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'} para "{query}"</div>{filtered.length > 0 && <div className="search-result-list">{filtered.slice(0, 6).map(post => <button key={post.id} onClick={() => openSearchResult(post.id)}><span>{post.title || 'Publicacion sin titulo'}</span><small>{post.project || 'Mi contenido'}</small></button>)}</div>}{filtered.length === 0 && <span className="search-result-empty">No encontramos una publicación con ese texto.</span>}</div>}{view === 'timeline' && <Timeline onNewScheduled={scheduledAt => { select(null); setScheduledAtForNew(scheduledAt); setNewPostSpace(activeSpace); setCreating(true) }} />}{view === 'calendar' && <CalendarView onPickPost={pickEditorSessionPost} pickMode={editorPickMode} pickedPostIds={editorSessionPostIds} />}{view === 'board' && <Board onPickPost={pickEditorSessionPost} pickMode={editorPickMode} pickedPostIds={editorSessionPostIds} onEditSelection={ids => { const validIds = ids.filter(id => posts.some(post => post.id === id)); if (!validIds.length) return; setEditorMinimized(false); setCreating(false); setEditorSessionIds(validIds); select(validIds[0]) }} />}{view === 'ideas' && <IdeasView />}{view === 'concept-map' && <ConceptMap />}{view === 'library' && <LibraryView />}{view === 'sources' && <SourcesView />}{view === 'about' && <AboutUpdates />}</AppErrorBoundary></div></main>{(creating || selected) && <AppErrorBoundary key={selected?.id || 'new'}><Editor initial={selected} scheduledAtForNew={scheduledAtForNew} spaceForNew={newPostSpace} sessionPosts={selected ? (editorSessionIds ? editorSession : [selected]) : undefined} minimized={editorMinimized} onMinimizedChange={setEditorMinimized} boardPick={Boolean(selected)} onSessionNavigate={id => select(id)} onSessionAdd={addEditorSessionPost} onSessionClose={closeEditorSessionPost} onClose={closeEditor} /></AppErrorBoundary>}{(view === 'board' || view === 'calendar') && selected && <AppErrorBoundary key="planner-day-switcher"><BoardDaySwitcher onPickPost={pickEditorSessionPost} pickedPostIds={editorSessionPostIds} /></AppErrorBoundary>}</div>
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

  return <><GlobalErrorCenter /><AppErrorBoundary><AppContent /></AppErrorBoundary><UpdateDialog /></>
}

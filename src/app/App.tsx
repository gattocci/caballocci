import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Sidebar, Topbar } from '../components/layout/AppShell'
import { reportAppError } from './errors'
import { postMatchesQuery, usePlanner } from './store'
import { AppErrorBoundary, GlobalErrorCenter } from '../components/layout/GlobalErrorCenter'
import { UpdateDialog } from '../components/UpdateDialog'
import type { MediaAsset } from '../shared/types'

const Editor = lazy(() => import('../features/editor/Editor').then(module => ({ default: module.Editor })))
const ConceptMap = lazy(() => import('../features/concept-map/ConceptMap').then(module => ({ default: module.ConceptMap })))
const IdeasView = lazy(() => import('../features/ideas/IdeasView').then(module => ({ default: module.IdeasView })))
const Board = lazy(() => import('../features/planner/PlannerViews').then(module => ({ default: module.Board })))
const BoardDaySwitcher = lazy(() => import('../features/planner/PlannerViews').then(module => ({ default: module.BoardDaySwitcher })))
const CalendarView = lazy(() => import('../features/planner/PlannerViews').then(module => ({ default: module.CalendarView })))
const LibraryView = lazy(() => import('../features/planner/PlannerViews').then(module => ({ default: module.LibraryView })))
const Timeline = lazy(() => import('../features/planner/PlannerViews').then(module => ({ default: module.Timeline })))
const AboutUpdates = lazy(() => import('../features/settings/AboutUpdates').then(module => ({ default: module.AboutUpdates })))
const SourcesView = lazy(() => import('../features/sources/SourcesView').then(module => ({ default: module.SourcesView })))

function AppContent() {
  const { load, loading, loadError, view, posts, selectedId, select, query, activeSpace, setView, undoHistory, redoHistory, undoNotice, undoSavedChange, redoSavedChange, clearUndoNotice } = usePlanner()
  const [creating, setCreating] = useState(false)
  const [scheduledAtForNew, setScheduledAtForNew] = useState<string | null>(null)
  const [newPostSpace, setNewPostSpace] = useState<string | null>(null)
  const [editorSessionIds, setEditorSessionIds] = useState<string[] | null>(null)
  const [editorMinimized, setEditorMinimized] = useState(false)
  const [mediaAttachment, setMediaAttachment] = useState<{ id: string; postId: string; assets: MediaAsset[] } | null>(null)
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
    if (loading) return
    let active = true
    let importing = false
    let lastIssue = ''
    let syncFailureReported = false
    const importMobileSignals = async () => {
      if (importing) return
      importing = true
      try {
        if (!await window.planner.mobileSync.folder()) {
          lastIssue = ''
          syncFailureReported = false
          return
        }
        const report = await window.planner.mobileSync.importEvents()
        if (!active) return
        const issues = [
          ...report.invalid.map(item => `${item.file}: ${item.reason}`),
          ...report.unknown.map(item => `${item.file}: destino no encontrado (${item.postId}/${item.targetId})`),
        ].sort()
        const issueSignature = issues.join('\n')
        if (issueSignature && issueSignature !== lastIssue) {
          reportAppError(new Error(issues.slice(0, 10).join('\n')), 'No se pudieron importar todas las señales móviles')
        }
        lastIssue = issueSignature
        syncFailureReported = false
      } catch (error) {
        if (active && !syncFailureReported) reportAppError(error, 'No se pudieron importar las señales móviles')
        syncFailureReported = true
      } finally {
        importing = false
      }
    }
    void importMobileSignals()
    const timer = window.setInterval(() => void importMobileSignals(), 10_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [loading])
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
  return <div className="app">
    {undoNotice && <div className="global-undo-notice" role="status" aria-live="polite">{undoNotice}</div>}
    {closeWarning && <div className="global-close-notice" role="status" aria-live="polite">Vuelve a pulsar cerrar en 2 segundos para salir.</div>}
    <AppErrorBoundary><Sidebar /></AppErrorBoundary>
    <main>
      <AppErrorBoundary><Topbar onNew={() => { setEditorMinimized(false); setEditorSessionIds(null); select(null); setScheduledAtForNew(null); setNewPostSpace(activeSpace); setCreating(true) }} onSearchSubmit={() => openSearchResult()} /></AppErrorBoundary>
      <div className="content">
        <AppErrorBoundary key={view}>
          <Suspense fallback={<div className="loading" role="status"><div className="brand-symbol"><span /><span /><span /></div><p>Cargando vista...</p></div>}>
            {query && view !== 'about' && view !== 'concept-map' && view !== 'sources' && (
              <div className="search-result">
                <div className="search-result-summary">
                  <Search size={16} />{filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'} para "{query}"
                </div>
                {filtered.length > 0 && <div className="search-result-list">{filtered.slice(0, 6).map(post => (
                  <button key={post.id} onClick={() => openSearchResult(post.id)}>
                    <span>{post.title || 'Publicacion sin titulo'}</span><small>{post.project || 'Mi contenido'}</small>
                  </button>
                ))}</div>}
                {filtered.length === 0 && <span className="search-result-empty">No encontramos una publicación con ese texto.</span>}
              </div>
            )}
            {view === 'timeline' && <Timeline onNewScheduled={scheduledAt => { select(null); setScheduledAtForNew(scheduledAt); setNewPostSpace(activeSpace); setCreating(true) }} />}
            {view === 'calendar' && <CalendarView onPickPost={pickEditorSessionPost} pickMode={editorPickMode} pickedPostIds={editorSessionPostIds} />}
            {view === 'board' && <Board onPickPost={pickEditorSessionPost} pickMode={editorPickMode} pickedPostIds={editorSessionPostIds} onEditSelection={ids => { const validIds = ids.filter(id => posts.some(post => post.id === id)); if (!validIds.length) return; setEditorMinimized(false); setCreating(false); setEditorSessionIds(validIds); select(validIds[0]) }} />}
            {view === 'ideas' && <IdeasView />}
            {view === 'concept-map' && <ConceptMap />}
            {view === 'library' && <LibraryView />}
            {view === 'sources' && <SourcesView />}
            {view === 'about' && <AboutUpdates />}
          </Suspense>
        </AppErrorBoundary>
      </div>
    </main>
    {(creating || selected) && <AppErrorBoundary key={selected?.id || 'new'}>
      <Suspense fallback={<div className="loading" role="status"><p>Cargando editor...</p></div>}>
        <Editor initial={selected} scheduledAtForNew={scheduledAtForNew} spaceForNew={newPostSpace} sessionPosts={selected ? (editorSessionIds ? editorSession : [selected]) : undefined} minimized={editorMinimized} onMinimizedChange={setEditorMinimized} boardPick={Boolean(selected)} mediaAttachment={mediaAttachment} showMediaPickerInEditor={!selected || (view !== 'board' && view !== 'calendar')} onSessionNavigate={id => select(id)} onSessionAdd={addEditorSessionPost} onSessionClose={closeEditorSessionPost} onClose={closeEditor} />
      </Suspense>
    </AppErrorBoundary>}
    {(view === 'board' || view === 'calendar') && selected && <AppErrorBoundary key="planner-day-switcher"><Suspense fallback={null}><BoardDaySwitcher onPickPost={pickEditorSessionPost} pickedPostIds={editorSessionPostIds} onAttachMedia={(postId, assets) => setMediaAttachment({ id: crypto.randomUUID(), postId, assets })} /></Suspense></AppErrorBoundary>}
  </div>
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

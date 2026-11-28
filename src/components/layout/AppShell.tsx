import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Archive, CalendarDays, ChevronRight, Clock3, Columns3, CornerUpLeft, Database, Download, FolderOpen, Library, Lightbulb, Menu, MoreHorizontal, Network, Pencil, Plus, Redo2, Search, Settings, StickyNote, Trash2, Undo2, X } from 'lucide-react'
import { usePlanner } from '../../app/store'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { getPlatformMeta } from '../../shared/constants'
import type { Platform, UpdateState, WorkGroup } from '../../shared/types'
import { childrenByParent, isDescendant, subtreePostIds } from '../../shared/work-group-tree'
import { useWorkGroupOrder } from '../../features/planner/useWorkGroupOrder'
import { useWorkGroupNesting, applyCollectionDropClasses, clearCollectionDropClasses, collectionDropZone, type CollectionDropZone } from '../../features/planner/useWorkGroupNesting'
import { BoardContextMenu } from '../../features/planner/BoardContextMenu'
import { NoteReminder } from './NoteReminder'
import './app-shell.css'

export function PlatformMark({ platform, small = false }: { platform: Platform; small?: boolean }) {
  const meta = getPlatformMeta(platform)
  return <span className={'platform-mark ' + platform + (small ? ' small' : '')}>{meta.mark}</span>
}

export function Sidebar() {
  const { view, setView, posts, ideas, workGroups, activeWorkGroupId, setActiveWorkGroup, setWorkGroupArchived, activeSpace, customSpaces, hiddenSpaces, spaceNotes, spaceKey, saveSpaceNotes, setActiveSpace, addSpace, renameSpace, removeSpace, movePostsToSpace, requestConceptMapPosts } = usePlanner()
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [creatingSpace, setCreatingSpace] = useState(false)
  const [editingSpace, setEditingSpace] = useState<string | null>(null)
  const [removingSpace, setRemovingSpace] = useState<string | null>(null)
  const [spaceName, setSpaceName] = useState('')
  const [draggingOverSpace, setDraggingOverSpace] = useState<string | null>(null)
  const [draggingOverMap, setDraggingOverMap] = useState(false)
  const [showCollectionDate, setShowCollectionDate] = useState(() => { try { return localStorage.getItem('caballocci.collection-label-date') === 'true' } catch { return false } })
  const [collectionMenu, setCollectionMenu] = useState<{ group: WorkGroup; x: number; y: number } | null>(null)
  const [draggingCollectionId, setDraggingCollectionId] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem('caballocci.work-group-collapsed') || '[]'); return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []) } catch { return new Set() }
  })
  const { orderedGroups } = useWorkGroupOrder()
  const { nestWorkGroup, reorderSibling } = useWorkGroupNesting()
  const toggleCollapsed = (id: string) => setCollapsedGroups(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    try { localStorage.setItem('caballocci.work-group-collapsed', JSON.stringify([...next])) } catch { /* Preferences are optional. */ }
    return next
  })
  useEffect(() => {
    if (!collectionMenu) return
    const dismiss = () => setCollectionMenu(null)
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [collectionMenu])
  useEffect(() => {
    const update = () => { try { setShowCollectionDate(localStorage.getItem('caballocci.collection-label-date') === 'true') } catch { setShowCollectionDate(false) } }
    window.addEventListener('caballocci-collection-label-change', update)
    return () => window.removeEventListener('caballocci-collection-label-change', update)
  }, [])
  const spaces = useMemo(() => Array.from(new Set(['Campaña Aurora', ...customSpaces, ...posts.map(post => post.project), ...ideas.map(idea => idea.space)].filter(space => space && space !== 'Mi contenido'))).filter(space => !hiddenSpaces.includes(space)), [customSpaces, hiddenSpaces, ideas, posts])
  const visibleWorkGroups = orderedGroups(workGroups.filter(group => !group.archivedAt && (!activeSpace || group.space === activeSpace)))
  /** Children of each collection preserving the global sort order; orphaned subcollections surface as roots. */
  const workGroupChildren = childrenByParent(visibleWorkGroups)
  const subtreeSets = new Map(visibleWorkGroups.map(group => [group.id, new Set(subtreePostIds(visibleWorkGroups, group.id))]))
  const countPostsIn = (group: WorkGroup) => posts.reduce((total, post) => total + (subtreeSets.get(group.id)?.has(post.id) ? 1 : 0), 0)
  const draggingCollection = draggingCollectionId ? workGroups.find(group => group.id === draggingCollectionId) ?? null : null
  const collectionDropProps = (group: WorkGroup) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!draggingCollectionId) return
      const zone = collectionDropZone(event.clientY, event.currentTarget)
      if (zone === 'nest' && isDescendant(workGroups, draggingCollectionId, group.id)) { applyCollectionDropClasses(event.currentTarget, null); return }
      event.preventDefault()
      applyCollectionDropClasses(event.currentTarget, zone)
      event.currentTarget.dataset.dropZone = zone
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => clearCollectionDropClasses(event.currentTarget),
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      const target = event.currentTarget
      const zone = (target.dataset.dropZone as CollectionDropZone | undefined) ?? collectionDropZone(event.clientY, target)
      clearCollectionDropClasses(target)
      delete target.dataset.dropZone
      const draggedId = event.dataTransfer.getData('application/x-caballocci-work-group-id')
      if (!draggedId) return
      setDraggingCollectionId(null)
      if (zone === 'nest') {
        if (isDescendant(workGroups, draggedId, group.id) || draggedId === group.id) return
        nestWorkGroup(draggedId, group.id)
        return
      }
      reorderSibling(draggedId, group.id, zone)
    },
  })
  const archiveCollection = (group: WorkGroup) => {
    if (!window.confirm(`¿Archivar “${group.name}” y sus subcolecciones? Sus publicaciones y estados se conservarán y podrás restaurarla después.`)) return
    void runWithErrorReporting(() => setWorkGroupArchived(group.id, true), 'No se pudo archivar la colección')
  }
  const openCollection = (group: WorkGroup) => {
    setActiveSpace(null)
    setActiveWorkGroup(group.id)
    setView('board')
  }
  const spaceDropProps = (space: string) => ({
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!Array.from(event.dataTransfer.types).includes('application/x-caballocci-post-ids')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDraggingOverSpace(space)
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDraggingOverSpace(null)
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      if (!Array.from(event.dataTransfer.types).includes('application/x-caballocci-post-ids')) return
      event.preventDefault()
      event.stopPropagation()
      setDraggingOverSpace(null)
      let ids: string[] = []
      try { ids = JSON.parse(event.dataTransfer.getData('application/x-caballocci-post-ids')) as string[] } catch {
        const id = event.dataTransfer.getData('text/plain')
        if (id) ids = [id]
      }
      if (ids.length) void runWithErrorReporting(async () => {
        const moved = await movePostsToSpace(ids, space)
        if (moved) {
          setActiveWorkGroup(null)
          setActiveSpace(space)
          setView('board')
        }
      }, 'No se pudieron mover las publicaciones al espacio')
    },
  })
  /** Soltar tarjetas sobre “Mapa conceptual” crea referencias en la carpeta activa del mapa, sin sacarlas del tablero. */
  const mapDropProps = {
    onDragOver: (event: DragEvent<HTMLButtonElement>) => {
      if (!Array.from(event.dataTransfer.types).includes('application/x-caballocci-post-ids')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDraggingOverMap(true)
    },
    onDragLeave: (event: DragEvent<HTMLButtonElement>) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDraggingOverMap(false)
    },
    onDrop: (event: DragEvent<HTMLButtonElement>) => {
      if (!Array.from(event.dataTransfer.types).includes('application/x-caballocci-post-ids')) return
      event.preventDefault()
      event.stopPropagation()
      setDraggingOverMap(false)
      let ids: string[] = []
      try { ids = JSON.parse(event.dataTransfer.getData('application/x-caballocci-post-ids')) as string[] } catch {
        const id = event.dataTransfer.getData('text/plain')
        if (id) ids = [id]
      }
      const visibleIds = new Set(posts.filter(post => !activeSpace || post.project === activeSpace).map(post => post.id))
      const references = ids.filter(id => visibleIds.has(id))
      if (references.length) requestConceptMapPosts(references)
    },
  }
  const renderCollectionNode = (group: WorkGroup, depth: number): React.ReactNode => {
    const children = workGroupChildren.get(group.id) ?? []
    const isOpen = !collapsedGroups.has(group.id)
    const count = countPostsIn(group)
    const label = `${showCollectionDate ? `${group.name} · ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(group.createdAt))}` : group.name}`
    return <div key={group.id} className="side-collection-branch">
      <div className="side-collection-row" style={{ '--collection-depth': depth } as React.CSSProperties}>
        {children.length
          ? <button type="button" className="side-collection-toggle" aria-label={isOpen ? `Contraer ${group.name}` : `Expandir ${group.name}`} aria-expanded={isOpen} onClick={() => toggleCollapsed(group.id)}><ChevronRight size={14} className={isOpen ? 'expanded' : ''} /></button>
          : <span className="side-collection-toggle-spacer" aria-hidden="true" />}
        <button type="button" draggable className={'space side-collection ' + (activeWorkGroupId === group.id ? 'active' : '') + (draggingCollectionId === group.id ? ' dragging' : '')} onClick={() => openCollection(group)} onDragStart={event => { event.dataTransfer.setData('application/x-caballocci-work-group-id', group.id); setDraggingCollectionId(group.id) }} onDragEnd={() => setDraggingCollectionId(null)} {...collectionDropProps(group)}><FolderOpen size={15} /><span>{label}</span><em>{count}</em></button>
        <button type="button" className="side-collection-menu" aria-label={`Opciones de ${group.name}`} onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          setCollectionMenu({ group, x: rect.right, y: rect.bottom + 4 })
        }}><MoreHorizontal size={14} /></button>
      </div>
      {isOpen && children.map(child => renderCollectionNode(child, depth + 1))}
    </div>
  }
  const nav = [
    { id: 'timeline', label: 'Línea de tiempo', icon: Clock3 },
    { id: 'calendar', label: 'Calendario', icon: CalendarDays },
    { id: 'board', label: 'Tablero', icon: Columns3 },
    { id: 'ideas', label: 'Ideas', icon: Lightbulb },
    { id: 'concept-map', label: 'Mapa conceptual', icon: Network },
    { id: 'sources', label: 'Fuentes', icon: Database },
    { id: 'library', label: 'Biblioteca', icon: Library },
  ] as const
  return <aside className="sidebar">
    <div className="brand"><div className="brand-symbol"><span /><span /><span /></div><div><strong>caballo</strong><b>cci</b></div></div>
    <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={(view === id ? 'active' : '') + (id === 'concept-map' && draggingOverMap ? ' map-drop-target' : '')} title={id === 'concept-map' ? 'Soltá publicaciones para referenciarlas en el mapa' : undefined} onClick={() => setView(id)} {...(id === 'concept-map' ? mapDropProps : {})}><Icon size={18} /><span>{label}</span>{id === 'timeline' && <em>{posts.filter(p => p.status === 'scheduled' && (!activeSpace || p.project === activeSpace)).length}</em>}{id === 'ideas' && <em>{ideas.filter(idea => idea.status !== 'archived' && (!activeSpace || idea.space === activeSpace)).length}</em>}</button>)}</nav>
    <div className="side-section"><p>ESPACIOS</p><button className={'space ' + (activeSpace === null ? 'active' : '')} onClick={() => { setActiveSpace(null); setActiveWorkGroup(null) }}><span className="space-dot coral">C</span><span>Todos los contenidos</span></button>{spaces.map((space, index) => <div className={'space-row' + (draggingOverSpace === space ? ' space-drop-target' : '')} key={space} {...spaceDropProps(space)}><button className={'space ' + (activeSpace === space ? 'active' : '')} onClick={() => { setActiveWorkGroup(null); setActiveSpace(space) }}><span className={'space-dot ' + (index % 2 ? 'coral' : 'mint')}>{space.slice(0, 1).toUpperCase()}</span><span>{space}</span></button><button className="space-menu-button" aria-label={'Opciones de ' + space} aria-expanded={menuOpen === space} onClick={() => setMenuOpen(menuOpen === space ? null : space)}><MoreHorizontal size={16} /></button>{menuOpen === space && <div className="space-menu"><button onClick={() => { setEditingSpace(space); setSpaceName(space); setMenuOpen(null) }}><Pencil size={14} /> Renombrar</button><button className="danger-menu-item" onClick={() => { setRemovingSpace(space); setMenuOpen(null) }}><Trash2 size={14} /> Quitar espacio</button></div>}</div>)}<button className="add-space" onClick={() => { setCreatingSpace(true); setSpaceName('') }}><Plus size={15} /> Nuevo espacio</button>{activeSpace && <div className="space-context"><div className="space-context-heading"><strong>{activeSpace}</strong><button className="icon-button" title="Abrir carpeta del espacio" onClick={() => void runWithErrorReporting(() => window.planner.system.openSpaceFolder(activeSpace), 'No se pudo abrir la carpeta del espacio')}><FolderOpen size={15} /></button></div><div className="space-context-stats"><span><b>{posts.filter(post => post.project === activeSpace).length}</b> publicaciones</span><span><b>{ideas.filter(idea => idea.space === activeSpace).length}</b> ideas</span></div><label><span>NOTAS DEL ESPACIO</span><textarea value={spaceNotes[spaceKey(activeSpace)] || ''} onChange={event => saveSpaceNotes(activeSpace, event.target.value)} placeholder="Objetivo, tono, enlaces, decisiones y contexto..." /></label><small className="space-folder-hint">La carpeta del espacio contiene las carpetas de sus publicaciones.</small></div>}<div className="side-collections"><p>COLECCIONES</p>{(workGroupChildren.get(null) ?? []).map(group => renderCollectionNode(group, 0))}{draggingCollection?.parentId != null && <button type="button" className="side-collection-root-drop" onDragOver={event => { event.preventDefault(); event.currentTarget.classList.add('drag-over') }} onDragLeave={event => event.currentTarget.classList.remove('drag-over')} onDrop={event => { event.preventDefault(); event.currentTarget.classList.remove('drag-over'); const draggedId = event.dataTransfer.getData('application/x-caballocci-work-group-id'); if (draggedId) nestWorkGroup(draggedId, null); setDraggingCollectionId(null) }}><CornerUpLeft size={13} /> Soltar para mover al nivel superior</button>}</div></div>
    {collectionMenu && <BoardContextMenu x={collectionMenu.x} y={collectionMenu.y} label={`Opciones de ${collectionMenu.group.name}`}>
      <button type="button" role="menuitem" onClick={() => { setCollectionMenu(null); openCollection(collectionMenu.group) }}><Pencil size={14} />Gestionar en tablero</button>
      {collectionMenu.group.parentId && <button type="button" role="menuitem" onClick={() => { setCollectionMenu(null); nestWorkGroup(collectionMenu.group.id, null) }}><CornerUpLeft size={14} />Sacar al nivel superior</button>}
      <button type="button" role="menuitem" onClick={() => { setCollectionMenu(null); archiveCollection(collectionMenu.group) }}><Archive size={14} />Archivar colección y subcolecciones</button>
    </BoardContextMenu>}
    <div className="sidebar-bottom"><div className="offline"><div><strong>Datos locales</strong><small>Se guardan en este equipo</small></div></div><button className={view === 'about' ? 'active' : ''} title="Ajustes" onClick={() => setView('about')}><Settings size={18} /></button></div>
    {(creatingSpace || editingSpace) && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) { setCreatingSpace(false); setEditingSpace(null) } }}><form className="space-dialog" onSubmit={event => { event.preventDefault(); void runWithErrorReporting(async () => { if (!spaceName.trim()) return; if (editingSpace) await renameSpace(editingSpace, spaceName); else addSpace(spaceName); setSpaceName(''); setCreatingSpace(false); setEditingSpace(null) }, 'No se pudo guardar el espacio') }}><header><div><span>{editingSpace ? 'EDITAR ESPACIO' : 'NUEVO ESPACIO'}</span><h2>{editingSpace ? 'Renombra este proyecto' : 'Organiza una campaña'}</h2></div><button type="button" className="icon-button" onClick={() => { setCreatingSpace(false); setEditingSpace(null) }}><X size={18} /></button></header><label>Nombre<input autoFocus value={spaceName} onChange={event => setSpaceName(event.target.value)} placeholder="Ej. Lanzamiento de verano" /></label><footer><button type="button" className="ghost-button" onClick={() => { setCreatingSpace(false); setEditingSpace(null) }}>Cancelar</button><button className="save-button" disabled={!spaceName.trim()}>{editingSpace ? 'Guardar nombre' : 'Crear espacio'}</button></footer></form></div>}
    {removingSpace && <div className="space-dialog-backdrop"><section className="space-dialog remove-space-dialog"><header><div><span>QUITAR ESPACIO</span><h2>{removingSpace}</h2></div><button type="button" className="icon-button" onClick={() => setRemovingSpace(null)}><X size={18} /></button></header><p>Este espacio contiene {posts.filter(post => post.project === removingSpace).length} publicaciones y {ideas.filter(idea => idea.space === removingSpace).length} ideas. Los archivos multimedia nunca se eliminan.</p><div className="remove-space-options"><button className="ghost-button" onClick={() => void runWithErrorReporting(async () => { await removeSpace(removingSpace, false); setRemovingSpace(null) }, 'No se pudo quitar el espacio')}>Ocultar y conservar</button><button className="danger-action" onClick={() => void runWithErrorReporting(async () => { await removeSpace(removingSpace, true); setRemovingSpace(null) }, 'No se pudo mover el contenido del espacio')}>Mover a contenido general</button></div></section></div>}
  </aside>
}

export function Topbar({ onNew, onSearchSubmit }: { onNew: () => void; onSearchSubmit?: () => void }) {
  const { query, setQuery, view, setView, undoHistory, redoHistory, undoSavedChange, redoSavedChange } = usePlanner()
  const canUndoHere = undoHistory.at(-1)?.view === view
  const canRedoHere = redoHistory.at(-1)?.view === view
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  useEffect(() => {
    let active = true
    const unsubscribe = window.planner.updates.onStateChange(setUpdate)
    void window.planner.updates.getState().then(state => { if (active) setUpdate(state) }).catch(error => reportAppError(error, 'No se pudo consultar el estado de las actualizaciones'))
    return () => { active = false; unsubscribe() }
  }, [])
  useEffect(() => {
    if (update?.status === 'error') reportAppError(update.message || 'La actualización encontró un error.', 'Error de actualización')
  }, [update?.message, update?.status])
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLocaleLowerCase()
      const target = event.target
      const isEditing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      if (key === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (key === 'n' && !isEditing && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        event.preventDefault()
        onNew()
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [onNew])
  const go = (view: 'timeline' | 'calendar' | 'board' | 'ideas' | 'library' | 'sources' | 'about') => { setView(view); setOpen(false) }
  const updateIndicator = update?.status === 'downloading' || update?.status === 'available' || update?.status === 'downloaded' || update?.status === 'installing' || (update?.status === 'error' && update.availableVersion)
  const updateLabel = update?.status === 'downloading'
    ? `Descargando · ${Math.round(update.percent || 0)}%`
    : update?.status === 'installing'
      ? 'Esperando operaciones'
    : update?.status === 'available'
      ? `Disponible · v${update.availableVersion}`
      : update?.status === 'downloaded'
        ? 'Actualización lista'
        : 'Descarga fallida · Reintentar'
  return <header className="topbar"><div className="search"><Search size={17} /><input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={event => { if (event.key === 'Enter') onSearchSubmit?.() }} placeholder="Buscar publicaciones, ideas, etiquetas..." /><kbd>Ctrl K</kbd></div><div className="top-actions">{updateIndicator && <button className={`update-indicator ${update?.status}`} title="Ver actualizaciones" onClick={() => setView('about')}><Download size={14} /><span>{updateLabel}</span>{update?.status === 'downloading' && <progress max="100" value={update.percent || 0} />}</button>}<div className="app-menu-wrap"><button className="icon-button" title="Abrir menú" aria-expanded={open} onClick={() => setOpen(value => !value)}><Menu size={18} /></button>{open && <div className="app-menu"><button onClick={() => go('timeline')}><Clock3 size={15} /> Línea de tiempo</button><button onClick={() => go('calendar')}><CalendarDays size={15} /> Calendario</button><button onClick={() => go('board')}><Columns3 size={15} /> Tablero</button><button onClick={() => go('ideas')}><Lightbulb size={15} /> Ideas</button><button onClick={() => go('library')}><Library size={15} /> Biblioteca</button><button onClick={() => void runWithErrorReporting(async () => { await window.planner.lifecycle.openQuickNote(); setOpen(false) }, 'No se pudo abrir la nota rápida')}><StickyNote size={15} /> Nota rápida</button><hr />{canUndoHere && <button onClick={() => void runWithErrorReporting(async () => { await undoSavedChange(); setOpen(false) }, 'No se pudo deshacer el cambio guardado')}><Undo2 size={15} /> Deshacer (Ctrl+Z)</button>}{canRedoHere && <button onClick={() => void runWithErrorReporting(async () => { await redoSavedChange(); setOpen(false) }, 'No se pudo rehacer el cambio guardado')}><Redo2 size={15} /> Rehacer (Ctrl+Shift+Z)</button>}<button onClick={() => go('about')}><Settings size={15} /> Ajustes</button></div>}</div><NoteReminder /><button className="new-button" onClick={onNew}><Plus size={17} /> Nueva publicación</button><div className="avatar">CG</div></div></header>
}

export function ViewHeading({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return <div className="view-heading"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="view-tools">{children}</div></div>
}

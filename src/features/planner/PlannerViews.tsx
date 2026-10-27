import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BoardCardColorPicker, MobileCardStatus, type BoardCardDetailLevel, type MobilePublicationState } from './BoardCardDecorations'
import { createPortal } from 'react-dom'
import {
  addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format,
  isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { Archive, ArchiveRestore, CalendarDays, ChevronLeft, ChevronRight, FolderPlus, GripVertical, List, Pencil, Smartphone, Trash2 } from 'lucide-react'
import { contentLabels, stages, statusMeta } from '../../shared/constants'
import { postColors } from '../../shared/postColors'
import { PlatformMark, ViewHeading } from '../../components/layout/AppShell'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { postMatchesQuery, usePlanner } from '../../app/store'
import { useSelection } from '../../app/useSelection'
import type { Post, WorkGroup } from '../../shared/types'
import './planner.css'

function fromLocalDateTimeInput(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}


export function Board() {
  const { posts: allPosts, workGroups, move, select, save, activeSpace, query, setQuery, saveWorkGroup, setWorkGroupPosts, setWorkGroupArchived, removeWorkGroup } = usePlanner()
  const [visiblePerColumn, setVisiblePerColumn] = useState(30)
  const [boardMode, setBoardMode] = useState<'kanban' | 'list' | 'calendar'>(() => {
    try { return (localStorage.getItem('caballocci.board-view.all') as 'kanban' | 'list' | 'calendar') || 'kanban' } catch { return 'kanban' }
  })
  const [boardCardDetailLevel, setBoardCardDetailLevel] = useState<BoardCardDetailLevel>(() => {
    try {
      const saved = localStorage.getItem('caballocci.board-card-details')
      return saved === 'hidden' || saved === 'full' ? saved : 'discreet'
    } catch { return 'discreet' }
  })
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(new Set())
  const [listStatus, setListStatus] = useState('')
  const [listFormat, setListFormat] = useState('')
  const [listGroup, setListGroup] = useState('')
  const [listFrom, setListFrom] = useState('')
  const [listTo, setListTo] = useState('')
  const [listSort, setListSort] = useState<'title' | 'status' | 'format' | 'collection' | 'date'>('date')
  const [listSortDirection, setListSortDirection] = useState<'asc' | 'desc'>('asc')
  const [listPage, setListPage] = useState(0)
  const [bulkScheduleAt, setBulkScheduleAt] = useState('')
  const [bulkScheduleWarning, setBulkScheduleWarning] = useState('')
  const [mobileExportBusy, setMobileExportBusy] = useState(false)
  const [mobileExportMessage, setMobileExportMessage] = useState('')
  const [mobileExportSkipped, setMobileExportSkipped] = useState<string[]>([])
  const [mobilePublicationState, setMobilePublicationState] = useState<MobilePublicationState | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(new Date())
  const [expandedCalendarDay, setExpandedCalendarDay] = useState<string | null>(null)
  const [calendarDefaultTime, setCalendarDefaultTime] = useState('10:00')
  const { selected, toggle, clear } = useSelection()
  const dragIds = useRef<string[]>([])
  const [armed, setArmed] = useState<string | null>(null)
  const [selectedWorkGroupId, setSelectedWorkGroupId] = useState('')
  const [membershipTargetGroupId, setMembershipTargetGroupId] = useState('')
  const [showArchivedGroups, setShowArchivedGroups] = useState(false)
  const [showArchivedPosts, setShowArchivedPosts] = useState(false)
  const [showCompressedPosts, setShowCompressedPosts] = useState(false)
  const [groupFormOpen, setGroupFormOpen] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)
  const [pendingGroupAction, setPendingGroupAction] = useState<{ type: 'archive' | 'restore' | 'delete'; group: WorkGroup } | null>(null)
  const [groupDeleteMode, setGroupDeleteMode] = useState<'group' | 'all-posts' | 'selected-posts'>('group')
  const [groupPostsToDelete, setGroupPostsToDelete] = useState<string[]>([])
  const [pendingMediaCompression, setPendingMediaCompression] = useState<{ target: 'group' | 'post'; id: string; name: string; mediaCount: number } | null>(null)
  const [workingOnGroup, setWorkingOnGroup] = useState(false)
  const [mediaCompressionMessage, setMediaCompressionMessage] = useState('')
  const refreshMobilePublicationState = async () => {
    try {
      setMobilePublicationState(await window.planner.mobileSync.publicationState())
    } catch (error) {
      reportAppError(error, 'No se pudo consultar el estado de envíos al celular')
    }
  }
  const changePostCardColor = (post: Post, color: string) => runWithErrorReporting(async () => {
    const targets = selected.size > 1 && selected.has(post.id) ? [...selected] : [post.id]
    for (const id of targets) {
      const target = allPosts.find(item => item.id === id)
      if (target) await save({ ...target, color })
    }
  }, 'No se pudo cambiar el color de las tarjetas')
  useEffect(() => { void refreshMobilePublicationState() }, [])
  useEffect(() => {
    setGroupDeleteMode('group')
    setGroupPostsToDelete([])
  }, [pendingGroupAction?.group.id])
  const availableGroups = workGroups.filter(group => showArchivedGroups || !group.archivedAt)
  const selectedWorkGroup = workGroups.find(group => group.id === selectedWorkGroupId) || null
  const boardPreferenceKey = `caballocci.board-view.${activeSpace || 'all'}`
  useEffect(() => {
    try {
      const saved = localStorage.getItem(boardPreferenceKey)
      setBoardMode(saved === 'list' || saved === 'calendar' ? saved : 'kanban')
    } catch { setBoardMode('kanban') }
  }, [boardPreferenceKey])
  const changeBoardMode = (mode: 'kanban' | 'list' | 'calendar') => {
    setBoardMode(mode)
    try { localStorage.setItem(boardPreferenceKey, mode) } catch { /* Preferences are optional. */ }
    clear()
  }
  const changeBoardCardDetailLevel = (level: BoardCardDetailLevel) => {
    setBoardCardDetailLevel(level)
    try { localStorage.setItem('caballocci.board-card-details', level) } catch { /* Preferences are optional. */ }
  }
  const matchingPosts = (selectedWorkGroup
    ? allPosts.filter(post => selectedWorkGroup.postIds.includes(post.id))
    : activeSpace ? allPosts.filter(post => post.project === activeSpace) : allPosts).filter(post => postMatchesQuery(post, query))
  const posts = selectedWorkGroup ? matchingPosts.filter(post => selectedWorkGroup.postIds.includes(post.id)) : matchingPosts
  const visibleBoardPosts = posts.filter(post => post.status !== 'archived')
  const listPosts = useMemo(() => posts.filter(post =>
    (!listStatus || post.status === listStatus) &&
    (!listFormat || post.contentType === listFormat) &&
    (!listGroup || workGroups.some(group => group.id === listGroup && group.postIds.includes(post.id))) &&
    (!listFrom || Boolean(post.scheduledAt && post.scheduledAt.slice(0, 10) >= listFrom)) &&
    (!listTo || Boolean(post.scheduledAt && post.scheduledAt.slice(0, 10) <= listTo)),
  ).sort((a, b) => {
    const left = listSort === 'title' ? a.title.toLocaleLowerCase() : listSort === 'status' ? [...stages, 'archived' as Post['status']].indexOf(a.status) : listSort === 'format' ? a.contentType : listSort === 'collection' ? workGroups.filter(group => group.postIds.includes(a.id)).map(group => group.name).join(', ').toLocaleLowerCase() : a.scheduledAt || '9999'
    const right = listSort === 'title' ? b.title.toLocaleLowerCase() : listSort === 'status' ? [...stages, 'archived' as Post['status']].indexOf(b.status) : listSort === 'format' ? b.contentType : listSort === 'collection' ? workGroups.filter(group => group.postIds.includes(b.id)).map(group => group.name).join(', ').toLocaleLowerCase() : b.scheduledAt || '9999'
    const compared = left < right ? -1 : left > right ? 1 : 0
    return compared * (listSortDirection === 'asc' ? 1 : -1)
  }), [posts, listStatus, listFormat, listGroup, listFrom, listTo, listSort, listSortDirection, workGroups])
  const pageSize = 75
  const listPageCount = Math.max(1, Math.ceil(listPosts.length / pageSize))
  const visibleListPosts = listPosts.slice(listPage * pageSize, (listPage + 1) * pageSize)
  const archivedPosts = posts.filter(post => post.status === 'archived')
  const compressedPosts = allPosts.filter(post => post.media.some(asset => asset.compressed))
  const groupUncompressedMediaCount = selectedWorkGroup
    ? posts.flatMap(post => post.media).filter(asset => !asset.compressed).length
    : 0
  useEffect(() => { clear() }, [query, activeSpace, selectedWorkGroupId, clear])
  useEffect(() => { setListPage(0); clear() }, [listStatus, listFormat, listGroup, listFrom, listTo, clear])
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') clear() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [clear])
  const bulkMove = (status: Post['status']) => runWithErrorReporting(async () => {
    const targets = [...selected].filter(id => allPosts.some(item => item.id === id))
    for (const id of targets) await move(id, status)
    usePlanner.getState().groupRecentUndoActions(targets.length, `Mover ${targets.length} publicaciones a ${statusMeta[status].label}`)
    clear()
  }, 'No se pudieron actualizar las publicaciones seleccionadas')
  const bulkSchedule = () => {
    const scheduledAt = fromLocalDateTimeInput(bulkScheduleAt)
    if (!scheduledAt || !selected.size) {
      setBulkScheduleWarning('Elige fecha y hora para programar las publicaciones seleccionadas.')
      return
    }
    void runWithErrorReporting(async () => {
      const targets = [...selected].filter(id => allPosts.some(post => post.id === id))
      for (const id of targets) {
        const post = allPosts.find(item => item.id === id)
        if (post) await usePlanner.getState().save({ ...post, scheduledAt, status: 'scheduled' })
      }
      usePlanner.getState().groupRecentUndoActions(targets.length, `Programar ${targets.length} publicaciones`)
      setBulkScheduleAt('')
      setBulkScheduleWarning('')
      clear()
    }, 'No se pudieron programar las publicaciones seleccionadas')
  }
  const exportSelectedToMobile = () => runWithErrorReporting(async () => {
    const postIds = [...selected].filter(id => allPosts.some(post => post.id === id))
    if (!postIds.length) return
    setMobileExportBusy(true)
    setMobileExportMessage('')
    setMobileExportSkipped([])
    try {
      const report = await window.planner.mobileSync.exportSelected(postIds)
      if (!report) return
      await refreshMobilePublicationState()
      setMobileExportMessage(`Lote ${report.batch}: ${report.publications} ${report.publications === 1 ? 'publicación' : 'publicaciones'} y ${report.destinations} ${report.destinations === 1 ? 'destino' : 'destinos'} añadidos al catálogo.`)

      if (report.missingAlbums.length) setMobileExportMessage(value => value + ` Se retiraron ${report.missingAlbums.length} referencias a carpetas ausentes.`)
      setMobileExportSkipped(report.skipped.map(item => `${item.title || item.postId}: ${item.reason}`))
    } finally {
      setMobileExportBusy(false)
    }
  }, 'No se pudo enviar la selección al celular')
  const scheduleDroppedPost = (event: React.DragEvent, day: Date) => {
    event.preventDefault()
    const post = allPosts.find(item => item.id === event.dataTransfer.getData('post'))
    if (!post) return
    const [hours, minutes] = calendarDefaultTime.split(':').map(Number)
    const scheduledAt = new Date(day)
    scheduledAt.setHours(hours || 0, minutes || 0, 0, 0)
    void runWithErrorReporting(() => usePlanner.getState().save({ ...post, scheduledAt: scheduledAt.toISOString(), status: 'scheduled' }), 'No se pudo programar la publicación')
  }
  const moveDragged = (status: Post['status']) => runWithErrorReporting(async () => { const ids = dragIds.current; dragIds.current = []; for (const id of ids) await move(id, status); clear() }, 'No se pudieron mover las publicaciones')
  const archivedCount = posts.filter(post => post.status === 'archived').length
  const openGroupForm = (group?: typeof selectedWorkGroup) => {
    setEditingGroupId(group?.id || null)
    setGroupName(group?.name || '')
    setGroupDescription(group?.description || '')
    setGroupFormOpen(true)
  }
  const submitGroupForm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!groupName.trim() || savingGroup) return
    void runWithErrorReporting(async () => {
      setSavingGroup(true)
      try {
        const group = await saveWorkGroup({
          ...(editingGroupId ? { id: editingGroupId } : {}),
          name: groupName.trim(),
          description: groupDescription.trim(),
        })
        if (!editingGroupId && selected.size) await setWorkGroupPosts(group.id, [...selected], { recordHistory: false })
        setSelectedWorkGroupId(group.id)
        setMembershipTargetGroupId(group.id)
        setGroupFormOpen(false)
        clear()
      } finally {
        setSavingGroup(false)
      }
    }, editingGroupId ? 'No se pudo actualizar la colección' : 'No se pudo crear la colección')
  }
  const updateGroupMembership = (groupId: string, add: boolean) => runWithErrorReporting(async () => {
    const group = workGroups.find(item => item.id === groupId)
    if (!group || group.archivedAt || !selected.size) return
    const selectedIds = [...selected]
    const nextIds = add
      ? [...new Set([...group.postIds, ...selectedIds])]
      : group.postIds.filter(id => !selected.has(id))
    await setWorkGroupPosts(group.id, nextIds)
    clear()
  }, add ? 'No se pudieron añadir publicaciones a la colección' : 'No se pudieron quitar publicaciones de la colección')
  const confirmGroupAction = () => {
    if (!pendingGroupAction || workingOnGroup) return
    void runWithErrorReporting(async () => {
      setWorkingOnGroup(true)
      try {
        const { type, group } = pendingGroupAction
        if (type === 'delete') {
          const postIds = groupDeleteMode === 'all-posts' ? group.postIds : groupDeleteMode === 'selected-posts' ? groupPostsToDelete : []
          for (const id of postIds) {
            const post = allPosts.find(item => item.id === id)
            if (post?.media.some(asset => asset.compressed)) await window.planner.workGroups.restorePostMedia(id)
            await usePlanner.getState().remove(id)
          }
          if (!postIds.length && group.compressedMediaCount) await window.planner.workGroups.restoreMedia(group.id)
          await removeWorkGroup(group.id, { recordHistory: postIds.length === 0 })
          await usePlanner.getState().load()
          setSelectedWorkGroupId('')
          if (membershipTargetGroupId === group.id) setMembershipTargetGroupId('')
        } else {
          const restoring = type === 'restore'
          await setWorkGroupArchived(group.id, !restoring)
          if (!restoring) {
            setSelectedWorkGroupId('')
            if (membershipTargetGroupId === group.id) setMembershipTargetGroupId('')
          } else {
            setMembershipTargetGroupId(group.id)
          }
        }
        setPendingGroupAction(null)
      } finally {
        setWorkingOnGroup(false)
      }
    }, pendingGroupAction.type === 'delete' ? 'No se pudo eliminar la colección' : 'No se pudo actualizar el estado de la colección')
  }
  const compressGroupMedia = () => runWithErrorReporting(async () => {
    if (!selectedWorkGroup) return
    setMediaCompressionMessage('')
    const result = await window.planner.workGroups.compressMedia(selectedWorkGroup.id)
    await usePlanner.getState().load()
    setMediaCompressionMessage(result.compressed
      ? `${result.compressed} archivos comprimidos; se liberaron ${(result.releasedBytes / 1024 / 1024).toFixed(1)} MB.${result.skipped ? ` Se omitieron ${result.skipped} medios compartidos, externos, ya comprimidos o sin ahorro neto.` : ''}`
      : `No había medios con compresión segura y ahorro neto.${result.skipped ? ` Se omitieron ${result.skipped} medios compartidos, externos, ya comprimidos o que no reducían el espacio.` : ''}`)
  }, 'No se pudieron comprimir los medios de la colección')
  const restoreGroupMedia = () => runWithErrorReporting(async () => {
    if (!selectedWorkGroup) return
    const result = await window.planner.workGroups.restoreMedia(selectedWorkGroup.id)
    await usePlanner.getState().load()
    setMediaCompressionMessage(`${result.restored} archivos restaurados a sus rutas originales.`)
  }, 'No se pudieron restaurar los medios de la colección')
  const compressPostMedia = (post: Post) => runWithErrorReporting(async () => {
    const result = await window.planner.workGroups.compressPostMedia(post.id)
    await usePlanner.getState().load()
    setMediaCompressionMessage(result.compressed
      ? `${post.title || 'Publicación'}: ${result.compressed} archivos comprimidos; se liberaron ${(result.releasedBytes / 1024 / 1024).toFixed(1)} MB.${result.skipped ? ` Se omitieron ${result.skipped} medios compartidos, externos, ya comprimidos o sin ahorro neto.` : ''}`
      : `No había medios con compresión segura y ahorro neto en “${post.title || 'Publicación'}”.${result.skipped ? ` Se omitieron ${result.skipped} medios compartidos, externos, ya comprimidos o que no reducían el espacio.` : ''}`)
  }, 'No se pudieron comprimir los medios de la publicación')
  const restorePostMedia = (post: Post) => runWithErrorReporting(async () => {
    const result = await window.planner.workGroups.restorePostMedia(post.id)
    await usePlanner.getState().load()
    setMediaCompressionMessage(`${result.restored} archivos restaurados a sus rutas originales.`)
  }, 'No se pudieron restaurar los medios de la publicación')
  const confirmMediaCompression = () => {
    if (!pendingMediaCompression) return
    const pending = pendingMediaCompression
    setPendingMediaCompression(null)
    if (pending.target === 'group') void compressGroupMedia()
    else {
      const post = allPosts.find(item => item.id === pending.id)
      if (post) void compressPostMedia(post)
    }
  }
  const toggleArchivedGroups = () => {
    const next = !showArchivedGroups
    setShowArchivedGroups(next)
    if (!next && selectedWorkGroup?.archivedAt) {
      setSelectedWorkGroupId('')
      if (membershipTargetGroupId === selectedWorkGroup.id) setMembershipTargetGroupId('')
    }
  }
  return <section className={`workspace board-mode-${boardMode}`}><ViewHeading title="Tablero de contenido" subtitle="Gestiona publicaciones por etapas, en lista o por fecha."><div className="segmented board-mode-switch" role="group" aria-label="Vista del tablero"><button type="button" aria-pressed={boardMode === 'kanban'} className={boardMode === 'kanban' ? 'active' : ''} onClick={() => changeBoardMode('kanban')}>Kanban</button><button type="button" aria-pressed={boardMode === 'list'} className={boardMode === 'list' ? 'active' : ''} onClick={() => changeBoardMode('list')}><List size={13} /> Lista</button><button type="button" aria-pressed={boardMode === 'calendar'} className={boardMode === 'calendar' ? 'active' : ''} onClick={() => changeBoardMode('calendar')}><CalendarDays size={13} /> Calendario</button></div>{boardMode === 'kanban' && <button className="settings-button" type="button" disabled={visiblePerColumn >= 100} onClick={() => setVisiblePerColumn(current => Math.min(100, current + 30))}>{visiblePerColumn >= 100 ? 'Límite de tarjetas' : `Cargar ${Math.min(30, 100 - visiblePerColumn)} más por etapa`}</button>}{boardMode === 'kanban' && <label className="board-card-detail-control">Detalles técnicos<select aria-label="Nivel de detalles técnicos en las tarjetas" value={boardCardDetailLevel} onChange={event => changeBoardCardDetailLevel(event.target.value as BoardCardDetailLevel)}><option value="discreet">Discretos</option><option value="full">Completos</option><option value="hidden">Ocultos</option></select></label>}</ViewHeading>
    <div className="work-group-toolbar">
      <div className="work-group-picker"><label htmlFor="work-group-filter">Colección</label><select id="work-group-filter" value={selectedWorkGroupId} onChange={event => { const id = event.target.value; setSelectedWorkGroupId(id); setMediaCompressionMessage(''); if (id && !workGroups.find(group => group.id === id)?.archivedAt) setMembershipTargetGroupId(id) }}><option value="">Todas las publicaciones</option>{availableGroups.map(group => <option key={group.id} value={group.id}>{group.name}{group.archivedAt ? ' · Archivada' : ''} · {format(parseISO(group.createdAt), 'd MMM yyyy', { locale: es })} ({group.postIds.length})</option>)}</select></div>
      <button type="button" className="settings-button" onClick={toggleArchivedGroups}>{showArchivedGroups ? 'Ocultar archivadas' : 'Ver archivadas'}</button>
      <button type="button" className="settings-button" onClick={() => openGroupForm()}><FolderPlus size={14} /> Nueva colección</button>
      {selectedWorkGroup && <div className="work-group-actions">
        <button type="button" className="settings-button" onClick={() => openGroupForm(selectedWorkGroup)}><Pencil size={13} /> Editar</button>
        <button type="button" className="settings-button" onClick={() => setPendingGroupAction({ type: selectedWorkGroup.archivedAt ? 'restore' : 'archive', group: selectedWorkGroup })}>{selectedWorkGroup.archivedAt ? <><ArchiveRestore size={14} /> Restaurar colección</> : <><Archive size={14} /> Archivar colección</>}</button>
        {selectedWorkGroup.archivedAt && <>{groupUncompressedMediaCount > 0 && <button type="button" className="settings-button" onClick={() => setPendingMediaCompression({ target: 'group', id: selectedWorkGroup.id, name: selectedWorkGroup.name, mediaCount: groupUncompressedMediaCount })}><Archive size={14} /> Comprimir medios</button>}{selectedWorkGroup.compressedMediaCount > 0 && <button type="button" className="settings-button" onClick={() => void restoreGroupMedia()}><ArchiveRestore size={14} /> Restaurar {selectedWorkGroup.compressedMediaCount} medios</button>}</>}
        <button type="button" className="settings-button work-group-delete-button" onClick={() => setPendingGroupAction({ type: 'delete', group: selectedWorkGroup })}><Trash2 size={14} /> Borrar colección</button>
      </div>}
    </div>
    {boardMode === 'list' && <div className="board-list-filters" aria-label="Filtros de publicaciones">
      <label>Etapa<select value={listStatus} onChange={event => setListStatus(event.target.value)}><option value="">Todas</option>{[...stages, 'archived' as Post['status']].map(status => <option key={status} value={status}>{statusMeta[status].label}</option>)}</select></label>
      <label>Formato<select value={listFormat} onChange={event => setListFormat(event.target.value)}><option value="">Todos</option>{Object.entries(contentLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Colección<select value={listGroup} onChange={event => setListGroup(event.target.value)}><option value="">Todas</option>{workGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label>Desde<input type="date" value={listFrom} onChange={event => setListFrom(event.target.value)} /></label>
      <label>Hasta<input type="date" value={listTo} onChange={event => setListTo(event.target.value)} /></label>
      {(listStatus || listFormat || listGroup || listFrom || listTo) && <button type="button" className="settings-button" onClick={() => { setListStatus(''); setListFormat(''); setListGroup(''); setListFrom(''); setListTo('') }}>Limpiar filtros</button>}
    </div>}
    {groupFormOpen && <div className="work-group-form-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !savingGroup) setGroupFormOpen(false) }}>
      <form className="work-group-form" role="dialog" aria-modal="true" aria-labelledby="work-group-form-title" onSubmit={submitGroupForm}>
        <header><span>COLECCIÓN DE TRABAJO</span><button type="button" aria-label="Cerrar" disabled={savingGroup} onClick={() => setGroupFormOpen(false)}>×</button></header>
        <h2 id="work-group-form-title">{editingGroupId ? 'Editar colección' : 'Crear colección'}</h2>
        <p>Reúne publicaciones de una campaña, serie o proyecto. Sus estados no se modifican.</p>
        <label htmlFor="work-group-name">Nombre</label>
        <input id="work-group-name" autoFocus maxLength={120} required value={groupName} onChange={event => setGroupName(event.target.value)} placeholder="Ej. Lanzamiento de primavera" />
        <label htmlFor="work-group-description">Descripción <span>Opcional</span></label>
        <textarea id="work-group-description" maxLength={2000} rows={3} value={groupDescription} onChange={event => setGroupDescription(event.target.value)} placeholder="¿Qué tienen en común estas publicaciones?" />
        {!editingGroupId && <div className="work-group-form-hint">{selected.size
          ? `Se añadirán automáticamente ${selected.size} publicaciones seleccionadas.`
          : 'Después de crearla, selecciona publicaciones en el tablero y usa “Añadir a colección”.'}</div>}
        <footer><button type="button" className="settings-button" disabled={savingGroup} onClick={() => setGroupFormOpen(false)}>Cancelar</button><button type="submit" className="new-button" disabled={savingGroup || !groupName.trim()}>{savingGroup ? 'Guardando…' : editingGroupId ? 'Guardar cambios' : 'Crear colección'}</button></footer>
      </form>
    </div>}
    {selectedWorkGroup && <div className="work-group-summary" role="status"><strong>{selectedWorkGroup.name}</strong><span>{selectedWorkGroup.postIds.length} publicaciones · Creada el {format(parseISO(selectedWorkGroup.createdAt), 'd MMMM yyyy', { locale: es })}{selectedWorkGroup.compressedMediaCount ? ` · ${selectedWorkGroup.compressedMediaCount} medios comprimidos` : ''} · Los estados individuales no cambian al archivar la colección.</span>{selectedWorkGroup.archivedAt && <b>Archivada</b>}</div>}
    {mediaCompressionMessage && <p className="work-group-export-message" role="status">{mediaCompressionMessage}</p>}
    {pendingGroupAction && <div className="work-group-form-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !workingOnGroup) setPendingGroupAction(null) }}>
      <section className="work-group-form work-group-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="work-group-confirm-title" aria-describedby="work-group-confirm-description">
        <header><span>CONFIRMAR ACCIÓN</span><button type="button" aria-label="Cerrar" disabled={workingOnGroup} onClick={() => setPendingGroupAction(null)}>×</button></header>
        <h2 id="work-group-confirm-title">{pendingGroupAction.type === 'delete' ? '¿Borrar esta colección?' : pendingGroupAction.type === 'archive' ? '¿Archivar esta colección?' : '¿Restaurar esta colección?'}</h2>
        <p id="work-group-confirm-description">{pendingGroupAction.type === 'delete'
          ? <>Se borrará <strong>{pendingGroupAction.group.name}</strong> y sus vínculos. Elige qué hacer con sus {pendingGroupAction.group.postIds.length} publicaciones:</>
          : pendingGroupAction.type === 'archive'
            ? <>Se archivará <strong>{pendingGroupAction.group.name}</strong>. Sus publicaciones y estados permanecerán intactos; podrás restaurarla después.</>
            : <>Se restaurará <strong>{pendingGroupAction.group.name}</strong> y volverá a aparecer entre las colecciones activas.</>}</p>
        {pendingGroupAction.type === 'delete' && <div className="work-group-delete-options" role="radiogroup" aria-label="Qué borrar">
          <label><input type="radio" name="group-delete-mode" checked={groupDeleteMode === 'group'} onChange={() => setGroupDeleteMode('group')} /><span><strong>Borrar solo la colección</strong><small>Conserva publicaciones y archivos.</small></span></label>
          <label><input type="radio" name="group-delete-mode" checked={groupDeleteMode === 'all-posts'} onChange={() => setGroupDeleteMode('all-posts')} /><span><strong>Borrar colección y todas las publicaciones ({pendingGroupAction.group.postIds.length})</strong><small>Se quitarán también de otras colecciones.</small></span></label>
          <label><input type="radio" name="group-delete-mode" checked={groupDeleteMode === 'selected-posts'} onChange={() => setGroupDeleteMode('selected-posts')} /><span><strong>Borrar colección y algunas publicaciones</strong><small>Elige cuáles borrar; las demás se conservan.</small></span></label>
          {groupDeleteMode === 'selected-posts' && <div className="work-group-delete-post-list">{allPosts.filter(post => pendingGroupAction.group.postIds.includes(post.id)).map(post => <label key={post.id}><input type="checkbox" checked={groupPostsToDelete.includes(post.id)} onChange={event => setGroupPostsToDelete(current => event.target.checked ? [...current, post.id] : current.filter(id => id !== post.id))} /><span>{post.title || 'Publicación sin título'}</span></label>)}</div>}
          <p>{groupDeleteMode === 'group' ? 'No se eliminará ninguna publicación.' : `Se eliminarán ${groupDeleteMode === 'all-posts' ? pendingGroupAction.group.postIds.length : groupPostsToDelete.length} publicaciones y sus vínculos. Esta acción no se puede deshacer.`}{pendingGroupAction.group.compressedMediaCount ? ' Los medios comprimidos se restaurarán antes del borrado.' : ''}</p>
        </div>}
        <footer><button type="button" className="settings-button" disabled={workingOnGroup} onClick={() => setPendingGroupAction(null)}>Cancelar</button><button type="button" className={pendingGroupAction.type === 'delete' && groupDeleteMode !== 'group' ? 'work-group-danger-button' : 'new-button'} disabled={workingOnGroup || pendingGroupAction.type === 'delete' && groupDeleteMode === 'selected-posts' && !groupPostsToDelete.length} onClick={confirmGroupAction}>{workingOnGroup ? 'Procesando…' : pendingGroupAction.type === 'delete' ? groupDeleteMode === 'group' ? 'Borrar solo colección' : 'Borrar colección y publicaciones' : pendingGroupAction.type === 'archive' ? 'Archivar colección' : 'Restaurar colección'}</button></footer>
      </section>
    </div>}
    {boardMode === 'list' && <section className="board-list-view" aria-label="Publicaciones en lista">
      {!listPosts.length ? <div className="planner-empty-inline" role="status"><strong>{query.trim() ? 'No hay publicaciones que coincidan' : 'No hay publicaciones para estos filtros'}</strong><span>Ajusta la búsqueda o los filtros para ver resultados.</span></div> : <>
        <div className="board-list-scroll"><table><thead><tr>
          <th><button type="button" onClick={() => { setListSort('title'); setListSortDirection(current => listSort === 'title' && current === 'asc' ? 'desc' : 'asc') }}>Título</button></th>
          <th><button type="button" onClick={() => { setListSort('status'); setListSortDirection(current => listSort === 'status' && current === 'asc' ? 'desc' : 'asc') }}>Etapa</button></th>
          <th><button type="button" onClick={() => { setListSort('format'); setListSortDirection(current => listSort === 'format' && current === 'asc' ? 'desc' : 'asc') }}>Formato</button></th>
          <th><button type="button" onClick={() => { setListSort('collection'); setListSortDirection(current => listSort === 'collection' && current === 'asc' ? 'desc' : 'asc') }}>Colección</button></th>
          <th><button type="button" onClick={() => { setListSort('date'); setListSortDirection(current => listSort === 'date' && current === 'asc' ? 'desc' : 'asc') }}>Fecha</button></th>
          <th>Destinos</th>
        </tr></thead><tbody>{visibleListPosts.map(post => {
          const memberships = workGroups.filter(group => group.postIds.includes(post.id))
          return <tr key={post.id} className={selected.has(post.id) ? 'selected' : ''}>
            <td><label className="board-list-select"><input type="checkbox" checked={selected.has(post.id)} onChange={event => toggle(post.id, event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey, listPosts.map(item => item.id))} aria-label={`Seleccionar ${post.title || 'publicación'}`} /><button type="button" onClick={() => select(post.id)}>{post.title || 'Publicación sin título'}</button></label></td>
            <td><span className="board-list-stage"><i style={{ background: statusMeta[post.status].color }} />{statusMeta[post.status].label}</span></td>
            <td>{contentLabels[post.contentType]}</td>
            <td>{memberships.length ? memberships.map(group => group.name).join(', ') : '—'}</td>
            <td>{post.scheduledAt ? format(parseISO(post.scheduledAt), 'd MMM yyyy · HH:mm', { locale: es }) : 'Sin fecha'}</td>
            <td>{post.distribution?.length ? post.distribution.map(target => target.name).join(', ') : post.platforms.join(', ') || '—'}</td>
          </tr>
        })}</tbody></table></div>
        <div className="board-list-pagination"><span>{listPosts.length} publicaciones · página {listPage + 1} de {listPageCount}</span><div><button type="button" className="settings-button" disabled={listPage === 0} onClick={() => setListPage(current => current - 1)}>Anterior</button><button type="button" className="settings-button" disabled={listPage + 1 >= listPageCount} onClick={() => setListPage(current => current + 1)}>Siguiente</button></div></div>
      </>}
    </section>}
    {boardMode === 'calendar' && <section className="board-editorial-calendar" aria-label="Calendario editorial">
      <div className="board-calendar-heading"><strong>{format(calendarMonth, 'MMMM yyyy', { locale: es })}</strong><div className="period-controls"><button type="button" aria-label="Mes anterior" onClick={() => { setCalendarMonth(current => subMonths(current, 1)); setExpandedCalendarDay(null) }}><ChevronLeft size={16} /></button><button type="button" onClick={() => { setCalendarMonth(new Date()); setExpandedCalendarDay(null) }}>Hoy</button><button type="button" aria-label="Mes siguiente" onClick={() => { setCalendarMonth(current => addMonths(current, 1)); setExpandedCalendarDay(null) }}><ChevronRight size={16} /></button></div></div>
      <section className="board-unscheduled" aria-label="Publicaciones sin programar"><header><div><strong>Sin programar</strong><span>{posts.filter(post => !post.scheduledAt && post.status !== 'archived' && post.status !== 'published').length}</span></div><label>Hora sugerida<input type="time" value={calendarDefaultTime} onChange={event => setCalendarDefaultTime(event.target.value || '10:00')} /></label></header><div>{posts.filter(post => !post.scheduledAt && post.status !== 'archived' && post.status !== 'published').map(post => <button type="button" key={post.id} draggable title="Arrastra al día para programar; también puedes abrir el detalle" onDragStart={event => event.dataTransfer.setData('post', post.id)} onClick={() => select(post.id)}><strong>{post.title || 'Publicación sin título'}</strong><span>{statusMeta[post.status].label} · {contentLabels[post.contentType]}</span></button>)}</div><small>Arrastra una publicación a un día. Se programará a las {calendarDefaultTime} en tu zona horaria.</small></section>
      <div className="board-calendar-grid"><div className="board-calendar-weekdays">{['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => <span key={day}>{day}</span>)}</div><div className="board-calendar-days">{eachDayOfInterval({ start: startOfWeek(startOfMonth(calendarMonth), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(calendarMonth), { weekStartsOn: 1 }) }).map(day => {
        const dayPosts = posts.filter(post => post.scheduledAt && isSameDay(parseISO(post.scheduledAt), day))
        const dayKey = format(day, 'yyyy-MM-dd')
        const visibleDayPosts = expandedCalendarDay === dayKey ? dayPosts : dayPosts.slice(0, 3)
        return <div key={day.toISOString()} className={`${isSameMonth(day, calendarMonth) ? '' : 'muted'} ${isSameDay(day, new Date()) ? 'today' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => scheduleDroppedPost(event, day)}><b>{format(day, 'd')}</b>{visibleDayPosts.map(post => <button type="button" key={post.id} title={post.title} onClick={() => select(post.id)}><time>{post.scheduledAt && format(parseISO(post.scheduledAt), 'HH:mm')}</time><span>{post.title || 'Publicación sin título'}</span></button>)}{dayPosts.length > 3 && <button type="button" className="board-calendar-more" onClick={() => setExpandedCalendarDay(expandedCalendarDay === dayKey ? null : dayKey)}>{expandedCalendarDay === dayKey ? 'Mostrar menos' : `+ ${dayPosts.length - 3} más`}</button>}</div>
      })}</div></div>
      <p className="board-calendar-note" role="status">{posts.some(post => post.scheduledAt) ? `${posts.filter(post => !post.scheduledAt).length} publicaciones sin fecha no se muestran en el calendario.` : 'No hay publicaciones programadas. Las publicaciones sin fecha no se asignan a ningún día.'}</p>
    </section>}
    {pendingMediaCompression && <div className="work-group-form-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPendingMediaCompression(null) }}>
      <section className="work-group-form work-group-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="media-compress-title" aria-describedby="media-compress-description">
        <header><span>AHORRAR ESPACIO</span><button type="button" aria-label="Cerrar" onClick={() => setPendingMediaCompression(null)}>×</button></header>
        <h2 id="media-compress-title">¿Comprimir medios?</h2>
        <p id="media-compress-description">Se guardarán hasta {pendingMediaCompression.mediaCount} medios de <strong>{pendingMediaCompression.name}</strong> en un ZIP interno con su manifiesto. Tras verificarlo, Caballocci eliminará los originales que administra para liberar espacio. Los medios compartidos o referenciados externamente se conservarán. Podrás restaurarlos después.</p>
        <footer><button type="button" className="settings-button" onClick={() => setPendingMediaCompression(null)}>Cancelar</button><button type="button" className="work-group-danger-button" onClick={confirmMediaCompression}>Comprimir y liberar espacio</button></footer>
      </section>
    </div>}
    {!selected.size && <p className="work-group-selection-hint">Para reunir publicaciones, marca las casillas de las tarjetas (pueden estar en distintas etapas) y elige una colección.</p>}
    {selected.size > 0 && <div className="board-bulk-actions"><strong>{selected.size} seleccionadas</strong><button type="button" disabled={mobileExportBusy} onClick={() => void exportSelectedToMobile()}><Smartphone size={14} /> {mobileExportBusy ? 'Enviando…' : 'Enviar selección al celular'}</button>{boardMode === 'list' && <div className="bulk-schedule-control"><label htmlFor="bulk-schedule-at">Fecha y hora</label><input id="bulk-schedule-at" type="datetime-local" value={bulkScheduleAt} onChange={event => { setBulkScheduleAt(event.target.value); setBulkScheduleWarning('') }} /><button type="button" disabled={!bulkScheduleAt} onClick={bulkSchedule}>Programar selección</button></div>}<button type="button" onClick={() => void bulkMove('draft')}>Borrador</button><button type="button" onClick={() => void bulkMove('review')}>Revisión</button><button type="button" onClick={() => void bulkMove('approved')}>Aprobadas</button><button type="button" onClick={() => void bulkMove('archived')}>Archivar</button><button type="button" onClick={clear}>Cancelar</button>{bulkScheduleWarning && <span className="bulk-schedule-warning" role="alert">{bulkScheduleWarning}</span>}</div>}
    {mobileExportMessage && <div className="work-group-export-message" role="status"><p>{mobileExportMessage}</p>{mobileExportSkipped.map((item, index) => <p key={`${index}-${item}`}>Omitida: {item}</p>)}</div>}
    {selected.size > 0 && <div className="board-bulk-actions work-group-membership-actions"><strong>{selected.size} publicaciones seleccionadas</strong>{workGroups.some(group => !group.archivedAt) && <><select aria-label="Colección de destino" value={membershipTargetGroupId} onChange={event => setMembershipTargetGroupId(event.target.value)}><option value="">Añadir a una colección…</option>{workGroups.filter(group => !group.archivedAt).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button type="button" disabled={!membershipTargetGroupId} onClick={() => void updateGroupMembership(membershipTargetGroupId, true)}>Añadir</button></>}{selectedWorkGroup && !selectedWorkGroup.archivedAt && selectedWorkGroup.postIds.some(id => selected.has(id)) && <button type="button" onClick={() => void updateGroupMembership(selectedWorkGroup.id, false)}>Quitar de esta colección</button>}<button type="button" onClick={() => openGroupForm()}>Crear colección con selección</button></div>}
    {archivedPosts.length > 0 && <section className="board-archived-posts"><header><div><strong>Publicaciones archivadas</strong><span>{archivedPosts.length}</span></div><button type="button" className="settings-button" onClick={() => setShowArchivedPosts(current => !current)}>{showArchivedPosts ? 'Ocultar' : 'Mostrar'}</button></header>{showArchivedPosts && <div className="board-archived-post-list">{archivedPosts.map(post => {
      const compressedCount = post.media.filter(asset => asset.compressed).length
      return <article key={post.id}><button type="button" className="board-archived-post-title" onClick={() => select(post.id)}><strong>{post.title || 'Publicación sin título'}</strong><span>{post.media.length} medios · {compressedCount} comprimidos</span></button><div>{post.media.length > compressedCount && <button type="button" className="settings-button" onClick={() => setPendingMediaCompression({ target: 'post', id: post.id, name: post.title || 'Publicación sin título', mediaCount: post.media.length - compressedCount })}><Archive size={13} /> Comprimir medios</button>}{compressedCount > 0 && <button type="button" className="settings-button" onClick={() => void restorePostMedia(post)}><ArchiveRestore size={13} /> Restaurar medios</button>}</div></article>
    })}</div>}</section>}
    {compressedPosts.length > 0 && <section className="board-archived-posts"><header><div><strong>Medios comprimidos</strong><span>{compressedPosts.length}</span></div><button type="button" className="settings-button" onClick={() => setShowCompressedPosts(current => !current)}>{showCompressedPosts ? 'Ocultar' : 'Mostrar'}</button></header>{showCompressedPosts && <div className="board-archived-post-list">{compressedPosts.map(post => <article key={post.id}><div className="board-archived-post-title"><strong>{post.title || 'Publicación sin título'}</strong><span>{post.media.filter(asset => asset.compressed).length} medios dentro de archivo ZIP · {statusMeta[post.status].label}</span></div><div><button type="button" className="settings-button" onClick={() => void restorePostMedia(post)}><ArchiveRestore size={13} /> Restaurar medios</button></div></article>)}</div>}</section>}
    {archivedCount > 0 && <p className="board-archive-note">{archivedCount} publicaciones archivadas no se muestran en el tablero.</p>}
    {!visibleBoardPosts.length && <div className="planner-empty-inline board-empty" role="status"><strong>{selectedWorkGroup && !posts.length ? 'Esta colección todavía no tiene publicaciones visibles' : query.trim() && posts.length === 0 ? 'No hay publicaciones que coincidan con la búsqueda' : archivedCount ? 'Todas las publicaciones de este espacio están archivadas' : 'Este espacio aún no tiene publicaciones'}</strong><span>{selectedWorkGroup && !posts.length ? 'Selecciona publicaciones del tablero y añádelas a esta colección.' : query.trim() && posts.length === 0 ? 'Limpia la búsqueda para volver a ver el tablero.' : 'Crea una publicación o convierte una idea para empezar.'}</span>{query.trim() && posts.length === 0 && <button type="button" className="settings-button" onClick={() => setQuery('')}>Limpiar búsqueda</button>}</div>}
    {boardMode === 'kanban' && <div className={'board' + (selected.size ? ' selecting' : '')}>{stages.map(status => { const columnPosts = visibleBoardPosts.filter(post => post.status === status); const visiblePosts = columnPosts.slice(0, visiblePerColumn); const order = columnPosts.map(post => post.id); const collapsed = collapsedColumns.has(status); return <div className={'board-column' + (collapsed ? ' collapsed' : '')} key={status} onDragOver={event => event.preventDefault()} onDrop={() => void moveDragged(status)}><header><button type="button" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expandir' : 'Contraer'} ${statusMeta[status].label}`} onClick={() => setCollapsedColumns(current => { const next = new Set(current); if (next.has(status)) next.delete(status); else next.add(status); return next })}><span style={{ background: statusMeta[status].color }} /><strong>{statusMeta[status].label}</strong><em>{columnPosts.length}</em><ChevronRight size={13} /></button></header>{!collapsed && <div className="board-stack">{visiblePosts.map(post => <article className={(selected.has(post.id) ? 'selected' : '') + (post.color !== postColors[0].value ? ' has-custom-color' : '')} style={{ '--post-color': post.color } as React.CSSProperties} draggable={armed === post.id} onDragStart={event => { dragIds.current = selected.has(post.id) ? [...selected] : [post.id]; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', post.id) }} onDragEnd={() => { dragIds.current = []; setArmed(null) }} key={post.id} onClick={event => { if (event.shiftKey || event.ctrlKey || event.metaKey || selected.size > 0) toggle(post.id, event.shiftKey, order); else select(post.id) }}><div><label className="board-select-hit" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selected.has(post.id)} onChange={event => toggle(post.id, event.nativeEvent instanceof MouseEvent && (event.nativeEvent as MouseEvent).shiftKey, order)} aria-label={`Seleccionar ${post.title || 'publicación'}`} /></label><span className="board-grip" title="Arrastrar" onMouseDown={() => setArmed(post.id)} onMouseUp={() => setArmed(null)}><GripVertical size={14} /></span>{post.platforms.map(p => <PlatformMark key={p} platform={p} small />)}<span className="board-content-type">{contentLabels[post.contentType]}</span>{selected.has(post.id) && <BoardCardColorPicker post={post} onColor={color => changePostCardColor(post, color)} />}</div><MobileCardStatus state={mobilePublicationState} postId={post.id} detailLevel={boardCardDetailLevel} /><h3>{post.title || 'Publicación sin título'}</h3>{post.scheduledAt && <small><CalendarDays size={12} />{format(parseISO(post.scheduledAt), 'd MMM · HH:mm', { locale: es })}</small>}</article>)}{!columnPosts.length && <p className="board-column-empty">Sin publicaciones en esta etapa</p>}{columnPosts.length > visiblePosts.length && <small className="board-more-hint">{columnPosts.length - visiblePosts.length} más, carga más tarjetas para verlas</small>}</div>}</div> })}</div>}
  </section>
}

export { LibraryView } from './LibraryView'
export { Timeline } from './TimelineView'
export { CalendarView, BoardDaySwitcher } from './CalendarViews'

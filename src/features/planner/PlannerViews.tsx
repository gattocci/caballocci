import { useEffect, useRef, useState } from 'react'
import { type BoardCardDetailLevel } from './BoardCardDecorations'
import { createPortal } from 'react-dom'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { statusMeta } from '../../shared/constants'
import { BoardLanes } from './BoardLanes'
import { BoardListView } from './BoardListView'
import { BoardListFilters } from './BoardListFilters'
import { BoardHeader } from './BoardHeader'
import { BoardArchivedMedia } from './BoardArchivedMedia'
import { BoardWorkGroupToolbar } from './BoardWorkGroupToolbar'
import { BoardBulkActions } from './BoardBulkActions'
import { BoardCalendarView } from './BoardCalendarView'
import { BoardWorkGroupDialogs } from './BoardWorkGroupDialogs'
import { useBoardWorkGroups } from './useBoardWorkGroups'
import { useBoardList } from './useBoardList'
import { useBoardLanes } from './useBoardLanes'
import { useBoardSelection } from './useBoardSelection'
import { runWithErrorReporting } from '../../app/errors'
import { postMatchesQuery, usePlanner } from '../../app/store'
import type { Post } from '../../shared/types'
import './planner.css'


export function Board() {
  const { posts: allPosts, workGroups, move, select, save, activeSpace, activeWorkGroupId: selectedWorkGroupId, setActiveWorkGroup, query, setQuery } = usePlanner()
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
  const [listStatus, setListStatus] = useState('')
  const [listFormat, setListFormat] = useState('')
  const [listGroup, setListGroup] = useState('')
  const [listFrom, setListFrom] = useState('')
  const [listTo, setListTo] = useState('')
  const [listSort, setListSort] = useState<'title' | 'status' | 'format' | 'collection' | 'date'>('date')
  const [listSortDirection, setListSortDirection] = useState<'asc' | 'desc'>('asc')
  const [listPage, setListPage] = useState(0)
  const boardSelection = useBoardSelection({ allPosts, query, activeSpace, selectedWorkGroupId, listFilterKey: [listStatus, listFormat, listGroup, listFrom, listTo].join('|'), setListPage, move })
  const {
    selected, toggle, clear, toggleStatusSelection,
    bulkScheduleAt, setBulkScheduleAt, bulkScheduleWarning, setBulkScheduleWarning,
    mobileExportBusy, mobileExportMessage, mobileExportSkipped, mobilePublicationState,
    bulkMove, bulkSchedule, exportSelectedToMobile,
  } = boardSelection
  const dragIds = useRef<string[]>([])
  const [showArchivedPosts, setShowArchivedPosts] = useState(false)
  const [showCompressedPosts, setShowCompressedPosts] = useState(false)
  const changePostCardColor = (post: Post, color: string) => runWithErrorReporting(async () => {
    const targets = selected.size > 1 && selected.has(post.id) ? [...selected] : [post.id]
    for (const id of targets) {
      const target = allPosts.find(item => item.id === id)
      if (target) await save({ ...target, color })
    }
  }, 'No se pudo cambiar el color de las tarjetas')
  const selectedWorkGroup = workGroups.find(group => group.id === selectedWorkGroupId) || null
  const workGroupControls = useBoardWorkGroups({ allPosts, workGroups, selectedWorkGroup, selected, clear })
  const {
    membershipTargetGroupId, setMembershipTargetGroupId,
    groupFormOpen, setGroupFormOpen, editingGroupId,
    groupName, setGroupName, groupDescription, setGroupDescription,
    savingGroup, pendingGroupAction, setPendingGroupAction,
    groupDeleteMode, setGroupDeleteMode, groupPostsToDelete, setGroupPostsToDelete,
    pendingMediaCompression, setPendingMediaCompression, workingOnGroup,
    mediaCompressionMessage, setMediaCompressionMessage,
    openGroupForm, submitGroupForm, updateGroupMembership, confirmGroupAction,
    restoreGroupMedia, restorePostMedia, confirmMediaCompression,
  } = workGroupControls
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
  const { activeGroups, boardLanes, collapsedLanes, toggleLane, reorderLane, toggleAllLanes } = useBoardLanes({ activeSpace, posts: visibleBoardPosts, workGroups, selectedWorkGroup })
  const { listPosts, listPageCount, visibleListPosts } = useBoardList({ posts, workGroups, status: listStatus, format: listFormat, group: listGroup, from: listFrom, to: listTo, sort: listSort, direction: listSortDirection, page: listPage })
  const archivedPosts = posts.filter(post => post.status === 'archived')
  const compressedPosts = allPosts.filter(post => post.media.some(asset => asset.compressed))
  const groupUncompressedMediaCount = selectedWorkGroup
    ? posts.flatMap(post => post.media).filter(asset => !asset.compressed).length
    : 0
  const scheduleDroppedPost = (postId: string, day: Date, time: string) => {
    const post = allPosts.find(item => item.id === postId)
    if (!post) return
    const [hours, minutes] = time.split(':').map(Number)
    const scheduledAt = new Date(day)
    scheduledAt.setHours(hours || 0, minutes || 0, 0, 0)
    void runWithErrorReporting(() => usePlanner.getState().save({ ...post, scheduledAt: scheduledAt.toISOString(), status: 'scheduled' }), 'No se pudo programar la publicación')
  }
  const moveDragged = (status: Post['status']) => runWithErrorReporting(async () => { const ids = dragIds.current; dragIds.current = []; const changed = ids.filter(id => allPosts.some(post => post.id === id && post.status !== status)); for (const id of changed) await move(id, status); if (changed.length) clear() }, 'No se pudieron mover las publicaciones')
  const archivedCount = posts.filter(post => post.status === 'archived').length
  return <section className={`workspace board-mode-${boardMode}`}><BoardHeader boardMode={boardMode} changeBoardMode={changeBoardMode} visiblePerColumn={visiblePerColumn} loadMore={() => setVisiblePerColumn(current => Math.min(100, current + 30))} detailLevel={boardCardDetailLevel} changeDetailLevel={changeBoardCardDetailLevel} />
    <BoardWorkGroupToolbar boardMode={boardMode} selectedWorkGroup={selectedWorkGroup} archivedCount={archivedCount} showArchivedPosts={showArchivedPosts} setShowArchivedPosts={setShowArchivedPosts} boardLanes={boardLanes} collapsedLanes={collapsedLanes} toggleAllLanes={toggleAllLanes} openGroupForm={openGroupForm} setActiveWorkGroup={setActiveWorkGroup} setPendingGroupAction={setPendingGroupAction} groupUncompressedMediaCount={groupUncompressedMediaCount} setPendingMediaCompression={setPendingMediaCompression} restoreGroupMedia={restoreGroupMedia} />
    {boardMode === 'list' && <BoardListFilters workGroups={workGroups} status={listStatus} setStatus={setListStatus} format={listFormat} setFormat={setListFormat} group={listGroup} setGroup={setListGroup} from={listFrom} setFrom={setListFrom} to={listTo} setTo={setListTo} />}
    {selectedWorkGroup && <div className="work-group-summary" role="status"><strong>{selectedWorkGroup.name}</strong><span>{selectedWorkGroup.postIds.length} publicaciones · Creada el {format(parseISO(selectedWorkGroup.createdAt), 'd MMMM yyyy', { locale: es })}{selectedWorkGroup.compressedMediaCount ? ` · ${selectedWorkGroup.compressedMediaCount} medios comprimidos` : ''} · Los estados individuales no cambian al archivar la colección.</span>{selectedWorkGroup.archivedAt && <b>Archivada</b>}</div>}
    {mediaCompressionMessage && <p className="work-group-export-message" role="status">{mediaCompressionMessage}</p>}
    {boardMode === 'list' && <BoardListView
      listPosts={listPosts}
      visibleListPosts={visibleListPosts}
      workGroups={workGroups}
      selected={selected}
      toggle={toggle}
      select={select}
      query={query}
      listSort={listSort}
      setListSort={setListSort}
      setListSortDirection={setListSortDirection}
      listPage={listPage}
      setListPage={setListPage}
      listPageCount={listPageCount}
    />}
    {boardMode === 'calendar' && <BoardCalendarView posts={posts} select={select} onScheduleDrop={scheduleDroppedPost} />}
    <BoardWorkGroupDialogs selectedCount={selected.size} allPosts={allPosts} groupFormOpen={groupFormOpen} setGroupFormOpen={setGroupFormOpen} editingGroupId={editingGroupId} groupName={groupName} setGroupName={setGroupName} groupDescription={groupDescription} setGroupDescription={setGroupDescription} savingGroup={savingGroup} submitGroupForm={submitGroupForm} pendingGroupAction={pendingGroupAction} setPendingGroupAction={setPendingGroupAction} groupDeleteMode={groupDeleteMode} setGroupDeleteMode={setGroupDeleteMode} groupPostsToDelete={groupPostsToDelete} setGroupPostsToDelete={setGroupPostsToDelete} workingOnGroup={workingOnGroup} confirmGroupAction={confirmGroupAction} pendingMediaCompression={pendingMediaCompression} setPendingMediaCompression={setPendingMediaCompression} confirmMediaCompression={confirmMediaCompression} />
    <BoardBulkActions selected={selected} workGroups={workGroups} selectedWorkGroup={selectedWorkGroup} membershipTargetGroupId={membershipTargetGroupId} setMembershipTargetGroupId={setMembershipTargetGroupId} updateGroupMembership={updateGroupMembership} openGroupForm={openGroupForm} clear={clear} boardMode={boardMode} mobileExportBusy={mobileExportBusy} exportSelectedToMobile={exportSelectedToMobile} bulkScheduleAt={bulkScheduleAt} setBulkScheduleAt={setBulkScheduleAt} setBulkScheduleWarning={setBulkScheduleWarning} bulkSchedule={bulkSchedule} bulkMove={bulkMove} bulkScheduleWarning={bulkScheduleWarning} />
    {mobileExportMessage && <div className="work-group-export-message" role="status"><p>{mobileExportMessage}</p>{mobileExportSkipped.map((item, index) => <p key={`${index}-${item}`}>Omitida: {item}</p>)}</div>}
    <BoardArchivedMedia archivedPosts={archivedPosts} compressedPosts={compressedPosts} showArchivedPosts={showArchivedPosts} showCompressedPosts={showCompressedPosts} setShowCompressedPosts={setShowCompressedPosts} select={select} setPendingMediaCompression={setPendingMediaCompression} restorePostMedia={restorePostMedia} />
    {!visibleBoardPosts.length && <div className="planner-empty-inline board-empty" role="status"><strong>{selectedWorkGroup && !posts.length ? 'Esta colección todavía no tiene publicaciones visibles' : query.trim() && posts.length === 0 ? 'No hay publicaciones que coincidan con la búsqueda' : archivedCount ? 'Todas las publicaciones de este espacio están archivadas' : 'Este espacio aún no tiene publicaciones'}</strong><span>{selectedWorkGroup && !posts.length ? 'Selecciona publicaciones del tablero y añádelas a esta colección.' : query.trim() && posts.length === 0 ? 'Limpia la búsqueda para volver a ver el tablero.' : 'Crea una publicación o convierte una idea para empezar.'}</span>{query.trim() && posts.length === 0 && <button type="button" className="settings-button" onClick={() => setQuery('')}>Limpiar búsqueda</button>}</div>}
    {boardMode === 'kanban' && <div className="board-lanes-scroll"><BoardLanes lanes={boardLanes} posts={visibleBoardPosts} activeGroups={activeGroups} selected={selected} collapsedLanes={collapsedLanes} toggleLane={toggleLane} reorderLane={reorderLane} visiblePerColumn={visiblePerColumn} mobilePublicationState={mobilePublicationState} boardCardDetailLevel={boardCardDetailLevel} dragIds={dragIds} onToggle={toggle} onSelect={select} onColor={changePostCardColor} onMove={moveDragged} onSelectStatus={toggleStatusSelection} /></div>}
  </section>
}


export { LibraryView } from './LibraryView'
export { Timeline } from './TimelineView'
export { CalendarView, BoardDaySwitcher } from './CalendarViews'




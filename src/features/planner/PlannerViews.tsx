import { useEffect, useRef, useState } from 'react'
import { type BoardCardDetailLevel } from './BoardCardDecorations'
import { createPortal } from 'react-dom'
import { statusMeta } from '../../shared/constants'
import { BoardLanes } from './BoardLanes'
import { BoardListView } from './BoardListView'
import { BoardListFilters } from './BoardListFilters'
import { BoardHeader } from './BoardHeader'
import { BoardArchivedMedia } from './BoardArchivedMedia'
import { BoardWorkGroupToolbar } from './BoardWorkGroupToolbar'
import { BoardCollectionNav } from './BoardCollectionNav'
import { planCollectionDetach } from './collection-branch'
import { BoardBulkActions } from './BoardBulkActions'
import { BoardCalendarView } from './BoardCalendarView'
import { BoardWorkGroupDialogs } from './BoardWorkGroupDialogs'
import { PastePostsDialog } from './PastePostsDialog'
import { useBoardWorkGroups } from './useBoardWorkGroups'
import { useWorkGroupOrder } from './useWorkGroupOrder'
import { childrenByParent, subtreeGroupIds, subtreePostIds } from '../../shared/work-group-tree'
import { useBoardList } from './useBoardList'
import { useBoardLanes } from './useBoardLanes'
import { useBoardSelection } from './useBoardSelection'
import { runWithErrorReporting } from '../../app/errors'
import { postMatchesQuery, usePlanner } from '../../app/store'
import { availableParsedFields, groupPayloadPosts, parsePostsFromText, readClipboardPayload, type ClipboardPostField, type ParsedPost } from '../../shared/clipboard-payload'
import type { MediaAsset, Post, PostInput, PostStatus, WorkGroup } from '../../shared/types'
import './planner.css'
import { AreaSelectionSurface } from './AreaSelectionSurface'


export function Board({ onEditSelection, onPickPost, pickMode = false, pickedPostIds = new Set<string>(), onCreatePostInStatus }: { onEditSelection(ids: string[]): void; onPickPost?(id: string): boolean; pickMode?: boolean; pickedPostIds?: Set<string>; onCreatePostInStatus?(status: PostStatus): void; }) {
  const { posts: allPosts, workGroups, moveWithStacks, movePostsToSpace, stackPosts, customSpaces, select, save, saveWorkGroup, remove, activeSpace, activeWorkGroupId: selectedWorkGroupId, setActiveWorkGroup, query, setQuery, groupRecentUndoActions } = usePlanner()
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
  const [includeSubcollections, setIncludeSubcollections] = useState<boolean>(() => {
    try { return localStorage.getItem('caballocci.include-subcollections') === 'true' } catch { return false }
  })
  useEffect(() => { setListGroup(''); setListPage(0) }, [activeSpace, selectedWorkGroupId])
  const boardSelection = useBoardSelection({ allPosts, query, activeSpace, selectedWorkGroupId, listFilterKey: [listStatus, listFormat, listGroup, listFrom, listTo].join('|'), setListPage, moveWithStacks })
  const {
    selected, toggle, clear, toggleStatusSelection,
    bulkScheduleAt, setBulkScheduleAt, bulkScheduleWarning, setBulkScheduleWarning,
    mobileExportBusy, mobileExportMessage, mobileExportSkipped, mobilePublicationState,
    bulkMove, bulkSchedule, bulkFormat, bulkClearSchedule, exportSelectedToMobile,
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
  const changeCollectionColor = (group: WorkGroup, color: string) => runWithErrorReporting(
    () => saveWorkGroup({ ...group, color }),
    'No se pudo cambiar el color de la colección',
  )
  const duplicateBoardPost = (post: Post) => runWithErrorReporting(() => save({
    ...post,
    id: undefined,
    title: `${post.title.trim() || 'Publicación'} (copia)`,
    distribution: (post.distribution || []).map(target => ({ ...target, status: target.status === 'not_applicable' ? 'not_applicable' as const : 'pending' as const })),
  }), 'No se pudo duplicar la publicación')
  // Regla: pegar nunca destruye — crea publicaciones nuevas con el shell del
  // destino (carril, espacio, formato) y el contenido del portapapeles. Todo
  // el pegado queda agrupado como un único paso de deshacer.
  const createPostsFromBlocks = (target: Post, blocks: ParsedPost[]) => runWithErrorReporting(async () => {
    const historyStart = usePlanner.getState().undoHistory.length
    const created: Post[] = []
    for (const parsedPost of blocks) {
      const saved = await save({
        ...target,
        id: undefined,
        title: parsedPost.title,
        caption: parsedPost.caption,
        notes: parsedPost.notes,
        hashtags: parsedPost.hashtags,
        ideaBlocks: parsedPost.slides.map(slide => ({ id: crypto.randomUUID(), title: slide.title, text: slide.text })),
        media: [],
        scheduledAt: null,
        distribution: [],
        sourceIdeaId: null,
        isCombined: undefined,
        combinedIdeaIds: undefined,
      })
      created.push(saved)
    }
    const actionCount = usePlanner.getState().undoHistory.length - historyStart
    if (actionCount > 1) usePlanner.getState().groupRecentUndoActions(actionCount, `Pegar ${created.length} ${created.length === 1 ? 'publicación' : 'publicaciones'}`)
    return created
  }, 'No se pudo pegar la publicación')
  const pastePostsFromClipboard = (target: Post) => runWithErrorReporting(async () => {
    const payload = readClipboardPayload(await window.planner.clipboard.readHtml())
    const parsed = payload ? groupPayloadPosts(payload.items) : parsePostsFromText(await window.planner.clipboard.readText())
    if (!parsed.length) return undefined
    return createPostsFromBlocks(target, parsed)
  }, 'No se pudo pegar la publicación')
  // Pegado con mapeo por id: el diálogo muestra el destino de cada bloque y
  // aquí se ejecuta. Crear siempre está disponible; actualizar los originales
  // es la parte destructiva y queda como un solo paso de deshacer.
  const [pasteDialog, setPasteDialog] = useState<{ blocks: ParsedPost[]; text: string; target: Post } | null>(null)
  const openPasteDialog = (target: Post) => runWithErrorReporting(async () => {
    const payload = readClipboardPayload(await window.planner.clipboard.readHtml())
    const text = await window.planner.clipboard.readText()
    const blocks = payload ? groupPayloadPosts(payload.items) : parsePostsFromText(text)
    if (blocks.length) setPasteDialog({ blocks, text: text.trim(), target })
  }, 'No se pudo leer el portapapeles')
  const updatePostsFromBlocks = (pairs: Array<{ block: ParsedPost; target: Post }>, fields: ClipboardPostField[], includeSlides: boolean, replaceSlides: boolean) => runWithErrorReporting(async () => {
    const historyStart = usePlanner.getState().undoHistory.length
    let updated = 0
    for (const { block, target } of pairs) {
      const updates: Partial<PostInput> = {}
      for (const field of fields) {
        if (field === 'hashtags') updates.hashtags = block.hashtags
        else if (field === 'title' || field === 'caption' || field === 'notes') updates[field] = block[field]
      }
      const newBlocks = block.slides.map(slide => ({ id: crypto.randomUUID(), title: slide.title, text: slide.text }))
      const ideaBlocks = includeSlides && newBlocks.length ? (replaceSlides ? newBlocks : [...target.ideaBlocks, ...newBlocks]) : undefined
      if (!Object.keys(updates).length && !ideaBlocks) continue
      await save({ ...target, ...updates, ...(ideaBlocks ? { ideaBlocks } : {}) })
      updated += 1
    }
    const actionCount = usePlanner.getState().undoHistory.length - historyStart
    if (actionCount > 1) usePlanner.getState().groupRecentUndoActions(actionCount, `Actualizar ${updated} ${updated === 1 ? 'publicación' : 'publicaciones'} desde el portapapeles`)
  }, 'No se pudo actualizar las publicaciones')
  // Reemplaza campos de las publicaciones elegidas (una o un lote) con los
  // copiados y, opcionalmente, anexa las diapositivas al final: la única
  // operación del portapapeles que pisa valores, por eso tiene confirmación
  // propia. Todo el lote queda como un paso de deshacer.
  const applyFieldsFromClipboard = (targets: Post[], fields: ClipboardPostField[], includeSlides: boolean) => runWithErrorReporting(async () => {
    const payload = readClipboardPayload(await window.planner.clipboard.readHtml())
    const parsed = payload ? groupPayloadPosts(payload.items) : parsePostsFromText(await window.planner.clipboard.readText())
    if (parsed.length !== 1) return
    const source = parsed[0]
    const updates: Partial<PostInput> = {}
    for (const field of fields) {
      if (field === 'hashtags') updates.hashtags = source.hashtags
      else if (field === 'title' || field === 'caption' || field === 'notes') updates[field] = source[field]
    }
    // Anexo aditivo: nunca toca las diapositivas existentes del destino.
    const newBlocks = includeSlides ? source.slides.map(slide => ({ id: crypto.randomUUID(), title: slide.title, text: slide.text })) : []
    if (!Object.keys(updates).length && !newBlocks.length) return
    const historyStart = usePlanner.getState().undoHistory.length
    for (const target of targets) {
      await save({ ...target, ...updates, ...(newBlocks.length ? { ideaBlocks: [...target.ideaBlocks, ...newBlocks] } : {}) })
    }
    const actionCount = usePlanner.getState().undoHistory.length - historyStart
    if (actionCount > 1) usePlanner.getState().groupRecentUndoActions(actionCount, `Aplicar contenido a ${targets.length} ${targets.length === 1 ? 'publicación' : 'publicaciones'}`)
  }, 'No se pudo aplicar los campos copiados')
  const deleteBoardPost = (post: Post) => runWithErrorReporting(async () => {
    if (window.confirm(`¿Eliminar “${post.title || 'Publicación sin título'}”? Esta acción no se puede deshacer.`)) await remove(post.id)
  }, 'No se pudo eliminar la publicación')
  const changeBoardPostStatus = (post: Post, status: Post['status']) => runWithErrorReporting(() => save({ ...post, status }), 'No se pudo cambiar la etapa')
  const scopedWorkGroups = activeSpace ? workGroups.filter(group => group.space === activeSpace) : workGroups
  const { orderedGroups } = useWorkGroupOrder()
  const orderedScopedWorkGroups = orderedGroups(scopedWorkGroups)
  const selectedWorkGroup = scopedWorkGroups.find(group => group.id === selectedWorkGroupId) || null
  const workGroupControls = useBoardWorkGroups({ allPosts, workGroups: scopedWorkGroups, activeSpace, selectedWorkGroup, selected, clear })
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
    formParentName,
  } = workGroupControls
  const pendingGroupChildCount = pendingGroupAction ? childrenByParent(workGroups).get(pendingGroupAction.group.id)?.length ?? 0 : 0
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
  const selectedSubtreePostIds = selectedWorkGroup ? subtreePostIds(scopedWorkGroups, selectedWorkGroup.id) : null
  const selectedDirectPostIds = selectedWorkGroup ? selectedWorkGroup.postIds : null
  const selectedVisiblePostIds = selectedWorkGroup
    ? includeSubcollections ? selectedSubtreePostIds : selectedDirectPostIds
    : null
  const scopedPosts = (selectedVisiblePostIds
    ? selectedVisiblePostIds.map(id => allPosts.find(post => post.id === id)).filter((post): post is Post => Boolean(post && (!selectedWorkGroup?.space || post.project === selectedWorkGroup.space)))
    : activeSpace ? allPosts.filter(post => post.project === activeSpace) : allPosts).filter(post => postMatchesQuery(post, query))
  const posts = selectedWorkGroup ? scopedPosts : scopedPosts.filter(post => !scopedWorkGroups.some(group => !group.archivedAt && group.postIds.includes(post.id)))
  const visibleBoardPosts = posts.filter(post => post.status !== 'archived')
  const collectionNavPosts = (activeSpace ? allPosts.filter(post => post.project === activeSpace) : allPosts).filter(post => postMatchesQuery(post, query))
  const lanesSelectedWorkGroup = selectedWorkGroup
    ? { ...selectedWorkGroup, postIds: selectedVisiblePostIds ?? [] }
    : selectedWorkGroup
  const { activeGroups, boardLanes, collapsedLanes, toggleLane, reorderLane } = useBoardLanes({ activeSpace, posts: visibleBoardPosts, workGroups: scopedWorkGroups, selectedWorkGroup: lanesSelectedWorkGroup })
  const { listPosts, listPageCount, visibleListPosts } = useBoardList({ posts, workGroups: scopedWorkGroups, status: listStatus, format: listFormat, group: listGroup, from: listFrom, to: listTo, sort: listSort, direction: listSortDirection, page: listPage })
  const archivedPosts = posts.filter(post => post.status === 'archived')
  const compressedPosts = posts.filter(post => post.media.some(asset => asset.compressed))
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
  const moveDragged = (status: Post['status']) => runWithErrorReporting(async () => { const ids = dragIds.current; dragIds.current = []; const changed = ids.filter(id => allPosts.some(post => post.id === id && post.status !== status)); if (changed.length) { await moveWithStacks(changed, status); clear() } }, 'No se pudieron mover las publicaciones')
  const dropPostsInCollection = (groupId: string, ids: string[], moveFromCurrent = false) => {
    const group = scopedWorkGroups.find(item => item.id === groupId && !item.archivedAt)
    const postIds = ids.filter(id => {
      const post = allPosts.find(item => item.id === id)
      return Boolean(post && (!group?.space || post.project === group.space))
    })
    if (!group || !postIds.length) return
    void runWithErrorReporting(async () => {
      if (moveFromCurrent && selectedWorkGroup) {
        const sourceIds = subtreeGroupIds(scopedWorkGroups, selectedWorkGroup.id)
        const historyStart = usePlanner.getState().undoHistory.length
        for (const source of scopedWorkGroups) {
          if (!sourceIds.has(source.id) || source.id === groupId) continue
          const nextPostIds = source.postIds.filter(id => !postIds.includes(id))
          if (nextPostIds.length !== source.postIds.length) await usePlanner.getState().setWorkGroupPosts(source.id, nextPostIds)
        }
        const currentTarget = usePlanner.getState().workGroups.find(item => item.id === groupId)
        if (currentTarget) await usePlanner.getState().setWorkGroupPosts(groupId, [...new Set([...currentTarget.postIds, ...postIds])])
        const changes = usePlanner.getState().undoHistory.length - historyStart
        if (changes > 1) usePlanner.getState().groupRecentUndoActions(changes, `Mover publicaciones a ${group.name}`)
      } else {
        const currentTarget = usePlanner.getState().workGroups.find(item => item.id === groupId)
        if (currentTarget) await usePlanner.getState().setWorkGroupPosts(groupId, [...new Set([...currentTarget.postIds, ...postIds])])
      }
      clear()
    }, 'No se pudieron añadir las publicaciones a la colección')
  }
  const dropPostsUnassigned = (ids: string[]) => {
    const existingIds = ids.filter(id => allPosts.some(post => post.id === id))
    const plan = planCollectionDetach(scopedWorkGroups, existingIds)
    if (!plan.length) return
    void runWithErrorReporting(async () => {
      const historyStart = usePlanner.getState().undoHistory.length
      for (const entry of plan) await usePlanner.getState().setWorkGroupPosts(entry.groupId, entry.postIds)
      const changes = usePlanner.getState().undoHistory.length - historyStart
      if (changes > 1) usePlanner.getState().groupRecentUndoActions(changes, `Quitar publicaciones de ${plan.length} colecciones`)
      clear()
    }, 'No se pudieron quitar las publicaciones de las colecciones')
  }
  const selectedPosts = selected.size > 1 ? allPosts.filter(post => selected.has(post.id)) : []
  const attachMediaToSelectedPosts = async (attachments: Array<{ postId: string; assets: MediaAsset[] }>) => {
    const historyStart = usePlanner.getState().undoHistory.length
    let updated = 0
    for (const attachment of attachments) {
      const post = usePlanner.getState().posts.find(item => item.id === attachment.postId)
      if (!post) continue
      const linkedIds = new Set(post.media.map(asset => asset.id))
      const newAssets = attachment.assets.filter(asset => !linkedIds.has(asset.id))
      if (!newAssets.length) continue
      await save({ ...post, media: [...post.media, ...newAssets] })
      updated += 1
    }
    const historyChanges = usePlanner.getState().undoHistory.length - historyStart
    if (updated > 1 && historyChanges > 1) groupRecentUndoActions(historyChanges, `Adjuntar medios a ${updated} publicaciones`)
  }
  const archivedGroups = scopedWorkGroups.filter(group => group.archivedAt)
  const archivedGroupPostIds = new Set(archivedGroups.flatMap(group => group.postIds))
  const archivedCount = collectionNavPosts.filter(post => post.status === 'archived' && !archivedGroupPostIds.has(post.id)).length
  const archiveEntryCount = archivedCount + archivedGroups.length
  const restoreArchivedStack = (ids: string[], status: Post['status']) => { void runWithErrorReporting(() => moveWithStacks(ids, status, { groupLabel: 'Restaurar pila' }), 'No se pudo restaurar la pila') }
  return <section className={`workspace board-mode-${boardMode}${pickMode ? ' editor-session-pick-mode' : ''}`}><BoardHeader boardMode={boardMode} changeBoardMode={changeBoardMode} visiblePerColumn={visiblePerColumn} loadMore={() => setVisiblePerColumn(current => Math.min(100, current + 30))} detailLevel={boardCardDetailLevel} changeDetailLevel={changeBoardCardDetailLevel} />
    {pickMode && <div className="editor-session-pick-notice" role="status"><strong>Modo añadir pestañas</strong><span>Haz clic en más publicaciones para sumarlas al editor.</span></div>}
    {boardMode === 'kanban' && <BoardCollectionNav groups={orderedScopedWorkGroups} posts={collectionNavPosts} selectedWorkGroup={selectedWorkGroup} setActiveWorkGroup={setActiveWorkGroup} openGroupForm={openGroupForm} onDropPosts={dropPostsInCollection} onDropPostsUnassigned={dropPostsUnassigned} onEditGroup={group => openGroupForm(group)} onColor={changeCollectionColor} onGroupAction={(type, group) => setPendingGroupAction({ type, group })} groupUncompressedMediaCount={groupUncompressedMediaCount} setPendingMediaCompression={(id, name, mediaCount) => setPendingMediaCompression({ target: 'group', id, name, mediaCount })} restoreGroupMedia={restoreGroupMedia} trailing={<BoardWorkGroupToolbar boardMode={boardMode} selectedWorkGroup={selectedWorkGroup} archivedCount={archiveEntryCount} showArchivedPosts={showArchivedPosts} setShowArchivedPosts={setShowArchivedPosts} openGroupForm={openGroupForm} includeSubcollections={includeSubcollections} setIncludeSubcollections={setIncludeSubcollections} />} />}
    {boardMode !== 'kanban' && <BoardWorkGroupToolbar boardMode={boardMode} selectedWorkGroup={selectedWorkGroup} archivedCount={archiveEntryCount} showArchivedPosts={showArchivedPosts} setShowArchivedPosts={setShowArchivedPosts} openGroupForm={openGroupForm} includeSubcollections={includeSubcollections} setIncludeSubcollections={setIncludeSubcollections} />}
    {boardMode === 'list' && <BoardListFilters workGroups={scopedWorkGroups} status={listStatus} setStatus={setListStatus} format={listFormat} setFormat={setListFormat} group={listGroup} setGroup={setListGroup} from={listFrom} setFrom={setListFrom} to={listTo} setTo={setListTo} />}
    {mediaCompressionMessage && <p className="work-group-export-message" role="status">{mediaCompressionMessage}</p>}
    {boardMode === 'list' && <BoardListView
      listPosts={listPosts}
      visibleListPosts={visibleListPosts}
      workGroups={scopedWorkGroups}
      selected={selected}
      toggle={toggle}
      select={select}
      onPickPost={onPickPost}
      pickedPostIds={pickedPostIds}
      query={query}
      listSort={listSort}
      setListSort={setListSort}
      setListSortDirection={setListSortDirection}
      listPage={listPage}
      setListPage={setListPage}
      listPageCount={listPageCount}
      setSelected={boardSelection.set}
      onDuplicate={duplicateBoardPost}
      onDelete={deleteBoardPost}
      onEditSelection={() => onEditSelection(allPosts.filter(post => selected.has(post.id)).map(post => post.id))}
      scheduleAt={bulkScheduleAt}
      scheduleWarning={bulkScheduleWarning}
      onArchive={ids => { void bulkMove('archived', ids) }}
      onScheduleAtChange={value => { setBulkScheduleAt(value); setBulkScheduleWarning('') }}
      onSchedule={bulkSchedule}
      onClearSchedule={bulkClearSchedule}
      onFormat={(ids, contentType) => bulkFormat(contentType, ids)}
    />}
    {boardMode === 'calendar' && <BoardCalendarView posts={posts} select={id => { if (!id || !onPickPost?.(id)) select(id) }} onScheduleDrop={scheduleDroppedPost} pickedPostIds={pickedPostIds} />}
    <BoardWorkGroupDialogs selectedCount={selected.size} allPosts={allPosts} groupFormOpen={groupFormOpen} setGroupFormOpen={setGroupFormOpen} editingGroupId={editingGroupId} formParentName={formParentName} pendingGroupChildCount={pendingGroupChildCount} groupName={groupName} setGroupName={setGroupName} groupDescription={groupDescription} setGroupDescription={setGroupDescription} savingGroup={savingGroup} submitGroupForm={submitGroupForm} pendingGroupAction={pendingGroupAction} setPendingGroupAction={setPendingGroupAction} groupDeleteMode={groupDeleteMode} setGroupDeleteMode={setGroupDeleteMode} groupPostsToDelete={groupPostsToDelete} setGroupPostsToDelete={setGroupPostsToDelete} workingOnGroup={workingOnGroup} confirmGroupAction={confirmGroupAction} pendingMediaCompression={pendingMediaCompression} setPendingMediaCompression={setPendingMediaCompression} confirmMediaCompression={confirmMediaCompression} />
    {pasteDialog && <PastePostsDialog blocks={pasteDialog.blocks} text={pasteDialog.text} posts={allPosts} onCreate={async blocks => { await createPostsFromBlocks(pasteDialog.target, blocks) }} onUpdate={(pairs, fields, includeSlides, replaceSlides) => updatePostsFromBlocks(pairs, fields, includeSlides, replaceSlides)} onClose={() => setPasteDialog(null)} />}
    <BoardBulkActions selected={selected} selectedPosts={selectedPosts} onAttachMedia={attachMediaToSelectedPosts} workGroups={scopedWorkGroups} selectedWorkGroup={selectedWorkGroup} membershipTargetGroupId={membershipTargetGroupId} setMembershipTargetGroupId={setMembershipTargetGroupId} updateGroupMembership={updateGroupMembership} openGroupForm={openGroupForm} clear={clear} boardMode={boardMode} mobileExportBusy={mobileExportBusy} exportSelectedToMobile={exportSelectedToMobile} bulkScheduleAt={bulkScheduleAt} setBulkScheduleAt={setBulkScheduleAt} setBulkScheduleWarning={setBulkScheduleWarning} bulkSchedule={bulkSchedule} bulkMove={bulkMove} bulkScheduleWarning={bulkScheduleWarning} spaces={Array.from(new Set([...customSpaces, ...allPosts.map(post => post.project)].filter(Boolean)))} moveToSpace={space => runWithErrorReporting(async () => { await movePostsToSpace([...selected], space); clear() }, 'No se pudieron mover las publicaciones de proyecto')} onStackSelection={() => runWithErrorReporting(async () => { if (selected.size < 2) return; const target = allPosts.find(post => selected.has(post.id)); if (!target) return; await stackPosts(target.id, [...selected]); clear() }, 'No se pudo apilar la selección')} />
    {mobileExportMessage && <div className="work-group-export-message" role="status"><p>{mobileExportMessage}</p>{mobileExportSkipped.map((item, index) => <p key={`${index}-${item}`}>Omitida: {item}</p>)}</div>}
    <BoardArchivedMedia archivedPosts={archivedPosts} archivedGroups={archivedGroups} collectionPosts={collectionNavPosts} compressedPosts={compressedPosts} showArchivedPosts={showArchivedPosts} showCompressedPosts={showCompressedPosts} setShowCompressedPosts={setShowCompressedPosts} select={select} setPendingMediaCompression={setPendingMediaCompression} restorePostMedia={restorePostMedia} restoreGroup={group => setPendingGroupAction({ type: 'restore', group })} restoreStack={restoreArchivedStack} openGroup={group => setActiveWorkGroup(group.id)} />
    {!visibleBoardPosts.length && <div className="planner-empty-inline board-empty" role="status"><strong>{selectedWorkGroup && !posts.length ? 'Esta colección todavía no tiene publicaciones visibles' : query.trim() && posts.length === 0 ? 'No hay publicaciones que coincidan con la búsqueda' : archivedCount ? 'Todas las publicaciones de este espacio están archivadas' : scopedWorkGroups.some(group => !group.archivedAt && group.postIds.some(id => posts.some(post => post.id === id))) ? 'No hay publicaciones sin colección' : 'Este espacio aún no tiene publicaciones'}</strong><span>{selectedWorkGroup && !posts.length ? 'Selecciona publicaciones del tablero y añádelas a esta colección.' : query.trim() && posts.length === 0 ? 'Limpia la búsqueda para volver a ver el tablero.' : scopedWorkGroups.some(group => !group.archivedAt && group.postIds.some(id => posts.some(post => post.id === id))) ? 'Las publicaciones que pertenecen a colecciones aparecen al entrar en ellas.' : 'Crea una publicación o convierte una idea para empezar.'}</span>{query.trim() && posts.length === 0 && <button type="button" className="settings-button" onClick={() => setQuery('')}>Limpiar búsqueda</button>}</div>}
    {boardMode === 'kanban' && <AreaSelectionSurface className="board-lanes-scroll" selected={selected} setSelected={boardSelection.set}><BoardLanes lanes={boardLanes} posts={visibleBoardPosts} activeGroups={activeGroups} selected={selected} collapsedLanes={collapsedLanes} toggleLane={toggleLane} reorderLane={reorderLane} visiblePerColumn={visiblePerColumn} mobilePublicationState={mobilePublicationState} boardCardDetailLevel={boardCardDetailLevel} dragIds={dragIds} onToggle={toggle} onSelect={select} onPickPost={onPickPost} pickedPostIds={pickedPostIds} onColor={changePostCardColor} onMove={moveDragged} onSelectStatus={toggleStatusSelection} onDuplicate={duplicateBoardPost} onPastePosts={pastePostsFromClipboard} onOpenPasteDialog={openPasteDialog} allPosts={allPosts} onApplyFields={applyFieldsFromClipboard} onDelete={deleteBoardPost} onStatus={changeBoardPostStatus} onNewPost={onCreatePostInStatus} onEditSelection={() => onEditSelection(allPosts.filter(post => selected.has(post.id)).map(post => post.id))} onArchive={ids => { void bulkMove('archived', ids) }} scheduleAt={bulkScheduleAt} scheduleWarning={bulkScheduleWarning} onScheduleAtChange={value => { setBulkScheduleAt(value); setBulkScheduleWarning('') }} onSchedule={bulkSchedule} onClearSchedule={bulkClearSchedule} onFormat={(ids, contentType) => bulkFormat(contentType, ids)} /></AreaSelectionSurface>}
  </section>
}


export { LibraryView } from './LibraryView'
export { Timeline } from './TimelineView'
export { CalendarView, BoardDaySwitcher } from './CalendarViews'

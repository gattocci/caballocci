import { useEffect, useRef, useState } from 'react'
import {
  addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format,
  isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { Archive, ArchiveRestore, CalendarDays, ChevronLeft, ChevronRight, Clock3, FileImage, FileText, Film, FolderOpen, FolderPlus, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { contentLabels, stages, statusMeta } from '../../shared/constants'
import { PlatformMark, ViewHeading } from '../../components/layout/AppShell'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { postMatchesQuery, usePlanner } from '../../app/store'
import { useSelection } from '../../app/useSelection'
import type { MediaAsset, Post, WorkGroup } from '../../shared/types'
import './planner.css'

function PostCard({ post, onSelect, onDrag }: { post: Post; onSelect(): void; onDrag(): void }) {
  const distribution = post.distribution || []
  const published = distribution.filter(target => target.status === 'published').length
  return <article className="post-card" draggable onDragStart={onDrag} onClick={onSelect} style={{ '--post-color': post.color } as React.CSSProperties}>
    <div className="card-top"><div>{post.platforms.map(p => <PlatformMark key={p} platform={p} small />)}</div><MoreHorizontal size={15} /></div>
    <span className="type-label">{contentLabels[post.contentType]}</span>
    <h3>{post.title}</h3><p>{post.caption}</p>
    <footer><span><Clock3 size={12} />{post.scheduledAt && format(parseISO(post.scheduledAt), 'HH:mm')}</span><i>{distribution.length ? `${published}/${distribution.length} destinos` : statusMeta[post.status].label}</i></footer>
  </article>
}

export function Timeline() {
  const { posts: allPosts, save, select, activeSpace, query } = usePlanner()
  const posts = (activeSpace ? allPosts.filter(post => post.project === activeSpace) : allPosts).filter(post => postMatchesQuery(post, query))
  const [anchor, setAnchor] = useState(new Date())
  const [dragged, setDragged] = useState<string | null>(null)
  const days = Array.from({ length: 14 }, (_, i) => addDays(startOfWeek(anchor, { weekStartsOn: 1 }), i))
  const scheduled = posts.filter(p => p.scheduledAt)
  const rangeStart = days[0]
  const rangeEnd = addDays(days[13], 1)
  const visibleScheduled = scheduled.filter(post => post.scheduledAt && parseISO(post.scheduledAt) >= rangeStart && parseISO(post.scheduledAt) < rangeEnd)
  const drop = (day: Date) => {
    const post = posts.find(p => p.id === dragged)
    if (!post) return
    const old = post.scheduledAt ? parseISO(post.scheduledAt) : new Date()
    const next = new Date(day)
    next.setHours(old.getHours(), old.getMinutes())
    void runWithErrorReporting(async () => {
      await save({ ...post, scheduledAt: next.toISOString(), status: post.status === 'idea' ? 'scheduled' : post.status })
      setDragged(null)
    }, 'No se pudo reprogramar la publicación')
  }
  return <section className="workspace">
    <ViewHeading title="Línea de tiempo" subtitle="Publicaciones con fecha, ordenadas para el periodo de 14 días seleccionado.">
      <div className="period-controls"><button onClick={() => setAnchor(addDays(anchor, -14))}><ChevronLeft size={17} /></button><button onClick={() => setAnchor(new Date())}>Hoy</button><button onClick={() => setAnchor(addDays(anchor, 14))}><ChevronRight size={17} /></button><span>{format(days[0], 'd MMM', { locale: es })} — {format(days[13], 'd MMM yyyy', { locale: es })}</span></div>
    </ViewHeading>
    <div className="timeline-shell">
      <div className="timeline-legend"><span>PUBLICACIONES · 14 DÍAS</span></div>
      <div className="timeline-scroll"><div className="timeline-grid" style={{ gridTemplateColumns: 'repeat(' + days.length + ', minmax(132px, 1fr))' }}>{days.map(day => <div key={day.toISOString()} className={'timeline-day ' + (isSameDay(day, new Date()) ? 'today' : '')} onDragOver={e => e.preventDefault()} onDrop={() => drop(day)}><header><span>{format(day, 'EEE', { locale: es })}</span><b>{format(day, 'd')}</b></header><div className="day-track">{scheduled.filter(p => isSameDay(parseISO(p.scheduledAt!), day)).map(post => <PostCard key={post.id} post={post} onSelect={() => select(post.id)} onDrag={() => setDragged(post.id)} />)}</div></div>)}</div></div>
    </div>
    {visibleScheduled.length === 0 && <div className="planner-empty-inline"><strong>No hay publicaciones con fecha en este periodo</strong><span>Prueba otro periodo o programa una publicación desde el tablero.</span></div>}
    <div className="timeline-footer"><div><strong>{visibleScheduled.length} publicaciones en esta vista de 14 días</strong><small>Arrastra una tarjeta para cambiar su fecha</small></div><div className="mini-stats"><span><b>{posts.filter(p => p.status === 'draft').length}</b>Borradores</span><span><b>{posts.filter(p => p.status === 'review').length}</b>En revisión</span><span><b>{posts.filter(p => p.status === 'scheduled').length}</b>Programadas</span></div></div>
  </section>
}

export function CalendarView() {
  const { posts: allPosts, select, save, activeSpace, query, setQuery } = usePlanner()
  const posts = (activeSpace ? allPosts.filter(post => post.project === activeSpace) : allPosts).filter(post => postMatchesQuery(post, query))
  const [month, setMonth] = useState(new Date())
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start, end })
  const monthScheduledPosts = posts.filter(post => post.scheduledAt && isSameMonth(parseISO(post.scheduledAt), month))
  const drop = (event: React.DragEvent, day: Date) => {
    const post = posts.find(p => p.id === event.dataTransfer.getData('post'))
    if (!post) return
    const next = new Date(day)
    next.setHours(post.scheduledAt ? parseISO(post.scheduledAt).getHours() : 10)
    void runWithErrorReporting(() => save({ ...post, scheduledAt: next.toISOString() }), 'No se pudo reprogramar la publicación')
  }
  return <section className="workspace">
    <ViewHeading title="Calendario" subtitle="Una vista clara de tu ritmo de publicación."><div className="period-controls"><button aria-label="Mes anterior" onClick={() => { setMonth(subMonths(month, 1)); setExpandedDay(null) }}><ChevronLeft size={17} /></button><button onClick={() => { setMonth(new Date()); setExpandedDay(null) }}>Hoy</button><button aria-label="Mes siguiente" onClick={() => { setMonth(addMonths(month, 1)); setExpandedDay(null) }}><ChevronRight size={17} /></button><span>{format(month, 'MMMM yyyy', { locale: es })}</span></div></ViewHeading>
    {!monthScheduledPosts.length && <div className="planner-empty-inline calendar-empty" role="status"><strong>{query.trim() && !posts.length ? 'No hay publicaciones que coincidan con la búsqueda' : `No hay publicaciones programadas en ${format(month, 'MMMM', { locale: es })}`}</strong><span>{query.trim() && !posts.length ? 'Borra la búsqueda para volver a ver el calendario completo.' : 'Las publicaciones con fecha aparecerán aquí.'}</span>{query.trim() && !posts.length && <button type="button" className="settings-button" onClick={() => setQuery('')}>Limpiar búsqueda</button>}</div>}
    <div className="calendar"><div className="weekdays">{['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => <span key={d}>{d}</span>)}</div><div className="month-grid">{days.map(day => {
      const dayKey = format(day, 'yyyy-MM-dd')
      const dayPosts = posts.filter(post => post.scheduledAt && isSameDay(parseISO(post.scheduledAt), day))
      const expanded = expandedDay === dayKey
      const visibleDayPosts = expanded ? dayPosts : dayPosts.slice(0, 3)
      const hiddenCount = dayPosts.length - visibleDayPosts.length
      return <div className={`month-day ${!isSameMonth(day, month) ? 'muted ' : ''}${isSameDay(day, new Date()) ? 'today ' : ''}${expanded ? 'expanded' : ''}`} key={dayKey} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, day)}>
        <b>{format(day, 'd')}</b>
        {visibleDayPosts.map(post => <button draggable onDragStart={event => event.dataTransfer.setData('post', post.id)} key={post.id} style={{ borderLeftColor: post.color }} onClick={() => select(post.id)} title={post.title}><span>{post.scheduledAt && format(parseISO(post.scheduledAt), 'HH:mm')}</span>{post.title}</button>)}
        {hiddenCount > 0 && <button type="button" className="month-day-more" onClick={() => setExpandedDay(dayKey)}>+ {hiddenCount} más</button>}
        {expanded && dayPosts.length > 3 && <button type="button" className="month-day-more" onClick={() => setExpandedDay(null)}>Mostrar menos</button>}
      </div>
    })}</div></div>
  </section>
}

export function Board() {
  const { posts: allPosts, workGroups, move, select, activeSpace, query, setQuery, saveWorkGroup, setWorkGroupPosts, setWorkGroupArchived, removeWorkGroup } = usePlanner()
  const [visiblePerColumn, setVisiblePerColumn] = useState(30)
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
  const [pendingMediaCompression, setPendingMediaCompression] = useState<{ target: 'group' | 'post'; id: string; name: string; mediaCount: number } | null>(null)
  const [workingOnGroup, setWorkingOnGroup] = useState(false)
  const [mediaCompressionMessage, setMediaCompressionMessage] = useState('')
  const availableGroups = workGroups.filter(group => showArchivedGroups || !group.archivedAt)
  const selectedWorkGroup = workGroups.find(group => group.id === selectedWorkGroupId) || null
  const matchingPosts = (selectedWorkGroup
    ? allPosts.filter(post => selectedWorkGroup.postIds.includes(post.id))
    : activeSpace ? allPosts.filter(post => post.project === activeSpace) : allPosts).filter(post => postMatchesQuery(post, query))
  const posts = selectedWorkGroup ? matchingPosts.filter(post => selectedWorkGroup.postIds.includes(post.id)) : matchingPosts
  const visibleBoardPosts = posts.filter(post => post.status !== 'archived')
  const archivedPosts = posts.filter(post => post.status === 'archived')
  const compressedPosts = allPosts.filter(post => post.media.some(asset => asset.compressed))
  const groupUncompressedMediaCount = selectedWorkGroup
    ? posts.flatMap(post => post.media).filter(asset => !asset.compressed).length
    : 0
  useEffect(() => { clear() }, [query, activeSpace, selectedWorkGroupId, clear])
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') clear() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [clear])
  const bulkMove = (status: Post['status']) => runWithErrorReporting(async () => {
    for (const id of selected) if (allPosts.some(item => item.id === id)) await move(id, status)
    clear()
  }, 'No se pudieron actualizar las publicaciones seleccionadas')
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
        if (!editingGroupId && selected.size) await setWorkGroupPosts(group.id, [...selected])
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
          if (group.compressedMediaCount) await window.planner.workGroups.restoreMedia(group.id)
          await removeWorkGroup(group.id)
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
  return <section className="workspace"><ViewHeading title="Tablero de contenido" subtitle="Organiza tus publicaciones por etapa y avanza cada una hasta su publicación."><button className="settings-button" type="button" onClick={() => setVisiblePerColumn(current => current === 30 ? Number.MAX_SAFE_INTEGER : 30)}>{visiblePerColumn === 30 ? 'Ver más tarjetas' : 'Compactar columnas'}</button></ViewHeading>
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
          ? <>Se borrará <strong>{pendingGroupAction.group.name}</strong> y sus vínculos. Las {pendingGroupAction.group.postIds.length} publicaciones, sus archivos y su pertenencia a otras colecciones se conservarán. {pendingGroupAction.group.compressedMediaCount ? 'Primero se restaurarán sus medios comprimidos a sus ubicaciones originales. ' : ''}Esta acción no se puede deshacer.</>
          : pendingGroupAction.type === 'archive'
            ? <>Se archivará <strong>{pendingGroupAction.group.name}</strong>. Sus publicaciones y estados permanecerán intactos; podrás restaurarla después.</>
            : <>Se restaurará <strong>{pendingGroupAction.group.name}</strong> y volverá a aparecer entre las colecciones activas.</>}</p>
        <footer><button type="button" className="settings-button" disabled={workingOnGroup} onClick={() => setPendingGroupAction(null)}>Cancelar</button><button type="button" className={pendingGroupAction.type === 'delete' ? 'work-group-danger-button' : 'new-button'} disabled={workingOnGroup} onClick={confirmGroupAction}>{workingOnGroup ? 'Procesando…' : pendingGroupAction.type === 'delete' ? 'Borrar solo colección' : pendingGroupAction.type === 'archive' ? 'Archivar colección' : 'Restaurar colección'}</button></footer>
      </section>
    </div>}
    {pendingMediaCompression && <div className="work-group-form-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPendingMediaCompression(null) }}>
      <section className="work-group-form work-group-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="media-compress-title" aria-describedby="media-compress-description">
        <header><span>AHORRAR ESPACIO</span><button type="button" aria-label="Cerrar" onClick={() => setPendingMediaCompression(null)}>×</button></header>
        <h2 id="media-compress-title">¿Comprimir medios?</h2>
        <p id="media-compress-description">Se guardarán hasta {pendingMediaCompression.mediaCount} medios de <strong>{pendingMediaCompression.name}</strong> en un ZIP interno con su manifiesto. Tras verificarlo, Caballocci eliminará los originales que administra para liberar espacio. Los medios compartidos o referenciados externamente se conservarán. Podrás restaurarlos después.</p>
        <footer><button type="button" className="settings-button" onClick={() => setPendingMediaCompression(null)}>Cancelar</button><button type="button" className="work-group-danger-button" onClick={confirmMediaCompression}>Comprimir y liberar espacio</button></footer>
      </section>
    </div>}
    {!selected.size && <p className="work-group-selection-hint">Para reunir publicaciones, marca las casillas de las tarjetas (pueden estar en distintas etapas) y elige una colección.</p>}
    {selected.size > 0 && <div className="board-bulk-actions"><strong>{selected.size} seleccionadas</strong><button type="button" onClick={() => void bulkMove('draft')}>Borrador</button><button type="button" onClick={() => void bulkMove('review')}>Revisión</button><button type="button" onClick={() => void bulkMove('approved')}>Aprobadas</button><button type="button" onClick={() => void bulkMove('archived')}>Archivar</button><button type="button" onClick={clear}>Cancelar</button></div>}
    {selected.size > 0 && <div className="board-bulk-actions work-group-membership-actions"><strong>{selected.size} publicaciones seleccionadas</strong>{workGroups.some(group => !group.archivedAt) && <><select aria-label="Colección de destino" value={membershipTargetGroupId} onChange={event => setMembershipTargetGroupId(event.target.value)}><option value="">Añadir a una colección…</option>{workGroups.filter(group => !group.archivedAt).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button type="button" disabled={!membershipTargetGroupId} onClick={() => void updateGroupMembership(membershipTargetGroupId, true)}>Añadir</button></>}{selectedWorkGroup && !selectedWorkGroup.archivedAt && selectedWorkGroup.postIds.some(id => selected.has(id)) && <button type="button" onClick={() => void updateGroupMembership(selectedWorkGroup.id, false)}>Quitar de esta colección</button>}<button type="button" onClick={() => openGroupForm()}>Crear colección con selección</button></div>}
    {archivedPosts.length > 0 && <section className="board-archived-posts"><header><div><strong>Publicaciones archivadas</strong><span>{archivedPosts.length}</span></div><button type="button" className="settings-button" onClick={() => setShowArchivedPosts(current => !current)}>{showArchivedPosts ? 'Ocultar' : 'Mostrar'}</button></header>{showArchivedPosts && <div className="board-archived-post-list">{archivedPosts.map(post => {
      const compressedCount = post.media.filter(asset => asset.compressed).length
      return <article key={post.id}><button type="button" className="board-archived-post-title" onClick={() => select(post.id)}><strong>{post.title || 'Publicación sin título'}</strong><span>{post.media.length} medios · {compressedCount} comprimidos</span></button><div>{post.media.length > compressedCount && <button type="button" className="settings-button" onClick={() => setPendingMediaCompression({ target: 'post', id: post.id, name: post.title || 'Publicación sin título', mediaCount: post.media.length - compressedCount })}><Archive size={13} /> Comprimir medios</button>}{compressedCount > 0 && <button type="button" className="settings-button" onClick={() => void restorePostMedia(post)}><ArchiveRestore size={13} /> Restaurar medios</button>}</div></article>
    })}</div>}</section>}
    {compressedPosts.length > 0 && <section className="board-archived-posts"><header><div><strong>Medios comprimidos</strong><span>{compressedPosts.length}</span></div><button type="button" className="settings-button" onClick={() => setShowCompressedPosts(current => !current)}>{showCompressedPosts ? 'Ocultar' : 'Mostrar'}</button></header>{showCompressedPosts && <div className="board-archived-post-list">{compressedPosts.map(post => <article key={post.id}><div className="board-archived-post-title"><strong>{post.title || 'Publicación sin título'}</strong><span>{post.media.filter(asset => asset.compressed).length} medios dentro de archivo ZIP · {statusMeta[post.status].label}</span></div><div><button type="button" className="settings-button" onClick={() => void restorePostMedia(post)}><ArchiveRestore size={13} /> Restaurar medios</button></div></article>)}</div>}</section>}
    {archivedCount > 0 && <p className="board-archive-note">{archivedCount} publicaciones archivadas no se muestran en el tablero.</p>}
    {!visibleBoardPosts.length && <div className="planner-empty-inline board-empty" role="status"><strong>{selectedWorkGroup && !posts.length ? 'Esta colección todavía no tiene publicaciones visibles' : query.trim() && posts.length === 0 ? 'No hay publicaciones que coincidan con la búsqueda' : archivedCount ? 'Todas las publicaciones de este espacio están archivadas' : 'Este espacio aún no tiene publicaciones'}</strong><span>{selectedWorkGroup && !posts.length ? 'Selecciona publicaciones del tablero y añádelas a esta colección.' : query.trim() && posts.length === 0 ? 'Limpia la búsqueda para volver a ver el tablero.' : 'Crea una publicación o convierte una idea para empezar.'}</span>{query.trim() && posts.length === 0 && <button type="button" className="settings-button" onClick={() => setQuery('')}>Limpiar búsqueda</button>}</div>}
    <div className={'board' + (selected.size ? ' selecting' : '')}>{stages.map(status => { const columnPosts = visibleBoardPosts.filter(post => post.status === status); const visiblePosts = columnPosts.slice(0, visiblePerColumn); const order = visiblePosts.map(post => post.id); return <div className="board-column" key={status} onDragOver={event => event.preventDefault()} onDrop={() => void moveDragged(status)}><header><span style={{ background: statusMeta[status].color }} /><strong>{statusMeta[status].label}</strong><em>{columnPosts.length}</em></header><div className="board-stack">{visiblePosts.map(post => <article className={selected.has(post.id) ? 'selected' : ''} draggable={armed === post.id} onDragStart={event => { dragIds.current = selected.has(post.id) ? [...selected] : [post.id]; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', post.id) }} onDragEnd={() => { dragIds.current = []; setArmed(null) }} key={post.id} onClick={event => { if (event.shiftKey || event.ctrlKey || event.metaKey || selected.size > 0) toggle(post.id, event.shiftKey, order); else select(post.id) }}><div><label className="board-select-hit" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selected.has(post.id)} onChange={event => toggle(post.id, event.nativeEvent instanceof MouseEvent && (event.nativeEvent as MouseEvent).shiftKey, order)} aria-label={`Seleccionar ${post.title || 'publicación'}`} /></label><span className="board-grip" title="Arrastrar" onMouseDown={() => setArmed(post.id)} onMouseUp={() => setArmed(null)}><GripVertical size={14} /></span>{post.platforms.map(p => <PlatformMark key={p} platform={p} small />)}<span>{contentLabels[post.contentType]}</span></div><h3>{post.title}</h3><p>{post.caption}</p>{post.distribution?.length ? <small>{post.distribution.filter(target => target.status === 'published').length}/{post.distribution.length} destinos publicados</small> : null}{post.scheduledAt && <small><CalendarDays size={12} />{format(parseISO(post.scheduledAt), 'd MMM · HH:mm', { locale: es })}</small>}</article>)}{!columnPosts.length && <p className="board-column-empty">Sin publicaciones en esta etapa</p>}{columnPosts.length > visiblePosts.length && <small className="board-more-hint">{columnPosts.length - visiblePosts.length} tarjetas ocultas</small>}</div></div> })}</div>
  </section>
}

export function LibraryView() {
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [mode, setMode] = useState<'copy' | 'reference'>('copy')
  useEffect(() => { void window.planner.media.list().then(setAssets).catch(error => reportAppError(error, 'No se pudo cargar la biblioteca multimedia')) }, [])
  const add = async () => {
    const imported = await window.planner.media.choose(mode)
    setAssets(current => [...imported, ...current.filter(item => !imported.some(next => next.id === item.id))])
  }
  return <section className="workspace library-workspace">  <ViewHeading title="Biblioteca multimedia" subtitle="Tus archivos permanecen en este equipo."><div className="segmented" role="group" aria-label="Cómo añadir archivos"><button type="button" aria-pressed={mode === 'copy'} className={mode === 'copy' ? 'active' : ''} onClick={() => setMode('copy')}>Copiar a biblioteca</button><button type="button" aria-pressed={mode === 'reference'} className={mode === 'reference' ? 'active' : ''} onClick={() => setMode('reference')}>Referenciar original</button></div><button type="button" className="new-button" onClick={() => void runWithErrorReporting(add, 'No se pudieron añadir archivos a la biblioteca')}><Plus size={17} /> Añadir archivos</button></ViewHeading>
    {assets.length ? <div className="asset-grid">{assets.map(asset => { const AssetIcon = asset.kind === 'image' ? FileImage : asset.kind === 'video' ? Film : FileText; return <article key={asset.id}><div className={`asset-preview ${asset.kind}`}><AssetIcon size={34} aria-hidden="true" /></div><strong title={asset.name}>{asset.name}</strong><span>{asset.kind === 'image' ? 'Imagen' : asset.kind === 'video' ? 'Vídeo' : 'Documento'}</span><small>{(asset.size / 1024 / 1024).toFixed(1)} MB · {asset.mode === 'copy' ? 'En biblioteca' : 'Referenciado'}</small><button type="button" onClick={() => void runWithErrorReporting(() => window.planner.media.reveal(asset.id), 'No se pudo abrir la ubicación del archivo')}><FolderOpen size={14} /> Abrir ubicación</button></article> })}</div> : <div className="empty-library"><div><FileImage size={32} /></div><h3>Tu biblioteca está lista</h3><p>Añade imágenes, vídeos o documentos desde tu equipo. Podrás vincularlos a cada publicación desde el editor.</p><button type="button" className="new-button" onClick={() => void runWithErrorReporting(add, 'No se pudieron añadir archivos a la biblioteca')}><Plus size={17} /> Elegir archivos</button></div>}
  </section>
}

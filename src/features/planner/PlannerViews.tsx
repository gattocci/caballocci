import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format,
  isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { Archive, ArchiveRestore, CalendarDays, ChevronLeft, ChevronRight, Clock3, FileImage, FileText, Film, FolderOpen, FolderPlus, GripVertical, List, Minimize2, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { contentLabels, stages, statusMeta } from '../../shared/constants'
import { postColors } from '../../shared/postColors'
import { PlatformMark, ViewHeading } from '../../components/layout/AppShell'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { postMatchesQuery, usePlanner } from '../../app/store'
import { useSelection } from '../../app/useSelection'
import type { MediaAsset, Post, WorkGroup } from '../../shared/types'
import './planner.css'

function fromLocalDateTimeInput(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function timeUntil(value: string, now: number) {
  const minutes = Math.round((new Date(value).getTime() - now) / 60_000)
  const absolute = Math.abs(minutes)
  const days = Math.floor(absolute / 1440)
  const hours = Math.floor((absolute % 1440) / 60)
  const rest = absolute % 60
  const amount = days ? `${days} d ${hours} h` : hours ? `${hours} h ${rest} min` : `${rest} min`
  return minutes < 0 ? `Hace ${amount}` : `En ${amount}`
}

function PostCard({ post, onSelect, onDrag, onDelete, onUnschedule, note, now, onColor, onNote }: { post: Post; onSelect(): void; onDrag(): void; onDelete(): void; onUnschedule(): void; note: string; now: number; onColor(color: string): void; onNote(note: string): void }) {
  const distribution = post.distribution || []
  const published = distribution.filter(target => target.status === 'published').length
  const [actionsOpen, setActionsOpen] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number; bottom: number } | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!actionsOpen || !menuAnchor || !menu) return
    const { width, height } = menu.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(menuAnchor.right - width, window.innerWidth - width - margin))
    const below = menuAnchor.bottom + 4
    const top = below + height <= window.innerHeight - margin
      ? below
      : Math.max(margin, menuAnchor.top - height - 4)
    setMenuPosition({ top, left })
  }, [actionsOpen, menuAnchor])
  const closeActions = () => {
    setActionsOpen(false)
    setMenuAnchor(null)
    setMenuPosition(null)
  }
  useEffect(() => {
    if (!actionsOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && (menuRef.current?.contains(target) || triggerRef.current?.contains(target))) return
      closeActions()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      closeActions()
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [actionsOpen])
  return <article className={'post-card' + (post.scheduledAt && new Date(post.scheduledAt).getTime() < now ? ' past' : '')} draggable onDragStart={onDrag} onClick={onSelect} style={{ '--post-color': post.color } as React.CSSProperties}>
    <div className="card-top"><div>{post.platforms.map(p => <PlatformMark key={p} platform={p} small />)}</div><button ref={triggerRef} type="button" className="timeline-post-menu-trigger" aria-label={`Acciones para ${post.title || 'publicación'}`} aria-expanded={actionsOpen} onClick={event => { event.stopPropagation(); if (actionsOpen) closeActions(); else { const rect = event.currentTarget.getBoundingClientRect(); setMenuAnchor({ top: rect.top, right: rect.right, bottom: rect.bottom }); setMenuPosition(null); setActionsOpen(true) } }}><MoreHorizontal size={15} /></button></div>
    {actionsOpen && menuAnchor && createPortal(<div ref={menuRef} className="timeline-post-menu" style={{ top: menuPosition?.top ?? 0, left: menuPosition?.left ?? 0, visibility: menuPosition ? 'visible' : 'hidden' }} onClick={event => event.stopPropagation()}><button type="button" onClick={() => { closeActions(); onSelect() }}><Pencil size={13} />Editar publicación</button><button type="button" className="timeline-unschedule-action" onClick={() => { closeActions(); onUnschedule() }}><CalendarDays size={13} />Quitar de la línea de tiempo</button><div className="timeline-color-picker"><span>Color de tarjeta</span><div>{postColors.map(color => <button type="button" key={color.value} aria-label={color.label} aria-pressed={post.color === color.value} title={color.label} style={{ backgroundColor: color.value }} onClick={() => onColor(color.value)} />)}</div></div><label className="timeline-note-input">Nota breve<input type="text" maxLength={120} value={note} placeholder="Añadir nota…" onChange={event => onNote(event.target.value)} /></label><button type="button" className="timeline-delete-action" onClick={() => { closeActions(); onDelete() }}><Trash2 size={13} />Eliminar definitivamente</button></div>, document.body)}
    <span className="type-label">{contentLabels[post.contentType]}</span>
    <h3>{post.title || 'Publicación sin título'}</h3>
    {note && <small className="timeline-card-note" title={note}>{note}</small>}
    <footer><span><Clock3 size={12} />{post.scheduledAt && format(parseISO(post.scheduledAt), 'HH:mm')}</span><i>{post.scheduledAt ? timeUntil(post.scheduledAt, now) : distribution.length ? `${published}/${distribution.length} destinos` : statusMeta[post.status].label}</i></footer>
  </article>
}

export function Timeline({ onNewScheduled }: { onNewScheduled(scheduledAt: string): void }) {
  const { posts: allPosts, save, remove, select, activeSpace, query } = usePlanner()
  const posts = (activeSpace ? allPosts.filter(post => post.project === activeSpace) : allPosts).filter(post => postMatchesQuery(post, query))
  const [anchor, setAnchor] = useState(new Date())
  const [periodDays, setPeriodDays] = useState<7 | 14>(() => {
    try { return localStorage.getItem('caballocci.timeline-range.all') === '14' ? 14 : 7 } catch { return 7 }
  })
  const [dragged, setDragged] = useState<string | null>(null)
  const [newPostTime, setNewPostTime] = useState(() => {
    try { return localStorage.getItem(`caballocci.timeline-time.${activeSpace || 'all'}`) || '10:00' } catch { return '10:00' }
  })
  const [addTarget, setAddTarget] = useState<{ day: string; label: string } | null>(null)
  const [existingSearch, setExistingSearch] = useState('')
  const [addError, setAddError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Post | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [timelineNotes, setTimelineNotes] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('caballocci.timeline-notes') || '{}') as Record<string, string> } catch { return {} }
  })
  const rangePreferenceKey = `caballocci.timeline-range.${activeSpace || 'all'}`
  const timePreferenceKey = `caballocci.timeline-time.${activeSpace || 'all'}`
  useEffect(() => {
    try { setPeriodDays(localStorage.getItem(rangePreferenceKey) === '14' ? 14 : 7) } catch { setPeriodDays(7) }
  }, [rangePreferenceKey])
  useEffect(() => {
    try { setNewPostTime(localStorage.getItem(timePreferenceKey) || '10:00') } catch { setNewPostTime('10:00') }
  }, [timePreferenceKey])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const updateTimelineNote = (postId: string, note: string) => {
    setTimelineNotes(current => {
      const next = { ...current, [postId]: note.slice(0, 120) }
      try { localStorage.setItem('caballocci.timeline-notes', JSON.stringify(next)) } catch { /* Notes are optional preferences. */ }
      return next
    })
  }
  const choosePeriod = (days: 7 | 14) => {
    setPeriodDays(days)
    try { localStorage.setItem(rangePreferenceKey, String(days)) } catch { /* Preferences are optional. */ }
  }
  const scheduleForDay = (day: Date, time = newPostTime) => {
    const [hours, minutes] = time.split(':').map(Number)
    const date = new Date(day)
    date.setHours(hours || 0, minutes || 0, 0, 0)
    return date.toISOString()
  }
  const chooseTime = (time: string) => {
    setNewPostTime(time)
    try { localStorage.setItem(timePreferenceKey, time) } catch { /* Preferences are optional. */ }
  }
  const unschedule = (post: Post) => void runWithErrorReporting(() => save({ ...post, scheduledAt: null, status: post.status === 'scheduled' ? 'draft' : post.status }), 'No se pudo quitar la fecha de la publicación')
  const days = Array.from({ length: periodDays }, (_, i) => addDays(startOfWeek(anchor, { weekStartsOn: 1 }), i))
  const scheduled = posts.filter(p => p.scheduledAt)
  const availablePosts = posts.filter(post => post.status !== 'archived' && post.status !== 'published' && postMatchesQuery(post, existingSearch))
  const rangeStart = days[0]
  const rangeEnd = addDays(days[periodDays - 1], 1)
  const visibleScheduled = scheduled.filter(post => post.scheduledAt && parseISO(post.scheduledAt) >= rangeStart && parseISO(post.scheduledAt) < rangeEnd)
  const outlookStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const outlook = Array.from({ length: 4 }, (_, index) => {
    const start = addDays(outlookStart, index * 7)
    const end = addDays(start, 7)
    return { start, end, count: scheduled.filter(post => post.scheduledAt && parseISO(post.scheduledAt) >= start && parseISO(post.scheduledAt) < end).length }
  })
  const nextScheduled = scheduled.map(post => ({ post, time: new Date(post.scheduledAt!).getTime() })).filter(item => item.time >= now).sort((a, b) => a.time - b.time)[0]
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
  return <section className="workspace timeline-workspace">
    <ViewHeading title="Línea de tiempo" subtitle="Planifica la semana y revisa de un vistazo el ritmo de las próximas cuatro.">
      <div className="timeline-heading-controls"><div className="segmented" role="group" aria-label="Duración de la vista"><button type="button" aria-pressed={periodDays === 7} className={periodDays === 7 ? 'active' : ''} onClick={() => choosePeriod(7)}>Semana</button><button type="button" aria-pressed={periodDays === 14} className={periodDays === 14 ? 'active' : ''} onClick={() => choosePeriod(14)}>2 semanas</button></div><div className="period-controls"><button type="button" aria-label="Periodo anterior" onClick={() => setAnchor(addDays(anchor, -periodDays))}><ChevronLeft size={17} /></button><button type="button" onClick={() => setAnchor(new Date())}>Hoy</button><button type="button" aria-label="Periodo siguiente" onClick={() => setAnchor(addDays(anchor, periodDays))}><ChevronRight size={17} /></button><span>{format(days[0], 'd MMM', { locale: es })} — {format(days[periodDays - 1], 'd MMM yyyy', { locale: es })}</span></div></div>
    </ViewHeading>
    <section className="timeline-outlook" aria-label="Carga de publicaciones de las próximas cuatro semanas"><span className="timeline-outlook-label">PRÓXIMAS CUATRO SEMANAS</span>{outlook.map((week, index) => <button type="button" key={week.start.toISOString()} aria-label={`Ver semana ${index + 1}, ${week.count} publicaciones`} onClick={() => { choosePeriod(7); setAnchor(week.start) }}><span>{index === 0 ? 'Esta semana' : `Semana ${index + 1}`}</span><b>{week.count}</b><small>{format(week.start, 'd MMM', { locale: es })} – {format(addDays(week.end, -1), 'd MMM', { locale: es })}</small><i style={{ '--week-load': `${Math.min(100, week.count * 14)}%` } as React.CSSProperties} /></button>)}</section>
    <div className="timeline-next" role="status">{nextScheduled ? <><Clock3 size={14} /><span><strong>Siguiente publicación</strong><b>{timeUntil(new Date(nextScheduled.time).toISOString(), now)}</b><small>{nextScheduled.post.title || 'Publicación sin título'} · {format(new Date(nextScheduled.time), 'EEEE d MMM · HH:mm', { locale: es })}</small></span></> : <><Clock3 size={14} /><span><strong>Sin próximas publicaciones</strong><small>Las publicaciones con fecha futura aparecerán aquí.</small></span></>}</div>
    <div className="timeline-shell">
      <div className="timeline-legend"><span>PUBLICACIONES · {periodDays === 7 ? 'SEMANA' : '2 SEMANAS'}</span><span>{visibleScheduled.length} programadas</span></div>
      <div className="timeline-scroll"><div className="timeline-grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(${periodDays === 7 ? 110 : 125}px, 1fr))` }}>{days.map(day => { const dayPosts = scheduled.filter(post => isSameDay(parseISO(post.scheduledAt!), day)); const dayLabel = format(day, 'EEEE d MMMM', { locale: es }); return <div key={day.toISOString()} className={'timeline-day ' + (isSameDay(day, new Date()) ? 'today' : '')} onDragOver={e => e.preventDefault()} onDrop={() => drop(day)}><header><span>{format(day, 'EEE', { locale: es })}</span><b>{format(day, 'd')}</b><small>{dayPosts.length}</small><button type="button" aria-label={`Añadir publicación para ${dayLabel}`} title="Añadir publicación" onClick={() => { setAddTarget({ day: day.toISOString(), label: dayLabel }); setExistingSearch(''); setAddError('') }}><Plus size={13} /></button></header><div className="day-track">{dayPosts.map(post => <PostCard key={post.id} post={post} note={timelineNotes[post.id] || ''} now={now} onSelect={() => select(post.id)} onDrag={() => setDragged(post.id)} onUnschedule={() => unschedule(post)} onDelete={() => { setPendingDelete(post); setDeleteError('') }} onColor={color => void runWithErrorReporting(() => save({ ...post, color }), 'No se pudo cambiar el color')} onNote={note => updateTimelineNote(post.id, note)} />)}{!dayPosts.length && <span className="timeline-day-empty">Sin publicaciones</span>}</div></div> })}</div></div>
    </div>
    <div className="timeline-footer"><div><strong>{visibleScheduled.length} programadas en esta vista</strong><small>Arrastra una tarjeta para cambiar su fecha</small></div><div className="mini-stats"><span><b>{posts.filter(p => p.status === 'draft').length}</b>Borradores</span><span><b>{posts.filter(p => p.status === 'review').length}</b>En revisión</span><span><b>{posts.filter(p => p.status === 'scheduled').length}</b>Programadas</span></div></div>
    {addTarget && <div className="timeline-add-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setAddTarget(null) }}><section className="timeline-add-dialog" role="dialog" aria-modal="true" aria-labelledby="timeline-add-title"><header><div><h2 id="timeline-add-title">Añadir al {addTarget.label}</h2><p>Elige una hora y cómo quieres añadir la publicación.</p></div><button type="button" aria-label="Cerrar" onClick={() => setAddTarget(null)}>×</button></header><div className="timeline-add-actions"><label className="timeline-modal-time">Hora de publicación<input type="time" value={newPostTime} onChange={event => chooseTime(event.target.value || '10:00')} /><small>Tu última hora elegida queda guardada para este espacio.</small></label><div className="timeline-time-presets" role="group" aria-label="Horas sugeridas">{['09:00', '12:00', '15:00', '18:00'].map(time => <button type="button" key={time} aria-pressed={newPostTime === time} onClick={() => chooseTime(time)}>{time}</button>)}</div><button type="button" onClick={() => { const scheduledAt = scheduleForDay(new Date(addTarget.day)); setAddTarget(null); onNewScheduled(scheduledAt) }}><Plus size={16} /><span><b>Crear publicación nueva</b><small>Se abrirá el editor con la fecha y hora elegidas.</small></span></button><label>O añadir una publicación existente<input type="search" value={existingSearch} onChange={event => setExistingSearch(event.target.value)} placeholder="Buscar por título o contenido" /></label><div className="timeline-existing-list">{availablePosts.length ? availablePosts.map(post => <button type="button" key={post.id} onClick={() => { setAddError(''); void runWithErrorReporting(async () => { try { await save({ ...post, scheduledAt: scheduleForDay(new Date(addTarget.day)), status: 'scheduled' }); setAddTarget(null) } catch (error) { setAddError(error instanceof Error ? error.message : 'No se pudo añadir la publicación.'); reportAppError(error, 'No se pudo añadir la publicación') } }, 'No se pudo añadir la publicación') }}><span>{post.title || 'Publicación sin título'}</span><small>{statusMeta[post.status].label} · {contentLabels[post.contentType]}{post.scheduledAt ? ` · ${format(parseISO(post.scheduledAt), 'd MMM HH:mm', { locale: es })}` : ' · Sin fecha'}</small></button>) : <p>No hay publicaciones disponibles para añadir.</p>}</div>{addError && <p className="timeline-add-error" role="alert">{addError}</p>}</div></section></div>}
    {pendingDelete && <div className="timeline-add-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPendingDelete(null) }}><section className="timeline-add-dialog timeline-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="timeline-delete-title"><header><div><h2 id="timeline-delete-title">¿Eliminar definitivamente esta publicación?</h2><p>“{pendingDelete.title || 'Publicación sin título'}” se borrará de toda la aplicación, incluidas sus colecciones. Si solo quieres quitarla de la planificación, elige “Quitar de la línea de tiempo”.</p></div><button type="button" aria-label="Cerrar" onClick={() => setPendingDelete(null)}>×</button></header>{deleteError && <p className="timeline-add-error" role="alert">{deleteError}</p>}<footer><button type="button" className="settings-button" onClick={() => setPendingDelete(null)}>Cancelar</button><button type="button" className="timeline-confirm-delete" onClick={() => { const post = pendingDelete; void runWithErrorReporting(async () => { try { await remove(post.id); setPendingDelete(null) } catch (error) { setDeleteError(error instanceof Error ? error.message : 'No se pudo eliminar la publicación.'); reportAppError(error, 'No se pudo eliminar la publicación') } }, 'No se pudo eliminar la publicación') }}><Trash2 size={14} /> Eliminar definitivamente</button></footer></section></div>}
  </section>
}

export function CalendarView() {
  const { posts: allPosts, select, save, activeSpace, query, setQuery, selectedId } = usePlanner()
  const posts = (activeSpace ? allPosts.filter(post => post.project === activeSpace) : allPosts).filter(post => postMatchesQuery(post, query))
  const [month, setMonth] = useState(new Date())
  const [dayPopover, setDayPopover] = useState<{ dayKey: string; anchor: HTMLElement } | null>(null)
  const [dayPopoverPosition, setDayPopoverPosition] = useState<{ top: number; left: number } | null>(null)
  const dayPopoverRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!dayPopover) return
    const updatePosition = () => {
      const popover = dayPopoverRef.current
      if (!popover) return
      const { height } = popover.getBoundingClientRect()
      const margin = 12
      const editor = document.querySelector('.editor')
      const editorRect = editor?.getBoundingClientRect()
      const rect = dayPopover.anchor.getBoundingClientRect()
      const availableLeftWidth = editorRect ? editorRect.left - margin * 2 : 0
      const dockToEditor = editorRect && availableLeftWidth >= 200
      popover.style.width = dockToEditor ? `${Math.min(320, availableLeftWidth)}px` : ''
      const popoverWidth = popover.getBoundingClientRect().width
      const left = dockToEditor && editorRect
        ? editorRect.left - popoverWidth - margin
        : Math.max(margin, Math.min(rect.left, window.innerWidth - popoverWidth - margin))
      const top = editorRect
        ? Math.max(margin, Math.min(editorRect.top + margin, window.innerHeight - height - margin))
        : rect.bottom + height <= window.innerHeight - margin
          ? rect.bottom + 6
          : Math.max(margin, rect.top - height - 6)
      setDayPopoverPosition({ top, left })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [dayPopover, selectedId])
  useEffect(() => {
    if (!dayPopover) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.editor-backdrop')) return
      if (target instanceof Node && (dayPopoverRef.current?.contains(target) || dayPopover.anchor.contains(target))) return
      setDayPopover(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDayPopover(null)
      dayPopover.anchor.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [dayPopover])
  const changeMonth = (nextMonth: Date) => {
    setMonth(nextMonth)
    setDayPopover(null)
    setDayPopoverPosition(null)
  }
  const openPost = (postId: string) => {
    setDayPopover(null)
    setDayPopoverPosition(null)
    select(postId)
  }
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
    <ViewHeading title="Calendario" subtitle="Una vista clara de tu ritmo de publicación."><div className="period-controls"><button aria-label="Mes anterior" onClick={() => changeMonth(subMonths(month, 1))}><ChevronLeft size={17} /></button><button onClick={() => changeMonth(new Date())}>Hoy</button><button aria-label="Mes siguiente" onClick={() => changeMonth(addMonths(month, 1))}><ChevronRight size={17} /></button><span>{format(month, 'MMMM yyyy', { locale: es })}</span></div></ViewHeading>
    {!monthScheduledPosts.length && <div className="planner-empty-inline calendar-empty" role="status"><strong>{query.trim() && !posts.length ? 'No hay publicaciones que coincidan con la búsqueda' : `No hay publicaciones programadas en ${format(month, 'MMMM', { locale: es })}`}</strong><span>{query.trim() && !posts.length ? 'Borra la búsqueda para volver a ver el calendario completo.' : 'Las publicaciones con fecha aparecerán aquí.'}</span>{query.trim() && !posts.length && <button type="button" className="settings-button" onClick={() => setQuery('')}>Limpiar búsqueda</button>}</div>}
    <div className="calendar"><div className="weekdays">{['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => <span key={d}>{d}</span>)}</div><div className="month-grid">{days.map(day => {
      const dayKey = format(day, 'yyyy-MM-dd')
      const dayPosts = posts.filter(post => post.scheduledAt && isSameDay(parseISO(post.scheduledAt), day))
        .sort((first, second) => new Date(first.scheduledAt || '').getTime() - new Date(second.scheduledAt || '').getTime())
      const visibleDayPosts = dayPosts.slice(0, 3)
      const hiddenCount = dayPosts.length - visibleDayPosts.length
      return <div className={`month-day ${!isSameMonth(day, month) ? 'muted ' : ''}${isSameDay(day, new Date()) ? 'today' : ''}`} key={dayKey} onClick={event => {
        if ((event.target as HTMLElement).closest('button')) return
        setDayPopover({ dayKey, anchor: event.currentTarget })
        setDayPopoverPosition(null)
      }} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, day)}>
        <button type="button" className="month-day-date" aria-label={`Ver publicaciones del ${format(day, 'd MMMM yyyy', { locale: es })}`} aria-haspopup="dialog" aria-expanded={dayPopover?.dayKey === dayKey} onClick={event => {
          if (dayPopover?.dayKey === dayKey) {
            setDayPopover(null)
            setDayPopoverPosition(null)
          } else {
            setDayPopover({ dayKey, anchor: event.currentTarget })
            setDayPopoverPosition(null)
          }
        }}>{format(day, 'd')}</button>
        <div className="month-day-posts">
          {visibleDayPosts.map(post => <button draggable onDragStart={event => event.dataTransfer.setData('post', post.id)} key={post.id} style={{ '--post-color': post.color } as React.CSSProperties} onClick={() => openPost(post.id)} title={post.title}><span>{post.scheduledAt && format(parseISO(post.scheduledAt), 'HH:mm')}</span>{post.title}</button>)}
          {hiddenCount > 0 && <button type="button" className="month-day-more" aria-haspopup="dialog" aria-expanded={dayPopover?.dayKey === dayKey} onClick={event => {
            setDayPopover({ dayKey, anchor: event.currentTarget })
            setDayPopoverPosition(null)
          }}>+ {hiddenCount} más</button>}
        </div>
      </div>
    })}</div></div>
    {dayPopover && createPortal((() => {
      const selectedDay = parseISO(dayPopover.dayKey)
      const dayPosts = posts.filter(post => post.scheduledAt && isSameDay(parseISO(post.scheduledAt), selectedDay))
        .sort((first, second) => new Date(first.scheduledAt || '').getTime() - new Date(second.scheduledAt || '').getTime())
      return <div ref={dayPopoverRef} className="calendar-day-popover" role="dialog" aria-label={`Publicaciones del ${format(selectedDay, 'd MMMM yyyy', { locale: es })}`} style={{ top: dayPopoverPosition?.top ?? 0, left: dayPopoverPosition?.left ?? 0, visibility: dayPopoverPosition ? 'visible' : 'hidden' }}>
        <header><strong>{format(selectedDay, 'EEEE d MMMM', { locale: es })}</strong><button type="button" aria-label="Cerrar publicaciones del día" onClick={() => { setDayPopover(null); setDayPopoverPosition(null) }}>×</button></header>
        <div className="calendar-day-popover-list">{dayPosts.length ? dayPosts.map(post => <button type="button" key={post.id} style={{ '--post-color': post.color } as React.CSSProperties} aria-current={selectedId === post.id ? 'true' : undefined} onClick={() => openPost(post.id)} title={post.title}>
          <time>{post.scheduledAt && format(parseISO(post.scheduledAt), 'HH:mm')}</time><span>{post.title || 'Publicación sin título'}</span>
        </button>) : <p>No hay publicaciones programadas este día.</p>}</div>
      </div>
    })(), document.body)}
  </section>
}

export function BoardDaySwitcher() {
  const { posts: allPosts, selectedId, select, activeSpace, query } = usePlanner()
  const selectedPost = allPosts.find(post => post.id === selectedId)
  const [expanded, setExpanded] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const posts = (activeSpace ? allPosts.filter(post => post.project === activeSpace) : allPosts).filter(post => postMatchesQuery(post, query))
  const scheduledDay = selectedPost?.scheduledAt ? parseISO(selectedPost.scheduledAt) : null
  const dayPosts = scheduledDay
    ? posts.filter(post => post.scheduledAt && isSameDay(parseISO(post.scheduledAt), scheduledDay))
      .sort((first, second) => new Date(first.scheduledAt || '').getTime() - new Date(second.scheduledAt || '').getTime())
    : []

  useLayoutEffect(() => {
    if (!selectedPost?.scheduledAt) {
      setPosition(null)
      return
    }
    const updatePosition = () => {
      const panel = panelRef.current
      const editor = document.querySelector('.editor')
      if (!editor) {
        setPosition(null)
        return
      }
      const editorRect = editor.getBoundingClientRect()
      const width = expanded ? Math.min(320, window.innerWidth - 24, Math.max(200, editorRect.left - 24)) : 42
      const estimatedExpandedHeight = Math.min(420, 52 + dayPosts.length * 38 + 12)
      const height = expanded ? panel?.getBoundingClientRect().height || estimatedExpandedHeight : 42
      setPosition({
        top: Math.max(12, Math.min(editorRect.top + 12, window.innerHeight - height - 12)),
        left: Math.max(12, editorRect.left - width - 12),
        width,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [selectedPost?.id, selectedPost?.scheduledAt, expanded, dayPosts.length])

  useEffect(() => {
    if (!expanded) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.editor-backdrop')) return
      if (target instanceof Node && panelRef.current?.contains(target)) return
      setExpanded(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [expanded])

  if (!selectedPost?.scheduledAt || !scheduledDay || !position) return null
  return createPortal(<div ref={panelRef} className={`calendar-day-popover board-day-switcher${expanded ? ' expanded' : ' minimized'}`} role={expanded ? 'dialog' : undefined} aria-label={expanded ? `Publicaciones del ${format(scheduledDay, 'd MMMM yyyy', { locale: es })}` : undefined} style={{ top: position.top, left: position.left, width: position.width }}>
    {expanded ? <>
      <header><strong>{format(scheduledDay, 'EEEE d MMMM', { locale: es })}</strong><button type="button" aria-label="Minimizar publicaciones del día" onClick={() => setExpanded(false)}><Minimize2 size={13} /></button></header>
      <div className="calendar-day-popover-list">{dayPosts.map(post => <button type="button" key={post.id} style={{ '--post-color': post.color } as React.CSSProperties} aria-current={selectedId === post.id ? 'true' : undefined} onClick={() => select(post.id)} title={post.title}>
        <time>{post.scheduledAt && format(parseISO(post.scheduledAt), 'HH:mm')}</time><span>{post.title || 'Publicación sin título'}</span>
      </button>)}</div>
    </> : <button type="button" className="board-day-switcher-trigger" aria-label={`Ver publicaciones del ${format(scheduledDay, 'd MMMM', { locale: es })}`} title={`Publicaciones del ${format(scheduledDay, 'd MMMM', { locale: es })}`} onClick={() => setExpanded(true)}>
      <CalendarDays size={17} /><span>{format(scheduledDay, 'd')}</span>
    </button>}
  </div>, document.body)
}

export function Board() {
  const { posts: allPosts, workGroups, move, select, activeSpace, query, setQuery, saveWorkGroup, setWorkGroupPosts, setWorkGroupArchived, removeWorkGroup } = usePlanner()
  const [visiblePerColumn, setVisiblePerColumn] = useState(30)
  const [boardMode, setBoardMode] = useState<'kanban' | 'list' | 'calendar'>(() => {
    try { return (localStorage.getItem('caballocci.board-view.all') as 'kanban' | 'list' | 'calendar') || 'kanban' } catch { return 'kanban' }
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
    for (const id of selected) if (allPosts.some(item => item.id === id)) await move(id, status)
    clear()
  }, 'No se pudieron actualizar las publicaciones seleccionadas')
  const bulkSchedule = () => {
    const scheduledAt = fromLocalDateTimeInput(bulkScheduleAt)
    if (!scheduledAt || !selected.size) {
      setBulkScheduleWarning('Elige fecha y hora para programar las publicaciones seleccionadas.')
      return
    }
    void runWithErrorReporting(async () => {
      for (const id of selected) {
        const post = allPosts.find(item => item.id === id)
        if (post) await usePlanner.getState().save({ ...post, scheduledAt, status: 'scheduled' })
      }
      setBulkScheduleAt('')
      setBulkScheduleWarning('')
      clear()
    }, 'No se pudieron programar las publicaciones seleccionadas')
  }
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
          const postIds = groupDeleteMode === 'all-posts' ? group.postIds : groupDeleteMode === 'selected-posts' ? groupPostsToDelete : []
          for (const id of postIds) {
            const post = allPosts.find(item => item.id === id)
            if (post?.media.some(asset => asset.compressed)) await window.planner.workGroups.restorePostMedia(id)
            await usePlanner.getState().remove(id)
          }
          if (!postIds.length && group.compressedMediaCount) await window.planner.workGroups.restoreMedia(group.id)
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
  return <section className={`workspace board-mode-${boardMode}`}><ViewHeading title="Tablero de contenido" subtitle="Gestiona publicaciones por etapas, en lista o por fecha."><div className="segmented board-mode-switch" role="group" aria-label="Vista del tablero"><button type="button" aria-pressed={boardMode === 'kanban'} className={boardMode === 'kanban' ? 'active' : ''} onClick={() => changeBoardMode('kanban')}>Kanban</button><button type="button" aria-pressed={boardMode === 'list'} className={boardMode === 'list' ? 'active' : ''} onClick={() => changeBoardMode('list')}><List size={13} /> Lista</button><button type="button" aria-pressed={boardMode === 'calendar'} className={boardMode === 'calendar' ? 'active' : ''} onClick={() => changeBoardMode('calendar')}><CalendarDays size={13} /> Calendario</button></div>{boardMode === 'kanban' && <button className="settings-button" type="button" disabled={visiblePerColumn >= 100} onClick={() => setVisiblePerColumn(current => Math.min(100, current + 30))}>{visiblePerColumn >= 100 ? 'Límite de tarjetas' : `Cargar ${Math.min(30, 100 - visiblePerColumn)} más por etapa`}</button>}</ViewHeading>
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
    {selected.size > 0 && <div className="board-bulk-actions"><strong>{selected.size} seleccionadas</strong>{boardMode === 'list' && <div className="bulk-schedule-control"><label htmlFor="bulk-schedule-at">Fecha y hora</label><input id="bulk-schedule-at" type="datetime-local" value={bulkScheduleAt} onChange={event => { setBulkScheduleAt(event.target.value); setBulkScheduleWarning('') }} /><button type="button" disabled={!bulkScheduleAt} onClick={bulkSchedule}>Programar selección</button></div>}<button type="button" onClick={() => void bulkMove('draft')}>Borrador</button><button type="button" onClick={() => void bulkMove('review')}>Revisión</button><button type="button" onClick={() => void bulkMove('approved')}>Aprobadas</button><button type="button" onClick={() => void bulkMove('archived')}>Archivar</button><button type="button" onClick={clear}>Cancelar</button>{bulkScheduleWarning && <span className="bulk-schedule-warning" role="alert">{bulkScheduleWarning}</span>}</div>}
    {selected.size > 0 && <div className="board-bulk-actions work-group-membership-actions"><strong>{selected.size} publicaciones seleccionadas</strong>{workGroups.some(group => !group.archivedAt) && <><select aria-label="Colección de destino" value={membershipTargetGroupId} onChange={event => setMembershipTargetGroupId(event.target.value)}><option value="">Añadir a una colección…</option>{workGroups.filter(group => !group.archivedAt).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button type="button" disabled={!membershipTargetGroupId} onClick={() => void updateGroupMembership(membershipTargetGroupId, true)}>Añadir</button></>}{selectedWorkGroup && !selectedWorkGroup.archivedAt && selectedWorkGroup.postIds.some(id => selected.has(id)) && <button type="button" onClick={() => void updateGroupMembership(selectedWorkGroup.id, false)}>Quitar de esta colección</button>}<button type="button" onClick={() => openGroupForm()}>Crear colección con selección</button></div>}
    {archivedPosts.length > 0 && <section className="board-archived-posts"><header><div><strong>Publicaciones archivadas</strong><span>{archivedPosts.length}</span></div><button type="button" className="settings-button" onClick={() => setShowArchivedPosts(current => !current)}>{showArchivedPosts ? 'Ocultar' : 'Mostrar'}</button></header>{showArchivedPosts && <div className="board-archived-post-list">{archivedPosts.map(post => {
      const compressedCount = post.media.filter(asset => asset.compressed).length
      return <article key={post.id}><button type="button" className="board-archived-post-title" onClick={() => select(post.id)}><strong>{post.title || 'Publicación sin título'}</strong><span>{post.media.length} medios · {compressedCount} comprimidos</span></button><div>{post.media.length > compressedCount && <button type="button" className="settings-button" onClick={() => setPendingMediaCompression({ target: 'post', id: post.id, name: post.title || 'Publicación sin título', mediaCount: post.media.length - compressedCount })}><Archive size={13} /> Comprimir medios</button>}{compressedCount > 0 && <button type="button" className="settings-button" onClick={() => void restorePostMedia(post)}><ArchiveRestore size={13} /> Restaurar medios</button>}</div></article>
    })}</div>}</section>}
    {compressedPosts.length > 0 && <section className="board-archived-posts"><header><div><strong>Medios comprimidos</strong><span>{compressedPosts.length}</span></div><button type="button" className="settings-button" onClick={() => setShowCompressedPosts(current => !current)}>{showCompressedPosts ? 'Ocultar' : 'Mostrar'}</button></header>{showCompressedPosts && <div className="board-archived-post-list">{compressedPosts.map(post => <article key={post.id}><div className="board-archived-post-title"><strong>{post.title || 'Publicación sin título'}</strong><span>{post.media.filter(asset => asset.compressed).length} medios dentro de archivo ZIP · {statusMeta[post.status].label}</span></div><div><button type="button" className="settings-button" onClick={() => void restorePostMedia(post)}><ArchiveRestore size={13} /> Restaurar medios</button></div></article>)}</div>}</section>}
    {archivedCount > 0 && <p className="board-archive-note">{archivedCount} publicaciones archivadas no se muestran en el tablero.</p>}
    {!visibleBoardPosts.length && <div className="planner-empty-inline board-empty" role="status"><strong>{selectedWorkGroup && !posts.length ? 'Esta colección todavía no tiene publicaciones visibles' : query.trim() && posts.length === 0 ? 'No hay publicaciones que coincidan con la búsqueda' : archivedCount ? 'Todas las publicaciones de este espacio están archivadas' : 'Este espacio aún no tiene publicaciones'}</strong><span>{selectedWorkGroup && !posts.length ? 'Selecciona publicaciones del tablero y añádelas a esta colección.' : query.trim() && posts.length === 0 ? 'Limpia la búsqueda para volver a ver el tablero.' : 'Crea una publicación o convierte una idea para empezar.'}</span>{query.trim() && posts.length === 0 && <button type="button" className="settings-button" onClick={() => setQuery('')}>Limpiar búsqueda</button>}</div>}
    {boardMode === 'kanban' && <div className={'board' + (selected.size ? ' selecting' : '')}>{stages.map(status => { const columnPosts = visibleBoardPosts.filter(post => post.status === status); const visiblePosts = columnPosts.slice(0, visiblePerColumn); const order = columnPosts.map(post => post.id); const collapsed = collapsedColumns.has(status); return <div className={'board-column' + (collapsed ? ' collapsed' : '')} key={status} onDragOver={event => event.preventDefault()} onDrop={() => void moveDragged(status)}><header><button type="button" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expandir' : 'Contraer'} ${statusMeta[status].label}`} onClick={() => setCollapsedColumns(current => { const next = new Set(current); if (next.has(status)) next.delete(status); else next.add(status); return next })}><span style={{ background: statusMeta[status].color }} /><strong>{statusMeta[status].label}</strong><em>{columnPosts.length}</em><ChevronRight size={13} /></button></header>{!collapsed && <div className="board-stack">{visiblePosts.map(post => <article className={selected.has(post.id) ? 'selected' : ''} draggable={armed === post.id} onDragStart={event => { dragIds.current = selected.has(post.id) ? [...selected] : [post.id]; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', post.id) }} onDragEnd={() => { dragIds.current = []; setArmed(null) }} key={post.id} onClick={event => { if (event.shiftKey || event.ctrlKey || event.metaKey || selected.size > 0) toggle(post.id, event.shiftKey, order); else select(post.id) }}><div><label className="board-select-hit" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selected.has(post.id)} onChange={event => toggle(post.id, event.nativeEvent instanceof MouseEvent && (event.nativeEvent as MouseEvent).shiftKey, order)} aria-label={`Seleccionar ${post.title || 'publicación'}`} /></label><span className="board-grip" title="Arrastrar" onMouseDown={() => setArmed(post.id)} onMouseUp={() => setArmed(null)}><GripVertical size={14} /></span>{post.platforms.map(p => <PlatformMark key={p} platform={p} small />)}<span>{contentLabels[post.contentType]}</span></div><h3>{post.title || 'Publicación sin título'}</h3>{post.scheduledAt && <small><CalendarDays size={12} />{format(parseISO(post.scheduledAt), 'd MMM · HH:mm', { locale: es })}</small>}</article>)}{!columnPosts.length && <p className="board-column-empty">Sin publicaciones en esta etapa</p>}{columnPosts.length > visiblePosts.length && <small className="board-more-hint">{columnPosts.length - visiblePosts.length} más, carga más tarjetas para verlas</small>}</div>}</div> })}</div>}
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

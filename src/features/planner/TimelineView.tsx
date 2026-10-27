import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BoardCardColorPicker } from './BoardCardDecorations'
import { createPortal } from 'react-dom'
import {
  addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format,
  isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { Archive, ArchiveRestore, CalendarDays, ChevronLeft, ChevronRight, Clock3, FileImage, FileText, Film, FolderOpen, FolderPlus, GripVertical, List, Minimize2, MoreHorizontal, Pencil, Plus, Smartphone, Trash2 } from 'lucide-react'
import { contentLabels, stages, statusMeta } from '../../shared/constants'
import { postColors } from '../../shared/postColors'
import { PlatformMark, ViewHeading } from '../../components/layout/AppShell'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { postMatchesQuery, usePlanner } from '../../app/store'
import { useSelection } from '../../app/useSelection'
import type { MediaAsset, Post, WorkGroup } from '../../shared/types'

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

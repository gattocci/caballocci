import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

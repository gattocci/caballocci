import { useState } from 'react'
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format,
  isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { contentLabels, statusMeta } from '../../shared/constants'
import type { Post } from '../../shared/types'

type BoardCalendarViewProps = {
  posts: Post[]
  select(id: string | null): void
  onScheduleDrop(postId: string, day: Date, time: string): void
}

export function BoardCalendarView({ posts, select, onScheduleDrop }: BoardCalendarViewProps) {
  const [calendarMonth, setCalendarMonth] = useState(new Date())
  const [expandedCalendarDay, setExpandedCalendarDay] = useState<string | null>(null)
  const [defaultTime, setDefaultTime] = useState('10:00')
  const unscheduledPosts = posts.filter(post => !post.scheduledAt && post.status !== 'archived' && post.status !== 'published')

  const changeMonth = (change: number) => {
    setCalendarMonth(current => change === 0 ? new Date() : change > 0 ? addMonths(current, change) : subMonths(current, Math.abs(change)))
    setExpandedCalendarDay(null)
  }

  return <section className="board-editorial-calendar" aria-label="Calendario editorial">
    <div className="board-calendar-heading"><strong>{format(calendarMonth, 'MMMM yyyy', { locale: es })}</strong><div className="period-controls"><button type="button" aria-label="Mes anterior" onClick={() => changeMonth(-1)}><ChevronLeft size={16} /></button><button type="button" onClick={() => changeMonth(0)}>Hoy</button><button type="button" aria-label="Mes siguiente" onClick={() => changeMonth(1)}><ChevronRight size={16} /></button></div></div>
    <section className="board-unscheduled" aria-label="Publicaciones sin programar"><header><div><strong>Sin programar</strong><span>{unscheduledPosts.length}</span></div><label>Hora sugerida<input type="time" value={defaultTime} onChange={event => setDefaultTime(event.target.value || '10:00')} /></label></header><div>{unscheduledPosts.map(post => <button type="button" key={post.id} draggable title="Arrastra al día para programar; también puedes abrir el detalle" onDragStart={event => event.dataTransfer.setData('post', post.id)} onClick={() => select(post.id)}><strong>{post.title || 'Publicación sin título'}</strong><span>{statusMeta[post.status].label} · {contentLabels[post.contentType]}</span></button>)}</div><small>Arrastra una publicación a un día. Se programará a las {defaultTime} en tu zona horaria.</small></section>
    <div className="board-calendar-grid"><div className="board-calendar-weekdays">{['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => <span key={day}>{day}</span>)}</div><div className="board-calendar-days">{eachDayOfInterval({ start: startOfWeek(startOfMonth(calendarMonth), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(calendarMonth), { weekStartsOn: 1 }) }).map(day => {
      const dayPosts = posts.filter(post => post.scheduledAt && isSameDay(parseISO(post.scheduledAt), day))
      const dayKey = format(day, 'yyyy-MM-dd')
      const visibleDayPosts = expandedCalendarDay === dayKey ? dayPosts : dayPosts.slice(0, 3)
      return <div key={day.toISOString()} className={`${isSameMonth(day, calendarMonth) ? '' : 'muted'} ${isSameDay(day, new Date()) ? 'today' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); onScheduleDrop(event.dataTransfer.getData('post'), day, defaultTime) }}><b>{format(day, 'd')}</b>{visibleDayPosts.map(post => <button type="button" key={post.id} title={post.title} onClick={() => select(post.id)}><time>{post.scheduledAt && format(parseISO(post.scheduledAt), 'HH:mm')}</time><span>{post.title || 'Publicación sin título'}</span></button>)}{dayPosts.length > 3 && <button type="button" className="board-calendar-more" onClick={() => setExpandedCalendarDay(expandedCalendarDay === dayKey ? null : dayKey)}>{expandedCalendarDay === dayKey ? 'Mostrar menos' : `+ ${dayPosts.length - 3} más`}</button>}</div>
    })}</div></div>
    <p className="board-calendar-note" role="status">{posts.some(post => post.scheduledAt) ? `${posts.filter(post => !post.scheduledAt).length} publicaciones sin fecha no se muestran en el calendario.` : 'No hay publicaciones programadas. Las publicaciones sin fecha no se asignan a ningún día.'}</p>
  </section>
}

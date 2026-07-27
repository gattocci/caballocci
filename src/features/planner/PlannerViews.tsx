import { useEffect, useState } from 'react'
import {
  addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format,
  isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, FileImage, FolderOpen, MoreHorizontal, Plus } from 'lucide-react'
import { contentLabels, stages, statusMeta } from '../../shared/constants'
import { PlatformMark, ViewHeading } from '../../components/layout/AppShell'
import { usePlanner } from '../../app/store'
import type { MediaAsset, Post } from '../../shared/types'

function PostCard({ post, onSelect, onDrag }: { post: Post; onSelect(): void; onDrag(): void }) {
  return <article className="post-card" draggable onDragStart={onDrag} onClick={onSelect} style={{ '--post-color': post.color } as React.CSSProperties}>
    <div className="card-top"><div>{post.platforms.map(p => <PlatformMark key={p} platform={p} small />)}</div><MoreHorizontal size={15} /></div>
    <span className="type-label">{contentLabels[post.contentType]}</span>
    <h3>{post.title}</h3><p>{post.caption}</p>
    <footer><span><Clock3 size={12} />{post.scheduledAt && format(parseISO(post.scheduledAt), 'HH:mm')}</span><i style={{ color: statusMeta[post.status].color }}>{statusMeta[post.status].label}</i></footer>
  </article>
}

export function Timeline() {
  const { posts: allPosts, save, select, activeSpace } = usePlanner()
  const posts = activeSpace ? allPosts.filter(post => post.project === activeSpace) : allPosts
  const [anchor, setAnchor] = useState(new Date())
  const [dragged, setDragged] = useState<string | null>(null)
  const days = Array.from({ length: 14 }, (_, i) => addDays(startOfWeek(anchor, { weekStartsOn: 1 }), i))
  const scheduled = posts.filter(p => p.scheduledAt)
  const drop = async (day: Date) => {
    const post = posts.find(p => p.id === dragged)
    if (!post) return
    const old = post.scheduledAt ? parseISO(post.scheduledAt) : new Date()
    const next = new Date(day)
    next.setHours(old.getHours(), old.getMinutes())
    await save({ ...post, scheduledAt: next.toISOString(), status: post.status === 'idea' ? 'scheduled' : post.status })
    setDragged(null)
  }
  return <section className="workspace">
    <ViewHeading title="Línea de tiempo" subtitle="Todo tu contenido, en el orden en que cobra vida.">
      <div className="period-controls"><button onClick={() => setAnchor(addDays(anchor, -14))}><ChevronLeft size={17} /></button><button onClick={() => setAnchor(new Date())}>Hoy</button><button onClick={() => setAnchor(addDays(anchor, 14))}><ChevronRight size={17} /></button><span>{format(days[0], 'd MMM', { locale: es })} — {format(days[13], 'd MMM yyyy', { locale: es })}</span></div>
    </ViewHeading>
    <div className="timeline-shell">
      <div className="timeline-legend"><span>PUBLICACIONES</span><div>{stages.slice(0, 5).map(s => <i key={s}><b style={{ background: statusMeta[s].color }} />{statusMeta[s].label}</i>)}</div></div>
      <div className="timeline-scroll"><div className="timeline-grid" style={{ gridTemplateColumns: 'repeat(' + days.length + ', minmax(132px, 1fr))' }}>{days.map(day => <div key={day.toISOString()} className={'timeline-day ' + (isSameDay(day, new Date()) ? 'today' : '')} onDragOver={e => e.preventDefault()} onDrop={() => drop(day)}><header><span>{format(day, 'EEE', { locale: es })}</span><b>{format(day, 'd')}</b></header><div className="day-track">{scheduled.filter(p => isSameDay(parseISO(p.scheduledAt!), day)).map(post => <PostCard key={post.id} post={post} onSelect={() => select(post.id)} onDrag={() => setDragged(post.id)} />)}</div></div>)}</div></div>
    </div>
    <div className="timeline-footer"><div><span className="pulse" /><strong>{scheduled.length} publicaciones planificadas</strong><small>Arrastra una tarjeta para cambiar su fecha</small></div><div className="mini-stats"><span><b>{posts.filter(p => p.status === 'draft').length}</b>Borradores</span><span><b>{posts.filter(p => p.status === 'review').length}</b>En revisión</span><span><b>{posts.filter(p => p.status === 'scheduled').length}</b>Programadas</span></div></div>
  </section>
}

export function CalendarView() {
  const { posts: allPosts, select, save, activeSpace } = usePlanner()
  const posts = activeSpace ? allPosts.filter(post => post.project === activeSpace) : allPosts
  const [month, setMonth] = useState(new Date())
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start, end })
  const drop = async (event: React.DragEvent, day: Date) => {
    const post = posts.find(p => p.id === event.dataTransfer.getData('post'))
    if (!post) return
    const next = new Date(day)
    next.setHours(post.scheduledAt ? parseISO(post.scheduledAt).getHours() : 10)
    await save({ ...post, scheduledAt: next.toISOString() })
  }
  return <section className="workspace">
    <ViewHeading title="Calendario" subtitle="Una vista clara de tu ritmo de publicación."><div className="period-controls"><button onClick={() => setMonth(subMonths(month, 1))}><ChevronLeft size={17} /></button><button onClick={() => setMonth(new Date())}>Hoy</button><button onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={17} /></button><span>{format(month, 'MMMM yyyy', { locale: es })}</span></div></ViewHeading>
    <div className="calendar"><div className="weekdays">{['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => <span key={d}>{d}</span>)}</div><div className="month-grid">{days.map(day => <div className={'month-day ' + (!isSameMonth(day, month) ? 'muted ' : '') + (isSameDay(day, new Date()) ? 'today' : '')} key={day.toISOString()} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, day)}><b>{format(day, 'd')}</b>{posts.filter(p => p.scheduledAt && isSameDay(parseISO(p.scheduledAt), day)).map(p => <button draggable onDragStart={e => e.dataTransfer.setData('post', p.id)} key={p.id} style={{ borderLeftColor: p.color }} onClick={() => select(p.id)}><span>{p.scheduledAt && format(parseISO(p.scheduledAt), 'HH:mm')}</span>{p.title}</button>)}</div>)}</div></div>
  </section>
}

export function Board() {
  const { posts: allPosts, move, select, activeSpace } = usePlanner()
  const posts = activeSpace ? allPosts.filter(post => post.project === activeSpace) : allPosts
  const [drag, setDrag] = useState<string | null>(null)
  return <section className="workspace"><ViewHeading title="Tablero de contenido" subtitle="Mueve cada idea hasta convertirla en una publicación." />
    <div className="board">{stages.map(status => <div className="board-column" key={status} onDragOver={e => e.preventDefault()} onDrop={() => { if (drag) move(drag, status); setDrag(null) }}><header><span style={{ background: statusMeta[status].color }} /><strong>{statusMeta[status].label}</strong><em>{posts.filter(p => p.status === status).length}</em></header><div className="board-stack">{posts.filter(p => p.status === status).map(post => <article draggable onDragStart={() => setDrag(post.id)} key={post.id} onClick={() => select(post.id)}><div>{post.platforms.map(p => <PlatformMark key={p} platform={p} small />)}<span>{contentLabels[post.contentType]}</span></div><h3>{post.title}</h3><p>{post.caption}</p>{post.scheduledAt && <small><CalendarDays size={12} />{format(parseISO(post.scheduledAt), 'd MMM · HH:mm', { locale: es })}</small>}</article>)}</div></div>)}</div>
  </section>
}

export function LibraryView() {
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [mode, setMode] = useState<'copy' | 'reference'>('copy')
  useEffect(() => { void window.planner.media.list().then(setAssets) }, [])
  const add = async () => {
    const imported = await window.planner.media.choose(mode)
    setAssets(current => [...imported, ...current.filter(item => !imported.some(next => next.id === item.id))])
  }
  return <section className="workspace"><ViewHeading title="Biblioteca multimedia" subtitle="Tus archivos permanecen en este equipo."><div className="segmented"><button className={mode === 'copy' ? 'active' : ''} onClick={() => setMode('copy')}>Copiar a biblioteca</button><button className={mode === 'reference' ? 'active' : ''} onClick={() => setMode('reference')}>Referenciar original</button></div><button className="new-button" onClick={add}><Plus size={17} /> Añadir archivos</button></ViewHeading>
    {assets.length ? <div className="asset-grid">{assets.map(a => <article key={a.id}><div className="asset-preview"><FileImage size={34} /></div><strong>{a.name}</strong><span>{a.kind === 'image' ? 'Imagen' : a.kind === 'video' ? 'Vídeo' : 'Documento'}</span><small>{(a.size / 1024 / 1024).toFixed(1)} MB · {a.mode === 'copy' ? 'En biblioteca' : 'Referenciado'}</small><button onClick={() => window.planner.media.reveal(a.id)}><FolderOpen size={14} /> Abrir ubicación</button></article>)}</div> : <div className="empty-library"><div><FileImage size={32} /></div><h3>Tu biblioteca está lista</h3><p>Añade imágenes, vídeos o documentos desde tu equipo. Podrás vincularlos a cada publicación desde el editor.</p><button className="new-button" onClick={add}><Plus size={17} /> Elegir archivos</button></div>}
  </section>
}

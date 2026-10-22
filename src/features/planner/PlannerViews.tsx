import { useEffect, useRef, useState } from 'react'
import {
  addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format,
  isSameDay, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, FileImage, FileText, Film, FolderOpen, GripVertical, MoreHorizontal, Plus } from 'lucide-react'
import { contentLabels, stages, statusMeta } from '../../shared/constants'
import { PlatformMark, ViewHeading } from '../../components/layout/AppShell'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { postMatchesQuery, usePlanner } from '../../app/store'
import { useSelection } from '../../app/useSelection'
import type { MediaAsset, Post } from '../../shared/types'
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
  const { posts: allPosts, move, select, activeSpace, query, setQuery } = usePlanner()
  const posts = (activeSpace ? allPosts.filter(post => post.project === activeSpace) : allPosts).filter(post => postMatchesQuery(post, query))
  const [visiblePerColumn, setVisiblePerColumn] = useState(30)
  const { selected, toggle, set, clear } = useSelection()
  const dragIds = useRef<string[]>([])
  const [armed, setArmed] = useState<string | null>(null)
  const visibleBoardPosts = posts.filter(post => post.status !== 'archived')
  useEffect(() => { clear() }, [query, activeSpace, clear])
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') clear() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [clear])
  const bulkMove = (status: Post['status']) => runWithErrorReporting(async () => {
    for (const id of selected) if (allPosts.some(item => item.id === id)) await move(id, status)
    clear()
  }, 'No se pudieron actualizar las publicaciones seleccionadas')
  const moveDragged = (status: Post['status']) => runWithErrorReporting(async () => { const ids = dragIds.current; dragIds.current = []; for (const id of ids) await move(id, status); clear() }, 'No se pudieron mover las publicaciones')
  const archivedCount = posts.filter(post => post.status === 'archived').length
  return <section className="workspace"><ViewHeading title="Tablero de contenido" subtitle="Organiza tus publicaciones por etapa y avanza cada una hasta su publicación."><button className="settings-button" type="button" onClick={() => setVisiblePerColumn(current => current === 30 ? Number.MAX_SAFE_INTEGER : 30)}>{visiblePerColumn === 30 ? 'Ver más tarjetas' : 'Compactar columnas'}</button></ViewHeading>
    {selected.size > 0 && <div className="board-bulk-actions"><strong>{selected.size} seleccionadas</strong><button type="button" onClick={() => void bulkMove('draft')}>Borrador</button><button type="button" onClick={() => void bulkMove('review')}>Revisión</button><button type="button" onClick={() => void bulkMove('approved')}>Aprobadas</button><button type="button" onClick={() => void bulkMove('archived')}>Archivar</button><button type="button" onClick={clear}>Cancelar</button></div>}
    {archivedCount > 0 && <p className="board-archive-note">{archivedCount} publicaciones archivadas no se muestran en el tablero.</p>}
    {!visibleBoardPosts.length && <div className="planner-empty-inline board-empty" role="status"><strong>{query.trim() && posts.length === 0 ? 'No hay publicaciones que coincidan con la búsqueda' : archivedCount ? 'Todas las publicaciones de este espacio están archivadas' : 'Este espacio aún no tiene publicaciones'}</strong><span>{query.trim() && posts.length === 0 ? 'Limpia la búsqueda para volver a ver el tablero.' : 'Crea una publicación o convierte una idea para empezar.'}</span>{query.trim() && posts.length === 0 && <button type="button" className="settings-button" onClick={() => setQuery('')}>Limpiar búsqueda</button>}</div>}
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

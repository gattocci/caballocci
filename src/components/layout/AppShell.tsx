import { useMemo, useState } from 'react'
import { CalendarDays, Check, Clock3, Columns3, Library, Menu, MoreHorizontal, Plus, Search, Settings, X } from 'lucide-react'
import { usePlanner } from '../../app/store'
import { platformMeta } from '../../shared/constants'
import type { Platform } from '../../shared/types'
import './app-shell.css'

export function PlatformMark({ platform, small = false }: { platform: Platform; small?: boolean }) {
  return <span className={'platform-mark ' + platform + (small ? ' small' : '')}>{platformMeta[platform].mark}</span>
}

export function Sidebar() {
  const { view, setView, posts, activeSpace, customSpaces, setActiveSpace, addSpace } = usePlanner()
  const [menuOpen, setMenuOpen] = useState(false)
  const [creatingSpace, setCreatingSpace] = useState(false)
  const [spaceName, setSpaceName] = useState('')
  const spaces = useMemo(() => Array.from(new Set(['Campaña Aurora', ...customSpaces, ...posts.map(post => post.project).filter(project => project && project !== 'Mi contenido')])), [customSpaces, posts])
  const nav = [
    { id: 'timeline', label: 'Línea de tiempo', icon: Clock3 },
    { id: 'calendar', label: 'Calendario', icon: CalendarDays },
    { id: 'board', label: 'Tablero', icon: Columns3 },
    { id: 'library', label: 'Biblioteca', icon: Library },
  ] as const
  return <aside className="sidebar">
    <div className="brand"><div className="brand-symbol"><span /><span /><span /></div><div><strong>caballo</strong><b>cci</b></div></div>
    <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span>{id === 'timeline' && <em>{posts.filter(p => p.status === 'scheduled').length}</em>}</button>)}</nav>
    <div className="side-section"><p>ESPACIOS</p><div className="space-row"><button className={'space ' + (activeSpace === null ? 'active' : '')} onClick={() => setActiveSpace(null)}><span className="space-dot coral">C</span><span>Mi contenido</span></button><button className="space-menu-button" aria-label="Opciones de Mi contenido" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}><MoreHorizontal size={16} /></button>{menuOpen && <div className="space-menu"><button onClick={() => { setActiveSpace(null); setMenuOpen(false) }}><Check size={14} /> Mostrar todo</button><button onClick={() => { setCreatingSpace(true); setMenuOpen(false) }}><Plus size={14} /> Nuevo espacio</button></div>}</div>{spaces.map((space, index) => <button key={space} className={'space ' + (activeSpace === space ? 'active' : '')} onClick={() => setActiveSpace(space)}><span className={'space-dot ' + (index % 2 ? 'coral' : 'mint')}>{space.slice(0, 1).toUpperCase()}</span><span>{space}</span></button>)}<button className="add-space" onClick={() => setCreatingSpace(true)}><Plus size={15} /> Nuevo espacio</button></div>
    <div className="sidebar-bottom"><div className="offline"><span /><div><strong>Todo guardado</strong><small>Modo local</small></div></div><button className={view === 'about' ? 'active' : ''} title="Acerca de y actualizaciones" onClick={() => setView('about')}><Settings size={18} /></button></div>
    {creatingSpace && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCreatingSpace(false) }}><form className="space-dialog" onSubmit={event => { event.preventDefault(); if (spaceName.trim()) { addSpace(spaceName); setSpaceName(''); setCreatingSpace(false) } }}><header><div><span>NUEVO ESPACIO</span><h2>Organiza una campaña</h2></div><button type="button" className="icon-button" onClick={() => setCreatingSpace(false)}><X size={18} /></button></header><label>Nombre<input autoFocus value={spaceName} onChange={event => setSpaceName(event.target.value)} placeholder="Ej. Lanzamiento de verano" /></label><footer><button type="button" className="ghost-button" onClick={() => setCreatingSpace(false)}>Cancelar</button><button className="save-button" disabled={!spaceName.trim()}>Crear espacio</button></footer></form></div>}
  </aside>
}

export function Topbar({ onNew }: { onNew: () => void }) {
  const { query, setQuery } = usePlanner()
  return <header className="topbar"><div className="search"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar publicaciones, etiquetas, campañas..." /><kbd>Ctrl K</kbd></div><div className="top-actions"><button className="icon-button" title="Menú"><Menu size={18} /></button><button className="new-button" onClick={onNew}><Plus size={17} /> Nueva publicación</button><div className="avatar">CG</div></div></header>
}

export function ViewHeading({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return <div className="view-heading"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="view-tools">{children}</div></div>
}

import { useMemo, useState } from 'react'
import { CalendarDays, Clock3, Columns3, Library, Menu, MoreHorizontal, Plus, Search, Settings, Trash2, X } from 'lucide-react'
import { usePlanner } from '../../app/store'
import { platformMeta } from '../../shared/constants'
import type { Platform } from '../../shared/types'
import './app-shell.css'

export function PlatformMark({ platform, small = false }: { platform: Platform; small?: boolean }) {
  return <span className={'platform-mark ' + platform + (small ? ' small' : '')}>{platformMeta[platform].mark}</span>
}

export function Sidebar() {
  const { view, setView, posts, activeSpace, customSpaces, hiddenSpaces, setActiveSpace, addSpace, removeSpace } = usePlanner()
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [creatingSpace, setCreatingSpace] = useState(false)
  const [spaceName, setSpaceName] = useState('')
  const spaces = useMemo(() => Array.from(new Set(['Campaña Aurora', ...customSpaces, ...posts.map(post => post.project).filter(project => project && project !== 'Mi contenido')])).filter(space => !hiddenSpaces.includes(space)), [customSpaces, hiddenSpaces, posts])
  const nav = [
    { id: 'timeline', label: 'Línea de tiempo', icon: Clock3 },
    { id: 'calendar', label: 'Calendario', icon: CalendarDays },
    { id: 'board', label: 'Tablero', icon: Columns3 },
    { id: 'library', label: 'Biblioteca', icon: Library },
  ] as const
  return <aside className="sidebar">
    <div className="brand"><div className="brand-symbol"><span /><span /><span /></div><div><strong>caballo</strong><b>cci</b></div></div>
    <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span>{id === 'timeline' && <em>{posts.filter(p => p.status === 'scheduled').length}</em>}</button>)}</nav>
    <div className="side-section"><p>ESPACIOS</p><button className={'space ' + (activeSpace === null ? 'active' : '')} onClick={() => setActiveSpace(null)}><span className="space-dot coral">C</span><span>Todos los contenidos</span></button>{spaces.map((space, index) => <div className="space-row" key={space}><button className={'space ' + (activeSpace === space ? 'active' : '')} onClick={() => setActiveSpace(space)}><span className={'space-dot ' + (index % 2 ? 'coral' : 'mint')}>{space.slice(0, 1).toUpperCase()}</span><span>{space}</span></button><button className="space-menu-button" aria-label={'Opciones de ' + space} aria-expanded={menuOpen === space} onClick={() => setMenuOpen(menuOpen === space ? null : space)}><MoreHorizontal size={16} /></button>{menuOpen === space && <div className="space-menu"><button className="danger-menu-item" onClick={() => { removeSpace(space); setMenuOpen(null) }}><Trash2 size={14} /> Quitar espacio</button><small>Las publicaciones se conservan.</small></div>}</div>)}<button className="add-space" onClick={() => setCreatingSpace(true)}><Plus size={15} /> Nuevo espacio</button></div>
    <div className="sidebar-bottom"><div className="offline"><span /><div><strong>Todo guardado</strong><small>Modo local</small></div></div><button className={view === 'about' ? 'active' : ''} title="Acerca de y actualizaciones" onClick={() => setView('about')}><Settings size={18} /></button></div>
    {creatingSpace && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCreatingSpace(false) }}><form className="space-dialog" onSubmit={event => { event.preventDefault(); if (spaceName.trim()) { addSpace(spaceName); setSpaceName(''); setCreatingSpace(false) } }}><header><div><span>NUEVO ESPACIO</span><h2>Organiza una campaña</h2></div><button type="button" className="icon-button" onClick={() => setCreatingSpace(false)}><X size={18} /></button></header><label>Nombre<input autoFocus value={spaceName} onChange={event => setSpaceName(event.target.value)} placeholder="Ej. Lanzamiento de verano" /></label><footer><button type="button" className="ghost-button" onClick={() => setCreatingSpace(false)}>Cancelar</button><button className="save-button" disabled={!spaceName.trim()}>Crear espacio</button></footer></form></div>}
  </aside>
}

export function Topbar({ onNew }: { onNew: () => void }) {
  const { query, setQuery, setView } = usePlanner()
  const [open, setOpen] = useState(false)
  const go = (view: 'timeline' | 'calendar' | 'board' | 'library' | 'about') => { setView(view); setOpen(false) }
  return <header className="topbar"><div className="search"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar publicaciones, etiquetas, campañas..." /><kbd>Ctrl K</kbd></div><div className="top-actions"><div className="app-menu-wrap"><button className="icon-button" title="Abrir menú" aria-expanded={open} onClick={() => setOpen(value => !value)}><Menu size={18} /></button>{open && <div className="app-menu"><button onClick={() => go('timeline')}><Clock3 size={15} /> Línea de tiempo</button><button onClick={() => go('calendar')}><CalendarDays size={15} /> Calendario</button><button onClick={() => go('board')}><Columns3 size={15} /> Tablero</button><button onClick={() => go('library')}><Library size={15} /> Biblioteca</button><hr /><button onClick={() => go('about')}><Settings size={15} /> Acerca de y actualizaciones</button></div>}</div><button className="new-button" onClick={onNew}><Plus size={17} /> Nueva publicación</button><div className="avatar">CG</div></div></header>
}

export function ViewHeading({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return <div className="view-heading"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="view-tools">{children}</div></div>
}

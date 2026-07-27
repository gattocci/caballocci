import { CalendarDays, Clock3, Columns3, Library, Menu, MoreHorizontal, Plus, Search, Settings } from 'lucide-react'
import { usePlanner } from '../../app/store'
import { platformMeta } from '../../shared/constants'
import type { Platform } from '../../shared/types'

export function PlatformMark({ platform, small = false }: { platform: Platform; small?: boolean }) {
  return <span className={'platform-mark ' + platform + (small ? ' small' : '')}>{platformMeta[platform].mark}</span>
}

export function Sidebar() {
  const { view, setView, posts } = usePlanner()
  const nav = [
    { id: 'timeline', label: 'Línea de tiempo', icon: Clock3 },
    { id: 'calendar', label: 'Calendario', icon: CalendarDays },
    { id: 'board', label: 'Tablero', icon: Columns3 },
    { id: 'library', label: 'Biblioteca', icon: Library },
  ] as const
  return <aside className="sidebar">
    <div className="brand"><div className="brand-symbol"><span /><span /><span /></div><div><strong>caballo</strong><b>cci</b></div></div>
    <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span>{id === 'timeline' && <em>{posts.filter(p => p.status === 'scheduled').length}</em>}</button>)}</nav>
    <div className="side-section"><p>ESPACIOS</p><button className="space active"><span className="space-dot coral">C</span><span>Mi contenido</span><MoreHorizontal size={16} /></button><button className="space"><span className="space-dot mint">A</span><span>Campaña Aurora</span></button><button className="add-space"><Plus size={15} /> Nuevo espacio</button></div>
    <div className="sidebar-bottom"><div className="offline"><span /><div><strong>Todo guardado</strong><small>Modo local</small></div></div><button title="Ajustes"><Settings size={18} /></button></div>
  </aside>
}

export function Topbar({ onNew }: { onNew: () => void }) {
  const { query, setQuery } = usePlanner()
  return <header className="topbar"><div className="search"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar publicaciones, etiquetas, campañas..." /><kbd>Ctrl K</kbd></div><div className="top-actions"><button className="icon-button" title="Menú"><Menu size={18} /></button><button className="new-button" onClick={onNew}><Plus size={17} /> Nueva publicación</button><div className="avatar">CG</div></div></header>
}

export function ViewHeading({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return <div className="view-heading"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="view-tools">{children}</div></div>
}

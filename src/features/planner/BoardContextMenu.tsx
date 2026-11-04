import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Archive, CalendarDays, ChevronDown, ChevronRight, Eraser } from 'lucide-react'
import { contentLabels } from '../../shared/constants'
import type { ContentType } from '../../shared/types'

export function BoardContextMenu({ x, y, label, children }: { x: number; y: number; label: string; children: ReactNode }) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return

    const positionMenu = () => {
      const { width, height } = menu.getBoundingClientRect()
      setPosition({
        left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
      })
    }

    const observer = new ResizeObserver(positionMenu)
    observer.observe(menu)
    window.addEventListener('resize', positionMenu)
    positionMenu()

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', positionMenu)
    }
  }, [x, y])

  return createPortal(<div
    ref={menuRef}
    className="board-context-menu"
    role="menu"
    aria-label={label}
    style={{ left: position?.left ?? x, top: position?.top ?? y, visibility: position ? 'visible' : 'hidden' }}
    onPointerDown={event => event.stopPropagation()}
  >{children}</div>, document.body)
}

export function BoardContextSelectionActions({ count, canArchive, hasScheduledPosts, scheduleAt, scheduleWarning, onArchive, onScheduleAtChange, onSchedule, onClearSchedule, onFormat }: {
  count: number
  canArchive: boolean
  hasScheduledPosts: boolean
  scheduleAt: string
  scheduleWarning: string
  onArchive(): void
  onScheduleAtChange(value: string): void
  onSchedule(): void
  onClearSchedule(): void
  onFormat(contentType: ContentType): void
}) {
  const [showFormats, setShowFormats] = useState(false)

  return <>
    {count > 1 && <div className="board-context-selection-note">{count} publicaciones seleccionadas</div>}
    <button type="button" role="menuitem" disabled={!canArchive} onClick={onArchive}><Archive size={14} />Archivar {count > 1 ? `selección (${count})` : 'publicación'}</button>
    <button type="button" role="menuitem" aria-expanded={showFormats} onClick={() => setShowFormats(value => !value)}>
      {showFormats ? <ChevronDown size={14} /> : <ChevronRight size={14} />}Cambiar formato…
    </button>
    {showFormats && <div className="board-context-statuses" role="group" aria-label="Cambiar formato">{(Object.keys(contentLabels) as ContentType[]).map(contentType =>
      <button type="button" role="menuitem" key={contentType} onClick={() => onFormat(contentType)}>{contentLabels[contentType]}</button>,
    )}</div>}
    <div className="board-context-schedule">
      <label>Fecha y hora<input type="datetime-local" value={scheduleAt} onChange={event => onScheduleAtChange(event.target.value)} /></label>
      <button type="button" role="menuitem" disabled={!scheduleAt} onClick={onSchedule}><CalendarDays size={14} />Programar {count > 1 ? 'selección' : 'publicación'}</button>
      {hasScheduledPosts && <button type="button" role="menuitem" onClick={onClearSchedule}><Eraser size={14} />Quitar fecha y hora</button>}
      {scheduleWarning && <span className="bulk-schedule-warning" role="alert">{scheduleWarning}</span>}
    </div>
  </>
}

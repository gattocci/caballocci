import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Smartphone } from 'lucide-react'
import { postColors } from '../../shared/postColors'
import type { Post } from '../../shared/types'

export type BoardCardDetailLevel = 'hidden' | 'discreet' | 'full'
export type MobilePublicationState = { configured: boolean; currentPostIds: string[]; previouslyExportedPostIds: string[] }

export function MobileCardStatus({ state, postId, detailLevel }: { state: MobilePublicationState | null; postId: string; detailLevel: BoardCardDetailLevel }) {
  if (detailLevel === 'hidden') return null
  if (!state || !state.configured) {
    if (detailLevel === 'discreet') return null
    return <span className="board-mobile-state unknown"><Smartphone size={11} /> {state ? 'Sin configurar' : 'Consultando'}</span>
  }
  const current = state.currentPostIds.includes(postId)
  const previous = !current && state.previouslyExportedPostIds.includes(postId)
  const label = current ? 'En catálogo móvil' : previous ? 'Exportada antes' : 'No exportada'
  const kind = current ? 'current' : previous ? 'previous' : 'never'
  const title = current
    ? 'Esta publicación tiene al menos un destino en el catálogo móvil.'
    : previous
      ? 'Se exportó al celular antes, pero ya no está en el catálogo actual.'
      : 'Esta publicación nunca se ha exportado al celular.'
  if (detailLevel === 'discreet') return <span className={`board-mobile-state ${kind} discreet`} title={title} aria-label={label}><Smartphone size={11} /></span>
  return <span className={`board-mobile-state ${kind}`} title={title}><Smartphone size={11} /> {label}</span>
}

export function BoardCardColorPicker({ post, onColor }: { post: Post; onColor(color: string): void }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionsRef = useRef<HTMLDivElement>(null)
  const defaultColor = postColors[0].value
  const close = () => { setOpen(false); setPosition(null) }
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && (triggerRef.current?.contains(target) || optionsRef.current?.contains(target))) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  const toggle = () => {
    if (open) { close(); return }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 145
    const height = 94
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
    const top = rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 5 : Math.max(8, rect.top - height - 5)
    setPosition({ top, left })
    setOpen(true)
  }
  return <div className="board-card-color-picker" onClick={event => event.stopPropagation()}>
    <button ref={triggerRef} type="button" className="board-card-color-trigger" aria-label="Cambiar color de tarjeta" aria-expanded={open} title="Color de tarjeta" style={{ backgroundColor: post.color }} onClick={toggle} />
    {open && position && createPortal(<div ref={optionsRef} className="board-card-color-options" role="group" aria-label="Colores de tarjeta" style={{ top: position.top, left: position.left }} onClick={event => event.stopPropagation()}>
      {postColors.map(color => <button type="button" key={color.value} aria-label={color.label} title={color.label} aria-pressed={post.color === color.value} style={{ backgroundColor: color.value }} onClick={() => { onColor(color.value); setOpen(false) }} />)}
      <button type="button" className="board-card-color-reset" aria-label="Usar color predeterminado" title="Color predeterminado" aria-pressed={post.color === defaultColor} onClick={() => { onColor(defaultColor); close() }}>Predeterminado</button>
    </div>, document.body)}
  </div>
}


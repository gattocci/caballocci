import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './area-selection.css'

type Point = { x: number; y: number }

/** Píxeles que hay que mover antes de que un click se convierta en selección por área. */
const DRAG_THRESHOLD = 4
/** Franja (px) junto al borde del contenedor donde se activa el autoscroll. */
const EDGE = 56
/** Velocidad máxima de autoscroll en px por frame. */
const MAX_SCROLL_SPEED = 24

/** Elementos sobre los que NO se inicia una selección por área. */
const BLOCKING = 'button,input,select,textarea,a,[contenteditable="true"],.board-status-heading,.board-lane-band'

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(id => b.has(id))

function ancestorsOf(element: HTMLElement) {
  const nodes: HTMLElement[] = []
  for (let node: HTMLElement | null = element; node; node = node.parentElement) nodes.push(node)
  return nodes
}

/** Suma del scroll de toda la cadena de ancestros: sirve para anclar el rectángulo al contenido. */
function scrollTotal(nodes: HTMLElement[]): Point {
  let x = 0, y = 0
  for (const node of nodes) { x += node.scrollLeft; y += node.scrollTop }
  return { x, y }
}

/** Primer ancestro que realmente puede scrollear en ese eje (o la página). */
function findScroller(nodes: HTMLElement[], axis: 'x' | 'y'): HTMLElement | null {
  const overflows = (node: HTMLElement) => axis === 'x' ? node.scrollWidth > node.clientWidth : node.scrollHeight > node.clientHeight
  for (const node of nodes) {
    if (node === document.documentElement || node === document.body) {
      const root = document.scrollingElement as HTMLElement | null
      if (root && overflows(root)) return root
      continue
    }
    const style = getComputedStyle(node)
    if (/(auto|scroll|overlay)/.test(axis === 'x' ? style.overflowX : style.overflowY) && overflows(node)) return node
  }
  return null
}

function scrollerBounds(scroller: HTMLElement) {
  if (scroller === document.scrollingElement) return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  return scroller.getBoundingClientRect()
}

/** Velocidad de scroll según qué tan cerca del borde está el puntero (0 si está lejos). */
function edgeSpeed(position: number, min: number, max: number) {
  let speed = 0
  if (position < min + EDGE) speed = -MAX_SCROLL_SPEED * Math.min(1, (min + EDGE - position) / EDGE)
  else if (position > max - EDGE) speed = MAX_SCROLL_SPEED * Math.min(1, (position - (max - EDGE)) / EDGE)
  return Math.sign(speed) * Math.ceil(Math.abs(speed))
}

/**
 * Agrega selección por área (rectángulo elástico) a una superficie cuyos elementos seleccionables
 * exponen `data-area-select-id`.
 *
 * - Se inicia arrastrando sobre un espacio vacío (o sobre filas si `startOnItems`).
 * - Shift / Ctrl / Cmd suman a la selección existente.
 * - Esc cancela y devuelve la selección previa.
 * - Hace autoscroll al acercarse a los bordes y mantiene el rectángulo anclado al contenido.
 */
export function AreaSelectionSurface({ children, selected, setSelected, className = '', startOnItems = false, disabled = false }: {
  children: ReactNode
  selected: Set<string>
  setSelected(ids: string[]): void
  className?: string
  /** Permite iniciar el arrastre sobre los propios elementos (útil en listas, donde no hay drag & drop). */
  startOnItems?: boolean
  /** Desactiva la selección (por ejemplo cuando la lista misma depende de la selección). */
  disabled?: boolean
}) {
  const surface = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const teardownRef = useRef<(() => void) | null>(null)
  // Siempre apunta a los últimos valores, así los listeners de window no quedan con datos viejos.
  const latest = useRef({ selected, setSelected })
  latest.current = { selected, setSelected }
  const [active, setActive] = useState(false)

  // Si el componente se desmonta a mitad de un arrastre, limpiamos listeners y la clase del body.
  useEffect(() => () => teardownRef.current?.(), [])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = surface.current
    if (disabled || !element || event.button !== 0 || event.pointerType === 'touch') return
    const target = event.target as HTMLElement
    const startedOnItem = Boolean(target.closest('[data-area-select-id]'))
    if (target.closest(BLOCKING) || (startedOnItem && !startOnItems)) return

    teardownRef.current?.()

    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    const initial = new Set(latest.current.selected)
    const base = additive ? new Set(initial) : new Set<string>()
    const origin: Point = { x: event.clientX, y: event.clientY }
    const chain = ancestorsOf(element)
    const scrollAtStart = scrollTotal(chain)

    let pointer: Point = origin
    let activated = false
    let frame = 0
    let lastSignature = ''
    let emitted: Set<string> | null = null
    let items: HTMLElement[] = []
    let scrollerX: HTMLElement | null = null
    let scrollerY: HTMLElement | null = null

    const update = () => {
      const box = boxRef.current
      if (!box) return
      const now = scrollTotal(chain)
      const signature = `${pointer.x}|${pointer.y}|${now.x}|${now.y}`
      if (signature === lastSignature) return
      lastSignature = signature

      // El punto de inicio "viaja" con el contenido cuando éste scrollea.
      const anchor = { x: origin.x - (now.x - scrollAtStart.x), y: origin.y - (now.y - scrollAtStart.y) }
      const left = Math.min(anchor.x, pointer.x), right = Math.max(anchor.x, pointer.x)
      const top = Math.min(anchor.y, pointer.y), bottom = Math.max(anchor.y, pointer.y)
      box.style.left = `${left}px`
      box.style.top = `${top}px`
      box.style.width = `${right - left}px`
      box.style.height = `${bottom - top}px`

      const hit = new Set(base)
      for (const item of items) {
        const rect = item.getBoundingClientRect()
        if (!rect.width && !rect.height) continue
        if (rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom) {
          const id = item.dataset.areaSelectId
          if (id) hit.add(id)
        }
      }
      // Solo avisamos cuando la selección realmente cambió: evita re-renders innecesarios.
      if (!sameSet(emitted ?? latest.current.selected, hit)) {
        emitted = hit
        latest.current.setSelected([...hit])
      }
    }

    const tick = () => {
      if (scrollerX) {
        const bounds = scrollerBounds(scrollerX)
        const delta = edgeSpeed(pointer.x, bounds.left, bounds.right)
        if (delta) scrollerX.scrollLeft += delta
      }
      if (scrollerY) {
        const bounds = scrollerBounds(scrollerY)
        const delta = edgeSpeed(pointer.y, bounds.top, bounds.bottom)
        if (delta) scrollerY.scrollTop += delta
      }
      update()
      frame = requestAnimationFrame(tick)
    }

    const activate = () => {
      activated = true
      items = [...element.querySelectorAll<HTMLElement>('[data-area-select-id]')]
      scrollerX = findScroller(chain, 'x')
      scrollerY = findScroller(chain, 'y')
      document.body.classList.add('area-selecting')
      window.getSelection()?.removeAllRanges()
      setActive(true)
      frame = requestAnimationFrame(tick)
    }

    const preventTextSelection = (e: Event) => e.preventDefault()
    const onMove = (e: PointerEvent) => {
      if (e.buttons === 0) { finish(false); return } // soltó el botón fuera de la ventana
      pointer = { x: e.clientX, y: e.clientY }
      if (!activated && Math.hypot(pointer.x - origin.x, pointer.y - origin.y) >= DRAG_THRESHOLD) activate()
    }
    const onUp = () => finish(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !activated) return
      // Capturamos Esc para que no llegue al listener global que limpia toda la selección.
      e.stopImmediatePropagation()
      e.preventDefault()
      finish(true)
    }
    const onBlur = () => finish(true)

    const teardown = () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onBlur)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('selectstart', preventTextSelection)
      document.body.classList.remove('area-selecting')
      teardownRef.current = null
      setActive(false)
    }

    const finish = (cancelled: boolean) => {
      const wasActivated = activated
      teardown()
      if (wasActivated) {
        if (cancelled) latest.current.setSelected([...initial])
        // Tras arrastrar, el navegador dispara un "click" sobre el elemento donde se soltó: lo descartamos.
        const swallow = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault() }
        window.addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', swallow, true), 0)
      } else if (!cancelled && !additive && !startedOnItem && latest.current.selected.size) {
        // Click simple sobre un espacio vacío: limpia la selección.
        latest.current.setSelected([])
      }
    }

    teardownRef.current = teardown
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onBlur)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('selectstart', preventTextSelection)
  }

  return <div ref={surface} className={`area-selection-surface ${className}`} onPointerDown={onPointerDown}>
    {children}
    {active && createPortal(<div ref={boxRef} className="area-selection-box" aria-hidden="true" />, document.body)}
  </div>
}
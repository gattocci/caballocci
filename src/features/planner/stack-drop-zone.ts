/**
 * Política de zonas de drop para el arrastre de publicaciones del tablero.
 *
 * Existe porque el feedback visual del DnD prometía más de lo que la hitbox cumplía:
 * las zonas estaban repartidas en tres handlers con criterios distintos y sin
 * exclusión mutua, así que mover, apilar, reordenar y desapilar se pisaban.
 * Acá vive una única decisión, pura y testeable, que el tablero traduce a
 * `dropEffect`, resalte y acción.
 *
 * Zonas (mutuamente excluyentes, de la más específica a la más general):
 * - `unstack` — franja del marco de la pila abierta: sacar el miembro arrastrado.
 * - `self`    — el destino es una de las tarjetas arrastradas: no hay acción.
 * - `insert`  — sobre una fila de la pila abierta: reordenar antes/después.
 * - `stack`   — tarjeta suelta o fondo de la pila abierta: apilar/añadir al final.
 * - `move`    — fuera de la superficie: lo resuelve el handler de la celda.
 */

/** Ancho (px) del marco de desapilado dibujado dentro de la pila expandida.
 *  Debe coincidir con `--stack-unstack-frame` en `board-stacks.css`. */
export const STACK_UNSTACK_FRAME = 16

export type StackDropZone =
  | { kind: 'stack'; targetId: string; stackId: string | null }
  | { kind: 'insert'; stackId: string; targetId: string; before: boolean }
  | { kind: 'unstack'; stackId: string }
  | { kind: 'move' }
  | { kind: 'self' }

/** Zonas que el tablero recuerda para pintar el destino antes de soltar. */
export type StackDropHover = { kind: 'stack'; targetId: string; stackId: string | null } | { kind: 'insert'; stackId: string; targetId: string; before: boolean } | { kind: 'unstack'; stackId: string }

/** Geometría mínima del rectángulo de drop: evita depender del DOM en los tests. */
export type DropRect = { top: number; bottom: number; left: number; right: number; width: number; height: number }

export type ResolveStackDropInput = {
  /** Superficie de decisión: la tarjeta suelta o el contenedor de la pila abierta. */
  rect: DropRect
  /** Fila concreta bajo el puntero, cuando la superficie es una pila abierta. */
  memberRect?: DropRect | null
  pointerX: number
  pointerY: number
  /** Ids que se están arrastrando: se excluyen de cualquier destino de apilado. */
  draggedIds: readonly string[]
  /** Id de la tarjeta (suelta o miembro) sobre la que cae el puntero. */
  targetId: string
  /** Pila cuyo marco se está evaluando. `null` cuando la pila no admite desapilado. */
  targetStackId?: string | null
  /** Ancho del marco de desapilado; por defecto `STACK_UNSTACK_FRAME`. */
  frameWidth?: number
}

const inside = (rect: DropRect, x: number, y: number) =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom

/**
 * Decide qué significa soltar en un punto, sobre un destino concreto.
 *
 * El orden importa: primero la superficie (fuera del rect no hay zona propia),
 * después el marco de desapilado —que debe ganar siempre, incluso sobre la fila
 * de un miembro— y recién al final la exclusión del origen y la geometría fina.
 */
export function resolveStackDropZone(input: ResolveStackDropInput): StackDropZone {
  const { rect, memberRect, pointerX, pointerY, draggedIds, targetId, targetStackId, frameWidth = STACK_UNSTACK_FRAME } = input

  // Fuera de la superficie no hay zona: el navegador decide (típicamente, mover).
  if (!inside(rect, pointerX, pointerY)) return { kind: 'move' }

  if (targetStackId) {
    // Dentro de una pila abierta, el marco exterior es la zona de desapilado.
    // Se evalúa antes que la fila para que la franja del borde siempre gane.
    const inFrame =
      pointerX <= rect.left + frameWidth || pointerX >= rect.right - frameWidth ||
      pointerY <= rect.top + frameWidth || pointerY >= rect.bottom - frameWidth
    if (inFrame) return { kind: 'unstack', stackId: targetStackId }

    // Fondo, encabezado o hueco entre filas: añadir al final de la pila.
    if (!memberRect) return { kind: 'stack', targetId, stackId: targetStackId }

    // Arrastrar un miembro sobre sí misma no reordena ni apila: era un no-op silencioso.
    if (draggedIds.includes(targetId)) return { kind: 'self' }

    // Mitad superior/inferior de la fila: reordenar dentro de la pila.
    return { kind: 'insert', stackId: targetStackId, targetId, before: pointerY < memberRect.top + memberRect.height / 2 }
  }

  // Arrastrar una tarjeta sobre sí misma nunca apila: el feedback de "Apilar"
  // era engañoso y la operación terminaba sin efecto.
  if (draggedIds.includes(targetId)) return { kind: 'self' }

  // Tarjeta suelta: toda su superficie apila (es la única acción posible sobre ella).
  return { kind: 'stack', targetId, stackId: null }
}

/**
 * Reordena los ids de una pila moviendo `draggedId` antes/después de `targetId`.
 * Devuelve una copia; si alguno no pertenece a la pila, el orden queda intacto.
 */
export function reorderStackIds(memberIds: readonly string[], draggedId: string, targetId: string, before: boolean): string[] {
  const ordered = [...memberIds]
  if (draggedId === targetId) return ordered
  const from = ordered.indexOf(draggedId)
  if (from < 0) return ordered
  ordered.splice(from, 1)
  const target = ordered.indexOf(targetId)
  if (target < 0) return [...memberIds]
  ordered.splice(before ? target : target + 1, 0, draggedId)
  return ordered
}

export type StackIntentModifiers = { altKey?: boolean; shiftKey?: boolean }

export function resolveCollapsedCardStackIntent(rect: DropRect, pointerY: number, modifiers: StackIntentModifiers = {}): 'stack' | 'move' {
  if (modifiers.altKey || modifiers.shiftKey) return 'stack'
  const band = Math.min(24, rect.height / 4)
  if (pointerY < rect.top + band || pointerY > rect.bottom - band) return 'move'
  return 'stack'
}

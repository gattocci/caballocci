import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveStackDropZone, resolveCollapsedCardStackIntent, reorderStackIds, type DropRect } from '../../../src/features/planner/stack-drop-zone.ts'

const rect = (top: number, left: number, width: number, height: number): DropRect => ({
  top, left, right: left + width, bottom: top + height, width, height,
})

/** Tarjeta suelta de 200×124 en (200, 100). */
const card = rect(100, 200, 200, 124)
/** Pila abierta de 300×400 con dos filas de 40 px dentro del marco de 12 px. */
const stack = rect(0, 0, 300, 400)
const row1 = rect(12, 12, 276, 40)
const row2 = rect(56, 12, 276, 40)

test('una tarjeta suelta apila en todo su cuerpo y nunca sobre sí misma', () => {
  assert.deepEqual(
    resolveStackDropZone({ rect: card, pointerX: 300, pointerY: 160, draggedIds: ['a'], targetId: 'b' }),
    { kind: 'stack', targetId: 'b', stackId: null },
  )
  assert.deepEqual(
    resolveStackDropZone({ rect: card, pointerX: 300, pointerY: 160, draggedIds: ['b'], targetId: 'b' }),
    { kind: 'self' },
  )
  // Los ids arrastrados se excluyen aunque vengan varios (selección múltiple).
  assert.deepEqual(
    resolveStackDropZone({ rect: card, pointerX: 300, pointerY: 160, draggedIds: ['a', 'b'], targetId: 'b' }),
    { kind: 'self' },
  )
})

test('fuera de la superficie la zona es move: la decide el handler de la celda', () => {
  assert.deepEqual(
    resolveStackDropZone({ rect: card, pointerX: 100, pointerY: 160, draggedIds: ['a'], targetId: 'b' }),
    { kind: 'move' },
  )
  assert.deepEqual(
    resolveStackDropZone({ rect: card, pointerX: 300, pointerY: 300, draggedIds: ['a'], targetId: 'b' }),
    { kind: 'move' },
  )
})

test('dentro de la pila abierta la mitad de la fila decide antes o después', () => {
  assert.deepEqual(
    resolveStackDropZone({ rect: stack, memberRect: row1, pointerX: 150, pointerY: 20, draggedIds: ['x'], targetId: 'a', targetStackId: 's1' }),
    { kind: 'insert', stackId: 's1', targetId: 'a', before: true },
  )
  assert.deepEqual(
    resolveStackDropZone({ rect: stack, memberRect: row1, pointerX: 150, pointerY: 45, draggedIds: ['x'], targetId: 'a', targetStackId: 's1' }),
    { kind: 'insert', stackId: 's1', targetId: 'a', before: false },
  )
  // Filas altas: el punto medio sale del rect de la fila, no de una altura fija.
  const tall = rect(12, 12, 276, 90)
  assert.equal(resolveStackDropZone({ rect: stack, memberRect: tall, pointerX: 150, pointerY: 12 + 44, draggedIds: ['x'], targetId: 'a', targetStackId: 's1' }).kind, 'insert')
  assert.equal((resolveStackDropZone({ rect: stack, memberRect: tall, pointerX: 150, pointerY: 12 + 46, draggedIds: ['x'], targetId: 'a', targetStackId: 's1' }) as { before: boolean }).before, false)
})

test('el marco exterior siempre gana: es la salida para desapilar', () => {
  // Borde izquierdo, derecho, superior e inferior: los cuatro lados del marco.
  for (const [x, y] of [[4, 200], [296, 200], [150, 4], [150, 396]]) {
    assert.deepEqual(
      resolveStackDropZone({ rect: stack, memberRect: row1, pointerX: x, pointerY: y, draggedIds: ['a'], targetId: 'a', targetStackId: 's1' }),
      { kind: 'unstack', stackId: 's1' },
    )
  }
  // El ancho del marco es configurable y no depende de los huecos entre filas.
  assert.equal(resolveStackDropZone({ rect: stack, pointerX: 8, pointerY: 200, draggedIds: ['a'], targetId: 'a', targetStackId: 's1', frameWidth: 4 }).kind, 'stack')
  assert.equal(resolveStackDropZone({ rect: stack, pointerX: 8, pointerY: 200, draggedIds: ['a'], targetId: 'a', targetStackId: 's1', frameWidth: 12 }).kind, 'unstack')
})

test('fondo y encabezado de la pila añaden al final; la fila propia no hace nada', () => {
  assert.deepEqual(
    resolveStackDropZone({ rect: stack, pointerX: 150, pointerY: 200, draggedIds: ['x'], targetId: 'a', targetStackId: 's1' }),
    { kind: 'stack', targetId: 'a', stackId: 's1' },
  )
  assert.deepEqual(
    resolveStackDropZone({ rect: stack, memberRect: row2, pointerX: 150, pointerY: 70, draggedIds: ['a'], targetId: 'a', targetStackId: 's1' }),
    { kind: 'self' },
  )
})

test('sin habilitar el desapilado, los bordes de la pila solo apilan', () => {
  // `targetStackId: null` = arrastre ajeno a la pila: no se ofrece "sacar de la pila".
  assert.deepEqual(
    resolveStackDropZone({ rect: stack, pointerX: 4, pointerY: 200, draggedIds: ['x'], targetId: 'a' }),
    { kind: 'stack', targetId: 'a', stackId: null },
  )
})

test('reorderStackIds mueve el miembro antes o después del destino', () => {
  assert.deepEqual(reorderStackIds(['a', 'b', 'c'], 'a', 'c', false), ['b', 'c', 'a'])
  assert.deepEqual(reorderStackIds(['a', 'b', 'c'], 'c', 'a', true), ['c', 'a', 'b'])
  assert.deepEqual(reorderStackIds(['a', 'b', 'c'], 'b', 'c', true), ['a', 'b', 'c'])
  // Entradas inválidas dejan el orden original intacto.
  assert.deepEqual(reorderStackIds(['a', 'b', 'c'], 'z', 'a', true), ['a', 'b', 'c'])
  assert.deepEqual(reorderStackIds(['a', 'b', 'c'], 'a', 'z', true), ['a', 'b', 'c'])
})

test('zonifica tarjetas sueltas entre mover e intención de apilar', () => {
  const tallCard = rect(100, 200, 200, 160)
  assert.equal(resolveCollapsedCardStackIntent(tallCard, 110), 'move')
  assert.equal(resolveCollapsedCardStackIntent(tallCard, 180), 'stack')
  assert.equal(resolveCollapsedCardStackIntent(tallCard, 180, { altKey: true }), 'stack')
  assert.equal(resolveCollapsedCardStackIntent(tallCard, 110, { shiftKey: true }), 'stack')
})

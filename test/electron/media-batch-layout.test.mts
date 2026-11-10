import assert from 'node:assert/strict'
import test from 'node:test'
import { detectCsvBatchLayout, getCsvBatchIndexes, getCsvBatchTargetName } from '../../electron/integrations/media-batch-layout.ts'
import { inferredVisual } from '../../src/features/editor/editor-utils.ts'

test('detects a transposed CSV/image grid with fields in R and posts in C', () => {
  const codes = Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 22 }, (_, column) => ({ row: row + 2, column: column + 1 })),
  ).flat()

  const layout = detectCsvBatchLayout(codes, 22, 11)

  assert.equal(layout, 'posts-in-columns')
  assert.deepEqual(getCsvBatchIndexes({ row: 2, column: 1 }, layout), { recordIndex: 0, headerIndex: 0 })
  assert.deepEqual(getCsvBatchIndexes({ row: 9, column: 22 }, layout), { recordIndex: 21, headerIndex: 7 })
})

test('keeps the existing post-in-row coordinate convention when it fits', () => {
  const codes = [{ row: 1, column: 1 }, { row: 22, column: 11 }]
  const layout = detectCsvBatchLayout(codes, 22, 11)

  assert.equal(layout, 'posts-in-rows')
  assert.deepEqual(getCsvBatchIndexes({ row: 22, column: 11 }, layout), { recordIndex: 21, headerIndex: 10 })
})

test('preserves normal PNG names and routes confirmed filename conflicts to portada.png', () => {
  assert.deepEqual(getCsvBatchTargetName('R01-C01.png', false, false), { name: 'R01-C01.png', isCover: false })
  assert.deepEqual(getCsvBatchTargetName('R01-C01.png', true, false), { name: 'portada.png', isCover: true })
  assert.equal(getCsvBatchTargetName('R01-C01.png', true, true), null)
})

test('infers cover role and slide order from prefixed CSV coordinates, not aspect ratio', () => {
  const asset = (name: string) => ({ id: name, name, kind: 'image' as const, size: 1, mode: 'copy' as const })
  assert.deepEqual(inferredVisual(asset('portada.png')), { role: 'cover', sequence: 0 })
  assert.deepEqual(inferredVisual(asset('16_9 - R02-C03.png')), { role: 'slide', sequence: 1 })
  assert.deepEqual(inferredVisual(asset('16_9 - R03-C03.png')), { role: 'slide', sequence: 2 })
})

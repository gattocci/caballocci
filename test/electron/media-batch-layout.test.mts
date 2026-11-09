import assert from 'node:assert/strict'
import test from 'node:test'
import { detectCsvBatchLayout, getCsvBatchIndexes } from '../../electron/integrations/media-batch-layout.ts'

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

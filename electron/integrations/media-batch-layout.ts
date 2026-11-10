export type CsvBatchLayout = 'posts-in-rows' | 'posts-in-columns'

export interface CsvBatchCode {
  row: number
  column: number
}

export function detectCsvBatchLayout(codes: CsvBatchCode[], recordCount: number, headerCount: number): CsvBatchLayout {
  const postsInRows = codes.every(({ row, column }) => row >= 1 && row <= recordCount && column >= 1 && column <= headerCount)
  const postsInColumns = codes.every(({ row, column }) => row >= 2 && row - 2 < headerCount && column >= 1 && column <= recordCount)
  return !postsInRows && postsInColumns ? 'posts-in-columns' : 'posts-in-rows'
}

export function getCsvBatchIndexes(code: CsvBatchCode, layout: CsvBatchLayout) {
  return layout === 'posts-in-columns'
    ? { recordIndex: code.column - 1, headerIndex: code.row - 2 }
    : { recordIndex: code.row - 1, headerIndex: code.column - 1 }
}

export function getCsvBatchTargetName(sourceName: string, hasDestinationConflict: boolean, hasCoverConflict: boolean) {
  if (!hasDestinationConflict) return { name: sourceName, isCover: false }
  if (hasCoverConflict) return null
  return { name: 'portada.png', isCover: true }
}

import { createHash } from 'node:crypto'

export interface ExportColumn {
  header: string
  source: string
  order: number
}

export function toCsv(records: Record<string, unknown>[], columns: ExportColumn[]): string {
  const sorted = [...columns].sort((left, right) => left.order - right.order)
  const lines = [sorted.map(column => escapeCsv(column.header)).join(',')]
  for (const record of records) lines.push(sorted.map(column => escapeCsv(resolvePath(record, column.source))).join(','))
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}

export function hashExportRecord(record: Record<string, unknown>, columns: ExportColumn[]): string {
  const values = [...columns].sort((left, right) => left.order - right.order).map(column => resolvePath(record, column.source))
  return createHash('sha256').update(JSON.stringify(values)).digest('hex')
}

function resolvePath(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) => {
    if (typeof current !== 'object' || current === null || !(key in current)) return ''
    return (current as Record<string, unknown>)[key]
  }, record)
}

function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

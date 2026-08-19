import type { SourceFormat } from './types'

export interface ParsedPayload {
  records: Record<string, unknown>[]
  truncated: boolean
}

export function parsePayload(payload: string, format: SourceFormat, recordsPath: string | null, maxRecords = 500): ParsedPayload {
  if (!Number.isInteger(maxRecords) || maxRecords < 1) throw new Error('maxRecords debe ser un entero positivo')
  const value = format === 'json' ? parseJson(payload) : format === 'ndjson' ? parseNdjson(payload) : parseCsv(payload)
  const records: Record<string, unknown>[] = format === 'json' ? resolveJsonRecords(value, recordsPath) : value as Record<string, unknown>[]
  const limited = records.slice(0, maxRecords)
  return { records: limited, truncated: records.length > limited.length }
}

function parseJson(payload: string): unknown {
  try { return JSON.parse(payload) as unknown } catch { throw new Error('La respuesta no contiene JSON válido') }
}

function parseNdjson(payload: string): Record<string, unknown>[] {
  return payload.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
    try { return asRecord(JSON.parse(line) as unknown, `NDJSON línea ${index + 1}`) } catch (error) {
      throw new Error(`NDJSON inválido en línea ${index + 1}: ${error instanceof Error ? error.message : 'valor no válido'}`)
    }
  })
}

function resolveJsonRecords(value: unknown, recordsPath: string | null): Record<string, unknown>[] {
  const candidate = recordsPath ? getPath(value, recordsPath) : Array.isArray(value) ? value : findFirstArray(value)
  if (!Array.isArray(candidate)) throw new Error('No se encontró un array de registros en la respuesta')
  return candidate.map((item, index) => asRecord(item, `JSON registro ${index + 1}`))
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) => {
    if (typeof current !== 'object' || current === null || !(key in current)) return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

function findFirstArray(value: unknown): unknown[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  for (const candidate of Object.values(value as Record<string, unknown>)) if (Array.isArray(candidate)) return candidate
  return undefined
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} no es un objeto`)
  return value as Record<string, unknown>
}

function parseCsv(payload: string): Record<string, unknown>[] {
  const rows = tokenizeCsv(payload)
  if (rows.length === 0) return []
  const headers = rows[0].map((header, index) => header.trim() || `column_${index + 1}`)
  return rows.slice(1).filter(row => row.some(cell => cell.trim())).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
}

function tokenizeCsv(payload: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []; let cell = ''; let quoted = false
  for (let index = 0; index < payload.length; index += 1) {
    const char = payload[index]
    if (char === '"') {
      if (quoted && payload[index + 1] === '"') { cell += '"'; index += 1 } else quoted = !quoted
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && payload[index + 1] === '\n') index += 1
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += char
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  if (quoted) throw new Error('CSV inválido: comillas sin cerrar')
  return rows
}

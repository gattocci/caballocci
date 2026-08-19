import { createHash } from 'node:crypto'
import type { ExistingContentRecord, NormalizedRecord, ReconciliationItem, ReconciliationReport, SourceDefinitionConfig } from './types'

export function normalizeRecord(raw: Record<string, unknown>, definition: SourceDefinitionConfig): NormalizedRecord {
  const externalRef = valueAtPath(raw, definition.externalRef)
  const title = valueAtPath(raw, definition.title)
  const sourceKind = valueAtPath(raw, definition.sourceKindField)
  if (!externalRef) throw new Error('externalRef vacío')
  if (!title) throw new Error('title vacío')
  const sourceKindText = String(sourceKind || '')
  return {
    externalRef: String(externalRef), title: String(title), sourceKind: sourceKindText,
    contentType: definition.contentTypeMap[sourceKindText] || 'post', raw,
    enriched: { ...definition.customFieldDefaults },
  }
}

export function reconcile(records: Record<string, unknown>[], existing: ExistingContentRecord[], definition: SourceDefinitionConfig): ReconciliationReport {
  const existingByRef = new Map(existing.map(item => [item.externalRef, item]))
  const seen = new Set<string>()
  const items: ReconciliationItem[] = records.map(raw => {
    let normalized: NormalizedRecord
    try { normalized = normalizeRecord(raw, definition) } catch (error) {
      return { kind: 'invalid' as const, record: null, existing: null, contentHash: null, reason: error instanceof Error ? error.message : 'Registro inválido' }
    }
    if (seen.has(normalized.externalRef)) return { kind: 'invalid' as const, record: normalized, existing: null, contentHash: null, reason: 'externalRef duplicado en la respuesta' }
    seen.add(normalized.externalRef)
    const contentHash = hashRecord(normalized.raw, definition.hashFields)
    const current = existingByRef.get(normalized.externalRef) || null
    const kind: ReconciliationItem['kind'] = current ? (current.contentHash === contentHash ? 'unchanged' : 'updated') : 'new'
    return { kind, record: normalized, existing: current, contentHash }
  })
  return { items, summary: { new: items.filter(i => i.kind === 'new').length, updated: items.filter(i => i.kind === 'updated').length, unchanged: items.filter(i => i.kind === 'unchanged').length, invalid: items.filter(i => i.kind === 'invalid').length, total: items.length } }
}

export function hashRecord(raw: Record<string, unknown>, fields: string[]): string {
  const selected = Object.fromEntries([...fields].sort().map(field => [field, valueAtPath(raw, field)]))
  return createHash('sha256').update(stableStringify(selected)).digest('hex')
}

function valueAtPath(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) => {
    if (typeof current !== 'object' || current === null || !(key in current)) return undefined
    return (current as Record<string, unknown>)[key]
  }, record)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

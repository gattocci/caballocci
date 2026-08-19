export type SourceFormat = 'json' | 'ndjson' | 'csv'

export interface SourceDefinitionConfig {
  externalRef: string
  title: string
  sourceKindField: string
  hashFields: string[]
  contentTypeMap: Record<string, string>
  customFieldDefaults: Record<string, unknown>
}

export interface NormalizedRecord {
  externalRef: string
  title: string
  sourceKind: string
  contentType: string
  raw: Record<string, unknown>
  enriched: Record<string, unknown>
}

export interface ExistingContentRecord {
  id: string
  externalRef: string
  contentHash: string
  raw: Record<string, unknown>
  enriched: Record<string, unknown>
  titleManuallyEdited: boolean
  lastSeenAt: string
}

export type ReconciliationKind = 'new' | 'updated' | 'unchanged' | 'invalid'

export interface ReconciliationItem {
  kind: ReconciliationKind
  record: NormalizedRecord | null
  existing: ExistingContentRecord | null
  contentHash: string | null
  reason?: string
}

export interface ReconciliationReport {
  items: ReconciliationItem[]
  summary: { new: number; updated: number; unchanged: number; invalid: number; total: number }
}

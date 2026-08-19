export interface SourceMappingSuggestion {
  externalRef: string
  title: string
  sourceKindField: string
  hashFields: string[]
  contentTypeMap: Record<string, string>
}

const firstMatch = (keys: string[], candidates: string[]) => candidates.find(candidate => keys.includes(candidate)) || ''

export function suggestSourceMapping(records: Record<string, unknown>[]): SourceMappingSuggestion | null {
  const first = records[0]
  if (!first) return null
  const keys = Object.keys(first)
  const externalRef = firstMatch(keys, ['externalRef', 'external_ref', 'ref', 'id', 'key', 'slug'])
  const title = firstMatch(keys, ['title', 'name', 'headline', 'subject'])
  if (!externalRef || !title) return null
  const sourceKindField = firstMatch(keys, ['kind', 'type', 'contentType', 'content_type', 'category'])
  const hashFields = [title, sourceKindField, ...['updated_at', 'updatedAt', 'published', 'share_url', 'url'].filter(key => keys.includes(key))]
    .filter((field, index, fields) => field && fields.indexOf(field) === index)
  const contentTypeMap: Record<string, string> = {}
  if (sourceKindField) {
    for (const value of records.map(record => record[sourceKindField]).filter(value => typeof value === 'string' && value.trim()).slice(0, 20)) contentTypeMap[String(value)] = 'post'
  }
  return { externalRef, title, sourceKindField, hashFields, contentTypeMap }
}

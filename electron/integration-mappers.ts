export function jsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}')) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

export function mapSource(row: Record<string, unknown>) {
  return {
    id: row.id, name: row.name, baseUrl: row.base_url, method: row.method, format: row.format,
    recordsPath: row.records_path || null, bodyTemplate: row.body_template || null, authType: row.auth_type,
    maxRecords: row.max_records, targetProject: row.target_project || 'Mi contenido', importMode: row.import_mode || 'post', initialStatus: row.initial_status || 'idea', createdAt: row.created_at, updatedAt: row.updated_at,
    hasStoredCredentials: Boolean(row.headers_ciphertext || row.auth_ciphertext),
    hasStoredHeaders: Boolean(row.headers_ciphertext),
    hasStoredAuth: Boolean(row.auth_ciphertext),
  }
}

export function mapSourceDefinition(row: Record<string, unknown>) {
  return {
    id: row.id, sourceId: row.source_id, fieldMap: jsonObject(row.field_map_json),
    contentTypeMap: jsonObject(row.content_type_map_json), customFieldDefaults: jsonObject(row.custom_field_defaults_json),
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export function mapContentRecord(row: Record<string, unknown>) {
  return {
    id: row.id, postId: row.post_id || null, ideaId: row.idea_id || null, sourceId: row.source_id, externalRef: row.external_ref,
    sourceKind: row.source_kind, contentHash: row.content_hash, raw: jsonObject(row.raw_json),
    normalized: jsonObject(row.normalized_json), enriched: jsonObject(row.enriched_json), suggestedTitle: row.suggested_title || null,
    titleManuallyEdited: Number(row.title_manually_edited) === 1, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, lastSeenAt: row.last_seen_at,
  }
}

export function mapCatalogConfig(row: Record<string, unknown> | undefined) {
  if (!row) return { configured: false, endpoint: '', createdBy: '', defaultKind: 'resource' }
  return { configured: Boolean(row.endpoint && row.created_by && row.token_ciphertext), endpoint: row.endpoint || '', createdBy: row.created_by || '', defaultKind: row.default_kind || 'resource', scope: row.scope || '' }
}

export function mapCatalogSync(row: Record<string, unknown> | undefined) {
  if (!row) return null
  let error: unknown = null
  try { error = row.error_json ? JSON.parse(String(row.error_json)) : null } catch { error = row.error_json }
  let responseHeaders: Record<string, string> = {}
  try { responseHeaders = JSON.parse(String(row.response_headers_json || '{}')) as Record<string, string> } catch { responseHeaders = {} }
  return { postId: row.post_id, source: row.source, externalId: row.external_id, kind: row.kind, remoteId: row.remote_id || null, publicUrl: row.public_url || null, action: row.action, error: error == null ? null : JSON.stringify(error), requestUrl: row.request_url || '', responseStatus: row.response_status == null ? null : Number(row.response_status), responseHeaders, responseBody: row.response_body || '', updatedAt: row.updated_at }
}

export function mapCatalogPostFields(row: Record<string, unknown> | undefined) {
  return { summary: row?.summary || '', content: row?.content || '', useHashtags: Number(row?.use_hashtags || 0) === 1, categoryId: row?.category_id == null ? null : Number(row.category_id), categorySlug: row?.category_slug || '', kind: row?.kind === 'resource_lite' ? 'resource_lite' : 'resource' }
}

export function catalogPayload(post: Record<string, unknown>, kind: string, overrides: Record<string, unknown> = {}) {
  const externalId = `post-${String(post.id)}`
  const base = kind === 'resource_lite'
    ? { kind, external_id: externalId, title: String(post.title || ''), summary: String(post.notes || ''), content: String(post.caption || ''), tag_ids: [] }
    : { kind: 'resource', external_id: externalId, title: String(post.title || ''), summary: String(post.notes || ''), content: String(post.caption || ''), learning_outcomes: [], estimated_minutes: Number(post.duration_minutes || 0), access_mode: 'public', tag_ids: [] }
  return { ...base, ...overrides }
}

export function mapContentTypeTemplate(row: Record<string, unknown>) {
  let fields: unknown[] = []
  try { const parsed = JSON.parse(String(row.fields_json || '[]')) as unknown; if (Array.isArray(parsed)) fields = parsed } catch { /* Invalid rows are treated as empty. */ }
  return { id: row.id, contentType: row.content_type, fields, createdAt: row.created_at, updatedAt: row.updated_at }
}

export function mapExportProfile(row: Record<string, unknown>) {
  let columns: unknown[] = []
  try { const parsed = JSON.parse(String(row.columns_json || '[]')) as unknown; if (Array.isArray(parsed)) columns = parsed } catch { /* Invalid rows are treated as empty. */ }
  return { id: row.id, name: row.name, appliesToContentType: row.applies_to_content_type, columns, createdAt: row.created_at, updatedAt: row.updated_at }
}

export function exportRecord(row: Record<string, unknown>, mediaAssets: Record<string, unknown>[]) {
  const parseArray = (value: unknown): unknown[] => { try { const parsed = JSON.parse(String(value || '[]')) as unknown; return Array.isArray(parsed) ? parsed : [] } catch { return [] } }
  const project = String(row.post_project || '')
  const media = parseArray(row.post_media)
  const mediaIds = media.map(item => typeof item === 'object' && item !== null ? String((item as Record<string, unknown>).id || '') : String(item))
  const groupedIdeas = parseArray(row.post_idea_blocks).map((value, index) => {
    const idea = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
    const text = String(idea.text || '')
    return { order: index, id: String(idea.id || ''), title: String(idea.title || ''), text, body: text }
  })
  return {
    id: row.content_id || row.post_id || row.id, externalRef: row.external_ref || '', sourceKind: row.source_kind || '',
    raw: jsonObject(row.raw_json), enriched: jsonObject(row.enriched_json), normalized: jsonObject(row.normalized_json),
    planning: { status: row.post_status || 'idea', date: row.post_scheduled_at || null, format: row.post_content_type || null, project },
    post: { title: row.post_title || '', caption: row.post_caption || '', notes: row.post_notes || '', hashtags: parseArray(row.post_hashtags), mentions: parseArray(row.post_mentions), platforms: parseArray(row.post_platforms), media, mediaAssets: mediaAssets.filter(asset => mediaIds.includes(String(asset.id))), contentType: row.post_content_type || null },
    ideas: groupedIdeas,
  }
}


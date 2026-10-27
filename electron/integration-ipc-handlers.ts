import type { IpcMainInvokeEvent } from 'electron'
import { safeStorage } from 'electron'
import type { PlannerDatabase } from './database'
import { parsePayload } from './integrations/parser'
import { reconcile } from './integrations/reconciler'
import { suggestSourceMapping } from './integrations/suggestions'
import { hashExportRecord, toCsv, type ExportColumn } from './integrations/exporter'
import type { SourceDefinitionConfig } from './integrations/types'
import { catalogPayload, exportRecord, jsonObject, mapCatalogConfig, mapCatalogPostFields, mapCatalogSync, mapContentRecord, mapContentTypeTemplate, mapExportProfile, mapSource, mapSourceDefinition } from './integration-mappers'
import { decryptSecret, encryptSecret, fetchSource } from './source-client'
import {
  validateArgumentCount,
  validateContentTypeTemplateInput,
  validateEnrichedInput,
  validateExportProfileInput,
  validateId,
  validateOptionalPostStatus,
  validateSourceDefinitionInput,
  validateSourceInput,
} from './ipc-validation'

type IntegrationIpcDependencies = {
  database: PlannerDatabase
  handle(channel: string, callback: (args: unknown[], event: IpcMainInvokeEvent) => unknown): void
  withoutArguments(callback: () => unknown): (args: unknown[]) => unknown
}

export function registerIntegrationIpcHandlers({ database, handle, withoutArguments }: IntegrationIpcDependencies) {
  const pendingImports = new Map<string, { sourceId: string; items: Record<string, unknown>[] }>()
  handle('catalog:config', args => {
    if (args.length > 1) throw new TypeError('Argumento IPC no valido: catalog.config')
    const scope = args[0] === undefined ? '' : String(args[0])
    return mapCatalogConfig(database.getCatalogConfig(scope) || database.getCatalogConfig(''))
  })
  handle('catalog:save-config', args => {
    validateArgumentCount(args, 1)
    const input = args[0] as Record<string, unknown>
    const endpoint = String(input.endpoint || '').trim()
    const createdBy = String(input.createdBy || '').trim()
    const defaultKind = input.defaultKind === 'resource_lite' ? 'resource_lite' : 'resource'
    if (!/^https?:\/\//i.test(endpoint) || endpoint.length > 4_000) throw new TypeError('Endpoint de catalogo no valido')
    if (!createdBy || createdBy.length > 128) throw new TypeError('createdBy no valido')
    const scope = String(input.scope || '')
    const current = database.getCatalogConfig(scope)
    let tokenCiphertext = current?.token_ciphertext || ''
    if (typeof input.token === 'string' && input.token.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('El almacenamiento seguro no esta disponible')
      tokenCiphertext = safeStorage.encryptString(input.token.trim()).toString('base64')
    }
    return mapCatalogConfig(database.saveCatalogConfig({ endpoint, createdBy, defaultKind, tokenCiphertext, scope }))
  })
  handle('catalog:post-fields', args => { validateArgumentCount(args, 1); return mapCatalogPostFields(database.getCatalogPostFields(validateId(args[0], 'catalog.postId'))) })
  handle('catalog:save-post-fields', args => {
    validateArgumentCount(args, 1); const input = args[0] as Record<string, unknown>; const postId = validateId(input.postId, 'catalog.postId')
    if (typeof input.summary !== 'string' || input.summary.length > 100_000 || typeof input.content !== 'string' || input.content.length > 500_000) throw new TypeError('Campos de catalogo no validos')
    const categoryId = input.categoryId == null || input.categoryId === '' ? null : Number(input.categoryId)
    if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId < 1)) throw new TypeError('categoryId no valido')
    const categorySlug = typeof input.categorySlug === 'string' ? input.categorySlug.trim() : ''
    if (categoryId !== null && categorySlug) throw new TypeError('Usa categoryId o categorySlug, no ambos')
    return mapCatalogPostFields(database.saveCatalogPostFields({ postId, summary: input.summary, content: input.content, useHashtags: input.useHashtags === true, kind: input.kind, categoryId, categorySlug }))
  })
  handle('catalog:sync', async args => {
    if (args.length < 2 || args.length > 4) throw new TypeError('Argumento IPC no valido: catalog.sync')
    const postId = validateId(args[0], 'catalog.postId')
    const kind = args[1] === 'resource_lite' ? 'resource_lite' : 'resource'
    const dryRun = args[2] === true
    const publish = args[3] === true && !dryRun
    const postFields = database.getCatalogPostFields(postId)
    const post = database.getPost(postId)
    if (!post) throw new Error('Publicacion no encontrada')
    const config = database.getCatalogConfig(String(post.project || '')) || database.getCatalogConfig('')
    if (!config?.endpoint || !config.created_by || !config.token_ciphertext) throw new Error('Configura primero la integracion de catalogo')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El almacenamiento seguro no esta disponible')
    const token = safeStorage.decryptString(Buffer.from(String(config.token_ciphertext), 'base64'))
    if (kind === 'resource' && (postFields?.category_id == null || Number(postFields.category_id) < 1) && !String(postFields?.category_slug || '').trim()) throw new Error('Configura category_id o category_slug para este Resource antes de sincronizar')
    const categoryFields = kind === 'resource' ? (String(postFields?.category_slug || '').trim() ? { category_slug: String(postFields?.category_slug).trim() } : { category_id: Number(postFields?.category_id) }) : {}
    const item = catalogPayload({ ...post, id: postId }, kind, { summary: postFields?.summary || String(post.notes || ''), content: postFields?.content || String(post.caption || ''), ...categoryFields, ...(postFields?.use_hashtags ? { tag_ids: [] } : {}) })
    const payload = { source: 'caballocci', dry_run: dryRun, publish, items: [item] }
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(String(config.endpoint), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal })
      const text = await response.text(); let body: Record<string, unknown> = {}
      try { body = JSON.parse(text) as Record<string, unknown> } catch { /* Response is reported below. */ }
      if (!response.ok) throw new Error(`La API de catalogo respondio HTTP ${response.status}: ${text.slice(0, 500)}`)
      const result = Array.isArray(body.items) ? body.items[0] as Record<string, unknown> : {}
      const hasError = Boolean(result.error) || Boolean(body.error) || Boolean(body.code && body.code !== 'ok')
      const action = hasError ? 'error' : String(result.action || (dryRun ? 'would_create' : 'created'))
      const errorValue = result.error || body.error || (hasError ? { code: body.code, message: body.message || 'La API rechazo el lote' } : null)
      const responseHeaders = Object.fromEntries(response.headers.entries())
      const sync = database.saveCatalogSync({ postId, externalId: item.external_id, kind, remoteId: result.id, publicUrl: result.public_url, action, errorJson: errorValue ? JSON.stringify(errorValue) : '', requestUrl: String(config.endpoint), responseStatus: response.status, responseHeadersJson: JSON.stringify(responseHeaders), responseBody: text })
      return { status: response.status, dryRun, response: body, sync: mapCatalogSync(sync) }
    } finally { clearTimeout(timeout) }
  })
  handle('catalog:sync-state', args => { validateArgumentCount(args, 1); return mapCatalogSync(database.getCatalogSync(validateId(args[0], 'catalog.postId'))) })
  handle('sources:list', withoutArguments(() => database.listSources().map(mapSource)))
  handle('sources:save', args => {
    validateArgumentCount(args, 1)
    const input = validateSourceInput(args[0])
    const current = input.id ? database.getSource(String(input.id)) : undefined
    const source = database.saveSource({
      ...input,
      headersCiphertext: Object.keys(input.headers as Record<string, string>).length > 0 ? encryptSecret(input.headers as Record<string, string>) : current?.headers_ciphertext || '',
      authCiphertext: Object.keys(input.authConfig as Record<string, string>).length > 0 ? encryptSecret(input.authConfig as Record<string, string>) : current?.auth_ciphertext || '',
    })
    return mapSource(source)
  })
  handle('sources:remove', args => {
    validateArgumentCount(args, 1)
    return database.removeSource(validateId(args[0], 'source.id'))
  })
  handle('sources:apply-destination', args => {
    validateArgumentCount(args, 1)
    return database.applySourceDestination(validateId(args[0], 'source.id'))
  })
  handle('source-definitions:list', args => {
    if (args.length > 1) throw new TypeError('Argumento IPC no valido: count')
    const sourceId = args.length === 1 ? validateId(args[0], 'sourceDefinition.sourceId') : undefined
    return database.listSourceDefinitions(sourceId).map(mapSourceDefinition)
  })
  handle('source-definitions:save', args => {
    validateArgumentCount(args, 1)
    const input = validateSourceDefinitionInput(args[0])
    const fieldMap = input.fieldMap as Record<string, unknown>
    return mapSourceDefinition(database.saveSourceDefinition({
      ...input,
      fieldMapJson: JSON.stringify({ ...fieldMap, hashFields: input.hashFields }),
      contentTypeMapJson: JSON.stringify(input.contentTypeMap),
      customFieldDefaultsJson: JSON.stringify(input.customFieldDefaults),
    }))
  })
  handle('sources:test', async args => {
    validateArgumentCount(args, 1)
    const input = validateSourceInput(args[0])
    const current = input.id ? database.getSource(String(input.id)) : undefined
    const headers = input.headers as Record<string, string>
    const authConfig = input.authConfig as Record<string, string>
    const source = {
      ...input,
      base_url: input.baseUrl,
      body_template: input.bodyTemplate,
      headers_ciphertext: Object.keys(headers).length > 0 ? encryptSecret(headers) : current?.headers_ciphertext || '',
      auth_ciphertext: Object.keys(authConfig).length > 0 ? encryptSecret(authConfig) : current?.auth_ciphertext || '',
    }
    const result = await fetchSource(source)
    let records: Record<string, unknown>[] = []; let parseWarning = ''
    try {
      records = parsePayload(result.payload, String(input.format) as 'json' | 'ndjson' | 'csv', input.recordsPath ? String(input.recordsPath) : null, Number(input.maxRecords || 500)).records
    } catch (error) { parseWarning = error instanceof Error ? error.message : 'No se pudo interpretar la respuesta' }
    return { ok: true, bytes: result.payload.length, status: result.status, statusText: result.statusText, contentType: result.contentType, sample: result.payload.slice(0, 1200), requestDetails: result.requestDetails, recordCount: records.length, fields: records[0] ? Object.keys(records[0]) : [], suggestion: suggestSourceMapping(records), parseWarning }
  })
  handle('imports:preview', async args => {
    validateArgumentCount(args, 2)
    const sourceId = validateId(args[0], 'source.id'); const definitionId = validateId(args[1], 'sourceDefinition.id')
    const source = database.getSource(sourceId); const definition = database.getSourceDefinition(definitionId)
    if (!source || !definition || String(definition.source_id) !== sourceId) throw new Error('Fuente o mapeo no encontrado')
    const response = await fetchSource(source)
    const parsed = parsePayload(response.payload, String(source.format) as 'json' | 'ndjson' | 'csv', source.records_path ? String(source.records_path) : null, Number(source.max_records || 500))
    const fieldMap = jsonObject(definition.field_map_json)
    const config: SourceDefinitionConfig = {
      externalRef: String(fieldMap.externalRef || ''), title: String(fieldMap.title || ''), sourceKindField: String(fieldMap.sourceKindField || ''),
      hashFields: Array.isArray(fieldMap.hashFields) ? fieldMap.hashFields.filter((item): item is string => typeof item === 'string') : [],
      contentTypeMap: jsonObject(definition.content_type_map_json) as Record<string, string>, customFieldDefaults: jsonObject(definition.custom_field_defaults_json),
    }
    const report = reconcile(parsed.records, database.listContentRecords(sourceId).map(row => ({
      id: String(row.id), externalRef: String(row.external_ref), contentHash: String(row.content_hash), raw: jsonObject(row.raw_json), enriched: jsonObject(row.enriched_json), titleManuallyEdited: Number(row.title_manually_edited) === 1, lastSeenAt: String(row.last_seen_at),
    })), config)
    const previewId = crypto.randomUUID(); pendingImports.set(previewId, { sourceId, items: report.items as unknown as Record<string, unknown>[] })
    return { previewId, truncated: parsed.truncated, records: parsed.records.slice(0, 25), report }
  })
  handle('imports:confirm', args => {
    validateArgumentCount(args, 1); const previewId = validateId(args[0], 'import.previewId')
    const pending = pendingImports.get(previewId); if (!pending) throw new Error('Preview de importación expirado')
    pendingImports.delete(previewId)
    return database.applyImport(pending.sourceId, pending.items)
  })
  handle('content-records:list', args => {
    if (args.length > 1) throw new TypeError('Argumento IPC no valido: count')
    const sourceId = args.length === 1 ? validateId(args[0], 'contentRecord.sourceId') : undefined
    return database.listContentRecords(sourceId).map(mapContentRecord)
  })
  handle('content-records:by-post', args => {
    validateArgumentCount(args, 1)
    const record = database.getContentRecordForPost(validateId(args[0], 'post.id'))
    return record ? mapContentRecord(record) : null
  })
  handle('content-records:save-enriched', args => {
    validateArgumentCount(args, 1)
    const input = validateEnrichedInput(args[0])
    return mapContentRecord(database.saveContentEnriched(String(input.id), JSON.stringify(input.enriched)))
  })
  handle('content-type-templates:list', withoutArguments(() => database.listContentTypeTemplates().map(mapContentTypeTemplate)))
  handle('content-type-templates:save', args => {
    validateArgumentCount(args, 1)
    const input = validateContentTypeTemplateInput(args[0])
    return mapContentTypeTemplate(database.saveContentTypeTemplate({ ...input, fieldsJson: JSON.stringify(input.fields) }))
  })
  handle('export-profiles:list', withoutArguments(() => database.listExportProfiles().map(mapExportProfile)))
  handle('export-profiles:save', args => {
    validateArgumentCount(args, 1)
    const input = validateExportProfileInput(args[0])
    return mapExportProfile(database.saveExportProfile({ ...input, columnsJson: JSON.stringify(input.columns) }))
  })
  handle('exports:csv', args => {
    if (args.length < 2 || args.length > 5) throw new TypeError('Argumento IPC no valido: exports.csv')
    const sourceId = args[0] === null ? undefined : validateId(args[0], 'export.sourceId')
    const profileId = validateId(args[1], 'export.profileId'); const profile = database.getExportProfile(profileId)
    if (!profile) throw new Error('Perfil de exportacion no encontrado')
    let columns: ExportColumn[] = []
    try { const parsed = JSON.parse(String(profile.columns_json)) as unknown; if (Array.isArray(parsed)) columns = parsed as ExportColumn[] } catch { /* The profile is invalid. */ }
    if (columns.length === 0) throw new Error('El perfil no tiene columnas')
    const deltaOnly = args[2] === undefined ? true : args[2] === true
    const project = args[3] === undefined || args[3] === null || args[3] === '' ? undefined : String(args[3])
    const status = validateOptionalPostStatus(args[4], 'export.status')
    const mediaAssets = database.listMedia()
    const allRecords = database.listExportRows(sourceId, project).map(row => exportRecord(row, mediaAssets)).filter(record => (profile.applies_to_content_type === 'all' || record.planning.format === profile.applies_to_content_type) && (!status || record.planning.status === status))
    const fingerprints = allRecords.map(record => ({ record, rowKey: String(record.id), rowHash: hashExportRecord(record, columns) }))
    const scope = `${project || ''}|${status || ''}`
    const previous = new Map(database.listLastExportSnapshot(profileId, sourceId, scope).map(row => [String(row.row_key), String(row.row_hash)]))
    const records = deltaOnly ? fingerprints.filter(item => previous.get(item.rowKey) !== item.rowHash).map(item => item.record) : allRecords
    database.saveExportSnapshot(profileId, sourceId, scope, deltaOnly ? 'delta' : 'full', fingerprints.map(item => ({ rowKey: item.rowKey, rowHash: item.rowHash })))
    const suffix = deltaOnly ? '-delta' : '-full'
    return { filename: `${String(profile.name).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'export'}${suffix}.csv`, csv: toCsv(records, columns), count: records.length, total: allRecords.length, delta: deltaOnly }
  })
}

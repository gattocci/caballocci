const platforms = ['instagram', 'facebook', 'x'] as const
const contentTypes = ['reel', 'carousel', 'story', 'post', 'thread'] as const
const postStatuses = ['idea', 'draft', 'review', 'approved', 'scheduled', 'published', 'archived'] as const
const ideaStatuses = ['inbox', 'developing', 'ready', 'converted', 'archived'] as const
const ideaPriorities = ['low', 'normal', 'high'] as const
const mediaKinds = ['image', 'video', 'document'] as const
const mediaModes = ['copy', 'reference'] as const
const conceptNodeKinds = ['idea', 'post', 'resource'] as const
const conceptRelations = ['references', 'depends_on', 'related'] as const
const sourceMethods = ['GET', 'POST'] as const
const sourceFormats = ['json', 'ndjson', 'csv'] as const
const sourceAuthTypes = ['none', 'apiKey', 'bearer', 'basic'] as const
const sourceImportModes = ['post', 'idea', 'both'] as const

function invalid(field: string): never {
  throw new TypeError(`Argumento IPC no valido: ${field}`)
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(field)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, maxLength: number, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && value.trim().length === 0)) invalid(field)
  return value
}

function optionalId(value: unknown, field = 'id'): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return text(value, field, 128, false)
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid(field)
  return value as T
}

function stringList(value: unknown, field: string, maxItems: number, itemMaxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) invalid(field)
  return value.map((item, index) => text(item, `${field}[${index}]`, itemMaxLength, false))
}

function mediaAsset(value: unknown, index: number) {
  const asset = record(value, `media[${index}]`)
  const size = asset.size
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0 || size > Number.MAX_SAFE_INTEGER) invalid(`media[${index}].size`)
  return {
    id: text(asset.id, `media[${index}].id`, 128, false),
    name: text(asset.name, `media[${index}].name`, 512, false),
    kind: enumValue(asset.kind, `media[${index}].kind`, mediaKinds),
    size,
    mode: enumValue(asset.mode, `media[${index}].mode`, mediaModes),
  }
}

function ideaBlock(value: unknown, index: number) {
  const block = record(value, `ideaBlocks[${index}]`)
  return {
    id: text(block.id, `ideaBlocks[${index}].id`, 128, false),
    title: text(block.title, `ideaBlocks[${index}].title`, 160),
    text: text(block.text, `ideaBlocks[${index}].text`, 10_000),
  }
}

export function validatePostInput(value: unknown): Record<string, unknown> {
  const post = record(value, 'post')
  const durationMinutes = post.durationMinutes
  if (typeof durationMinutes !== 'number' || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10_080) {
    invalid('post.durationMinutes')
  }

  let scheduledAt: string | null = null
  if (post.scheduledAt !== null && post.scheduledAt !== undefined && post.scheduledAt !== '') {
    scheduledAt = text(post.scheduledAt, 'post.scheduledAt', 64, false)
    if (Number.isNaN(Date.parse(scheduledAt))) invalid('post.scheduledAt')
  }

  const color = text(post.color, 'post.color', 7, false)
  if (!/^#[0-9a-f]{6}$/i.test(color)) invalid('post.color')

  const media = post.media === undefined ? [] : post.media
  if (!Array.isArray(media) || media.length > 100) invalid('post.media')
  const ideaBlocks = post.ideaBlocks === undefined ? [] : post.ideaBlocks
  if (!Array.isArray(ideaBlocks) || ideaBlocks.length > 50) invalid('post.ideaBlocks')

  const validated: Record<string, unknown> = {
    title: text(post.title, 'post.title', 300),
    caption: text(post.caption, 'post.caption', 100_000),
    notes: text(post.notes, 'post.notes', 100_000),
    hashtags: stringList(post.hashtags, 'post.hashtags', 100, 100),
    mentions: stringList(post.mentions, 'post.mentions', 100, 100),
    platforms: stringList(post.platforms, 'post.platforms', platforms.length, 32)
      .map((platform, index) => enumValue(platform, `post.platforms[${index}]`, platforms)),
    contentType: enumValue(post.contentType, 'post.contentType', contentTypes),
    status: enumValue(post.status, 'post.status', postStatuses),
    scheduledAt,
    durationMinutes,
    project: text(post.project, 'post.project', 200),
    color,
    media: media.map(mediaAsset),
    ideaBlocks: ideaBlocks.map(ideaBlock),
  }
  const id = optionalId(post.id, 'post.id')
  if (id) validated.id = id
  return validated
}

export function validateIdeaInput(value: unknown): Record<string, unknown> {
  const idea = record(value, 'idea')
  let dueDate: string | null = null
  if (idea.dueDate !== null && idea.dueDate !== undefined && idea.dueDate !== '') {
    dueDate = text(idea.dueDate, 'idea.dueDate', 32, false)
    if (Number.isNaN(Date.parse(dueDate))) invalid('idea.dueDate')
  }
  const tags = idea.tags === undefined ? [] : idea.tags
  if (!Array.isArray(tags) || tags.length > 30) invalid('idea.tags')
  const media = idea.media === undefined ? [] : idea.media
  if (!Array.isArray(media) || media.length > 100) invalid('idea.media')
  const validated: Record<string, unknown> = {
    space: text(idea.space, 'idea.space', 200, false),
    title: text(idea.title, 'idea.title', 240),
    body: text(idea.body, 'idea.body', 20_000),
    tags: stringList(tags, 'idea.tags', 30, 80),
    media: media.map(mediaAsset),
    status: enumValue(idea.status, 'idea.status', ideaStatuses),
    priority: enumValue(idea.priority, 'idea.priority', ideaPriorities),
    dueDate,
  }
  const id = optionalId(idea.id, 'idea.id')
  if (id) validated.id = id
  return validated
}

function stringRecord(value: unknown, field: string, maxItems: number, maxLength: number): Record<string, string> {
  const object = record(value, field)
  const entries = Object.entries(object)
  if (entries.length > maxItems) invalid(field)
  return Object.fromEntries(entries.map(([key, item]) => {
    const cleanKey = text(key, `${field}.key`, 200, false)
    const cleanValue = text(item, `${field}.${cleanKey}`, maxLength)
    if (/\r|\n/.test(cleanKey) || /\r|\n/.test(cleanValue)) invalid(`${field}.${cleanKey}`)
    return [cleanKey, cleanValue]
  }))
}

export function validateSourceInput(value: unknown): Record<string, unknown> {
  const source = record(value, 'source')
  const bodyTemplate = source.bodyTemplate === null || source.bodyTemplate === undefined || source.bodyTemplate === '' ? null : text(source.bodyTemplate, 'source.bodyTemplate', 100_000)
  if (bodyTemplate) { try { JSON.parse(bodyTemplate) } catch { invalid('source.bodyTemplate') } }
  const maxRecords = source.maxRecords === undefined ? 500 : source.maxRecords
  if (typeof maxRecords !== 'number' || !Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 10_000) invalid('source.maxRecords')
  const headers = stringRecord(source.headers === undefined ? {} : source.headers, 'source.headers', 100, 8_000)
  const authType = enumValue(source.authType || 'none', 'source.authType', sourceAuthTypes)
  const authConfig = stringRecord(source.authConfig === undefined ? {} : source.authConfig, 'source.authConfig', 20, 20_000)
  if (authType === 'bearer' && !authConfig.token?.trim()) {
    const tokenAlias = Object.keys(authConfig).find(key => /token/i.test(key) && authConfig[key].trim())
    if (tokenAlias) authConfig.token = authConfig[tokenAlias]
  }
  const hasBearerHeader = Object.entries(headers).some(([key, value]) => key.toLowerCase() === 'authorization' && /^Bearer\s+\S+/i.test(value))
  if (authType === 'bearer' && !authConfig.token?.trim() && !hasBearerHeader) throw new TypeError('Para Bearer token, Auth JSON debe tener la forma {"token":"TU_TOKEN"} o define Authorization en Headers JSON')
  if (authType === 'apiKey' && !authConfig.value?.trim()) throw new TypeError('Para API key, Auth JSON debe tener la forma {"value":"TU_API_KEY"} y opcionalmente "header"')
  if (authType === 'basic' && (!authConfig.username?.trim() || authConfig.password === undefined)) throw new TypeError('Para Basic, Auth JSON debe tener username y password')
  const targetProject = text(source.targetProject === undefined ? 'Mi contenido' : source.targetProject, 'source.targetProject', 200, false)
  const importMode = enumValue(source.importMode || 'post', 'source.importMode', sourceImportModes)
  const initialStatus = enumValue(source.initialStatus || 'idea', 'source.initialStatus', postStatuses)
  const validated: Record<string, unknown> = {
    name: text(source.name, 'source.name', 200, false),
    baseUrl: text(source.baseUrl, 'source.baseUrl', 4_000, false),
    method: enumValue(source.method, 'source.method', sourceMethods),
    format: enumValue(source.format, 'source.format', sourceFormats),
    recordsPath: source.recordsPath ? text(source.recordsPath, 'source.recordsPath', 300, false) : null,
    headers,
    bodyTemplate,
    authType,
    authConfig,
    targetProject,
    importMode,
    initialStatus,
    maxRecords,
  }
  const id = optionalId(source.id, 'source.id'); if (id) validated.id = id
  return validated
}

export function validateSourceDefinitionInput(value: unknown): Record<string, unknown> {
  const definition = record(value, 'sourceDefinition')
  const fieldMap = record(definition.fieldMap, 'sourceDefinition.fieldMap')
  const hashFields = definition.hashFields
  if (!Array.isArray(hashFields) || hashFields.length > 100) invalid('sourceDefinition.hashFields')
  const contentTypeMap = stringRecord(definition.contentTypeMap === undefined ? {} : definition.contentTypeMap, 'sourceDefinition.contentTypeMap', 100, 100)
  const customFieldDefaults = record(definition.customFieldDefaults === undefined ? {} : definition.customFieldDefaults, 'sourceDefinition.customFieldDefaults')
  const validated: Record<string, unknown> = {
    sourceId: validateId(definition.sourceId, 'sourceDefinition.sourceId'),
    fieldMap: {
      externalRef: text(fieldMap.externalRef, 'sourceDefinition.fieldMap.externalRef', 300, false),
      title: text(fieldMap.title, 'sourceDefinition.fieldMap.title', 300, false),
      sourceKindField: text(fieldMap.sourceKindField, 'sourceDefinition.fieldMap.sourceKindField', 300),
    },
    hashFields: hashFields.map((item, index) => text(item, `sourceDefinition.hashFields[${index}]`, 300, false)),
    contentTypeMap,
    customFieldDefaults,
  }
  const id = optionalId(definition.id, 'sourceDefinition.id'); if (id) validated.id = id
  return validated
}

export function validateEnrichedInput(value: unknown): Record<string, unknown> {
  const input = record(value, 'contentRecord')
  const enriched = record(input.enriched, 'contentRecord.enriched')
  if (JSON.stringify(enriched).length > 200_000) invalid('contentRecord.enriched')
  return { id: validateId(input.id, 'contentRecord.id'), enriched }
}

function exportColumns(value: unknown, field: string): Array<{ header: string; source: string; order: number }> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) invalid(field)
  return value.map((item, index) => {
    const column = record(item, `${field}[${index}]`)
    const order = column.order
    if (typeof order !== 'number' || !Number.isInteger(order) || order < 0 || order > 1_000) invalid(`${field}[${index}].order`)
    return { header: text(column.header, `${field}[${index}].header`, 200, false), source: text(column.source, `${field}[${index}].source`, 300, false), order }
  })
}

export function validateContentTypeTemplateInput(value: unknown): Record<string, unknown> {
  const template = record(value, 'contentTypeTemplate')
  const fields = template.fields
  if (!Array.isArray(fields) || fields.length > 50) invalid('contentTypeTemplate.fields')
  const validatedFields = fields.map((item, index) => {
    const field = record(item, `contentTypeTemplate.fields[${index}]`)
    return { key: text(field.key, `contentTypeTemplate.fields[${index}].key`, 100, false), label: text(field.label, `contentTypeTemplate.fields[${index}].label`, 160, false), type: enumValue(field.type, `contentTypeTemplate.fields[${index}].type`, ['text', 'textarea'] as const) }
  })
  const keys = new Set(validatedFields.map(field => field.key)); if (keys.size !== validatedFields.length) invalid('contentTypeTemplate.fields')
  const validated: Record<string, unknown> = { contentType: text(template.contentType, 'contentTypeTemplate.contentType', 100, false), fields: validatedFields }
  const id = optionalId(template.id, 'contentTypeTemplate.id'); if (id) validated.id = id
  return validated
}

export function validateExportProfileInput(value: unknown): Record<string, unknown> {
  const profile = record(value, 'exportProfile')
  const validated: Record<string, unknown> = {
    name: text(profile.name, 'exportProfile.name', 200, false),
    appliesToContentType: text(profile.appliesToContentType || 'all', 'exportProfile.appliesToContentType', 100, false),
    columns: exportColumns(profile.columns, 'exportProfile.columns'),
  }
  const id = optionalId(profile.id, 'exportProfile.id'); if (id) validated.id = id
  return validated
}

export function validateOptionalPostStatus(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return enumValue(value, field, postStatuses)
}

export function validateConceptNodeInput(value: unknown): Record<string, unknown> {
  const node = record(value, 'conceptMap.node')
  const x = node.x
  const y = node.y
  if (typeof x !== 'number' || !Number.isFinite(x) || x < -1_000_000 || x > 1_000_000) invalid('conceptMap.node.x')
  if (typeof y !== 'number' || !Number.isFinite(y) || y < -1_000_000 || y > 1_000_000) invalid('conceptMap.node.y')
  const sourceId = node.sourceId === null || node.sourceId === undefined || node.sourceId === '' ? null : text(node.sourceId, 'conceptMap.node.sourceId', 128, false)
  const folderId = node.folderId === null || node.folderId === undefined || node.folderId === '' ? null : text(node.folderId, 'conceptMap.node.folderId', 128, false)
  const validated: Record<string, unknown> = {
    folderId,
    kind: enumValue(node.kind, 'conceptMap.node.kind', conceptNodeKinds),
    sourceId,
    title: text(node.title, 'conceptMap.node.title', 240, false),
    body: text(node.body, 'conceptMap.node.body', 20_000),
    x,
    y,
  }
  const id = optionalId(node.id, 'conceptMap.node.id')
  if (id) validated.id = id
  return validated
}

export function validateConceptFolderInput(value: unknown): Record<string, unknown> {
  const folder = record(value, 'conceptMap.folder')
  const parentId = folder.parentId === null || folder.parentId === undefined || folder.parentId === '' ? null : text(folder.parentId, 'conceptMap.folder.parentId', 128, false)
  const validated: Record<string, unknown> = {
    parentId,
    name: text(folder.name, 'conceptMap.folder.name', 120, false),
  }
  const id = optionalId(folder.id, 'conceptMap.folder.id')
  if (id) {
    if (parentId === id) invalid('conceptMap.folder.parentId')
    validated.id = id
  }
  return validated
}

export function validateConceptLinkInput(value: unknown): Record<string, unknown> {
  const link = record(value, 'conceptMap.link')
  const fromNodeId = text(link.fromNodeId, 'conceptMap.link.fromNodeId', 128, false)
  const toNodeId = text(link.toNodeId, 'conceptMap.link.toNodeId', 128, false)
  if (fromNodeId === toNodeId) invalid('conceptMap.link')
  const validated: Record<string, unknown> = {
    fromNodeId,
    toNodeId,
    relation: enumValue(link.relation, 'conceptMap.link.relation', conceptRelations),
  }
  const id = optionalId(link.id, 'conceptMap.link.id')
  if (id) validated.id = id
  return validated
}

export function validateId(value: unknown, field = 'id') {
  return text(value, field, 128, false)
}

export function validateProject(value: unknown, field: string) {
  return text(value, field, 200, false)
}

export function validateClipboardText(value: unknown) {
  return text(value, 'text', 200_000)
}

export function validateMediaMode(value: unknown) {
  return enumValue(value, 'mode', mediaModes)
}

export function validateNoArguments(args: unknown[]) {
  if (args.length !== 0) invalid('unexpected')
}

export function validateArgumentCount(args: unknown[], expected: number) {
  if (args.length !== expected) invalid('count')
}

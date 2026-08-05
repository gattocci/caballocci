const platforms = ['instagram', 'facebook', 'x'] as const
const contentTypes = ['reel', 'carousel', 'story', 'post', 'thread'] as const
const postStatuses = ['idea', 'draft', 'review', 'approved', 'scheduled', 'published', 'archived'] as const
const ideaStatuses = ['inbox', 'developing', 'ready', 'converted', 'archived'] as const
const ideaPriorities = ['low', 'normal', 'high'] as const
const mediaKinds = ['image', 'video', 'document'] as const
const mediaModes = ['copy', 'reference'] as const
const conceptNodeKinds = ['idea', 'post', 'resource'] as const
const conceptRelations = ['references', 'depends_on', 'related'] as const

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

export function validateConceptNodeInput(value: unknown): Record<string, unknown> {
  const node = record(value, 'conceptMap.node')
  const x = node.x
  const y = node.y
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 20_000) invalid('conceptMap.node.x')
  if (typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y > 20_000) invalid('conceptMap.node.y')
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

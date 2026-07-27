const platforms = ['instagram', 'facebook', 'x'] as const
const contentTypes = ['reel', 'carousel', 'story', 'post', 'thread'] as const
const postStatuses = ['idea', 'draft', 'review', 'approved', 'scheduled', 'published', 'archived'] as const
const mediaKinds = ['image', 'video', 'document'] as const
const mediaModes = ['copy', 'reference'] as const

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
  }
  const id = optionalId(post.id, 'post.id')
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

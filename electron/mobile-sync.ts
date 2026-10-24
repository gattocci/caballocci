import fs from 'node:fs'
import path from 'node:path'

export const mobileCatalogSchema = 'caballocci.mobile-sync.catalog'
export const mobileUsageSchema = 'caballocci.mobile-sync.usage'
export const mobileSyncVersion = 1

export interface MobilePublication {
  postId: string
  targetId: string
  targetName: string
  manifestPath: string
  captionPath: string
  scheduledAt: string | null
  used: boolean
  batch?: string
}

export interface MobileCatalog {
  schema: typeof mobileCatalogSchema
  version: number
  generatedAt: string
  publications: MobilePublication[]
}

export interface MobileUsageEvent {
  schema: typeof mobileUsageSchema
  version: number
  eventId: string
  postId: string
  targetId: string
  action: 'used'
  usedAt: string
  deviceId: string
}

export interface MobileImportReport {
  imported: number
  duplicates: number
  invalid: Array<{ file: string; reason: string }>
  unknown: Array<{ file: string; postId: string; targetId: string }>
}

export interface MobileExportReport {
  batch: string
  publications: number
  destinations: number
  skipped: Array<{ postId: string; title: string; reason: string }>
  catalogPath: string
}

export function mergeMobilePublications(existing: MobilePublication[], replacements: MobilePublication[]) {
  const replacedPostIds = new Set(replacements.map(publication => publication.postId))
  return [...existing.filter(publication => !replacedPostIds.has(publication.postId)), ...replacements]
}

function batchLabel(sequence: number) {
  let value = sequence
  let label = ''
  while (value > 0) {
    value -= 1
    label = String.fromCharCode(97 + value % 26) + label
    value = Math.floor(value / 26)
  }
  return label
}

export function nextMobileBatch(syncRoot: string) {
  const outbox = path.join(syncRoot, 'pc-outbox')
  fs.mkdirSync(outbox, { recursive: true })
  const sequencePath = path.join(outbox, 'batch-sequence.json')
  let previous = 0
  if (fs.existsSync(sequencePath)) {
    const state = JSON.parse(fs.readFileSync(sequencePath, 'utf8')) as { last?: unknown }
    if (!Number.isSafeInteger(state.last) || Number(state.last) < 0) {
      throw new TypeError('El contador de lotes móvil no es válido.')
    }
    previous = Number(state.last)
  }
  const next = previous + 1
  const temporaryPath = path.join(outbox, `batch-sequence-${crypto.randomUUID()}.tmp`)
  fs.writeFileSync(temporaryPath, JSON.stringify({ last: next }), 'utf8')
  fs.renameSync(temporaryPath, sequencePath)
  return batchLabel(next)
}

export function nextMobileSpaceOrder(syncRoot: string, spaceName: string) {
  const outbox = path.join(syncRoot, 'pc-outbox')
  fs.mkdirSync(outbox, { recursive: true })
  const sequencePath = path.join(outbox, 'space-sequences.json')
  const key = spaceName.trim().normalize('NFKC').toLocaleLowerCase() || 'general'
  let sequences: Record<string, unknown> = {}
  if (fs.existsSync(sequencePath)) {
    const saved = JSON.parse(fs.readFileSync(sequencePath, 'utf8')) as unknown
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      throw new TypeError('El contador de publicaciones por espacio no es válido.')
    }
    sequences = saved as Record<string, unknown>
  }
  const previous = sequences[key] ?? 0
  if (!Number.isSafeInteger(previous) || Number(previous) < 0) {
    throw new TypeError(`El contador de publicaciones del espacio "${spaceName}" no es válido.`)
  }
  const next = Number(previous) + 1
  sequences[key] = next
  const temporaryPath = path.join(outbox, `space-sequences-${crypto.randomUUID()}.tmp`)
  fs.writeFileSync(temporaryPath, JSON.stringify(sequences, null, 2), 'utf8')
  fs.renameSync(temporaryPath, sequencePath)
  return next
}

export function recordMobileBatch(syncRoot: string, batch: string, postIds: string[]) {
  const outbox = path.join(syncRoot, 'pc-outbox')
  fs.mkdirSync(outbox, { recursive: true })
  const historyPath = path.join(outbox, 'batch-history.json')
  let history: Array<{ batch: string; exportedAt: string; postIds: string[] }> = []
  if (fs.existsSync(historyPath)) {
    const saved = JSON.parse(fs.readFileSync(historyPath, 'utf8')) as unknown
    if (!Array.isArray(saved)) throw new TypeError('El historial de lotes móvil no es válido.')
    history = saved as Array<{ batch: string; exportedAt: string; postIds: string[] }>
  }
  history.push({ batch, exportedAt: new Date().toISOString(), postIds })
  const temporaryPath = path.join(outbox, `batch-history-${crypto.randomUUID()}.tmp`)
  fs.writeFileSync(temporaryPath, JSON.stringify(history, null, 2), 'utf8')
  fs.renameSync(temporaryPath, historyPath)
}

export function writeMobileCatalog(syncRoot: string, publications: MobilePublication[], generatedAt = new Date().toISOString()) {
  const outbox = path.join(syncRoot, 'pc-outbox')
  fs.mkdirSync(outbox, { recursive: true })
  const catalog: MobileCatalog = {
    schema: mobileCatalogSchema,
    version: mobileSyncVersion,
    generatedAt,
    publications,
  }
  const temporaryPath = path.join(outbox, `catalog-${crypto.randomUUID()}.tmp`)
  fs.writeFileSync(temporaryPath, JSON.stringify(catalog, null, 2), 'utf8')
  fs.renameSync(temporaryPath, path.join(outbox, 'catalog.json'))
  return catalog
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value)
}

export function parseMobileUsageEvent(value: unknown): MobileUsageEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('El evento debe ser un objeto JSON.')
  const event = value as Record<string, unknown>
  if (event.schema !== mobileUsageSchema) throw new TypeError('Esquema de evento desconocido.')
  if (event.version !== mobileSyncVersion) throw new TypeError('Versión de evento no compatible.')
  if (!validIdentifier(event.eventId) || !validIdentifier(event.postId) || !validIdentifier(event.targetId) || !validIdentifier(event.deviceId)) {
    throw new TypeError('El evento contiene identificadores no válidos.')
  }
  if (event.action !== 'used') throw new TypeError('Tipo de acción no compatible.')
  if (typeof event.usedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(event.usedAt) || Number.isNaN(Date.parse(event.usedAt))) {
    throw new TypeError('La fecha del evento debe ser UTC en formato ISO 8601.')
  }
  return {
    schema: mobileUsageSchema,
    version: mobileSyncVersion,
    eventId: event.eventId,
    postId: event.postId,
    targetId: event.targetId,
    action: 'used',
    usedAt: event.usedAt,
    deviceId: event.deviceId,
  }
}

export function importMobileUsageFiles(
  syncRoot: string,
  targetExists: (postId: string, targetId: string) => boolean,
  recordUsage: (event: MobileUsageEvent) => boolean,
): MobileImportReport {
  const report: MobileImportReport = { imported: 0, duplicates: 0, invalid: [], unknown: [] }
  const inbox = path.join(syncRoot, 'android-inbox')
  if (!fs.existsSync(inbox)) return report

  for (const deviceEntry of fs.readdirSync(inbox, { withFileTypes: true })) {
    if (!deviceEntry.isDirectory()) continue
    const deviceDirectory = path.join(inbox, deviceEntry.name)
    for (const eventEntry of fs.readdirSync(deviceDirectory, { withFileTypes: true })) {
      if (!eventEntry.isFile() || path.extname(eventEntry.name).toLowerCase() !== '.json') continue
      const file = path.join(deviceDirectory, eventEntry.name)
      const displayFile = path.relative(syncRoot, file)
      let parsed: unknown
      try {
        const stat = fs.statSync(file)
        if (stat.size > 256 * 1024) throw new TypeError('El archivo supera el tamaño máximo de 256 KB.')
        parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
      } catch (error) {
        report.invalid.push({ file: displayFile, reason: error instanceof Error ? error.message : 'No se pudo leer el JSON.' })
        continue
      }
      let event: MobileUsageEvent
      try {
        event = parseMobileUsageEvent(parsed)
      } catch (error) {
        report.invalid.push({ file: displayFile, reason: error instanceof Error ? error.message : 'Formato de evento no válido.' })
        continue
      }
      if (event.deviceId !== deviceEntry.name) {
        report.invalid.push({ file: displayFile, reason: 'El identificador del dispositivo no coincide con su carpeta.' })
        continue
      }
      if (!targetExists(event.postId, event.targetId)) {
        report.unknown.push({ file: displayFile, postId: event.postId, targetId: event.targetId })
        continue
      }
      if (recordUsage(event)) report.imported += 1
      else report.duplicates += 1
    }
  }
  return report
}

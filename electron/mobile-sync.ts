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

export type MobileUsageAction = 'used' | 'removed'

export interface MobileUsageEvent {
  schema: typeof mobileUsageSchema
  version: number
  eventId: string
  postId: string
  targetId: string
  action: MobileUsageAction
  /** Momento del evento (ISO UTC). Se llama usedAt por compatibilidad con la versión 1 del contrato. */
  usedAt: string
  deviceId: string
}

export interface MobileImportReport {
  imported: number
  duplicates: number
  /** Confirmaciones de retiro (action "removed") importadas en esta pasada. */
  removed: number
  /** Álbumes eliminados de pc-outbox porque ya no están en el catálogo. */
  cleaned: number
  /** Referencias retiradas porque la carpeta de publicación ya no existía. */
  missingAlbums: string[]
  catalogBackupPaths: string[]
  invalid: Array<{ file: string; reason: string }>
  unknown: Array<{ file: string; postId: string; targetId: string }>
}

export interface MobileExportReport {
  batch: string
  publications: number
  destinations: number
  skipped: Array<{ postId: string; title: string; reason: string }>
  catalogPath: string
  missingAlbums: string[]
  catalogBackupPaths: string[]
}

export interface MobileCatalogStatus {
  configured: boolean
  catalogExists: boolean
  catalogPath: string | null
  referencedDestinations: number
  referencedAlbums: number
  availableAlbums: number
  missingAlbums: string[]
  incompleteAlbums: string[]
  archivedCatalogs: number
  latestCatalogBackupPath: string | null
}

export interface MobileReconcileReport {
  missingAlbums: string[]
  pruned: number
  cleaned: number
  cleanupFailed: string[]
  catalogBackupPath: string | null
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

export function nextMobileSpaceOrder(syncRoot: string, spaceName: string, replacingPostId?: string) {
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
  // Al exportar desde la app se reserva el primer hueco entre los álbumes
  // activos, ignorando la versión anterior de esta misma publicación.
  const activeOrders = new Set<number>()
  const albumsRoot = path.join(outbox, 'publications')
  if (replacingPostId && fs.existsSync(albumsRoot)) {
    for (const entry of fs.readdirSync(albumsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(albumsRoot, entry.name, 'manifest.json'), 'utf8')) as { postId?: unknown; spaceName?: unknown; spaceOrder?: unknown }
        const manifestKey = typeof manifest.spaceName === 'string' ? manifest.spaceName.trim().normalize('NFKC').toLocaleLowerCase() || 'general' : 'general'
        if (String(manifest.postId || '') !== replacingPostId && manifestKey === key && Number.isSafeInteger(manifest.spaceOrder) && Number(manifest.spaceOrder) > 0) activeOrders.add(Number(manifest.spaceOrder))
      } catch { /* Ignora carpetas temporales o manifiestos incompletos. */ }
    }
  }
  let next = replacingPostId ? 1 : Number(previous) + 1
  if (replacingPostId) while (activeOrders.has(next)) next += 1
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
  if (event.action !== 'used' && event.action !== 'removed') throw new TypeError('Tipo de acción no compatible.')
  if (typeof event.usedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(event.usedAt) || Number.isNaN(Date.parse(event.usedAt))) {
    throw new TypeError('La fecha del evento debe ser UTC en formato ISO 8601.')
  }
  return {
    schema: mobileUsageSchema,
    version: mobileSyncVersion,
    eventId: event.eventId,
    postId: event.postId,
    targetId: event.targetId,
    action: event.action,
    usedAt: event.usedAt,
    deviceId: event.deviceId,
  }
}

export function importMobileUsageFiles(
  syncRoot: string,
  targetExists: (postId: string, targetId: string) => boolean,
  recordUsage: (event: MobileUsageEvent) => boolean,
): MobileImportReport {
  const report: MobileImportReport = { imported: 0, duplicates: 0, removed: 0, cleaned: 0, missingAlbums: [], catalogBackupPaths: [], invalid: [], unknown: [] }
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
      // Un retiro es solo una señal de limpieza: se registra aunque la publicación ya no exista.
      if (event.action === 'used' && !targetExists(event.postId, event.targetId)) {
        report.unknown.push({ file: displayFile, postId: event.postId, targetId: event.targetId })
        continue
      }
      if (recordUsage(event)) {
        report.imported += 1
        if (event.action === 'removed') report.removed += 1
      } else report.duplicates += 1
    }
  }
  return report
}

export interface MobileUsageSummary {
  /** Destinos con al menos una confirmación de uso. */
  used: Set<string>
  /** Destinos cuyo último evento fue un retiro desde el móvil. */
  removed: Set<string>
}

export function mobileTargetKey(postId: string, targetId: string) {
  return `${postId}\u0000${targetId}`
}

export function summarizeMobileUsage(events: Array<{ postId: string; targetId: string; action: string; usedAt: string }>): MobileUsageSummary {
  const used = new Set<string>()
  const latest = new Map<string, { action: string; at: number }>()
  for (const item of events) {
    const key = mobileTargetKey(item.postId, item.targetId)
    const at = Date.parse(item.usedAt)
    if (item.action === 'used') used.add(key)
    const previous = latest.get(key)
    // En un empate gana el retiro: es lo último que la persona pudo hacer sobre una tarjeta ya marcada.
    if (!previous || at > previous.at || (at === previous.at && item.action === 'removed')) latest.set(key, { action: item.action, at })
  }
  const removed = new Set<string>()
  for (const [key, value] of latest) if (value.action === 'removed') removed.add(key)
  return { used, removed }
}

/** Quita del catálogo las entradas de publicaciones eliminadas/archivadas y los destinos retirados desde el móvil. */
export function pruneMobilePublications(
  publications: MobilePublication[],
  options: { postIsActive: (postId: string) => boolean; removed: Set<string> },
) {
  const kept: MobilePublication[] = []
  const dropped: MobilePublication[] = []
  for (const publication of publications) {
    const gone = !options.postIsActive(publication.postId) || options.removed.has(mobileTargetKey(publication.postId, publication.targetId))
    ;(gone ? dropped : kept).push(publication)
  }
  return { kept, dropped }
}

/**
 * Elimina de pc-outbox/publications los álbumes (carpetas con manifest.json) que el catálogo ya no referencia.
 * No toca carpetas ocultas (.caballocci-export-*) ni nada fuera de ese directorio.
 */
export function cleanUnreferencedMobileAlbums(syncRoot: string, publications: MobilePublication[]) {
  const albumsRoot = path.join(syncRoot, 'pc-outbox', 'publications')
  const result = { removed: [] as string[], failed: [] as string[] }
  if (!fs.existsSync(albumsRoot)) return result
  const referenced = new Set<string>()
  for (const publication of publications) {
    const parts = publication.manifestPath.replace(/\\/g, '/').split('/')
    if (parts.length >= 4 && parts[0] === 'pc-outbox' && parts[1] === 'publications') referenced.add(parts[2]!)
  }
  for (const entry of fs.readdirSync(albumsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || referenced.has(entry.name)) continue
    const directory = path.join(albumsRoot, entry.name)
    if (!fs.existsSync(path.join(directory, 'manifest.json'))) continue
    try {
      fs.rmSync(directory, { recursive: true, force: true })
      result.removed.push(entry.name)
    } catch {
      result.failed.push(entry.name)
    }
  }
  return result
}

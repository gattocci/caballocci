export const catalogSchema = 'caballocci.mobile-sync.catalog'
export const usageSchema = 'caballocci.mobile-sync.usage'
export const formatVersion = 1

export interface Publication {
  postId: string
  targetId: string
  targetName: string
  manifestPath: string
  captionPath: string
  scheduledAt: string | null
  used: boolean
  batch?: string
}

export interface Catalog {
  schema: typeof catalogSchema
  version: number
  generatedAt: string
  publications: Publication[]
}

export interface UsageEvent {
  schema: typeof usageSchema
  version: number
  eventId: string
  postId: string
  targetId: string
  /** used: marcada como usada. removed: retirada del móvil (señal de limpieza para la PC). */
  action: 'used' | 'removed'
  /** Momento del evento; el nombre se conserva por compatibilidad con la versión 1. */
  usedAt: string
  deviceId: string
}

export function parseCatalog(value: unknown): Catalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('El snapshot no es un objeto.')
  const catalog = value as Record<string, unknown>
  if (catalog.schema !== catalogSchema || catalog.version !== formatVersion || !Array.isArray(catalog.publications)) {
    throw new Error('Formato o versión de snapshot no compatible.')
  }
  const publications = catalog.publications.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('El snapshot contiene una publicación no válida.')
    const publication = item as Record<string, unknown>
    if (typeof publication.postId !== 'string' || typeof publication.targetId !== 'string' ||
      typeof publication.targetName !== 'string' || typeof publication.manifestPath !== 'string' ||
      typeof publication.captionPath !== 'string') {
      throw new Error('El snapshot contiene campos de publicación no válidos.')
    }
    return {
      postId: publication.postId,
      targetId: publication.targetId,
      targetName: publication.targetName,
      manifestPath: publication.manifestPath,
      captionPath: publication.captionPath,
      scheduledAt: typeof publication.scheduledAt === 'string' ? publication.scheduledAt : null,
      used: publication.used === true,
      ...(typeof publication.batch === 'string' && publication.batch ? { batch: publication.batch } : {}),
    }
  })
  return {
    schema: catalogSchema,
    version: formatVersion,
    generatedAt: typeof catalog.generatedAt === 'string' ? catalog.generatedAt : '',
    publications,
  }
}

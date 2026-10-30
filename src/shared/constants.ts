import type { ContentType, Platform, PostStatus } from './types'

export const statusMeta: Record<PostStatus, { label: string; color: string }> = {
  idea: { label: 'Pendiente', color: '#858d87' },
  draft: { label: 'Borradores', color: '#59a9e8' },
  review: { label: 'En revisión', color: '#d5a03c' },
  approved: { label: 'Aprobado', color: '#8fbf4a' },
  scheduled: { label: 'Programado', color: '#e76042' },
  published: { label: 'Publicado', color: '#1f7a52' },
  archived: { label: 'Archivado', color: '#737d77' },
}

export const platformMeta: Record<string, { label: string; mark: string }> = {
  instagram: { label: 'Instagram', mark: 'IG' },
  facebook: { label: 'Facebook', mark: 'f' },
  x: { label: 'X', mark: 'X' },
}

export function getPlatformMeta(platform: string) {
  if (platformMeta[platform]) return platformMeta[platform]
  const label = platform.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
  return { label, mark: platform.slice(0, 2).toUpperCase() }
}

export const contentLabels: Record<ContentType, string> = {
  reel: 'Reel', carousel: 'Carrusel', story: 'Historia', post: 'Publicación', thread: 'Hilo',
}

export const stages: PostStatus[] = ['idea', 'draft', 'review', 'approved', 'scheduled', 'published']

import type { ContentType, Platform, PostStatus } from './types'

export const statusMeta: Record<PostStatus, { label: string; color: string }> = {
  idea: { label: 'Ideas', color: '#9978d5' },
  draft: { label: 'Borradores', color: '#5f88d8' },
  review: { label: 'En revisión', color: '#d5a03c' },
  approved: { label: 'Aprobado', color: '#3f9f7a' },
  scheduled: { label: 'Programado', color: '#e76042' },
  published: { label: 'Publicado', color: '#2f9563' },
  archived: { label: 'Archivado', color: '#737d77' },
}

export const platformMeta: Record<Platform, { label: string; mark: string }> = {
  instagram: { label: 'Instagram', mark: 'IG' },
  facebook: { label: 'Facebook', mark: 'f' },
  x: { label: 'X', mark: 'X' },
}

export const contentLabels: Record<ContentType, string> = {
  reel: 'Reel', carousel: 'Carrusel', story: 'Historia', post: 'Publicación', thread: 'Hilo',
}

export const stages: PostStatus[] = ['idea', 'draft', 'review', 'approved', 'scheduled', 'published']

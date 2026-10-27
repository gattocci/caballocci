import type { ExportProfile, Source } from '../../shared/types'

export function blockRecipeColumns(includeTitle: boolean, includeIntro: boolean, ideaCount: number): ExportProfile['columns'] {
  const columns: ExportProfile['columns'] = []
  if (includeTitle) columns.push({ header: 'Title', source: 'post.title', order: columns.length })
  if (includeIntro) columns.push({ header: 'Texto inicial', source: 'post.caption', order: columns.length })
  for (let index = 0; index < ideaCount; index += 1) {
    columns.push({ header: `Idea ${index + 1}`, source: `ideas.${index}.text`, order: columns.length })
  }
  return columns
}

export function parseObject(text: string, label: string): Record<string, string> {
  const value = JSON.parse(text || '{}') as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} debe ser un objeto JSON`)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]))
}

export function parseAuth(text: string, authType: Source['authType']): Record<string, string> {
  const raw = text.trim()
  if (authType === 'bearer' && raw && !raw.startsWith('{')) return { token: raw }
  return parseObject(text, 'Autenticacion')
}

export function parseRecord(text: string, label: string): Record<string, unknown> {
  const value = JSON.parse(text || '{}') as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} debe ser un objeto JSON`)
  return value as Record<string, unknown>
}


import type { IdeaBlock, MediaAsset, PostInput } from '../../shared/types'

export const blankPost = (project: string): PostInput => ({
  id: crypto.randomUUID(),
  title: '', caption: '', notes: '', hashtags: [], mentions: [], platforms: ['instagram'],
  contentType: 'reel', status: 'idea', scheduledAt: null, durationMinutes: 60,
  project, color: '#e76042', ideaBlocks: [],
})

export function parseTitleCandidates(value: string) {
  const candidateLines = value.split(/\r?\n/).filter(line => /^\s*(?:[-*]|\d+[.)])\s+/.test(line) || /\*\*[“\"]/.test(line))
  const quoted = candidateLines.flatMap(line => [...line.matchAll(/[“\"]([^“\"]+)[”\"]/g)].map(match => match[1].trim())).filter(Boolean)
  if (quoted.length) return Array.from(new Set(quoted))
  return value.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*\d.)]+)\s*/, '').replace(/\*\*/g, '').trim()).filter(line => line.length > 8 && !/^\w+\s+(puede|suena|mantiene|ajustando)/i.test(line))
}

export function parseMasterSlides(value: string): IdeaBlock[] {
  const lines = value.replace(/\r/g, '').split('\n')
  const blocks: { label: string; heading: string; lines: string[] }[] = []
  let current: { label: string; heading: string; lines: string[] } | null = null
  for (const line of lines) {
    const match = line.match(/^\s*(?:#{1,4}\s*)?(?:slide|diapositiva)\s*([0-9]+|final|cierre)\s*[:.)\-]?\s*(.*)$/i)
      || line.match(/^\s*([0-9]+|final|cierre)\s*[:.)\-]?\s+(.*)$/i)
    if (match) {
      if (current) blocks.push(current)
      const heading = (match[2] || '').replace(/^[\s:.)\-–—]+/, '').trim()
      current = { label: match[1], heading: /^\([^)]*\)$/.test(heading) ? '' : heading, lines: [] }
    } else if (current) current.lines.push(line)
  }
  if (current) blocks.push(current)
  return blocks.filter(block => !/final|cierre/i.test(block.label)).map((block, index) => {
    const content = block.lines.join('\n').trim()
    const labeled = content.match(/\*\*(?:TITULO|TÍTULO):\*\*\s*(.+?)(?=\s+\*\*(?:BAJADA|SUBT[IÍ]TULO):|$)/i)
    const bold = content.match(/\*\*([^*]+)\*\*/)
    const title = block.heading || labeled?.[1].trim() || (bold && !/^(?:TITULO|TÍTULO|BAJADA|SUBT[IÍ]TULO):?$/i.test(bold[1]) ? bold[1].trim() : '') || `Slide ${index + 1}`
    const text = content.replace(/^\([^)]*\)\s*/, '').replace(labeled?.[0] || (block.heading ? '' : (bold?.[0] || '')), '').replace(/^\s*\n/, '').trim()
    return { id: crypto.randomUUID(), title, text }
  }).filter(block => block.title || block.text)
}

export function formatTitle(value: string, mode: 'upper' | 'lower' | 'title' | 'sentence') {
  const text = value.trim()
  if (mode === 'upper') return text.toLocaleUpperCase()
  if (mode === 'lower') return text.toLocaleLowerCase()
  if (mode === 'sentence') return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1).toLocaleLowerCase() : text
  return text.toLocaleLowerCase().replace(/(^|[\s¡¿])([\p{L}\d])/gu, (_, prefix: string, character: string) => prefix + character.toLocaleUpperCase())
}

export type NoteItem = { id: string; title: string; text: string }

export function toLocalDateTimeInput(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function fromLocalDateTimeInput(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function notesToItems(value: string): NoteItem[] {
  if (!value.trim()) return [{ id: crypto.randomUUID(), title: '', text: '' }]
  return value.split(/\n\s*---\s*\n/).map(part => {
    const lines = part.split('\n')
    const title = lines[0]?.match(/^\[(.*)\]$/)?.[1] || ''
    return { id: crypto.randomUUID(), title, text: (title ? lines.slice(1) : lines).join('\n').trim() }
  })
}

export function itemsToNotes(items: NoteItem[]) {
  return items.filter(item => item.title.trim() || item.text.trim()).map(item => `${item.title.trim() ? `[${item.title.trim()}]\n` : ''}${item.text.trim()}`).join('\n\n---\n\n')
}

export function inferredVisual(asset: NonNullable<PostInput['media']>[number]) {
  const name = asset.name.toLocaleLowerCase()
  const numbered = name.match(/^(\d+)[-_ .]/)
  if (/representative|representativa|portada/.test(name)) return { role: 'representative' as const, sequence: undefined }
  if (/cover/.test(name)) return { role: 'cover' as const, sequence: 0 }
  if (/cierre|closing|final/.test(name)) return { role: 'closing' as const, sequence: 10000 }
  if (numbered) return { role: 'slide' as const, sequence: Number(numbered[1]) }
  return { role: asset.presentationRole || 'other' as const, sequence: asset.sequence }
}

export function visualSequence(asset: NonNullable<PostInput['media']>[number]) {
  return asset.sequence === null ? null : asset.sequence ?? inferredVisual(asset).sequence
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) } catch { return String(error) }
}


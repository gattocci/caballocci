import type { Idea, IdeaAnalysisOptions, IdeaAnalysisProgress, IdeaInput, IdeaPriority, IdeaStatus } from '../../shared/types'
export const priorityLabels: Record<IdeaPriority, string> = { low: 'Baja', normal: 'Normal', high: 'Alta' }
export const statusLabels: Record<IdeaStatus, string> = { inbox: 'Nueva', developing: 'En desarrollo', ready: 'Lista', converted: 'Convertida', archived: 'Archivada' }
export const analysisProgressLabels: Record<IdeaAnalysisProgress['stage'], string> = {
  'loading-model': 'Cargando modelo de embeddings',
  embeddings: 'Preparando embeddings',
  comparing: 'Comparando similitudes entre ideas',
  grouping: 'Formando grupos con las coincidencias',
  saving: 'Guardando resultados',
  done: 'Análisis completado',
}
export const statusFilters: Array<{ value: 'active' | IdeaStatus; label: string }> = [
  { value: 'active', label: 'Activas' }, { value: 'inbox', label: 'Nuevas' }, { value: 'developing', label: 'En desarrollo' },
  { value: 'ready', label: 'Listas' }, { value: 'converted', label: 'Convertidas' }, { value: 'archived', label: 'Archivadas' },
]

export const defaultAnalysisOptions: IdeaAnalysisOptions = { editorialPrefixes: [], stripColonPrefixes: true, stripBracketedText: true, stripNumbers: true, ignoreTitleNumbersInClusterNames: true, minTokenLength: 3, genericTermThreshold: 0.08 }
function migrateAnalysisPreferences() {
  const migrationKey = 'caballocci.ideas.analysis-preferences-migrated-v1'
  try {
    if (localStorage.getItem(migrationKey)) return
    const ignoredKey = 'caballocci.ideas.analysis-ignored-terms'
    const ignored = (localStorage.getItem(ignoredKey) || '').split(/[\n,;]+/).map(term => term.trim().toLocaleLowerCase()).filter(Boolean).sort().join('|')
    if (ignored === ['modo dios', 'prompt', 'prohibido'].sort().join('|')) localStorage.setItem(ignoredKey, '')

    const optionsKey = 'caballocci.ideas.analysis-options'
    const stored = JSON.parse(localStorage.getItem(optionsKey) || '{}')
    if (Array.isArray(stored.editorialPrefixes) && stored.editorialPrefixes.map((term: string) => term.trim().toLocaleLowerCase()).sort().join('|') === ['modo dios', 'prompt', 'prompt prohibido'].sort().join('|')) {
      stored.editorialPrefixes = []
      localStorage.setItem(optionsKey, JSON.stringify(stored))
    }
    localStorage.setItem(migrationKey, '1')
  } catch { /* Optional local preference migration. */ }
}
export function readIgnoredTerms() {
  try { return localStorage.getItem('caballocci.ideas.analysis-ignored-terms') || '' } catch { return '' }
}
export function readAnalysisOptions(): IdeaAnalysisOptions {
  try {
    const stored = JSON.parse(localStorage.getItem('caballocci.ideas.analysis-options') || '{}')
    return { ...defaultAnalysisOptions, ...stored }
  } catch { return defaultAnalysisOptions }
}
export function readFamilyPatterns(): Record<string, string> {
  try { const parsed = JSON.parse(localStorage.getItem('caballocci.ideas.family-patterns') || '{}'); return parsed && typeof parsed === 'object' ? parsed : {} } catch { return {} }
}
export function readMarkedSeries(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('caballocci.ideas.marked-series') || '[]')
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []
  } catch { return [] }
}
export function clusterMembershipKey(ideaIds: string[]) {
  return JSON.stringify([...ideaIds].sort())
}
export function ideaFamily(title: string, sourceName?: string, patterns = readFamilyPatterns()) {
  const configured = sourceName ? patterns[sourceName] : undefined
  if (configured) {
    try { const match = title.match(new RegExp(configured, 'i')); if (match?.[0]) return { family: match[0].replace(/\s*\+\d+\s*:?[ \t]*/g, '').replace(/\s*:\s*$/, '').trim(), title: title.slice(match[0].length).trim() || title.trim() } } catch { /* Invalid local pattern: use generic detection. */ }
  }
  const match = title.match(/^\s*((?:[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\d+]*(?:\s+|$)){1,5})(?::|\s+-\s+|\s{2,})/) || title.match(/^\s*((?:[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\d+]*(?:\s+|$)){1,5})\s*\+\d+\s*:?\s*/)
  if (!match) return { family: '', title: title.trim() }
  const family = match[1].replace(/\s*\+\d+\s*$/, '').trim()
  return { family, title: title.slice(match[0].length).trim() || title.trim() }
}
export function testFamilyPattern(title: string, sourceName: string, patternsText: string) {
  try { const patterns = JSON.parse(patternsText) as Record<string, unknown>; const pattern = patterns[sourceName]; if (typeof pattern !== 'string' || !pattern) return { ok: false, message: 'No hay patrón para esa fuente.' }; const match = title.match(new RegExp(pattern, 'i')); if (!match?.[0]) return { ok: true, message: 'No coincide; se conservaría el título completo.', title }; const family = match[0].replace(/\s*\+\d+\s*:?[ \t]*/g, '').replace(/\s*:\s*$/, '').trim(); return { ok: true, message: `Familia: ${family || 'detectada'} · título resultante:`, title: title.slice(match[0].length).trim() || title.trim() } } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'JSON o regex no válidos.' } }
}
export function familyPatternError(text: string) {
  try { JSON.parse(text); return '' } catch (error) {
    const message = error instanceof Error ? error.message : 'JSON no válido.'
    const position = message.match(/position\s+(\d+)/i)?.[1]
    if (!position) return message
    const index = Number(position); const before = text.slice(0, index); const line = before.split('\n').length; const column = index - (before.lastIndexOf('\n') + 1) + 1
    return `${message} · línea ${line}, columna ${column}`
  }
}

export function commonTitlePrefix(titles: string[]) {
  if (titles.length < 2) return ''
  let prefix = titles[0].trim()
  for (const title of titles.slice(1)) {
    while (prefix && !title.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) prefix = prefix.slice(0, -1)
    if (!prefix) break
  }
  const boundary = prefix.lastIndexOf(' ')
  return boundary > 0 ? prefix.slice(0, boundary + 1).trim() : ''
}

export function clusterTitlePreview(idea: Idea, prefix: string) {
  const title = idea.title || ''
  const remainder = prefix && title.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()) ? title.slice(prefix.length).trim() : title.trim()
  return remainder.length >= 8 ? remainder : (idea.body.trim().slice(0, 84) || 'Idea sin título')
}

export function parseTextFile(text: string, sourceName: string, space: string): IdeaInput[] {
  const normalizedText = text.replace(/^\uFEFF/, '').replace(/\r/g, '')
  const frontmatter = normalizedText.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  const hasYamlFrontmatter = Boolean(frontmatter && frontmatter[1].split('\n').some(line => /^[A-Za-z0-9_-]+\s*:\s*/.test(line.trim())))
  const cleaned = (hasYamlFrontmatter ? normalizedText.slice(frontmatter![0].length) : normalizedText).trim()
  const marked = [...cleaned.matchAll(/==\s*([^=]+?)\s*==/g)]
  const numbered = [...cleaned.matchAll(/(?:^|\n)\s*(?:#{1,6}\s*)?\*\*\s*(\d+[.)]?\s*[^*\n]+?)\s*\*\*/gm)]
  const chunks = numbered.length
    ? numbered.map((match, index) => {
      const start = (match.index ?? 0) + match[0].length
      const end = numbered[index + 1]?.index ?? cleaned.length
      const title = match[1].replace(/^\d+[.)]?\s*/, '').replace(/^['“”\"]|['“”\"]$/g, '').trim()
      return { title, body: cleaned.slice(start, end).trim() }
    })
    : marked.length
    ? marked.map((match, index) => cleaned.slice(match.index! + match[0].length, marked[index + 1]?.index ?? cleaned.length).trim()).map((body, index) => ({ title: marked[index][1].trim(), body }))
    : cleaned.split(/\n\s*\n+/).map(chunk => chunk.trim()).filter(Boolean).map(chunk => {
      const lines = chunk.split('\n'); const first = lines.shift()?.trim() || ''
      const bold = first.match(/^(?:#{1,6}\s*)?\*\*\s*(?:\d+[.)]?\s*)?(.+?)\s*\*\*\s*(.*)$/)
      if (bold) return { title: bold[1].replace(/^['“”\"]|['“”\"]$/g, '').trim(), body: [bold[2], ...lines].filter(Boolean).join('\n').trim() }
      const heading = first.replace(/^#{1,6}\s*/, '').trim()
      return { title: heading.length <= 180 ? heading : '', body: heading.length <= 180 ? lines.join('\n').trim() : [first, ...lines].join('\n').trim() }
    })
  return chunks.filter(item => item.body.trim()).map(item => ({ space, title: item.title || sourceName, body: item.body, tags: [sourceName], sourceName, media: [], status: 'inbox' as const, priority: 'normal' as const, dueDate: null }))
}

function ideaKey(idea: Pick<IdeaInput, 'title' | 'body'>) {
  void idea.title
  return idea.body.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function previewImportDuplicates(inputs: IdeaInput[], existingIdeas: Idea[]) {
  const knownBodies = new Map<string, { title: string; sourceName: string; source: 'workspace' | 'file' }>()
  existingIdeas.forEach(idea => knownBodies.set(ideaKey(idea), { title: idea.title || '', sourceName: idea.sourceName || '', source: 'workspace' }))
  const duplicates: Array<{ incomingTitle: string; existingTitle: string; sourceName: string; existingSourceName: string; source: 'workspace' | 'file' }> = []
  const newCount = inputs.reduce((count, idea) => {
    const existing = knownBodies.get(ideaKey(idea))
    if (existing) {
      duplicates.push({
        incomingTitle: idea.title,
        existingTitle: existing.title,
        sourceName: idea.sourceName || '',
        existingSourceName: existing.sourceName || '',
        source: existing.source,
      })
      return count
    }
    knownBodies.set(ideaKey(idea), { title: idea.title, sourceName: idea.sourceName || '', source: 'file' })
    return count + 1
  }, 0)
  return { newCount, duplicates }
}

export function exploratoryDuplicateKey(idea: Idea) {
  const title = idea.title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  const body = idea.body.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  return title || body ? JSON.stringify([title, body]) : ''
}


migrateAnalysisPreferences()



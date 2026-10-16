import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Database } from 'sql.js'
import { env, pipeline } from '@huggingface/transformers'
import { rows, sqlString } from './sql'
import { defaultIdeaAnalysisOptions, type IdeaAnalysisOptions, type Row } from './types'

type EventWriter = (type: string, entity: string, entityId: string, payload: Record<string, unknown>, at: string) => void

/** Read-side storage for analysis history and persisted clusters. */
export class AnalysisRepository {
  private semanticExtractor: Promise<any> | null = null

  constructor(
    private readonly db: Database,
    private readonly listIdeas: () => Row[],
    private readonly getIdea: (id: string) => Row | undefined,
    private readonly ideaHash: (title: string, body: string) => string,
    private readonly persist: () => void,
    private readonly filePath: string,
    private readonly recordEvent: EventWriter,
  ) {}

  listEvents(entity?: string, entityId?: string): Row[] {
    const clauses = [entity ? `entity = ${sqlString(entity)}` : '', entityId ? `entity_id = ${sqlString(entityId)}` : ''].filter(Boolean)
    return rows(this.db, `SELECT * FROM events${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 500`)
  }

  listClusters(): Array<{ id: string; name: string; algorithm: string; model: string; model_version: string; calculated_at: string; ideaIds: string[] }> {
    return rows(this.db, 'SELECT * FROM idea_clusters ORDER BY calculated_at DESC').map(cluster => ({
      id: String(cluster.id), name: String(cluster.name), algorithm: String(cluster.algorithm), model: String(cluster.model),
      model_version: String(cluster.model_version), calculated_at: String(cluster.calculated_at),
      ideaIds: rows(this.db, `SELECT idea_id FROM idea_cluster_members WHERE cluster_id = ${sqlString(String(cluster.id))} ORDER BY position ASC`).map(member => String(member.idea_id)),
    }))
  }

  async refreshIdeaEmbeddings(ids?: string[], ignoredTerms: string[] = [], options: IdeaAnalysisOptions = defaultIdeaAnalysisOptions): Promise<{ updated: number; model: string; modelVersion: string }> {
    const model = 'multilingual-e5-small'
    const modelVersion = '4'
    const ignored = this.normalizeTerms(ignoredTerms)
    const corpus = this.listIdeas()
    const automaticTerms = this.semanticGenericTerms(corpus, ignored, options)
    const selected = ids?.length ? ids.map(id => corpus.find(idea => idea.id === id)).filter(Boolean) as Row[] : corpus
    const extractor = await this.getSemanticExtractor()
    const now = new Date().toISOString()
    const pending: Array<{ ideaId: string; hash: string; vector: Uint8Array }> = []
    try {
      for (const idea of selected) {
        const title = String(idea.title || '')
        const body = String(idea.body || '')
        const hash = createHash('sha256').update(`${model}:${modelVersion}|${JSON.stringify(options)}|${[...ignored].sort().join(',')}|${[...automaticTerms].sort().join(',')}|${this.ideaHash(title, body)}`).digest('hex')
        const existing = rows(this.db, `SELECT content_hash FROM embeddings WHERE idea_id = ${sqlString(String(idea.id))} AND model = ${sqlString(model)} AND model_version = ${sqlString(modelVersion)}`).at(0)
        if (existing && String(existing.content_hash) === hash) continue
        const output = await extractor(`passage: ${this.semanticText(title, body, automaticTerms, options)}`, { pooling: 'mean', normalize: true })
        pending.push({ ideaId: String(idea.id), hash, vector: this.semanticVector(output) })
      }
      if (!pending.length) return { updated: 0, model, modelVersion }
      this.db.run('BEGIN TRANSACTION')
      for (const item of pending) this.db.run('INSERT OR REPLACE INTO embeddings (idea_id,model,model_version,content_hash,vector,created_at) VALUES (?,?,?,?,?,?)', [item.ideaId, model, modelVersion, item.hash, item.vector, now])
      this.db.run('COMMIT')
      if (selected.length) this.persist()
      return { updated: pending.length, model, modelVersion }
    } catch (error) { try { this.db.run('ROLLBACK') } catch { /* transaction may not have started */ } throw error }
  }

  async listIdeaNeighbors(id: string, limit = 8, ignoredTerms: string[] = [], options: IdeaAnalysisOptions = defaultIdeaAnalysisOptions): Promise<Row[]> {
    if (!this.getIdea(id)) throw new Error('Idea no encontrada')
    await this.refreshIdeaEmbeddings(undefined, ignoredTerms, options)
    const sourceVector = this.embeddingVector(id)
    if (!sourceVector) return []
    return this.listIdeas().filter(idea => idea.id !== id)
      .map(idea => ({ idea, score: this.cosine(sourceVector, this.embeddingVector(String(idea.id)) || []) }))
      .filter(item => item.score > 0.025).sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(30, limit))).map(item => ({ ...item.idea, similarity: Number(item.score.toFixed(4)) }))
  }

  async proposeIdeaClusters(threshold = 0.65, ignoredTerms: string[] = [], options: IdeaAnalysisOptions = defaultIdeaAnalysisOptions): Promise<Array<{ id: string; name: string; ideaIds: string[]; scores: number[] }>> {
    const ignored = this.normalizeTerms(ignoredTerms)
    await this.refreshIdeaEmbeddings(undefined, [...ignored], options)
    const ideas = this.listIdeas()
    const namingIgnored = new Set([...ignored, ...this.semanticGenericTerms(ideas, ignored, options)])
    const documentFrequency = new Map<string, number>()
    for (const idea of ideas) for (const token of new Set(this.ideaTokens(idea, ignored, options.ignoreTitleNumbersInClusterNames))) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1)
    const vectors = new Map(ideas.map(idea => [String(idea.id), this.embeddingVector(String(idea.id)) || []]))
    const neighborCount = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(ideas.length))))
    const nearest = new Map<string, Set<string>>()
    for (const idea of ideas) {
      const id = String(idea.id)
      const matches = ideas.filter(other => other.id !== idea.id).map(other => ({ id: String(other.id), score: this.cosine(vectors.get(id) || [], vectors.get(String(other.id)) || []) })).filter(match => match.score >= threshold).sort((a, b) => b.score - a.score).slice(0, neighborCount)
      nearest.set(id, new Set(matches.map(match => match.id)))
    }
    const groups: string[][] = []
    const remaining = new Set(ideas.map(idea => String(idea.id)))
    while (remaining.size) {
      const root = [...remaining][0]
      const group = [root]
      remaining.delete(root)
      for (const candidate of [...remaining]) {
        const compatible = group.every(member => this.cosine(vectors.get(member) || [], vectors.get(candidate) || []) >= threshold && nearest.get(member)?.has(candidate) && nearest.get(candidate)?.has(member))
        if (compatible) { group.push(candidate); remaining.delete(candidate) }
      }
      if (group.length >= 2) groups.push(group)
    }
    const candidates = groups.map(group => {
      const members = group.map(id => ideas.find(idea => String(idea.id) === id)!).filter(Boolean)
      const terms = this.clusterTerms(members, namingIgnored, documentFrequency, ideas.length, options.ignoreTitleNumbersInClusterNames)
      const rawName = terms.slice(0, 3).join(' ') || 'Cluster sin nombre'
      const pairs = members.reduce((sum, idea, index) => sum + members.slice(index + 1).reduce((part, other) => part + this.cosine(vectors.get(String(idea.id)) || [], vectors.get(String(other.id)) || []), 0), 0)
      const cohesion = pairs / (members.length * (members.length - 1) / 2)
      return { id: crypto.randomUUID(), name: rawName[0]?.toLocaleUpperCase() + rawName.slice(1), ideaIds: group, scores: group.map(() => cohesion) }
    })
    const now = new Date().toISOString()
    this.db.run('BEGIN TRANSACTION')
    try {
      for (const cluster of candidates) {
        this.db.run('INSERT INTO idea_clusters (id,name,algorithm,model,model_version,calculated_at,name_manually_edited) VALUES (?,?,?,?,?,?,0)', [cluster.id, cluster.name, 'complete-linkage-mutual-nearest', 'multilingual-e5-small', '4', now])
        cluster.ideaIds.forEach((ideaId, position) => this.db.run('INSERT INTO idea_cluster_members (cluster_id,idea_id,position,score) VALUES (?,?,?,?)', [cluster.id, ideaId, position, cluster.scores[position]]))
      }
      this.recordEvent('clusters_proposed', 'ideas', 'workspace', { count: candidates.length, threshold }, now)
      this.db.run('COMMIT')
      this.persist()
      return candidates
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  previewIdeaAnalysis(ignoredTerms: string[] = [], options: IdeaAnalysisOptions = defaultIdeaAnalysisOptions) {
    const ignored = this.normalizeTerms(ignoredTerms)
    return { automaticTerms: [...this.semanticGenericTerms(this.listIdeas(), ignored, options)].sort() }
  }

  private async getSemanticExtractor() {
    if (!this.semanticExtractor) {
      const cacheDirectory = path.join(path.dirname(this.filePath), 'transformers-cache')
      fs.mkdirSync(cacheDirectory, { recursive: true })
      env.cacheDir = cacheDirectory
      env.useFSCache = true
      env.allowLocalModels = false
      env.allowRemoteModels = true
      this.semanticExtractor = pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' })
    }
    return this.semanticExtractor
  }

  private normalizeTerms(terms: string[]) { return new Set(terms.map(term => term.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim()).filter(Boolean)) }

  private semanticTitle(title: string, options: IdeaAnalysisOptions) {
    const value = title.trim()
    const afterColon = options.stripColonPrefixes ? value.match(/^[^:]{2,40}:\s*(.+)$/)?.[1] : undefined
    if (afterColon) return afterColon
    const configuredPrefix = options.editorialPrefixes.find(item => item.trim() && value.toLocaleLowerCase().startsWith(item.trim().toLocaleLowerCase()))
    return configuredPrefix ? value.slice(configuredPrefix.length).replace(/^\s*[+\-–—]?\s*\d*\s*/, '').trim() || value : value
  }

  private semanticText(title: string, body: string, genericTerms: Set<string>, options: IdeaAnalysisOptions) {
    const clean = (value: string) => value.replace(options.stripBracketedText ? /\[[^\]]*\]/g : /$^/, ' ').replace(options.stripNumbers ? /\b\d+(?:[.,]\d+)?\b/g : /$^/, ' ').replace(/\s+/g, ' ').trim()
    const removeGeneric = (value: string) => value.split(/\s+/).filter(token => {
      const normalized = token.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}]/gu, '')
      return normalized.length >= options.minTokenLength && !genericTerms.has(normalized)
    }).join(' ')
    const cleanedBody = removeGeneric(clean(body))
    const cleanedTitle = removeGeneric(clean(this.semanticTitle(title, options)))
    return `${cleanedBody} ${cleanedTitle} ${cleanedBody}`.trim()
  }

  private semanticGenericTerms(ideas: Row[], ignored: Set<string>, options: IdeaAnalysisOptions) {
    const frequency = new Map<string, number>()
    const total = ideas.length || 1
    for (const idea of ideas) for (const token of new Set(this.analysisTokens(this.semanticText(String(idea.title || ''), String(idea.body || ''), new Set(), options), ignored))) frequency.set(token, (frequency.get(token) || 0) + 1)
    return new Set([...frequency.entries()].filter(([, count]) => count / total >= options.genericTermThreshold).map(([token]) => token))
  }

  private semanticVector(output: any): Uint8Array {
    const values = output?.tolist ? output.tolist() : output?.data ? Array.from(output.data) : []
    const flat = Array.isArray(values) ? (Array.isArray(values[0]) ? values[0] : values) : []
    return new TextEncoder().encode(JSON.stringify(flat.map(Number)))
  }

  private embeddingVector(id: string): number[] | null {
    const row = rows(this.db, `SELECT vector FROM embeddings WHERE idea_id = ${sqlString(id)} AND model = 'multilingual-e5-small' AND model_version = '4'`).at(0)
    if (!row?.vector) return null
    const bytes = row.vector instanceof Uint8Array ? row.vector : new Uint8Array(row.vector as ArrayBuffer)
    try { const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown; return Array.isArray(parsed) ? parsed.map(Number) : null } catch { return null }
  }

  private cosine(a: number[], b: number[]) { return !a.length || !b.length || a.length !== b.length ? 0 : a.reduce((sum, value, index) => sum + value * b[index], 0) }

  private clusterTerms(ideas: Row[], ignored: Set<string>, corpusFrequency: Map<string, number>, corpusSize: number, ignoreTitleNumbers: boolean) {
    const frequency = new Map<string, number>()
    for (const idea of ideas) for (const token of this.ideaTokens(idea, ignored, ignoreTitleNumbers)) frequency.set(token, (frequency.get(token) || 0) + 1)
    return [...frequency.entries()].map(([token, count]) => {
      const corpusCount = corpusFrequency.get(token) || 0
      return { token, score: count * Math.log(1 + (corpusSize - corpusCount + 0.5) / (corpusCount + 0.5)) }
    }).sort((a, b) => b.score - a.score).map(item => item.token)
  }

  private ideaTokens(idea: Row, ignored: Set<string>, ignoreTitleNumbers = false) {
    const titleText = String(idea.title || '').replace(ignoreTitleNumbers ? /\b\d+(?:[.,]\d+)?\b/g : /$^/, ' ')
    return [...this.analysisTokens(titleText, ignored).flatMap(token => [token, token]), ...this.analysisTokens(String(idea.body || ''), ignored)]
  }

  private analysisTokens(value: string, ignored: Set<string>) {
    return value.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]{3,}/gu)?.filter(token => !ignored.has(token)) || []
  }
}

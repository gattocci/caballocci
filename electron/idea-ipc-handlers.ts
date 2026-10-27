import type { PlannerDatabase } from './database'
import type { IpcMainInvokeEvent } from 'electron'
import {
  validateArgumentCount,
  validateAnalysisTerms,
  validateIdeaAnalysisOptions,
  validateIdeaIds,
  validateIdeaInput,
  validateId,
  validateLimit,
  validateOptionalIdeaIds,
  validateThreshold,
} from './ipc-validation'

type IdeaIpcDependencies = {
  database: PlannerDatabase
  handle(channel: string, callback: (args: unknown[], event: IpcMainInvokeEvent) => unknown): void
  withoutArguments(callback: () => unknown): (args: unknown[]) => unknown
  mapIdea(row: Record<string, unknown>): any
  mapPost(row: Record<string, unknown>): any
  mapIdeaNeighbor(row: Record<string, unknown>): any
  ensurePostMediaFolder(project: string, postId: string): unknown
}

export function registerIdeaIpcHandlers({ database, handle, withoutArguments, mapIdea, mapPost, mapIdeaNeighbor, ensurePostMediaFolder }: IdeaIpcDependencies) {  handle('ideas:list', withoutArguments(() => database.listIdeas().map(mapIdea)))
  handle('ideas:save', args => {
    validateArgumentCount(args, 1)
    return mapIdea(database.saveIdea(validateIdeaInput(args[0])))
  })
  handle('ideas:save-many', args => {
    validateArgumentCount(args, 1)
    if (!Array.isArray(args[0]) || args[0].length > 2_000) throw new TypeError('Lote de ideas no valido')
    const inputs = (args[0] as unknown[]).map(validateIdeaInput)
    const result = database.saveIdeasMany(inputs)
    return { created: result.created.map(mapIdea), skipped: result.skipped, duplicates: result.duplicates }
  })
  handle('ideas:import-history', withoutArguments(() => database.listIdeaImportRuns().map(row => ({ id: row.id, fileName: row.file_name, space: row.space, total: Number(row.total || 0), created: Number(row.created || 0), skipped: Number(row.skipped || 0), importedAt: row.imported_at }))))
  handle('ideas:remove', args => {
    validateArgumentCount(args, 1)
    return database.removeIdea(validateId(args[0], 'idea.id'))
  })
  handle('ideas:convert', args => {
    validateArgumentCount(args, 1)
    const converted = database.convertIdea(validateId(args[0], 'idea.id'))
    ensurePostMediaFolder(String(converted.post.project || ''), String(converted.post.id))
    return { idea: mapIdea(converted.idea), post: mapPost(converted.post) }
  })
  handle('ideas:combine', args => {
    validateArgumentCount(args, 1)
    const combined = database.combineIdeas(validateIdeaIds(args[0]))
    ensurePostMediaFolder(String(combined.post.project || ''), String(combined.post.id))
    return { ideas: combined.ideas.map(mapIdea), post: mapPost(combined.post) }
  })
  handle('ideas:neighbors', args => {
    if (args.length < 1 || args.length > 4) throw new TypeError('Numero de argumentos no valido')
    return database.listIdeaNeighbors(validateId(args[0], 'idea.id'), validateLimit(args[1]), validateAnalysisTerms(args[2]), validateIdeaAnalysisOptions(args[3])).then(rows => rows.map(mapIdeaNeighbor))
  })
  handle('ideas:embeddings-refresh', args => {
    if (args.length > 3) throw new TypeError('Numero de argumentos no valido')
    return database.refreshIdeaEmbeddings(validateOptionalIdeaIds(args[0]), validateAnalysisTerms(args[1]), validateIdeaAnalysisOptions(args[2]))
  })
  handle('ideas:clusters', (args, event) => {
    if (args.length !== 4) throw new TypeError('Numero de argumentos no valido')
    if (typeof args[3] !== 'string' || !args[3] || args[3].length > 100) throw new TypeError('Identificador de analisis no valido')
    const requestId = args[3]
    const progress = (update: { stage: string; completed: number; total: number }) => {
      if (!event.sender.isDestroyed()) event.sender.send('ideas:clusters:progress', { requestId, ...update })
    }
    return database.proposeIdeaClusters(validateThreshold(args[0]), validateAnalysisTerms(args[1]), validateIdeaAnalysisOptions(args[2]), progress).then(clusters => clusters)
  })
  handle('ideas:analysis-preview', args => {
    if (args.length > 2) throw new TypeError('Numero de argumentos no valido')
    return database.previewIdeaAnalysis(validateAnalysisTerms(args[0]), validateIdeaAnalysisOptions(args[1]))
  })
  handle('ideas:clusters-list', withoutArguments(() => database.listIdeaClusters().map(cluster => ({ id: cluster.id, name: cluster.name, ideaIds: cluster.ideaIds, memberScores: cluster.memberScores, algorithm: cluster.algorithm, calculatedAt: cluster.calculated_at }))))
}


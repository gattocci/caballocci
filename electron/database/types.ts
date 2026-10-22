export type Row = Record<string, unknown>
export type IdeaAnalysisProgress = {
  stage: 'loading-model' | 'embeddings' | 'comparing' | 'grouping' | 'saving' | 'done'
  completed: number
  total: number
}
export type IdeaClusterComparison = { ideaId: string; score: number }

export type IdeaAnalysisOptions = {
  editorialPrefixes: string[]
  stripColonPrefixes: boolean
  stripBracketedText: boolean
  stripNumbers: boolean
  ignoreTitleNumbersInClusterNames: boolean
  minTokenLength: number
  genericTermThreshold: number
}

export const defaultIdeaAnalysisOptions: IdeaAnalysisOptions = {
  editorialPrefixes: [],
  stripColonPrefixes: true,
  stripBracketedText: true,
  stripNumbers: true,
  ignoreTitleNumbersInClusterNames: true,
  minTokenLength: 3,
  genericTermThreshold: 0.08,
}

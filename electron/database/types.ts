export type Row = Record<string, unknown>

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

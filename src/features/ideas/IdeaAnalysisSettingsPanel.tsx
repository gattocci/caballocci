import type { IdeaAnalysisOptions } from '../../shared/types'
import { IdeaFamilyPatternsSettings } from './IdeaFamilyPatternsSettings'

export function IdeaAnalysisSettingsPanel({ ignoredTermsText, onIgnoredTermsChange, analysisOptions, onAnalysisOptionsChange, automaticTerms }: {
  ignoredTermsText: string
  onIgnoredTermsChange(value: string): void
  analysisOptions: IdeaAnalysisOptions
  onAnalysisOptionsChange(update: (current: IdeaAnalysisOptions) => IdeaAnalysisOptions): void
  automaticTerms: string[]
}) {
  return <details className="idea-analysis-settings"><summary>Configuración del análisis local</summary>
    <p className="idea-analysis-intro">Ajusta qué señales se comparan al encontrar ideas relacionadas. Estos cambios no editan tus ideas originales.</p>
    <IdeaFamilyPatternsSettings />
    <label>Términos que quieres ignorar<textarea value={ignoredTermsText} onChange={event => onIgnoredTermsChange(event.target.value)} placeholder="ejemplo, ejemplo, ejemplo" /></label>
    <label>Prefijos editoriales que quieres ignorar<textarea value={analysisOptions.editorialPrefixes.join('\n')} onChange={event => onAnalysisOptionsChange(current => ({ ...current, editorialPrefixes: event.target.value.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean) }))} placeholder={'ejemplo\nejemplo'} /></label>
    <div className="idea-analysis-options"><label><input type="checkbox" checked={analysisOptions.stripColonPrefixes} onChange={event => onAnalysisOptionsChange(current => ({ ...current, stripColonPrefixes: event.target.checked }))} /> Quitar prefijo antes de dos puntos en títulos</label><label><input type="checkbox" checked={analysisOptions.stripBracketedText} onChange={event => onAnalysisOptionsChange(current => ({ ...current, stripBracketedText: event.target.checked }))} /> Excluir texto entre corchetes</label><label><input type="checkbox" checked={analysisOptions.stripNumbers} onChange={event => onAnalysisOptionsChange(current => ({ ...current, stripNumbers: event.target.checked }))} /> Excluir números de los embeddings</label><label><input type="checkbox" checked={analysisOptions.ignoreTitleNumbersInClusterNames} onChange={event => onAnalysisOptionsChange(current => ({ ...current, ignoreTitleNumbersInClusterNames: event.target.checked }))} /> Ignorar números de títulos al nombrar clusters</label></div>
    <details className="idea-analysis-advanced"><summary>Avanzado · sensibilidad y términos automáticos</summary><p>Úsalo solo si los grupos incluyen demasiadas coincidencias genéricas o dejan fuera ideas relacionadas.</p>
      <div className="idea-analysis-numeric"><label>Longitud mínima de palabra<input type="number" min="1" max="10" value={analysisOptions.minTokenLength} onChange={event => onAnalysisOptionsChange(current => ({ ...current, minTokenLength: Math.max(1, Math.min(10, Number(event.target.value) || 1)) }))} /></label><label>Umbral de términos repetidos (%)<input type="number" min="1" max="100" value={Math.round(analysisOptions.genericTermThreshold * 100)} onChange={event => onAnalysisOptionsChange(current => ({ ...current, genericTermThreshold: Math.max(0.01, Math.min(1, (Number(event.target.value) || 1) / 100)) }))} /></label></div>
      <div className="idea-analysis-preview"><strong>Excluir automáticamente ({automaticTerms.length})</strong><span>{automaticTerms.slice(0, 80).join(', ') || 'No se detectaron términos frecuentes'}{automaticTerms.length > 80 ? ', …' : ''}</span></div>
    </details>
    <small>La configuración se guarda en este dispositivo. Los originales no se modifican; el siguiente análisis regenerará los vectores si cambian las reglas.</small>
  </details>
}

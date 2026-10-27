import type { IdeaImportRun, IdeaInput } from '../../shared/types'
import { X } from 'lucide-react'
import type { previewImportDuplicates } from './idea-utils'

type ImportPreview = { fileName: string; ideas: IdeaInput[]; warning: string }
type DuplicateNotice = { title: string; existingTitle: string; existingSourceName: string }
type ImportDuplicatePreview = ReturnType<typeof previewImportDuplicates>
type IdeasTab = 'ideas' | 'imports'

type IdeaImportPanelsProps = {
  ideasTab: IdeasTab
  importHistory: IdeaImportRun[]
  importMessage: string
  importDuplicates: DuplicateNotice[]
  importPreview: ImportPreview | null
  importDuplicatePreview: ImportDuplicatePreview | null
  importing: boolean
  onRefreshHistory(): void
  onCancelPreview(): void
  onConfirmImport(): void
}

export function IdeaImportPanels({ ideasTab, importHistory, importMessage, importDuplicates, importPreview, importDuplicatePreview, importing, onRefreshHistory, onCancelPreview, onConfirmImport }: IdeaImportPanelsProps) {
  return <>
    {ideasTab === 'imports' && <section className="ideas-import-history"><header><div><span>ARCHIVOS LOCALES</span><h2>Historial de importaciones</h2></div><button type="button" className="settings-button" onClick={onRefreshHistory}>Actualizar</button></header>{importHistory.length ? <div className="ideas-import-history-list">{importHistory.map(run => <article key={run.id}><div><strong>{run.fileName}</strong><small>{new Date(run.importedAt).toLocaleString()} · {run.space || 'Todos los contenidos'}</small></div><div className="ideas-import-stats"><span>{run.total} detectadas</span><span>{run.created} nuevas</span><span>{run.skipped} duplicadas</span></div></article>)}</div> : <p className="ideas-import-history-empty">Todavía no hay importaciones registradas.</p>}</section>}
    {importMessage && <div className="ideas-import-result"><p className="ideas-import-message">{importMessage}</p>{importDuplicates.length > 0 && <details><summary>Ver {importDuplicates.length} coincidencias existentes</summary><ul>{importDuplicates.map((duplicate, index) => <li key={`${duplicate.title}-${index}`}><strong>{duplicate.title}</strong><span>ya existe como “{duplicate.existingTitle}”{duplicate.existingSourceName ? ` · ${duplicate.existingSourceName}` : ''}</span></li>)}</ul></details>}</div>}
    {importPreview && importDuplicatePreview && <section className="ideas-import-preview" aria-label="Vista previa de importación">
      <header><div><span>VISTA PREVIA</span><h2>{importPreview.fileName}</h2><p>Revisa qué se añadirá antes de guardar. Las coincidencias se vuelven a comprobar al importar.</p></div><button type="button" className="icon-button" aria-label="Cancelar importación" onClick={onCancelPreview}><X size={16} /></button></header>
      {importPreview.warning && <p className="ideas-import-warning" role="status">{importPreview.warning}</p>}
      <div className="ideas-import-preview-stats"><article><strong>{importPreview.ideas.length}</strong><span>ideas detectadas</span></article><article><strong>{importDuplicatePreview.newCount}</strong><span>nuevas</span></article><article><strong>{importDuplicatePreview.duplicates.length}</strong><span>duplicadas que se omitirán</span></article></div>
      <details className="ideas-import-preview-list"><summary>Revisar {importPreview.ideas.length} ideas preparadas</summary><ul>{importPreview.ideas.map((idea, index) => <li key={`${index}-${idea.title}`}><strong>{idea.title || 'Idea sin título'}</strong><span>{idea.body.slice(0, 220)}{idea.body.length > 220 ? '…' : ''}</span></li>)}</ul></details>
      {importDuplicatePreview.duplicates.length > 0 && <details className="ideas-import-preview-list"><summary>Ver {importDuplicatePreview.duplicates.length} coincidencias</summary><ul>{importDuplicatePreview.duplicates.map((duplicate, index) => <li key={`${index}-${duplicate.incomingTitle}`}><strong>{duplicate.incomingTitle}</strong><span>{duplicate.source === 'file' ? `Repetida en este archivo; primera entrada: “${duplicate.existingTitle}”` : `Ya existe como “${duplicate.existingTitle}”`}{duplicate.existingSourceName ? ` · ${duplicate.existingSourceName}` : ''}</span></li>)}</ul></details>}
      <footer><button type="button" className="ghost-button" disabled={importing} onClick={onCancelPreview}>Cancelar</button><button type="button" className="save-button" disabled={importing} onClick={onConfirmImport}>{importing ? 'Importando…' : `Importar lote · ${importDuplicatePreview.newCount} nuevas`}</button></footer>
    </section>}
  </>
}




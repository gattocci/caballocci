import type { ContentRecord, ContentTypeTemplate } from '../../shared/types'
import { EnrichmentEditor } from './EnrichmentEditor'

export function ImportedSourceRecords({ records, templates, onSaveEnriched }: {
  records: ContentRecord[]
  templates: ContentTypeTemplate[]
  onSaveEnriched(record: ContentRecord, value: Record<string, unknown> | string): void
}) {
  const matchingTemplateRecords = records.flatMap(record => {
    const template = templates.find(item => item.contentType === String(record.normalized.contentType || 'post'))
    return template ? [{ record, template }] : []
  })

  return <>
    <section className="source-panel"><header><div><span>CAMPOS EXTRA</span><h2>{records.length} registros importados</h2></div></header><p className="export-copy">Usa estos campos solo para metadatos internos. El título, texto e ideas agrupadas se editan directamente en cada publicación y se exportan con el guion por bloques.</p><div className="content-record-list">{records.map(record => <article key={record.id}><div><strong>{record.normalized.title ? String(record.normalized.title) : record.externalRef}</strong><small>{record.externalRef} · {record.titleManuallyEdited ? 'título protegido' : 'título sincronizable'}</small><small>{record.postId ? 'publicación vinculada al tablero' : 'sin publicación vinculada'} · {record.ideaId ? 'idea vinculada' : 'sin idea vinculada'}</small></div><EnrichmentEditor record={record} template={undefined} onSave={onSaveEnriched} /></article>)}</div></section>
    <section className="source-panel"><header><div><span>DATOS RECIBIDOS</span><h2>Originales y normalizados</h2></div></header><div className="source-data-list">{records.map(record => <details className="source-data" key={record.id}><summary>{record.normalized.title ? String(record.normalized.title) : record.externalRef}</summary><pre>{JSON.stringify({ original: record.raw, normalizado: record.normalized }, null, 2)}</pre></details>)}</div></section>
    {matchingTemplateRecords.length > 0 && <section className="source-panel"><header><div><span>FORMULARIOS DE PLANTILLA</span><h2>Campos por tipo de contenido</h2></div></header><div className="content-record-list">{matchingTemplateRecords.map(({ record, template }) => <article key={record.id}><div><strong>{record.normalized.title ? String(record.normalized.title) : record.externalRef}</strong><small>{template.contentType}</small></div><EnrichmentEditor record={record} template={template} onSave={onSaveEnriched} /></article>)}</div></section>}
  </>
}

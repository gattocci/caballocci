import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import type { ContentRecord, ContentTypeTemplate } from '../../shared/types'
import { parseRecord } from './source-utils'

export function EnrichmentEditor({ record, template, onSave }: { record: ContentRecord; template: ContentTypeTemplate | undefined; onSave(record: ContentRecord, value: Record<string, unknown>): void }) {
  const [draft, setDraft] = useState<Record<string, unknown>>(record.enriched)
  const [jsonError, setJsonError] = useState('')
  useEffect(() => setDraft(record.enriched), [record])
  if (!template?.fields.length) return <details className="advanced-enrichment"><summary>Editar JSON avanzado</summary><textarea defaultValue={JSON.stringify(record.enriched, null, 2)} onBlur={event => { try { const value = JSON.parse(event.target.value) as unknown; if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('El valor debe ser un objeto JSON.'); setJsonError(''); onSave(record, value as Record<string, unknown>) } catch (error) { setJsonError(error instanceof Error ? error.message : 'JSON no válido. Revisa el formato e inténtalo de nuevo.') } }} aria-label={`Enriquecimiento de ${record.externalRef}`} aria-invalid={Boolean(jsonError)} aria-describedby={jsonError ? `enrichment-error-${record.id}` : undefined} />{jsonError && <small className="field-error" id={`enrichment-error-${record.id}`} role="alert">{jsonError}</small>}</details>
  return <div className="enrichment-fields">{template.fields.map(field => <label key={field.key}>{field.label}{field.type === 'textarea' ? <textarea value={String(draft[field.key] || '')} onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} /> : <input value={String(draft[field.key] || '')} onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} />}</label>)}<button className="settings-button" onClick={() => onSave(record, draft)}><Save size={13} /> Guardar</button></div>
}


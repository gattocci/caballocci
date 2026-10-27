import { Check } from 'lucide-react'
import type { ImportReport } from '../../shared/types'

export function SourceImportPreview({ preview, busy, onConfirm }: {
  preview: { previewId: string; truncated: boolean; records: Record<string, unknown>[]; report: { summary: ImportReport } }
  busy: boolean
  onConfirm(): void
}) {
  const { summary } = preview.report
  const warning = preview.truncated
    ? 'La respuesta superó el límite configurado y fue recortada.'
    : summary.total === 0
      ? 'La fuente devolvió cero registros. No se aplicaron cambios.'
      : 'No hay cambios en los datos, pero puedes confirmar para actualizar la última sincronización y completar destinos faltantes.'
  const columns = Array.from(new Set(preview.records.flatMap(record => Object.keys(record)))).slice(0, 8)

  return <section className="source-panel import-preview"><header><div><span>PREVIEW</span><h2>{summary.total} registros recibidos</h2></div><button className="save-button" disabled={busy || summary.total === 0} onClick={onConfirm}><Check size={15} /> Confirmar sincronización</button></header><div className="import-summary"><b>{summary.new} nuevos</b><b>{summary.updated} actualizados</b><b>{summary.unchanged} sin cambios</b><b>{summary.invalid} inválidos</b></div>{(preview.truncated || summary.total === 0 || summary.unchanged === summary.total) && <p className="source-warning">{warning}</p>}<div className="preview-table-wrap"><table><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.records.map((record, index) => <tr key={index}>{columns.map(column => <td key={column}>{String(record[column] ?? '')}</td>)}</tr>)}</tbody></table></div></section>
}

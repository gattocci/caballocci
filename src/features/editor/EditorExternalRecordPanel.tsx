import type { ContentRecord } from '../../shared/types'

export function EditorExternalRecordPanel({ record }: { record: ContentRecord }) {
  return <section className="external-data"><header><div><span>FUENTE EXTERNA</span><strong>{record.externalRef}</strong></div><small>{record.lastSeenAt ? `Visto por última vez: ${new Date(record.lastSeenAt).toLocaleString()}` : ''}</small></header><details open><summary>Registro original</summary><pre>{JSON.stringify(record.raw, null, 2)}</pre></details><details><summary>Registro normalizado</summary><pre>{JSON.stringify(record.normalized, null, 2)}</pre></details><details><summary>Enriquecimiento interno</summary><pre>{JSON.stringify(record.enriched, null, 2)}</pre></details></section>
}

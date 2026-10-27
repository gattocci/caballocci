import type { CatalogSync } from '../../shared/types'

type CatalogKind = 'resource' | 'resource_lite'

export function EditorCatalogPanel({
  categoryId, onCategoryIdChange, summary, onSummaryChange, content, onContentChange, useHashtags, onUseHashtagsChange,
  sync, endpoint, onEndpointChange, createdBy, onCreatedByChange, token, onTokenChange, configured, kind, onKindChange,
  busy, message, onSaveConfig, onSync, preview,
}: {
  categoryId: string
  onCategoryIdChange(value: string): void
  summary: string
  onSummaryChange(value: string): void
  content: string
  onContentChange(value: string): void
  useHashtags: boolean
  onUseHashtagsChange(value: boolean): void
  sync: CatalogSync | null
  endpoint: string
  onEndpointChange(value: string): void
  createdBy: string
  onCreatedByChange(value: string): void
  token: string
  onTokenChange(value: string): void
  configured: boolean
  kind: CatalogKind
  onKindChange(value: CatalogKind): void
  busy: boolean
  message: string
  onSaveConfig(): void
  onSync(dryRun: boolean): void
  preview: unknown
}) {
  return <>
    <div className="catalog-fields"><label>category_id (solo Resource)<input type="number" min="1" step="1" value={categoryId} onChange={event => onCategoryIdChange(event.target.value)} placeholder="Ej. 4" /></label><label>Resumen del catálogo<textarea value={summary} onChange={event => onSummaryChange(event.target.value)} placeholder="Resumen breve; conserva saltos de línea y Markdown pegado." /></label><label>Contenido del catálogo<textarea value={content} onChange={event => onContentChange(event.target.value)} placeholder="Pega aquí el Markdown completo." /></label><label><input type="checkbox" checked={useHashtags} onChange={event => onUseHashtagsChange(event.target.checked)} /> Convertir hashtags a tags (requiere IDs)</label></div>
    <section className="external-data catalog-panel"><header><div><span>INTEGRACIÓN DE CONTENIDO</span><strong>{sync ? `Estado: ${sync.action}` : 'Sin sincronizar'}</strong></div>{sync?.updatedAt && <small>{new Date(sync.updatedAt).toLocaleString()}</small>}</header><label>Endpoint<input value={endpoint} onChange={event => onEndpointChange(event.target.value)} placeholder="https://dominio.tld/api/integrations/content/batch" /></label><label>CONTENT_INTEGRATION_CREATED_BY<input value={createdBy} onChange={event => onCreatedByChange(event.target.value)} placeholder="UUID del administrador" /></label><label>Token de integración<input type="password" value={token} onChange={event => onTokenChange(event.target.value)} placeholder={configured ? 'Guardado de forma segura; deja vacío para conservarlo' : 'Token largo'} /></label><label>Tipo<select value={kind} onChange={event => onKindChange(event.target.value as CatalogKind)}><option value="resource">Resource</option><option value="resource_lite">Resource Lite</option></select></label><div className="source-actions"><button className="settings-button" disabled={busy || !endpoint || !createdBy} onClick={onSaveConfig}>Guardar configuración</button><button className="settings-button" disabled={busy || !configured} onClick={() => onSync(true)}>Probar (dry run)</button><button className="save-button" disabled={busy || !configured} onClick={() => onSync(false)}>Sincronizar</button></div>{message && <p className="source-message">{message}</p>}{sync?.publicUrl && <a href={sync.publicUrl} target="_blank" rel="noreferrer">Abrir contenido remoto</a>}{sync?.error && <pre>{sync.error}</pre>}<details><summary>Payload generado</summary><pre>{JSON.stringify(preview, null, 2)}</pre></details></section>
  </>
}

import { Download, Plus, RefreshCw, Save } from 'lucide-react'
import type { ExportProfile } from '../../shared/types'

export const exportFieldOptions = [
  ['Título de publicación', 'post.title'], ['Texto de publicación', 'post.caption'], ['Notas', 'post.notes'], ['Tipo de contenido', 'post.contentType'], ['Estado', 'planning.status'], ['Fecha de planificación', 'planning.date'], ['Proyecto / espacio', 'planning.project'], ['Hashtags', 'post.hashtags'], ['Plataformas', 'post.platforms'], ['Media', 'post.media'], ['Datos de media', 'post.mediaAssets'], ['Ideas agrupadas', 'ideas'], ['Idea 1: título', 'ideas.0.title'], ['Idea 1: texto', 'ideas.0.body'], ['Idea 2: título', 'ideas.1.title'], ['Idea 2: texto', 'ideas.1.body'], ['Referencia externa', 'externalRef'], ['JSON raw', 'raw'],
] as const

type ExportStatus = 'all' | 'idea' | 'draft' | 'review' | 'approved' | 'scheduled' | 'published' | 'archived'

type SourceExportPanelProps = {
  profiles: ExportProfile[]
  selectedProfileId: string
  onProfileChange(value: string): void
  includeTitle: boolean
  onIncludeTitleChange(value: boolean): void
  includeIntro: boolean
  onIncludeIntroChange(value: boolean): void
  ideaColumns: number
  onIdeaColumnsChange(value: number): void
  onApplyRecipe(): void
  profileName: string
  onProfileNameChange(value: string): void
  selectedExportField: string
  onExportFieldChange(value: string): void
  profileColumnsText: string
  onProfileColumnsChange(value: string): void
  onAddField(): void
  onSaveProfile(): void
  exportScope: 'all' | 'source'
  onExportScopeChange(value: 'all' | 'source'): void
  hasSelectedSource: boolean
  exportProject: string
  onExportProjectChange(value: string): void
  exportStatus: ExportStatus
  onExportStatusChange(value: ExportStatus): void
  deltaOnly: boolean
  onDeltaOnlyChange(value: boolean): void
  onDownload(): void
}

export function SourceExportPanel(props: SourceExportPanelProps) {
  const { profiles, selectedProfileId, onProfileChange, includeTitle, onIncludeTitleChange, includeIntro, onIncludeIntroChange, ideaColumns, onIdeaColumnsChange, onApplyRecipe, profileName, onProfileNameChange, selectedExportField, onExportFieldChange, profileColumnsText, onProfileColumnsChange, onAddField, onSaveProfile, exportScope, onExportScopeChange, hasSelectedSource, exportProject, onExportProjectChange, exportStatus, onExportStatusChange, deltaOnly, onDeltaOnlyChange, onDownload } = props

  return <section className="source-panel configuration-panel">
    <header><div><span>EXPORTACIÓN CSV</span><h2>Guion por bloques</h2></div>{profiles.length > 0 && <select value={selectedProfileId} onChange={event => onProfileChange(event.target.value)}>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>}</header>
    <p className="export-copy">Una fila por publicación: título, texto inicial y los textos de sus ideas agrupadas en el orden del editor.</p>
    <div className="export-recipe"><label className="export-check"><input type="checkbox" checked={includeTitle} onChange={event => onIncludeTitleChange(event.target.checked)} /> Título</label><label className="export-check"><input type="checkbox" checked={includeIntro} onChange={event => onIncludeIntroChange(event.target.checked)} /> Texto inicial</label><label>Columnas de ideas<input type="number" min="0" max="30" value={ideaColumns} onChange={event => onIdeaColumnsChange(Number(event.target.value))} /></label><button type="button" className="settings-button" onClick={onApplyRecipe}><RefreshCw size={14} /> Aplicar receta</button></div>
    <div className="source-grid"><label>Nombre del perfil<input value={profileName} onChange={event => onProfileNameChange(event.target.value)} /></label><label>Agregar campo adicional<select value={selectedExportField} onChange={event => onExportFieldChange(event.target.value)}>{exportFieldOptions.map(([label, source]) => <option value={source} key={source}>{label}</option>)}</select><button type="button" className="settings-button" onClick={onAddField}><Plus size={14} /> Agregar campo</button></label></div>
    <details className="export-advanced"><summary>Columnas avanzadas</summary><textarea value={profileColumnsText} onChange={event => onProfileColumnsChange(event.target.value)} /></details>
    <div className="source-actions"><button className="save-button" onClick={onSaveProfile}><Save size={15} /> Guardar perfil</button><label className="export-mode"><span>Alcance</span><select value={exportScope} onChange={event => onExportScopeChange(event.target.value as 'all' | 'source')}><option value="all">Todo el planner</option><option value="source" disabled={!hasSelectedSource}>Fuente actual</option></select></label><label className="export-mode"><span>Proyecto / espacio</span><input value={exportProject} onChange={event => onExportProjectChange(event.target.value)} placeholder="Todos" /></label><label className="export-mode"><span>Estado</span><select value={exportStatus} onChange={event => onExportStatusChange(event.target.value as ExportStatus)}><option value="all">Todos</option><option value="idea">Ideas</option><option value="draft">Borradores</option><option value="review">En revisión</option><option value="approved">Aprobados</option><option value="scheduled">Programados</option><option value="published">Publicados</option><option value="archived">Archivados</option></select></label><label className="export-mode"><input type="checkbox" checked={deltaOnly} onChange={event => onDeltaOnlyChange(event.target.checked)} /> Solo nuevos o modificados</label><button className="settings-button" disabled={!selectedProfileId} onClick={onDownload}><Download size={15} /> Descargar CSV</button></div>
  </section>
}

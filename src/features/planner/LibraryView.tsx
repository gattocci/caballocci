import { useEffect, useState } from 'react'
import { FileImage, FileText, Film, FolderOpen, Plus } from 'lucide-react'
import { ViewHeading } from '../../components/layout/AppShell'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import type { MediaAsset } from '../../shared/types'

export function LibraryView() {
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [mode, setMode] = useState<'copy' | 'reference'>('copy')
  useEffect(() => { void window.planner.media.list().then(setAssets).catch(error => reportAppError(error, 'No se pudo cargar la biblioteca multimedia')) }, [])
  const add = async () => {
    const imported = await window.planner.media.choose(mode)
    setAssets(current => [...imported, ...current.filter(item => !imported.some(next => next.id === item.id))])
  }
  return <section className="workspace library-workspace">  <ViewHeading title="Biblioteca multimedia" subtitle="Tus archivos permanecen en este equipo."><div className="segmented" role="group" aria-label="Cómo añadir archivos"><button type="button" aria-pressed={mode === 'copy'} className={mode === 'copy' ? 'active' : ''} onClick={() => setMode('copy')}>Copiar a biblioteca</button><button type="button" aria-pressed={mode === 'reference'} className={mode === 'reference' ? 'active' : ''} onClick={() => setMode('reference')}>Referenciar original</button></div><button type="button" className="new-button" onClick={() => void runWithErrorReporting(add, 'No se pudieron añadir archivos a la biblioteca')}><Plus size={17} /> Añadir archivos</button></ViewHeading>
    {assets.length ? <div className="asset-grid">{assets.map(asset => { const AssetIcon = asset.kind === 'image' ? FileImage : asset.kind === 'video' ? Film : FileText; return <article key={asset.id}><div className={`asset-preview ${asset.kind}`}><AssetIcon size={34} aria-hidden="true" /></div><strong title={asset.name}>{asset.name}</strong><span>{asset.kind === 'image' ? 'Imagen' : asset.kind === 'video' ? 'Vídeo' : 'Documento'}</span><small>{(asset.size / 1024 / 1024).toFixed(1)} MB · {asset.mode === 'copy' ? 'En biblioteca' : 'Referenciado'}</small><button type="button" onClick={() => void runWithErrorReporting(() => window.planner.media.reveal(asset.id), 'No se pudo abrir la ubicación del archivo')}><FolderOpen size={14} /> Abrir ubicación</button></article> })}</div> : <div className="empty-library"><div><FileImage size={32} /></div><h3>Tu biblioteca está lista</h3><p>Añade imágenes, vídeos o documentos desde tu equipo. Podrás vincularlos a cada publicación desde el editor.</p><button type="button" className="new-button" onClick={() => void runWithErrorReporting(add, 'No se pudieron añadir archivos a la biblioteca')}><Plus size={17} /> Elegir archivos</button></div>}
  </section>
}
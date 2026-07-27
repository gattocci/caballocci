import { useState } from 'react'
import { Archive, Clipboard, FileImage, Hash, Instagram, MessageCircle, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import { contentLabels, platformMeta, statusMeta } from '../../shared/constants'
import { PlatformMark } from '../../components/layout/AppShell'
import { usePlanner } from '../../app/store'
import type { ContentType, Platform, Post, PostInput, PostStatus } from '../../shared/types'

const blankPost = (): PostInput => ({
  title: '', caption: '', notes: '', hashtags: [], mentions: [], platforms: ['instagram'],
  contentType: 'reel', status: 'idea', scheduledAt: new Date().toISOString(), durationMinutes: 60,
  project: 'Mi contenido', color: '#e76042',
})

function Preview({ draft }: { draft: PostInput }) {
  const platform = draft.platforms[0] || 'instagram'
  const text = [draft.caption, ...draft.hashtags].join(' ').trim()
  return <div className="preview-wrap">
    <div className="preview-platforms">{draft.platforms.map(p => <button key={p}><PlatformMark platform={p} />{platformMeta[p].label}</button>)}</div>
    <div className={'social-preview ' + platform}>
      <header><div className="preview-avatar">CP</div><div><strong>tu_cuenta</strong><span>Vista previa local</span></div><MoreHorizontal size={17} /></header>
      <div className="preview-media"><Instagram size={42} /><span>{contentLabels[draft.contentType]}</span></div>
      <div className="preview-actions"><MessageCircle /><Archive /><Clipboard /></div>
      <p><strong>tu_cuenta </strong>{text || 'Aquí aparecerá el texto de tu publicación.'}</p>
    </div>
    <button className="copy-helper" onClick={() => window.planner.clipboard.write(text)}><Clipboard size={16} /> Copiar texto para publicar</button>
  </div>
}

export function Editor({ initial, onClose }: { initial: Post | null; onClose(): void }) {
  const { save, remove } = usePlanner()
  const [draft, setDraft] = useState<PostInput>(initial ? { ...initial } : blankPost())
  const [tab, setTab] = useState<'content' | 'preview' | 'notes'>('content')
  const [saving, setSaving] = useState(false)
  const update = <K extends keyof PostInput>(key: K, value: PostInput[K]) => setDraft(d => ({ ...d, [key]: value }))
  const togglePlatform = (platform: Platform) => update('platforms', draft.platforms.includes(platform) ? draft.platforms.filter(p => p !== platform) : [...draft.platforms, platform])
  const submit = async () => { setSaving(true); await save(draft); setSaving(false); onClose() }
  const attach = async () => update('media', [...(draft.media || []), ...await window.planner.media.choose('copy')])

  return <div className="editor-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><aside className="editor">
    <header><div><span>{initial ? 'EDITAR PUBLICACIÓN' : 'NUEVA PUBLICACIÓN'}</span><h2>{draft.title || 'Sin título todavía'}</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></header>
    <div className="editor-tabs"><button className={tab === 'content' ? 'active' : ''} onClick={() => setTab('content')}>Contenido</button><button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Vista previa</button><button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>Notas</button></div>
    <div className="editor-body">
      {tab === 'content' && <>
        <label>Título<input value={draft.title} onChange={e => update('title', e.target.value)} placeholder="Nombra esta pieza de contenido" /></label>
        <div className="field-row"><label>Formato<select value={draft.contentType} onChange={e => update('contentType', e.target.value as ContentType)}>{Object.entries(contentLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Estado<select value={draft.status} onChange={e => update('status', e.target.value as PostStatus)}>{Object.entries(statusMeta).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}</select></label></div>
        <label>Plataformas<div className="platform-selector">{(['instagram', 'facebook', 'x'] as Platform[]).map(p => <button type="button" className={draft.platforms.includes(p) ? 'active' : ''} key={p} onClick={() => togglePlatform(p)}><PlatformMark platform={p} />{platformMeta[p].label}</button>)}</div></label>
        <label>Texto de la publicación<div className="caption-box"><textarea value={draft.caption} onChange={e => update('caption', e.target.value)} placeholder="Escribe pensando en la persona que lo leerá..." /><span>{draft.caption.length} caracteres</span></div></label>
        <label><span className="label-icon"><Hash size={14} /> Hashtags</span><input value={draft.hashtags.join(' ')} onChange={e => update('hashtags', e.target.value.split(/\s+/).filter(Boolean))} placeholder="#contenido #campaña" /></label>
        <div className="field-row"><label>Fecha y hora<input type="datetime-local" value={draft.scheduledAt?.slice(0, 16) || ''} onChange={e => update('scheduledAt', e.target.value ? new Date(e.target.value).toISOString() : null)} /></label><label>Proyecto<input value={draft.project} onChange={e => update('project', e.target.value)} /></label></div>
        <button className="media-drop" onClick={attach}><FileImage size={23} /><span><strong>Añadir material</strong><small>Imágenes, vídeo o documentos</small></span><Plus size={18} /></button>
        {draft.media?.map(media => <div className="media-row" key={media.id}><FileImage size={18} /><span>{media.name}</span><small>{(media.size / 1024 / 1024).toFixed(1)} MB</small></div>)}
      </>}
      {tab === 'preview' && <Preview draft={draft} />}
      {tab === 'notes' && <label>Notas internas<textarea className="notes-area" value={draft.notes} onChange={e => update('notes', e.target.value)} placeholder="Instrucciones, observaciones, comentarios del cliente..." /></label>}
    </div>
    <footer>{initial ? <button className="danger-button" title="Eliminar" onClick={async () => { await remove(initial.id); onClose() }}><Trash2 size={16} /></button> : <span />}<div><button className="ghost-button" onClick={onClose}>Cancelar</button><button className="save-button" disabled={!draft.title || saving} onClick={submit}>{saving ? 'Guardando...' : 'Guardar publicación'}</button></div></footer>
  </aside></div>
}

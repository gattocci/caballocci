import { Clipboard, Sparkles } from 'lucide-react'
import { parseTitleCandidates } from './editor-utils'

export function EditorAssistantPanel({ idea, onIdeaChange, titles, onTitlesChange, onSelectTitle, master, onMasterChange, message, onApply, onCopyMark }: {
  idea: string
  onIdeaChange(value: string): void
  titles: string
  onTitlesChange(value: string): void
  onSelectTitle(title: string): void
  master: string
  onMasterChange(value: string): void
  message: string
  onApply(): void
  onCopyMark(): void
}) {
  const candidates = parseTitleCandidates(titles)

  return <section className="ai-assistant"><header><div><span>INGESTA DE RESPUESTAS</span><strong>Convierte tus textos en una publicación</strong></div><Sparkles size={19} /></header><p className="assistant-hint">Se detectan títulos y slides numeradas; las secciones “final” o “cierre” se descartan.</p>
    <label>Original<textarea value={idea} onChange={event => onIdeaChange(event.target.value)} placeholder="Pega aquí el texto seleccionado" /></label>
    <label>Títulos<textarea value={titles} onChange={event => onTitlesChange(event.target.value)} placeholder="Un título por línea" /></label>
    {candidates.length > 0 && <div className="assistant-candidates"><span>Elegir título</span>{candidates.map(title => <button type="button" key={title} onClick={() => onSelectTitle(title)}>{title}</button>)}</div>}
    <label>Respuesta del p1<textarea value={master} onChange={event => onMasterChange(event.target.value)} placeholder={'Slide 0: ...\nSlide 1: ...\nFinal: ...'} /></label>
    <div className="assistant-actions"><button type="button" className="save-button" onClick={onApply}><Sparkles size={15} /> Aplicar a la publicación</button><button type="button" className="ghost-button" onClick={onCopyMark}><Clipboard size={15} /> Copiar marca</button></div>
    {message && <p className="assistant-message">{message}</p>}
  </section>
}

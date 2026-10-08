import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, Lightbulb, Pencil, Plus, Trash2, X } from 'lucide-react'
import { ViewHeading } from '../../components/layout/AppShell'
import { ideaMatchesQuery, usePlanner } from '../../app/store'
import type { Idea, IdeaInput, IdeaPriority, IdeaStatus } from '../../shared/types'
import './ideas.css'

const blankIdea = (space: string): IdeaInput => ({
  space, title: '', body: '', tags: [], media: [], status: 'inbox', priority: 'normal', dueDate: null,
})

const priorityLabels: Record<IdeaPriority, string> = { low: 'Baja', normal: 'Normal', high: 'Alta' }
const statusLabels: Record<IdeaStatus, string> = { inbox: 'Nueva', developing: 'En desarrollo', ready: 'Lista', converted: 'Convertida', archived: 'Archivada' }

function parseTextFile(text: string, sourceName: string, space: string): IdeaInput[] {
  const normalizedText = text.replace(/^\uFEFF/, '').replace(/\r/g, '')
  const frontmatter = normalizedText.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  const hasYamlFrontmatter = Boolean(frontmatter && frontmatter[1].split('\n').some(line => /^[A-Za-z0-9_-]+\s*:\s*/.test(line.trim())))
  const cleaned = (hasYamlFrontmatter ? normalizedText.slice(frontmatter![0].length) : normalizedText).trim()
  const marked = [...cleaned.matchAll(/==\s*([^=]+?)\s*==/g)]
  const numbered = [...cleaned.matchAll(/(?:^|\n)\s*(?:#{1,6}\s*)?\*\*\s*(\d+[.)]?\s*[^*\n]+?)\s*\*\*/gm)]
  const chunks = numbered.length
    ? numbered.map((match, index) => {
      const start = (match.index ?? 0) + match[0].length
      const end = numbered[index + 1]?.index ?? cleaned.length
      const title = match[1].replace(/^\d+[.)]?\s*/, '').replace(/^['“”\"]|['“”\"]$/g, '').trim()
      return { title, body: cleaned.slice(start, end).trim() }
    })
    : marked.length
    ? marked.map((match, index) => cleaned.slice(match.index! + match[0].length, marked[index + 1]?.index ?? cleaned.length).trim()).map((body, index) => ({ title: marked[index][1].trim(), body }))
    : cleaned.split(/\n\s*\n+/).map(chunk => chunk.trim()).filter(Boolean).map(chunk => {
      const lines = chunk.split('\n'); const first = lines.shift()?.trim() || ''
      const bold = first.match(/^(?:#{1,6}\s*)?\*\*\s*(?:\d+[.)]?\s*)?(.+?)\s*\*\*\s*(.*)$/)
      if (bold) return { title: bold[1].replace(/^['“”\"]|['“”\"]$/g, '').trim(), body: [bold[2], ...lines].filter(Boolean).join('\n').trim() }
      const heading = first.replace(/^#{1,6}\s*/, '').trim()
      return { title: heading.length <= 180 ? heading : '', body: heading.length <= 180 ? lines.join('\n').trim() : [first, ...lines].join('\n').trim() }
    })
  return chunks.filter(item => item.body.trim()).map(item => ({ space, title: item.title || sourceName, body: item.body, tags: [sourceName], sourceName, media: [], status: 'inbox' as const, priority: 'normal' as const, dueDate: null }))
}

function ideaKey(idea: Pick<IdeaInput, 'title' | 'body'>) {
  void idea.title
  return idea.body.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function IdeasView() {
  const { ideas, activeSpace, saveIdea, saveIdeasMany, removeIdea, convertIdea, select, setView, query } = usePlanner()
  const [draft, setDraft] = useState<IdeaInput | null>(null)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [importDuplicates, setImportDuplicates] = useState<Array<{ title: string; existingTitle: string; existingSourceName: string }>>([])
  const [statusFilter, setStatusFilter] = useState<'active' | IdeaStatus>('active')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const ideasInSpace = useMemo(() => (activeSpace ? ideas.filter(idea => idea.space === activeSpace) : ideas).filter(idea => statusFilter === 'active' ? idea.status === 'inbox' || idea.status === 'developing' || idea.status === 'ready' : idea.status === statusFilter).filter(idea => ideaMatchesQuery(idea, query)), [activeSpace, ideas, query, statusFilter])
  const pageSize = 40
  const pageCount = Math.max(1, Math.ceil(ideasInSpace.length / pageSize))
  const visibleIdeas = ideasInSpace.slice((page - 1) * pageSize, page * pageSize)
  useEffect(() => { setPage(1); setSelectedIds([]) }, [query, statusFilter, activeSpace])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])
  const edit = (idea: Idea) => setDraft({ ...idea })
  const save = async () => {
    if (!draft?.title.trim()) return
    await saveIdea({ ...draft, title: draft.title.trim(), body: draft.body.trim() })
    setDraft(null)
  }
  const convert = async (idea: Idea) => {
    const post = await convertIdea(idea.id)
    select(post.id)
    setView('board')
  }
  const importFile = async () => {
    setImporting(true)
    try {
      const file = await window.planner.files.readText()
      if (!file) return
      const parsed = parseTextFile(file.text, file.name, activeSpace || 'Mi contenido')
      if (!parsed.length) { setImportMessage('No se encontraron bloques con contenido.'); return }
      const sourceHeaders = [...file.text.matchAll(/(?:^|\n)\s*(?:#{1,6}\s*)?\*\*\s*(\d+[.)]?\s*[^*\n]+?)\s*\*\*/gm)].length
      if (sourceHeaders !== parsed.length) setImportMessage(`Aviso: el archivo contiene ${sourceHeaders} encabezados numerados y se pudieron preparar ${parsed.length} Ideas.`)
      if (!window.confirm(`Preview: ${parsed.length} bloques detectados.\nLa base verificará duplicados contra todas las Ideas existentes.\n\n¿Importar este lote?`)) return
      const result = await saveIdeasMany(parsed)
      setImportMessage(`${result.created.length} de ${parsed.length} ideas importadas${result.skipped ? ` · ${result.skipped} duplicadas omitidas` : ''}.`)
      setImportDuplicates(result.duplicates)
    } finally { setImporting(false) }
  }
  const toggleSelected = (id: string) => setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  const selectVisible = () => setSelectedIds(current => current.length === visibleIdeas.length ? [] : visibleIdeas.map(idea => idea.id))
  const bulkStatus = async (status: IdeaStatus) => {
    if (!selectedIds.length) return
    for (const id of selectedIds) { const idea = ideas.find(item => item.id === id); if (idea) await saveIdea({ ...idea, status }) }
    setSelectedIds([])
  }
  const bulkConvert = async () => {
    if (!selectedIds.length) return
    for (const id of selectedIds) await convertIdea(id)
    setSelectedIds([])
  }
  const bulkRemove = async () => {
    if (!selectedIds.length || !window.confirm(`¿Eliminar ${selectedIds.length} ideas seleccionadas?`)) return
    for (const id of selectedIds) await removeIdea(id)
    setSelectedIds([])
  }

  return <section className="workspace ideas-workspace">
    <ViewHeading title="Ideas" subtitle="Captura, desarrolla y convierte tus ideas en contenido.">
      <button className="settings-button" disabled={importing} onClick={() => void importFile()}>{importing ? 'Importando...' : 'Importar .md / .txt'}</button><button className="new-button" onClick={() => setDraft(blankIdea(activeSpace || 'Mi contenido'))}><Plus size={17} /> Nueva idea</button>
    </ViewHeading>
    {importMessage && <div className="ideas-import-result"><p className="ideas-import-message">{importMessage}</p>{importDuplicates.length > 0 && <details><summary>Ver {importDuplicates.length} coincidencias existentes</summary><ul>{importDuplicates.map((duplicate, index) => <li key={`${duplicate.title}-${index}`}><strong>{duplicate.title}</strong><span>ya existe como “{duplicate.existingTitle}”{duplicate.existingSourceName ? ` · ${duplicate.existingSourceName}` : ''}</span></li>)}</ul></details>}</div>}
    <div className="ideas-toolbar"><label>Estado<select value={statusFilter} onChange={event => setStatusFilter(event.target.value as 'active' | IdeaStatus)}><option value="active">Activas</option><option value="inbox">Nuevas</option><option value="developing">En desarrollo</option><option value="ready">Listas</option><option value="converted">Convertidas</option><option value="archived">Archivadas</option></select></label><span>{ideasInSpace.length} ideas · página {page} de {pageCount}</span><button type="button" className="settings-button" onClick={selectVisible}>{selectedIds.length === visibleIdeas.length && visibleIdeas.length ? 'Quitar selección' : 'Seleccionar página'}</button></div>
    {selectedIds.length > 0 && <div className="ideas-bulk-actions"><strong>{selectedIds.length} seleccionadas</strong><button type="button" onClick={() => void bulkStatus('developing')}>Desarrollar</button><button type="button" onClick={() => void bulkStatus('ready')}>Marcar listas</button><button type="button" onClick={() => void bulkConvert()}>Convertir</button><button type="button" onClick={() => void bulkStatus('archived')}>Archivar</button><button type="button" onClick={() => void bulkRemove()}>Eliminar</button></div>}
    {ideasInSpace.length ? <div className="ideas-grid">{visibleIdeas.map(idea => <article className={'idea-card ' + (selectedIds.includes(idea.id) ? 'selected' : '')} key={idea.id} onClick={event => { if (event.shiftKey || event.ctrlKey || event.metaKey || selectedIds.length > 0) toggleSelected(idea.id) }}>
      <header><label className="idea-select" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(idea.id)} onChange={() => toggleSelected(idea.id)} /> <span className={'idea-priority ' + idea.priority}>{priorityLabels[idea.priority]}</span></label><div><button title="Editar idea" onClick={event => { event.stopPropagation(); edit(idea) }}><Pencil size={15} /></button><button title="Eliminar idea" className="idea-delete" onClick={event => { event.stopPropagation(); if (window.confirm('Eliminar esta idea?')) void removeIdea(idea.id) }}><Trash2 size={15} /></button></div></header>
      <span className="idea-status">{statusLabels[idea.status]}</span><h2>{idea.title || 'Idea sin titulo'}</h2><p>{idea.body || 'Sin desarrollo todavia.'}</p>
      <footer>{idea.dueDate && <span><CalendarDays size={13} />{new Date(idea.dueDate).toLocaleDateString()}</span>}<small>{idea.space}</small>{idea.status !== 'converted' && <button onClick={event => { event.stopPropagation(); void convert(idea) }}>Convertir <ArrowRight size={14} /></button>}</footer>
    </article>)}</div> : <div className="ideas-empty"><Lightbulb size={34} /><strong>No hay ideas en este filtro</strong><span>Importa un archivo o cambia el estado seleccionado.</span><button className="new-button" onClick={() => setDraft(blankIdea(activeSpace || 'Mi contenido'))}><Plus size={17} /> Nueva idea</button></div>}
    {ideasInSpace.length > 0 && <div className="ideas-pagination"><button disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Anterior</button><span>{page} / {pageCount}</span><button disabled={page >= pageCount} onClick={() => setPage(current => current + 1)}>Siguiente</button></div>}
    {draft && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDraft(null) }}><form className="space-dialog idea-dialog" onSubmit={event => { event.preventDefault(); void save() }}><header><div><span>{draft.id ? 'EDITAR IDEA' : 'NUEVA IDEA'}</span><h2>{draft.title || 'Idea sin titulo'}</h2></div><button type="button" className="icon-button" onClick={() => setDraft(null)}><X size={18} /></button></header><label>Titulo<input autoFocus value={draft.title} maxLength={240} onChange={event => setDraft(current => current ? { ...current, title: event.target.value } : current)} placeholder="Describe la idea" /></label><label>Desarrollo<textarea value={draft.body} maxLength={20_000} onChange={event => setDraft(current => current ? { ...current, body: event.target.value } : current)} placeholder="Anota el enfoque, datos o una primera version" /></label><div className="idea-dialog-row"><label>Estado<select value={draft.status} onChange={event => setDraft(current => current ? { ...current, status: event.target.value as IdeaStatus } : current)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Prioridad<select value={draft.priority} onChange={event => setDraft(current => current ? { ...current, priority: event.target.value as IdeaPriority } : current)}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label>Espacio<input value={draft.space} maxLength={200} onChange={event => setDraft(current => current ? { ...current, space: event.target.value } : current)} /></label><footer><button type="button" className="ghost-button" onClick={() => setDraft(null)}>Cancelar</button><button className="save-button" disabled={!draft.title.trim()}>Guardar idea</button></footer></form></div>}
  </section>
}

import { useEffect, useMemo, useState, type PointerEvent } from 'react'
import { BookOpen, GitBranch, Lightbulb, Link2, Network, Plus, Trash2, X } from 'lucide-react'
import { ViewHeading } from '../../components/layout/AppShell'
import { usePlanner } from '../../app/store'
import type { ConceptMapLink, ConceptMapNode, ConceptNodeKind, ConceptRelation } from '../../shared/types'
import './concept-map.css'

const relationLabels: Record<ConceptRelation, string> = {
  references: 'hace referencia a', depends_on: 'depende de', related: 'se relaciona con',
}
const kindLabels: Record<ConceptNodeKind, string> = { idea: 'Idea', post: 'Publicacion', resource: 'Recurso general' }
const kindIcons = { idea: Lightbulb, post: BookOpen, resource: Network }

function nextPosition(count: number) { return { x: 42 + (count % 4) * 248, y: 74 + (Math.floor(count / 4) % 3) * 178 } }

export function ConceptMap() {
  const { posts, ideas, activeSpace, saveIdea } = usePlanner()
  const [nodes, setNodes] = useState<ConceptMapNode[]>([])
  const [links, setLinks] = useState<ConceptMapLink[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [linkStartId, setLinkStartId] = useState<string | null>(null)
  const [relation, setRelation] = useState<ConceptRelation>('related')
  const [resourceOpen, setResourceOpen] = useState(false)
  const [ideaOpen, setIdeaOpen] = useState(false)
  const [ideaTitle, setIdeaTitle] = useState('')
  const [ideaBody, setIdeaBody] = useState('')
  const [resourceTitle, setResourceTitle] = useState('')
  const [resourceBody, setResourceBody] = useState('')
  const [drag, setDrag] = useState<{ id: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null)
  const availableIdeas = useMemo(() => activeSpace ? ideas.filter(idea => idea.space === activeSpace) : ideas, [activeSpace, ideas])
  const availablePosts = useMemo(() => activeSpace ? posts.filter(post => post.project === activeSpace) : posts, [activeSpace, posts])
  const selected = nodes.find(node => node.id === selectedId) || null

  useEffect(() => { void window.planner.conceptMap.list().then(map => { setNodes(map.nodes); setLinks(map.links) }) }, [])

  const addNode = async (kind: ConceptNodeKind, sourceId: string | null, title: string, body: string) => {
    const saved = await window.planner.conceptMap.saveNode({ kind, sourceId, title: title.trim(), body: body.trim(), ...nextPosition(nodes.length) })
    setNodes(current => [...current, saved]); setSelectedId(saved.id)
  }
  const addIdea = (id: string) => { const idea = availableIdeas.find(item => item.id === id); if (idea) void addNode('idea', id, idea.title || 'Idea sin titulo', idea.body) }
  const addPost = (id: string) => { const post = availablePosts.find(item => item.id === id); if (post) void addNode('post', id, post.title || 'Publicacion sin titulo', post.caption) }
  const addResource = () => {
    if (!resourceTitle.trim()) return
    void addNode('resource', null, resourceTitle, resourceBody)
    setResourceTitle(''); setResourceBody(''); setResourceOpen(false)
  }
  const createIdea = async () => {
    if (!ideaTitle.trim()) return
    const idea = await saveIdea({
      space: activeSpace || 'Mi contenido', title: ideaTitle.trim(), body: ideaBody.trim(), tags: [], media: [], status: 'inbox', priority: 'normal', dueDate: null,
    })
    await addNode('idea', idea.id, idea.title, idea.body)
    setIdeaTitle(''); setIdeaBody(''); setIdeaOpen(false)
  }
  const selectNode = async (id: string) => {
    if (linkStartId && linkStartId !== id) {
      const exists = links.some(link => link.fromNodeId === linkStartId && link.toNodeId === id && link.relation === relation)
      if (!exists) {
        const saved = await window.planner.conceptMap.saveLink({ fromNodeId: linkStartId, toNodeId: id, relation })
        setLinks(current => [...current, saved])
      }
      setLinkStartId(null); return
    }
    setSelectedId(id)
  }
  const moveNode = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const x = Math.max(0, drag.nodeX + event.clientX - drag.startX)
    const y = Math.max(0, drag.nodeY + event.clientY - drag.startY)
    setNodes(current => current.map(node => node.id === drag.id ? { ...node, x, y } : node))
  }
  const persistMove = async () => {
    if (!drag) return
    const node = nodes.find(item => item.id === drag.id); setDrag(null)
    if (!node) return
    const saved = await window.planner.conceptMap.saveNode({ id: node.id, kind: node.kind, sourceId: node.sourceId, title: node.title, body: node.body, x: node.x, y: node.y })
    setNodes(current => current.map(item => item.id === saved.id ? saved : item))
  }
  const removeSelected = async () => {
    if (!selected) return
    await window.planner.conceptMap.removeNode(selected.id)
    setNodes(current => current.filter(node => node.id !== selected.id)); setLinks(current => current.filter(link => link.fromNodeId !== selected.id && link.toNodeId !== selected.id)); setSelectedId(null); setLinkStartId(null)
  }
  const removeLink = async (id: string) => { await window.planner.conceptMap.removeLink(id); setLinks(current => current.filter(link => link.id !== id)) }

  return <section className="workspace concept-workspace">
    <ViewHeading title="Mapa conceptual" subtitle="Conecta ideas, publicaciones y recursos para ver su contexto y dependencias.">
      <button className="new-button" onClick={() => setIdeaOpen(true)}><Lightbulb size={17} /> Nueva idea</button>
      <select className="map-source-select" aria-label="Anadir idea al mapa" defaultValue="" onChange={event => { if (event.target.value) { addIdea(event.target.value); event.target.value = '' } }}><option value="">Anadir idea</option>{availableIdeas.filter(idea => !nodes.some(node => node.kind === 'idea' && node.sourceId === idea.id)).map(idea => <option key={idea.id} value={idea.id}>{idea.title || 'Idea sin titulo'}</option>)}</select>
      <select className="map-source-select" aria-label="Anadir publicacion al mapa" defaultValue="" onChange={event => { if (event.target.value) { addPost(event.target.value); event.target.value = '' } }}><option value="">Anadir publicacion</option>{availablePosts.filter(post => !nodes.some(node => node.kind === 'post' && node.sourceId === post.id)).map(post => <option key={post.id} value={post.id}>{post.title || 'Publicacion sin titulo'}</option>)}</select>
      <button className="new-button" onClick={() => setResourceOpen(true)}><Plus size={17} /> Recurso general</button>
    </ViewHeading>
    <div className="concept-toolbar"><div className="relation-control" role="group" aria-label="Tipo de relacion">{(Object.keys(relationLabels) as ConceptRelation[]).map(value => <button key={value} className={relation === value ? 'active' : ''} onClick={() => setRelation(value)}>{relationLabels[value]}</button>)}</div><button className={'map-action ' + (linkStartId ? 'active' : '')} disabled={!selected} onClick={() => setLinkStartId(current => current ? null : selected?.id || null)}><Link2 size={16} />{linkStartId ? 'Elegir destino' : 'Conectar seleccionado'}</button>{selected && <button className="map-action danger" onClick={() => void removeSelected()}><Trash2 size={16} /> Quitar del mapa</button>}</div>
    <div className="concept-map-scroll"><div className={'concept-surface ' + (linkStartId ? 'linking' : '')} onPointerMove={moveNode} onPointerUp={() => void persistMove()} onPointerCancel={() => void persistMove()}>
      <svg className="concept-links" aria-hidden="true"><defs><marker id="concept-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>{links.map(link => { const from = nodes.find(node => node.id === link.fromNodeId); const to = nodes.find(node => node.id === link.toNodeId); if (!from || !to) return null; const x1 = from.x + 214; const y1 = from.y + 68; const x2 = to.x + 6; const y2 = to.y + 68; const middleX = (x1 + x2) / 2; const middleY = (y1 + y2) / 2; return <g className="concept-link" key={link.id}><path d={`M ${x1} ${y1} C ${middleX} ${y1}, ${middleX} ${y2}, ${x2} ${y2}`} markerEnd="url(#concept-arrow)" /><foreignObject x={middleX - 55} y={middleY - 12} width="110" height="25"><button title="Quitar relacion" onClick={() => void removeLink(link.id)}>{relationLabels[link.relation]}</button></foreignObject></g> })}</svg>
      {nodes.map(node => { const Icon = kindIcons[node.kind]; return <article key={node.id} className={'concept-node ' + node.kind + (selectedId === node.id ? ' selected' : '') + (linkStartId === node.id ? ' link-source' : '')} style={{ left: node.x, top: node.y }} onClick={() => void selectNode(node.id)} onPointerDown={event => { if ((event.target as HTMLElement).closest('button')) return; event.currentTarget.setPointerCapture(event.pointerId); setDrag({ id: node.id, startX: event.clientX, startY: event.clientY, nodeX: node.x, nodeY: node.y }) }}><header><span><Icon size={14} /> {kindLabels[node.kind]}</span><GitBranch size={15} /></header><strong>{node.title}</strong>{node.body && <p>{node.body}</p>}</article> })}
      {!nodes.length && <div className="concept-empty"><Network size={30} /><strong>El mapa esta vacio</strong><span>Anade una idea, publicacion o recurso general.</span></div>}
    </div></div>
    {ideaOpen && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setIdeaOpen(false) }}><form className="space-dialog resource-dialog" onSubmit={event => { event.preventDefault(); void createIdea() }}><header><div><span>NUEVA IDEA</span><h2>Idea para el mapa</h2></div><button type="button" className="icon-button" onClick={() => setIdeaOpen(false)}><X size={18} /></button></header><label>Titulo<input autoFocus value={ideaTitle} maxLength={240} onChange={event => setIdeaTitle(event.target.value)} placeholder="Ej. Primer argumento del reel" /></label><label>Desarrollo<textarea value={ideaBody} maxLength={20_000} onChange={event => setIdeaBody(event.target.value)} placeholder="Anota el enfoque o datos importantes" /></label><footer><button type="button" className="ghost-button" onClick={() => setIdeaOpen(false)}>Cancelar</button><button className="save-button" disabled={!ideaTitle.trim()}>Crear idea</button></footer></form></div>}
    {resourceOpen && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setResourceOpen(false) }}><form className="space-dialog resource-dialog" onSubmit={event => { event.preventDefault(); addResource() }}><header><div><span>RECURSO GENERAL</span><h2>Nuevo elemento de contexto</h2></div><button type="button" className="icon-button" onClick={() => setResourceOpen(false)}><X size={18} /></button></header><label>Titulo<input autoFocus value={resourceTitle} maxLength={240} onChange={event => setResourceTitle(event.target.value)} placeholder="Ej. Guia de tono de marca" /></label><label>Notas<textarea value={resourceBody} maxLength={20_000} onChange={event => setResourceBody(event.target.value)} placeholder="Enlace, contexto o recordatorio" /></label><footer><button type="button" className="ghost-button" onClick={() => setResourceOpen(false)}>Cancelar</button><button className="save-button" disabled={!resourceTitle.trim()}>Anadir al mapa</button></footer></form></div>}
  </section>
}

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ArrowLeft, BookOpen, Folder, FolderPlus, GitBranch, Lightbulb, Link2, Maximize2, Minus, Network, Plus, Trash2, X, ZoomIn } from 'lucide-react'
import { ViewHeading } from '../../components/layout/AppShell'
import { usePlanner } from '../../app/store'
import type { ConceptMapFolder, ConceptMapLink, ConceptMapNode, ConceptNodeKind, ConceptRelation } from '../../shared/types'
import './concept-map.css'

const canvas = { width: 1600, height: 900 }
const relationLabels: Record<ConceptRelation, string> = { references: 'hace referencia a', depends_on: 'depende de', related: 'se relaciona con' }
const kindLabels: Record<ConceptNodeKind, string> = { idea: 'Idea', post: 'Publicacion', resource: 'Recurso general' }
const kindIcons = { idea: Lightbulb, post: BookOpen, resource: Network }

function nextPosition(count: number) { return { x: 52 + (count % 5) * 270, y: 92 + (Math.floor(count / 5) % 4) * 182 } }
function folderPath(folders: ConceptMapFolder[], id: string | null) {
  const path: ConceptMapFolder[] = []; let current = id; const seen = new Set<string>()
  while (current && !seen.has(current)) { const folder = folders.find(item => item.id === current); if (!folder) break; path.unshift(folder); seen.add(current); current = folder.parentId }
  return path
}

export function ConceptMap() {
  const { posts, ideas, activeSpace, saveIdea } = usePlanner()
  const [nodes, setNodes] = useState<ConceptMapNode[]>([])
  const [links, setLinks] = useState<ConceptMapLink[]>([])
  const [folders, setFolders] = useState<ConceptMapFolder[]>([])
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [linkStartId, setLinkStartId] = useState<string | null>(null)
  const [relation, setRelation] = useState<ConceptRelation>('related')
  const [resourceOpen, setResourceOpen] = useState(false)
  const [ideaOpen, setIdeaOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [ideaTitle, setIdeaTitle] = useState('')
  const [ideaBody, setIdeaBody] = useState('')
  const [resourceTitle, setResourceTitle] = useState('')
  const [resourceBody, setResourceBody] = useState('')
  const [folderName, setFolderName] = useState('')
  const [zoom, setZoom] = useState(1)
  const [drag, setDrag] = useState<{ id: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null)
  const [pan, setPan] = useState<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const availableIdeas = useMemo(() => activeSpace ? ideas.filter(idea => idea.space === activeSpace) : ideas, [activeSpace, ideas])
  const availablePosts = useMemo(() => activeSpace ? posts.filter(post => post.project === activeSpace) : posts, [activeSpace, posts])
  const visibleNodes = useMemo(() => nodes.filter(node => node.folderId === activeFolderId), [activeFolderId, nodes])
  const visibleFolders = useMemo(() => folders.filter(folder => folder.parentId === activeFolderId), [activeFolderId, folders])
  const path = useMemo(() => folderPath(folders, activeFolderId), [activeFolderId, folders])
  const selected = visibleNodes.find(node => node.id === selectedId) || null

  const reload = async () => { const map = await window.planner.conceptMap.list(); setNodes(map.nodes); setLinks(map.links); setFolders(map.folders) }
  useEffect(() => { void reload() }, [])
  useEffect(() => { setSelectedId(null); setLinkStartId(null) }, [activeFolderId])

  const addNode = async (kind: ConceptNodeKind, sourceId: string | null, title: string, body: string) => {
    const saved = await window.planner.conceptMap.saveNode({ folderId: activeFolderId, kind, sourceId, title: title.trim(), body: body.trim(), ...nextPosition(visibleNodes.length) })
    setNodes(current => [...current, saved]); setSelectedId(saved.id)
  }
  const addIdea = (id: string) => { const idea = availableIdeas.find(item => item.id === id); if (idea) void addNode('idea', id, idea.title || 'Idea sin titulo', idea.body) }
  const addPost = (id: string) => { const post = availablePosts.find(item => item.id === id); if (post) void addNode('post', id, post.title || 'Publicacion sin titulo', post.caption) }
  const addResource = () => { if (!resourceTitle.trim()) return; void addNode('resource', null, resourceTitle, resourceBody); setResourceTitle(''); setResourceBody(''); setResourceOpen(false) }
  const createIdea = async () => {
    if (!ideaTitle.trim()) return
    const idea = await saveIdea({ space: activeSpace || 'Mi contenido', title: ideaTitle.trim(), body: ideaBody.trim(), tags: [], media: [], status: 'inbox', priority: 'normal', dueDate: null })
    await addNode('idea', idea.id, idea.title, idea.body); setIdeaTitle(''); setIdeaBody(''); setIdeaOpen(false)
  }
  const createFolder = async () => {
    if (!folderName.trim()) return
    const folder = await window.planner.conceptMap.saveFolder({ parentId: activeFolderId, name: folderName.trim() })
    setFolders(current => [...current, folder]); setFolderName(''); setFolderOpen(false)
  }
  const deleteActiveFolder = async () => {
    if (!activeFolderId) return
    const result = await window.planner.conceptMap.removeFolder(activeFolderId)
    await reload(); setActiveFolderId(result.parentId)
  }
  const selectNode = async (id: string) => {
    if (linkStartId && linkStartId !== id) {
      const exists = links.some(link => link.fromNodeId === linkStartId && link.toNodeId === id && link.relation === relation)
      if (!exists) { const saved = await window.planner.conceptMap.saveLink({ fromNodeId: linkStartId, toNodeId: id, relation }); setLinks(current => [...current, saved]) }
      setLinkStartId(null); return
    }
    setSelectedId(id)
  }
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag) {
      const x = Math.max(0, drag.nodeX + (event.clientX - drag.startX) / zoom)
      const y = Math.max(0, drag.nodeY + (event.clientY - drag.startY) / zoom)
      setNodes(current => current.map(node => node.id === drag.id ? { ...node, x, y } : node)); return
    }
    if (pan && scrollerRef.current) { scrollerRef.current.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX); scrollerRef.current.scrollTop = pan.scrollTop - (event.clientY - pan.startY) }
  }
  const finishPointer = async () => {
    setPan(null)
    if (!drag) return
    const node = nodes.find(item => item.id === drag.id); setDrag(null)
    if (!node) return
    const saved = await window.planner.conceptMap.saveNode({ id: node.id, folderId: node.folderId, kind: node.kind, sourceId: node.sourceId, title: node.title, body: node.body, x: node.x, y: node.y })
    setNodes(current => current.map(item => item.id === saved.id ? saved : item))
  }
  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.concept-node, .concept-link')) return
    const scroller = scrollerRef.current; if (!scroller) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setPan({ startX: event.clientX, startY: event.clientY, scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop })
  }
  const removeSelected = async () => { if (!selected) return; await window.planner.conceptMap.removeNode(selected.id); setNodes(current => current.filter(node => node.id !== selected.id)); setLinks(current => current.filter(link => link.fromNodeId !== selected.id && link.toNodeId !== selected.id)); setSelectedId(null); setLinkStartId(null) }
  const removeLink = async (id: string) => { await window.planner.conceptMap.removeLink(id); setLinks(current => current.filter(link => link.id !== id)) }
  const adjustZoom = (change: number) => setZoom(current => Math.min(1.7, Math.max(.55, Math.round((current + change) * 100) / 100)))

  return <section className="workspace concept-workspace">
    <ViewHeading title="Mapa conceptual" subtitle="Conecta ideas, publicaciones y recursos para ver su contexto y dependencias.">
      <button className="new-button" onClick={() => setIdeaOpen(true)}><Lightbulb size={17} /> Nueva idea</button><button className="new-button" onClick={() => setResourceOpen(true)}><Plus size={17} /> Recurso general</button><button className="map-action" onClick={() => setFolderOpen(true)}><FolderPlus size={16} /> Nueva carpeta</button>
    </ViewHeading>
    <div className="map-navigation"><button className="map-icon-button" title="Volver a la carpeta anterior" disabled={!activeFolderId} onClick={() => setActiveFolderId(path.at(-2)?.id || null)}><ArrowLeft size={17} /></button><div className="map-breadcrumb"><button className={!activeFolderId ? 'active' : ''} onClick={() => setActiveFolderId(null)}>Mapa</button>{path.map(folder => <button className={folder.id === activeFolderId ? 'active' : ''} key={folder.id} onClick={() => setActiveFolderId(folder.id)}>{folder.name}</button>)}</div>{activeFolderId && <button className="map-icon-button danger" title="Eliminar carpeta y subir su contenido" onClick={() => void deleteActiveFolder()}><Trash2 size={16} /></button>}</div>
    {visibleFolders.length > 0 && <div className="map-folder-grid">{visibleFolders.map(folder => <button className="map-folder-card" key={folder.id} onClick={() => setActiveFolderId(folder.id)}><Folder size={21} /><span><strong>{folder.name}</strong><small>{nodes.filter(node => node.folderId === folder.id).length} nodos</small></span><ArrowLeft className="folder-enter" size={16} /></button>)}</div>}
    <div className="concept-toolbar"><div className="relation-control" role="group" aria-label="Tipo de relacion">{(Object.keys(relationLabels) as ConceptRelation[]).map(value => <button key={value} className={relation === value ? 'active' : ''} onClick={() => setRelation(value)}>{relationLabels[value]}</button>)}</div><button className={'map-action ' + (linkStartId ? 'active' : '')} disabled={!selected} onClick={() => setLinkStartId(current => current ? null : selected?.id || null)}><Link2 size={16} />{linkStartId ? 'Elegir destino' : 'Conectar seleccionado'}</button>{selected && <button className="map-action danger" onClick={() => void removeSelected()}><Trash2 size={16} /> Quitar del mapa</button>}<div className="map-zoom"><button title="Alejar" onClick={() => adjustZoom(-.15)}><Minus size={16} /></button><span>{Math.round(zoom * 100)}%</span><button title="Acercar" onClick={() => adjustZoom(.15)}><ZoomIn size={16} /></button><button title="Restablecer zoom" onClick={() => setZoom(1)}><Maximize2 size={15} /></button></div></div>
    <div className="concept-map-scroll" ref={scrollerRef} onPointerDown={beginPan} onPointerMove={handlePointerMove} onPointerUp={() => void finishPointer()} onPointerCancel={() => void finishPointer()}><div className="concept-viewport" style={{ width: canvas.width * zoom, height: canvas.height * zoom }}><div className={'concept-surface ' + (linkStartId ? 'linking' : '')} style={{ transform: `scale(${zoom})` }}>
      <svg className="concept-links" aria-hidden="true"><defs><marker id="concept-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>{links.map(link => { const from = visibleNodes.find(node => node.id === link.fromNodeId); const to = visibleNodes.find(node => node.id === link.toNodeId); if (!from || !to) return null; const x1 = from.x + 214; const y1 = from.y + 68; const x2 = to.x + 6; const y2 = to.y + 68; const middleX = (x1 + x2) / 2; const middleY = (y1 + y2) / 2; return <g className="concept-link" key={link.id}><path d={`M ${x1} ${y1} C ${middleX} ${y1}, ${middleX} ${y2}, ${x2} ${y2}`} markerEnd="url(#concept-arrow)" /><foreignObject x={middleX - 55} y={middleY - 12} width="110" height="25"><button title="Quitar relacion" onClick={() => void removeLink(link.id)}>{relationLabels[link.relation]}</button></foreignObject></g> })}</svg>
      {visibleNodes.map(node => { const Icon = kindIcons[node.kind]; return <article key={node.id} className={'concept-node ' + node.kind + (selectedId === node.id ? ' selected' : '') + (linkStartId === node.id ? ' link-source' : '')} style={{ left: node.x, top: node.y }} onClick={() => void selectNode(node.id)} onPointerDown={event => { if ((event.target as HTMLElement).closest('button')) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDrag({ id: node.id, startX: event.clientX, startY: event.clientY, nodeX: node.x, nodeY: node.y }) }}><header><span><Icon size={14} /> {kindLabels[node.kind]}</span><GitBranch size={15} /></header><strong>{node.title}</strong>{node.body && <p>{node.body}</p>}</article> })}
      {!visibleNodes.length && <div className="concept-empty"><Network size={30} /><strong>Esta carpeta esta vacia</strong><span>Anade una idea, publicacion o recurso general.</span></div>}
    </div></div></div>
    <div className="map-source-row"><select className="map-source-select" aria-label="Anadir idea al mapa" defaultValue="" onChange={event => { if (event.target.value) { addIdea(event.target.value); event.target.value = '' } }}><option value="">Anadir idea existente</option>{availableIdeas.filter(idea => !nodes.some(node => node.kind === 'idea' && node.sourceId === idea.id)).map(idea => <option key={idea.id} value={idea.id}>{idea.title || 'Idea sin titulo'}</option>)}</select><select className="map-source-select" aria-label="Anadir publicacion al mapa" defaultValue="" onChange={event => { if (event.target.value) { addPost(event.target.value); event.target.value = '' } }}><option value="">Anadir publicacion existente</option>{availablePosts.filter(post => !nodes.some(node => node.kind === 'post' && node.sourceId === post.id)).map(post => <option key={post.id} value={post.id}>{post.title || 'Publicacion sin titulo'}</option>)}</select></div>
    {folderOpen && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setFolderOpen(false) }}><form className="space-dialog resource-dialog" onSubmit={event => { event.preventDefault(); void createFolder() }}><header><div><span>NUEVA CARPETA</span><h2>{activeFolderId ? 'Subcarpeta del mapa' : 'Carpeta del mapa'}</h2></div><button type="button" className="icon-button" onClick={() => setFolderOpen(false)}><X size={18} /></button></header><label>Nombre<input autoFocus value={folderName} maxLength={120} onChange={event => setFolderName(event.target.value)} placeholder="Ej. Investigacion de campana" /></label><footer><button type="button" className="ghost-button" onClick={() => setFolderOpen(false)}>Cancelar</button><button className="save-button" disabled={!folderName.trim()}>Crear carpeta</button></footer></form></div>}
    {ideaOpen && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setIdeaOpen(false) }}><form className="space-dialog resource-dialog" onSubmit={event => { event.preventDefault(); void createIdea() }}><header><div><span>NUEVA IDEA</span><h2>Idea para el mapa</h2></div><button type="button" className="icon-button" onClick={() => setIdeaOpen(false)}><X size={18} /></button></header><label>Titulo<input autoFocus value={ideaTitle} maxLength={240} onChange={event => setIdeaTitle(event.target.value)} placeholder="Ej. Primer argumento del reel" /></label><label>Desarrollo<textarea value={ideaBody} maxLength={20_000} onChange={event => setIdeaBody(event.target.value)} placeholder="Anota el enfoque o datos importantes" /></label><footer><button type="button" className="ghost-button" onClick={() => setIdeaOpen(false)}>Cancelar</button><button className="save-button" disabled={!ideaTitle.trim()}>Crear idea</button></footer></form></div>}
    {resourceOpen && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setResourceOpen(false) }}><form className="space-dialog resource-dialog" onSubmit={event => { event.preventDefault(); addResource() }}><header><div><span>RECURSO GENERAL</span><h2>Nuevo elemento de contexto</h2></div><button type="button" className="icon-button" onClick={() => setResourceOpen(false)}><X size={18} /></button></header><label>Titulo<input autoFocus value={resourceTitle} maxLength={240} onChange={event => setResourceTitle(event.target.value)} placeholder="Ej. Guia de tono de marca" /></label><label>Notas<textarea value={resourceBody} maxLength={20_000} onChange={event => setResourceBody(event.target.value)} placeholder="Enlace, contexto o recordatorio" /></label><footer><button type="button" className="ghost-button" onClick={() => setResourceOpen(false)}>Cancelar</button><button className="save-button" disabled={!resourceTitle.trim()}>Anadir al mapa</button></footer></form></div>}
  </section>
}

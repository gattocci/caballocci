import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ArrowLeft, ArrowRightLeft, BookOpen, Download, ExternalLink, Folder, FolderPlus, GitBranch, Lightbulb, Link2, Maximize2, Minus, Network, Pencil, Plus, Save, Search, Sparkles, Trash2, Undo2, X, ZoomIn } from 'lucide-react'
import { ViewHeading } from '../../components/layout/AppShell'
import { runWithErrorReporting } from '../../app/errors'
import { usePlanner } from '../../app/store'
import type { ConceptMapFolder, ConceptMapLink, ConceptMapNode, ConceptNodeKind, ConceptRelation, IdeaNeighbor } from '../../shared/types'
import {
  arrangeNodes, buildExport, contentTypeLabels, filterLabels, filterOrder, findFreeSlot, formatDate, ideaStatusLabels, isUnpublishedIdea,
  kindLabels, layoutLabels, nodeSize, opportunityGroups, postStatusLabels, priorityLabels, relationLabel, relationOptions, sameTitle,
  type LayoutMode, type NodeFilter,
} from './conceptMapModel'
import './concept-map.css'

const defaultCamera = { x: -120, y: -80, zoom: 1 }
const dragThreshold = 4
const kindIcons = { idea: Lightbulb, post: BookOpen, resource: Network }

type Camera = typeof defaultCamera

function clampZoom(value: number) { return Math.min(1.8, Math.max(.45, Math.round(value * 100) / 100)) }
function cameraKey(folderId: string | null) { return `caballocci.map-camera.${folderId || 'root'}` }
function loadCamera(folderId: string | null): Camera {
  try {
    const saved = JSON.parse(localStorage.getItem(cameraKey(folderId)) || '') as Camera
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y) && Number.isFinite(saved.zoom)) return { x: saved.x, y: saved.y, zoom: clampZoom(saved.zoom) }
  } catch { /* Use the initial camera. */ }
  return { ...defaultCamera }
}
function folderPath(folders: ConceptMapFolder[], id: string | null) {
  const path: ConceptMapFolder[] = []; let current = id; const seen = new Set<string>()
  while (current && !seen.has(current)) { const folder = folders.find(item => item.id === current); if (!folder) break; path.unshift(folder); seen.add(current); current = folder.parentId }
  return path
}
function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null
  return Boolean(element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable))
}

export function ConceptMap() {
  const { posts, ideas, activeSpace, saveIdea, save: savePost, ideaNeighbors, select: selectPost, selectIdea, setView } = usePlanner()
  const [nodes, setNodes] = useState<ConceptMapNode[]>([])
  const [links, setLinks] = useState<ConceptMapLink[]>([])
  const [folders, setFolders] = useState<ConceptMapFolder[]>([])
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)
  const [linkStartId, setLinkStartId] = useState<string | null>(null)
  const [relation, setRelation] = useState<ConceptRelation | null>(null)
  const [camera, setCamera] = useState<Camera>(loadCamera(null))
  const [viewport, setViewport] = useState({ width: 1000, height: 610 })
  const [resourceOpen, setResourceOpen] = useState(false)
  const [ideaOpen, setIdeaOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [ideaTitle, setIdeaTitle] = useState('')
  const [ideaBody, setIdeaBody] = useState('')
  const [resourceTitle, setResourceTitle] = useState('')
  const [resourceBody, setResourceBody] = useState('')
  const [folderName, setFolderName] = useState('')
  const [nodeQuery, setNodeQuery] = useState('')
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  const [editingNode, setEditingNode] = useState(false)
  const [syncSource, setSyncSource] = useState(true)
  const [nodeTitle, setNodeTitle] = useState('')
  const [nodeBody, setNodeBody] = useState('')
  const [similarIdeas, setSimilarIdeas] = useState<IdeaNeighbor[]>([])
  const [loadingSimilar, setLoadingSimilar] = useState(false)
  const [showPendingIdeas, setShowPendingIdeas] = useState(false)
  const [showOpportunities, setShowOpportunities] = useState(false)
  const [filter, setFilter] = useState<NodeFilter>('all')
  const [history, setHistory] = useState<string[]>([])
  const [layoutUndo, setLayoutUndo] = useState<Array<{ id: string; x: number; y: number }> | null>(null)
  const [drag, setDrag] = useState<{ ids: string[]; startX: number; startY: number; positions: Array<{ id: string; x: number; y: number }> } | null>(null)
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; x: number; y: number } | null>(null)
  const [selectionShortcutNotice, setSelectionShortcutNotice] = useState('')
  const [pan, setPan] = useState<{ startX: number; startY: number; camera: Camera } | null>(null)
  const runSafely = (action: () => Promise<unknown>, context: string) => { void runWithErrorReporting(action, context) }
  const viewportRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef(camera)
  const movedRef = useRef(false)
  const selectedIdRef = useRef<string | null>(null)
  const wheelRef = useRef<(event: WheelEvent) => void>(() => {})

  const ideaById = useMemo(() => new Map(ideas.map(idea => [idea.id, idea])), [ideas])
  const postById = useMemo(() => new Map(posts.map(post => [post.id, post])), [posts])
  const availableIdeas = useMemo(() => activeSpace ? ideas.filter(idea => idea.space === activeSpace) : ideas, [activeSpace, ideas])
  const availablePosts = useMemo(() => activeSpace ? posts.filter(post => post.project === activeSpace) : posts, [activeSpace, posts])
  const mappedIdeaIds = useMemo(() => new Set(nodes.filter(node => node.kind === 'idea' && node.sourceId).map(node => node.sourceId as string)), [nodes])
  const mappedPostIds = useMemo(() => new Set(nodes.filter(node => node.kind === 'post' && node.sourceId).map(node => node.sourceId as string)), [nodes])
  const pendingIdeas = useMemo(() => availableIdeas.filter(idea => (idea.status === 'inbox' || idea.status === 'developing') && !mappedIdeaIds.has(idea.id)), [availableIdeas, mappedIdeaIds])
  const folderNodes = useMemo(() => nodes.filter(node => node.folderId === activeFolderId), [activeFolderId, nodes])
  const folderNodeById = useMemo(() => new Map(folderNodes.map(node => [node.id, node])), [folderNodes])
  const visibleFolders = useMemo(() => folders.filter(folder => folder.parentId === activeFolderId), [activeFolderId, folders])
  const path = useMemo(() => folderPath(folders, activeFolderId), [activeFolderId, folders])
  const visibleWorld = useMemo(() => {
    const margin = 300 / camera.zoom; const right = camera.x + viewport.width / camera.zoom; const bottom = camera.y + viewport.height / camera.zoom
    return folderNodes.filter(node => node.x + nodeSize.width >= camera.x - margin && node.x <= right + margin && node.y + nodeSize.height >= camera.y - margin && node.y <= bottom + margin)
  }, [camera, folderNodes, viewport])
  const visibleIds = useMemo(() => new Set(visibleWorld.map(node => node.id)), [visibleWorld])
  const linkedIds = useMemo(() => new Set(links.flatMap(link => [link.fromNodeId, link.toNodeId])), [links])
  const selected = folderNodes.find(node => node.id === selectedId) || null
  const selectedLink = links.find(link => link.id === selectedLinkId) || null
  const connectedLinks = useMemo(() => selected ? links.filter(link => link.fromNodeId === selected.id || link.toNodeId === selected.id) : [], [links, selected])
  const connectedIds = useMemo(() => new Set(connectedLinks.flatMap(link => [link.fromNodeId, link.toNodeId])), [connectedLinks])
  const query = nodeQuery.trim().toLocaleLowerCase()
  const matchedNodes = useMemo(() => query ? nodes.filter(node => `${node.title} ${node.body} ${folderPath(folders, node.folderId).map(folder => folder.name).join(' ')}`.toLocaleLowerCase().includes(query)) : [], [folders, nodes, query])
  const matchedIds = useMemo(() => new Set(matchedNodes.map(node => node.id)), [matchedNodes])
  const focusActive = Boolean(selectedId)

  const matchesFilter = (node: ConceptMapNode) => {
    if (filter === 'all') return true
    if (filter === 'orphan') return !linkedIds.has(node.id)
    if (filter === 'unpublished') return node.kind === 'idea' && isUnpublishedIdea(node.sourceId ? ideaById.get(node.sourceId) : undefined)
    return node.kind === filter
  }
  const filterCounts = useMemo(() => {
    const counts = {} as Record<NodeFilter, number>
    for (const key of filterOrder) counts[key] = 0
    for (const node of folderNodes) {
      counts.all++
      if (node.kind === 'idea') counts.idea++
      else if (node.kind === 'post') counts.post++
      else counts.resource++
      if (!linkedIds.has(node.id)) counts.orphan++
      if (node.kind === 'idea' && isUnpublishedIdea(node.sourceId ? ideaById.get(node.sourceId) : undefined)) counts.unpublished++
    }
    return counts
  }, [folderNodes, ideaById, linkedIds])
  const unpublishedInMap = useMemo(() => nodes.filter(node => node.kind === 'idea' && isUnpublishedIdea(node.sourceId ? ideaById.get(node.sourceId) : undefined)), [ideaById, nodes])
  const groups = useMemo(() => opportunityGroups(nodes, links, node => node.kind === 'idea' && Boolean(node.sourceId && ideaById.get(node.sourceId)?.postId)), [ideaById, links, nodes])
  const opportunityCount = groups.length + (unpublishedInMap.length ? 1 : 0)

  const sourceOf = (node: ConceptMapNode) => {
    if (!node.sourceId) return null
    if (node.kind === 'idea') { const idea = ideaById.get(node.sourceId); return idea ? { title: idea.title, body: idea.body } : null }
    if (node.kind === 'post') { const post = postById.get(node.sourceId); return post ? { title: post.title, body: post.caption } : null }
    return null
  }
  const fallbackTitle = (kind: ConceptNodeKind) => kind === 'post' ? 'Publicación sin título' : 'Idea sin título'
  const sourceDiffers = (node: ConceptMapNode) => { const source = sourceOf(node); return Boolean(source && (!sameTitle(node.title, source.title) || node.body !== source.body.trim())) }
  const contextRows = (node: ConceptMapNode): Array<[string, string]> => {
    const rows: Array<[string, string]> = []
    if (node.kind === 'idea' && node.sourceId) {
      const idea = ideaById.get(node.sourceId)
      if (idea) rows.push(['Estado', ideaStatusLabels[idea.status] || idea.status], ['Espacio', idea.space], ['Prioridad', priorityLabels[idea.priority] || idea.priority], ['Actualizada', formatDate(idea.updatedAt)])
    } else if (node.kind === 'post' && node.sourceId) {
      const post = postById.get(node.sourceId)
      if (post) rows.push(['Estado', postStatusLabels[post.status] || post.status], ['Espacio', post.project], ['Formato', contentTypeLabels[post.contentType] || post.contentType], ['Programada', formatDate(post.scheduledAt)])
    } else rows.push(['Creado', formatDate(node.createdAt)])
    return rows.filter(([, value]) => value)
  }
  const groupOf = (mode: LayoutMode) => (node: ConceptMapNode) => {
    if (mode === 'kind') return node.kind
    if (node.kind === 'idea') return 'Idea · ' + (ideaStatusLabels[ideaById.get(node.sourceId || '')?.status || ''] || 'Sin estado')
    if (node.kind === 'post') return 'Publicación · ' + (postStatusLabels[postById.get(node.sourceId || '')?.status || ''] || 'Sin estado')
    return 'Recurso'
  }

  // Related idea <-> publication that could be connected (always the user's decision).
  const counterpart = useMemo(() => {
    if (!selected?.sourceId) return null
    if (selected.kind === 'idea') { const idea = ideaById.get(selected.sourceId); const post = idea?.postId ? postById.get(idea.postId) : undefined; return post ? { kind: 'post' as const, id: post.id, title: post.title, body: post.caption } : null }
    if (selected.kind === 'post') { const post = postById.get(selected.sourceId); const idea = post?.sourceIdeaId ? ideaById.get(post.sourceIdeaId) : undefined; return idea ? { kind: 'idea' as const, id: idea.id, title: idea.title, body: idea.body } : null }
    return null
  }, [ideaById, postById, selected])
  const counterpartNode = counterpart ? nodes.find(node => node.kind === counterpart.kind && node.sourceId === counterpart.id) : undefined
  const counterpartLinked = Boolean(selected && counterpartNode && links.some(link => (link.fromNodeId === selected.id && link.toNodeId === counterpartNode.id) || (link.toNodeId === selected.id && link.fromNodeId === counterpartNode.id)))

  const persistCamera = (next: Camera) => localStorage.setItem(cameraKey(activeFolderId), JSON.stringify(next))
  const setCameraAndPersist = (next: Camera) => { cameraRef.current = next; setCamera(next); persistCamera(next) }
  const reload = async () => { const map = await window.planner.conceptMap.list(); setNodes(map.nodes); setLinks(map.links); setFolders(map.folders) }
  const clearSelection = () => { setSelectedId(null); setSelectedNodeIds([]); setSelectedLinkId(null); setLinkStartId(null); setEditingNode(false) }
  const centerOn = (node: ConceptMapNode) => {
    const zoom = cameraRef.current.zoom
    setCameraAndPersist({ ...cameraRef.current, x: node.x + nodeSize.width / 2 - viewport.width / zoom / 2, y: node.y + nodeSize.height / 2 - viewport.height / zoom / 2 })
  }

  useEffect(() => { runSafely(reload, 'No se pudo cargar el mapa conceptual') }, [])
  useEffect(() => { cameraRef.current = camera }, [camera])
  useEffect(() => { selectedIdRef.current = selectedId; setEditingNode(false); setSimilarIdeas([]); if (selectedId) setSelectedNodeIds([selectedId]); else setSelectedNodeIds(current => current.length > 1 ? current : []) }, [selectedId])
  useEffect(() => {
    if (!selectionShortcutNotice) return
    const timeout = window.setTimeout(() => setSelectionShortcutNotice(''), 2100)
    return () => window.clearTimeout(timeout)
  }, [selectionShortcutNotice])
  useEffect(() => {
    setSelectedId(null); setSelectedNodeIds([]); setSelectedLinkId(null); setLinkStartId(null)
    const next = loadCamera(activeFolderId); cameraRef.current = next; setCamera(next)
  }, [activeFolderId])
  useEffect(() => {
    if (!pendingFocusId) return
    const node = nodes.find(item => item.id === pendingFocusId)
    if (!node || node.folderId !== activeFolderId) return
    const zoom = cameraRef.current.zoom
    const next = { ...cameraRef.current, x: node.x + nodeSize.width / 2 - viewport.width / zoom / 2, y: node.y + nodeSize.height / 2 - viewport.height / zoom / 2 }
    cameraRef.current = next; setCamera(next); localStorage.setItem(cameraKey(activeFolderId), JSON.stringify(next)); setSelectedId(node.id); setPendingFocusId(null)
  }, [activeFolderId, nodes, pendingFocusId, viewport])
  useEffect(() => {
    const element = viewportRef.current; if (!element) return
    const update = () => setViewport({ width: element.clientWidth, height: element.clientHeight })
    update(); const observer = new ResizeObserver(update); observer.observe(element); return () => observer.disconnect()
  }, [])
  // React attaches wheel listeners as passive, so preventDefault() was ignored. Use a native non-passive listener.
  useEffect(() => {
    const element = viewportRef.current; if (!element) return
    const listener = (event: WheelEvent) => wheelRef.current(event)
    element.addEventListener('wheel', listener, { passive: false })
    return () => element.removeEventListener('wheel', listener)
  }, [])
  wheelRef.current = event => { event.preventDefault(); zoomAt(cameraRef.current.zoom * (event.deltaY < 0 ? 1.12 : .89), event.clientX, event.clientY) }

  // Keyboard shortcuts. Rebound every render so it always sees the latest state.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const anyDialog = folderOpen || ideaOpen || resourceOpen
      if (event.key === 'Escape') {
        if (anyDialog) { setFolderOpen(false); setIdeaOpen(false); setResourceOpen(false); return }
        if (linkStartId) { setLinkStartId(null); return }
        if (editingNode) { setEditingNode(false); return }
        if (selectedId || selectedLinkId) { clearSelection(); if (isTyping(event.target)) (event.target as HTMLElement).blur(); return }
        if (nodeQuery) { setNodeQuery(''); return }
        return
      }
      if (anyDialog || isTyping(event.target)) return
      if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); goBack(); return }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus() }
      else if (event.key === 'f' || event.key === 'F') fitContent()
      else if (event.key === '+' || event.key === '=') zoomAt(cameraRef.current.zoom * 1.2)
      else if (event.key === '-') zoomAt(cameraRef.current.zoom / 1.2)
      else if ((event.key === 'c' || event.key === 'C') && selected) setLinkStartId(current => current ? null : selected.id)
      else if ((event.key === 'e' || event.key === 'E') && selected && !editingNode) { event.preventDefault(); beginEditNode() }
      else if (event.key === 'Delete' && selected) removeSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const addNode = async (kind: ConceptNodeKind, sourceId: string | null, title: string, body: string, options: { select?: boolean } = {}) => {
    const saved = await window.planner.conceptMap.saveNode({ folderId: activeFolderId, kind, sourceId, title: title.trim(), body: body.trim(), ...findFreeSlot(folderNodes) })
    setNodes(current => [...current, saved])
    if (options.select !== false) { setSelectedId(saved.id); setSelectedLinkId(null); centerOn(saved) }
    return saved
  }
  const addIdeaNode = (idea: { id: string; title: string; body: string }) => runSafely(() => addNode('idea', idea.id, idea.title || fallbackTitle('idea'), idea.body), 'No se pudo añadir la idea al mapa')
  const addIdea = (id: string) => { const idea = availableIdeas.find(item => item.id === id); if (idea) addIdeaNode(idea) }
  const addPost = (id: string) => { const post = availablePosts.find(item => item.id === id); if (post) runSafely(() => addNode('post', id, post.title || fallbackTitle('post'), post.caption), 'No se pudo añadir la publicación al mapa') }
  const addResource = () => {
    if (!resourceTitle.trim()) return
    runSafely(async () => { await addNode('resource', null, resourceTitle, resourceBody); setResourceTitle(''); setResourceBody(''); setResourceOpen(false) }, 'No se pudo crear el recurso')
  }
  const createIdea = () => runSafely(async () => { if (!ideaTitle.trim()) return; const idea = await saveIdea({ space: activeSpace || 'Mi contenido', title: ideaTitle.trim(), body: ideaBody.trim(), tags: [], media: [], status: 'inbox', priority: 'normal', dueDate: null }, { recordHistory: false }); await addNode('idea', idea.id, idea.title, idea.body); setIdeaTitle(''); setIdeaBody(''); setIdeaOpen(false) }, 'No se pudo crear la idea en el mapa')
  const createFolder = () => runSafely(async () => { if (!folderName.trim()) return; const folder = await window.planner.conceptMap.saveFolder({ parentId: activeFolderId, name: folderName.trim() }); setFolders(current => [...current, folder]); setFolderName(''); setFolderOpen(false) }, 'No se pudo crear la carpeta')
  const deleteActiveFolder = () => runSafely(async () => { if (!activeFolderId || !window.confirm('¿Eliminar esta carpeta? Sus nodos y subcarpetas subirán al nivel anterior.')) return; const result = await window.planner.conceptMap.removeFolder(activeFolderId); await reload(); setActiveFolderId(result.parentId) }, 'No se pudo eliminar la carpeta')

  const createLink = async (fromNodeId: string, toNodeId: string, linkRelation: ConceptRelation | null) => {
    if (links.some(link => link.fromNodeId === fromNodeId && link.toNodeId === toNodeId && link.relation === linkRelation)) return null
    const saved = await window.planner.conceptMap.saveLink({ fromNodeId, toNodeId, relation: linkRelation })
    setLinks(current => [...current, saved])
    return saved
  }
  const updateLink = (link: ConceptMapLink, changes: Partial<Pick<ConceptMapLink, 'fromNodeId' | 'toNodeId' | 'relation'>>) => runSafely(async () => {
    const next = { ...link, ...changes }
    if (links.some(other => other.id !== link.id && other.fromNodeId === next.fromNodeId && other.toNodeId === next.toNodeId && other.relation === next.relation)) throw new Error('Ya existe una conexión igual entre estos dos nodos')
    const saved = await window.planner.conceptMap.saveLink({ id: link.id, fromNodeId: next.fromNodeId, toNodeId: next.toNodeId, relation: next.relation })
    setLinks(current => current.map(item => item.id === saved.id ? saved : item))
  }, 'No se pudo actualizar la relación')
  const removeLink = (id: string) => runSafely(async () => { await window.planner.conceptMap.removeLink(id); setLinks(current => current.filter(link => link.id !== id)); setSelectedLinkId(current => current === id ? null : current) }, 'No se pudo quitar la relación')
  const selectLink = (id: string) => { setSelectedLinkId(id); setSelectedId(null); setSelectedNodeIds([]); setLinkStartId(null) }

  const selectNode = (id: string) => runSafely(async () => {
    if (linkStartId && linkStartId !== id) { await createLink(linkStartId, id, relation); setLinkStartId(null); return }
    setSelectedId(id); setSelectedLinkId(null)
  }, 'No se pudo actualizar el nodo o su relación')

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const origin = drag ? { x: drag.startX, y: drag.startY } : pan ? { x: pan.startX, y: pan.startY } : selectionBox ? { x: selectionBox.startX, y: selectionBox.startY } : null
    if (!origin) return
    if (!movedRef.current) { if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < dragThreshold) return; movedRef.current = true }
    if (selectionBox) { setSelectionBox(current => current ? { ...current, x: event.clientX, y: event.clientY } : null); return }
    if (drag) { const dx = (event.clientX - drag.startX) / cameraRef.current.zoom; const dy = (event.clientY - drag.startY) / cameraRef.current.zoom; const positions = new Map(drag.positions.map(position => [position.id, position])); setNodes(current => current.map(node => { const position = positions.get(node.id); return position ? { ...node, x: position.x + dx, y: position.y + dy } : node })); return }
    if (pan) { const next = { ...pan.camera, x: pan.camera.x - (event.clientX - pan.startX) / pan.camera.zoom, y: pan.camera.y - (event.clientY - pan.startY) / pan.camera.zoom }; cameraRef.current = next; setCamera(next) }
  }
  const finishPointer = () => {
    const moved = movedRef.current; movedRef.current = false
    if (selectionBox) {
      const left = Math.min(selectionBox.startX, selectionBox.x); const top = Math.min(selectionBox.startY, selectionBox.y)
      const right = Math.max(selectionBox.startX, selectionBox.x); const bottom = Math.max(selectionBox.startY, selectionBox.y)
      const rect = viewportRef.current?.getBoundingClientRect()
      const hits = folderNodes.filter(node => { const x = (node.x - cameraRef.current.x) * cameraRef.current.zoom + (rect?.left || 0); const y = (node.y - cameraRef.current.y) * cameraRef.current.zoom + (rect?.top || 0); return x + nodeSize.width * cameraRef.current.zoom >= left && x <= right && y + nodeSize.height * cameraRef.current.zoom >= top && y <= bottom })
      setSelectedNodeIds(hits.map(node => node.id)); setSelectedId(hits.length === 1 ? hits[0].id : null); setSelectionBox(null)
    }
    if (pan) {
      // A plain click on empty canvas (no movement) clears the selection; a real drag just pans.
      if (moved) persistCamera(cameraRef.current); else clearSelection()
      setPan(null)
    }
    if (drag) {
      const movedNodes = nodes.filter(node => drag.ids.includes(node.id)); setDrag(null)
      // Only persist when the node actually moved: a simple click used to write to the database every time.
      if (movedNodes.length && moved) runSafely(async () => {
        const savedNodes = await Promise.all(movedNodes.map(node => window.planner.conceptMap.saveNode({ id: node.id, folderId: node.folderId, kind: node.kind, sourceId: node.sourceId, title: node.title, body: node.body, x: node.x, y: node.y })))
        const savedById = new Map(savedNodes.map(node => [node.id, node]))
        setNodes(current => current.map(item => savedById.get(item.id) || item))
      }, 'No se pudieron guardar las posiciones de los nodos')
    }
  }
  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.concept-node, .concept-link')) return
    movedRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    if (event.shiftKey) { setSelectionShortcutNotice('Shift + arrastre selecciona varios nodos; arrastra uno seleccionado para moverlos juntos.'); setSelectionBox({ startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY }); return }
    setPan({ startX: event.clientX, startY: event.clientY, camera: cameraRef.current })
  }
  const zoomAt = (nextZoom: number, clientX?: number, clientY?: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    const localX = rect && clientX !== undefined ? clientX - rect.left : viewport.width / 2
    const localY = rect && clientY !== undefined ? clientY - rect.top : viewport.height / 2
    const previous = cameraRef.current; const zoom = clampZoom(nextZoom)
    const worldX = previous.x + localX / previous.zoom; const worldY = previous.y + localY / previous.zoom
    setCameraAndPersist({ x: worldX - localX / zoom, y: worldY - localY / zoom, zoom })
  }
  const fitNodes = (list: ConceptMapNode[]) => {
    if (!list.length) { setCameraAndPersist({ ...defaultCamera }); return }
    const left = Math.min(...list.map(node => node.x)); const top = Math.min(...list.map(node => node.y))
    const right = Math.max(...list.map(node => node.x + nodeSize.width)); const bottom = Math.max(...list.map(node => node.y + nodeSize.height))
    const zoom = clampZoom(Math.min(viewport.width / (right - left + 160), viewport.height / (bottom - top + 160)))
    setCameraAndPersist({ x: (left + right) / 2 - viewport.width / zoom / 2, y: (top + bottom) / 2 - viewport.height / zoom / 2, zoom })
  }
  const fitContent = () => fitNodes(folderNodes)

  const removeSelected = () => runSafely(async () => {
    if (!selected) return
    if (connectedLinks.length && !window.confirm(`Este nodo tiene ${connectedLinks.length} conexión(es) que se perderán. ¿Quitarlo del mapa? La idea o publicación original no se borra.`)) return
    await window.planner.conceptMap.removeNode(selected.id)
    setNodes(current => current.filter(node => node.id !== selected.id)); setLinks(current => current.filter(link => link.fromNodeId !== selected.id && link.toNodeId !== selected.id))
    clearSelection()
  }, 'No se pudo quitar el nodo del mapa')

  const beginEditNode = () => { if (!selected) return; setNodeTitle(selected.title); setNodeBody(selected.body); setSyncSource(true); setEditingNode(true) }
  const findSimilarIdeas = () => runSafely(async () => {
    if (!selected?.sourceId || selected.kind !== 'idea') return
    const requestedId = selected.id
    setLoadingSimilar(true)
    try { const result = await ideaNeighbors(selected.sourceId, 5); if (selectedIdRef.current === requestedId) setSimilarIdeas(result) } finally { setLoadingSimilar(false) }
  }, 'No se pudieron encontrar ideas relacionadas')
  const connectSimilar = (idea: IdeaNeighbor) => runSafely(async () => {
    if (!selected) return
    const target = nodes.find(node => node.kind === 'idea' && node.sourceId === idea.id) || await addNode('idea', idea.id, idea.title || fallbackTitle('idea'), idea.body, { select: false })
    await createLink(selected.id, target.id, 'related')
  }, 'No se pudo conectar la idea')
  const connectCounterpart = () => runSafely(async () => {
    if (!selected || !counterpart) return
    const other = counterpartNode || await addNode(counterpart.kind, counterpart.id, counterpart.title || fallbackTitle(counterpart.kind), counterpart.body, { select: false })
    const [from, to] = selected.kind === 'post' ? [selected, other] : [other, selected]
    await createLink(from.id, to.id, 'develops')
  }, 'No se pudo conectar con el elemento relacionado')

  const writeNode = (node: ConceptMapNode, title: string, body: string) => window.planner.conceptMap.saveNode({ id: node.id, folderId: node.folderId, kind: node.kind, sourceId: node.sourceId, title, body, x: node.x, y: node.y })
  const saveNodeDetails = () => runSafely(async () => {
    if (!selected || !nodeTitle.trim()) return
    const nextTitle = nodeTitle.trim(); const nextBody = nodeBody.trim()
    const saved = await writeNode(selected, nextTitle, nextBody)
    setNodes(current => current.map(node => node.id === saved.id ? saved : node))
    // With "update original" off, the node keeps its own map-only text and the source is left untouched.
    if (syncSource && selected.kind === 'idea' && selected.sourceId) { const source = ideaById.get(selected.sourceId); if (source && (source.title !== nextTitle || source.body !== nextBody)) await saveIdea({ ...source, title: nextTitle, body: nextBody }) }
    if (syncSource && selected.kind === 'post' && selected.sourceId) { const source = postById.get(selected.sourceId); if (source && (source.title !== nextTitle || source.caption !== nextBody)) await savePost({ ...source, title: nextTitle, caption: nextBody }) }
    setEditingNode(false)
  }, 'No se pudieron guardar los detalles del nodo')
  const restoreFromSource = () => runSafely(async () => {
    if (!selected) return
    const source = sourceOf(selected); if (!source) return
    const saved = await writeNode(selected, source.title.trim() || fallbackTitle(selected.kind), source.body.trim())
    setNodes(current => current.map(node => node.id === saved.id ? saved : node))
  }, 'No se pudo restaurar el texto original')

  const focusNode = (node: ConceptMapNode, options: { record?: boolean } = {}) => {
    if (options.record !== false && selectedId && selectedId !== node.id) { const previous = selectedId; setHistory(current => [...current.slice(-29), previous]) }
    setSelectedLinkId(null)
    if (node.folderId !== activeFolderId) { setPendingFocusId(node.id); setActiveFolderId(node.folderId); return }
    setSelectedId(node.id); centerOn(node)
  }
  const goBack = () => {
    const stack = [...history]
    while (stack.length) {
      const node = nodes.find(item => item.id === stack.pop())
      if (node) { setHistory(stack); focusNode(node, { record: false }); return }
    }
    setHistory([])
  }

  const applyLayout = (mode: LayoutMode) => runSafely(async () => {
    if (!folderNodes.length) return
    const positions = arrangeNodes(folderNodes, mode, groupOf(mode))
    const previous = folderNodes.map(node => ({ id: node.id, x: node.x, y: node.y }))
    const saved: ConceptMapNode[] = []
    for (const node of folderNodes) { const position = positions.get(node.id)!; saved.push(await window.planner.conceptMap.saveNode({ id: node.id, folderId: node.folderId, kind: node.kind, sourceId: node.sourceId, title: node.title, body: node.body, x: position.x, y: position.y })) }
    const byId = new Map(saved.map(node => [node.id, node]))
    setNodes(current => current.map(node => byId.get(node.id) || node))
    setLayoutUndo(previous); fitNodes(saved)
  }, 'No se pudieron ordenar los nodos')
  const undoLayout = () => runSafely(async () => {
    if (!layoutUndo) return
    const saved: ConceptMapNode[] = []
    for (const old of layoutUndo) { const node = nodes.find(item => item.id === old.id); if (node) saved.push(await window.planner.conceptMap.saveNode({ id: node.id, folderId: node.folderId, kind: node.kind, sourceId: node.sourceId, title: node.title, body: node.body, x: old.x, y: old.y })) }
    const byId = new Map(saved.map(node => [node.id, node]))
    setNodes(current => current.map(node => byId.get(node.id) || node)); setLayoutUndo(null); fitNodes(saved)
  }, 'No se pudo deshacer el orden')

  const exportView = () => {
    const scopeName = path.length ? path.map(folder => folder.name).join(' / ') : 'Mapa completo'
    const payload = buildExport(folders, nodes, links, activeFolderId, scopeName)
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `mapa-conceptual-${(path.at(-1)?.name || 'completo').replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.json`
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url)
  }

  const nodeTitleOf = (id: string) => nodes.find(node => node.id === id)?.title || 'Nodo'
  const arrowFor = (link: ConceptMapLink) => selectedLinkId === link.id ? 'selected' : focusActive && connectedLinks.some(item => item.id === link.id) ? 'emphasized' : 'normal'

  return <section className="workspace concept-workspace"><ViewHeading title="Mapa conceptual" subtitle="Un mismo espacio para reunir ideas, publicaciones y recursos, y conectar lo que les da contexto."><button type="button" className="new-button" onClick={() => setIdeaOpen(true)}><Lightbulb size={17} /> Nueva idea</button><button type="button" className="map-action" onClick={() => setResourceOpen(true)}><Plus size={17} /> Recurso general</button><button type="button" className="map-action" onClick={() => setFolderOpen(true)}><FolderPlus size={16} /> Nueva carpeta</button></ViewHeading>
    <div className="map-navigation"><button className="map-icon-button" title="Volver a la carpeta anterior" disabled={!activeFolderId} onClick={() => setActiveFolderId(path.at(-2)?.id || null)}><ArrowLeft size={17} /></button><div className="map-breadcrumb"><button className={!activeFolderId ? 'active' : ''} onClick={() => setActiveFolderId(null)}>Mapa</button>{path.map(folder => <button className={folder.id === activeFolderId ? 'active' : ''} key={folder.id} onClick={() => setActiveFolderId(folder.id)}>{folder.name}</button>)}</div>{activeFolderId && <button className="map-icon-button danger" title="Eliminar carpeta y subir su contenido" onClick={() => void deleteActiveFolder()}><Trash2 size={16} /></button>}</div>
    {visibleFolders.length > 0 && <div className="map-folder-grid">{visibleFolders.map(folder => <button className="map-folder-card" key={folder.id} onClick={() => setActiveFolderId(folder.id)}><Folder size={21} /><span><strong>{folder.name}</strong><small>{nodes.filter(node => node.folderId === folder.id).length} nodos</small></span><ArrowLeft className="folder-enter" size={16} /></button>)}</div>}
    <div className="concept-toolbar"><label className="map-search"><Search size={15} /><input ref={searchRef} aria-label="Buscar nodos" placeholder="Buscar en este mapa…  ( / )" value={nodeQuery} onChange={event => setNodeQuery(event.target.value)} /></label><label className="relation-control"><span>Relación al conectar</span><select aria-label="Tipo de relación al conectar" value={relation || ''} onChange={event => setRelation((event.target.value || null) as ConceptRelation | null)}>{relationOptions.map(value => <option key={value || 'unclassified'} value={value || ''}>{relationLabel(value)}</option>)}</select></label><button type="button" className={'map-action ' + (showPendingIdeas ? 'active' : '')} disabled={!pendingIdeas.length && !showPendingIdeas} onClick={() => setShowPendingIdeas(value => !value)}><Lightbulb size={15} /> Ideas pendientes · {pendingIdeas.length}</button><button type="button" className={'map-action ' + (linkStartId ? 'active' : '')} disabled={!selected} title="Atajo: C · Esc para cancelar" onClick={() => setLinkStartId(current => current ? null : selected?.id || null)}><Link2 size={16} />{linkStartId ? 'Elegir destino (Esc cancela)' : 'Conectar seleccionado'}</button>{selected && <button type="button" className="map-action danger" title="Atajo: Supr" onClick={() => void removeSelected()}><Trash2 size={16} /> Quitar del mapa</button>}<div className="map-zoom"><button type="button" aria-label="Alejar" title="Alejar ( - )" onClick={() => zoomAt(cameraRef.current.zoom / 1.2)}><Minus size={16} /></button><span>{Math.round(camera.zoom * 100)}%</span><button type="button" aria-label="Acercar" title="Acercar ( + )" onClick={() => zoomAt(cameraRef.current.zoom * 1.2)}><ZoomIn size={16} /></button><button type="button" aria-label="Encuadrar contenido" title="Encuadrar contenido ( F )" onClick={fitContent}><Maximize2 size={15} /></button></div></div>
    <div className="concept-toolbar concept-toolbar-secondary"><div className="map-filter" role="group" aria-label="Filtrar nodos">{filterOrder.map(key => <button type="button" key={key} className={filter === key ? 'active' : ''} disabled={key !== 'all' && !filterCounts[key] && filter !== key} onClick={() => setFilter(key)}>{filterLabels[key]}<small>{filterCounts[key]}</small></button>)}</div><button type="button" className={'map-action ' + (showOpportunities ? 'active' : '')} disabled={!opportunityCount && !showOpportunities} onClick={() => setShowOpportunities(value => !value)}><Sparkles size={15} /> Oportunidades · {opportunityCount}</button><select className="map-source-select map-layout-select" aria-label="Ordenar nodos" value="" disabled={!folderNodes.length} onChange={event => { if (event.target.value) applyLayout(event.target.value as LayoutMode); event.target.value = '' }}><option value="">Ordenar nodos…</option>{(Object.keys(layoutLabels) as LayoutMode[]).map(mode => <option key={mode} value={mode}>{layoutLabels[mode]}</option>)}</select>{layoutUndo && <button type="button" className="map-action" onClick={() => void undoLayout()}><Undo2 size={15} /> Deshacer orden</button>}<button type="button" className="map-action" disabled={!history.length} title="Volver al nodo anterior (Alt + ←)" onClick={goBack}><ArrowLeft size={15} /> Nodo anterior</button><button type="button" className="map-action map-export" title="Exportar esta carpeta y sus subcarpetas con sus conexiones (JSON)" onClick={exportView}><Download size={15} /> Exportar</button><span className="map-selection-hint">{selectedNodeIds.length > 1 ? `${selectedNodeIds.length} nodos seleccionados` : 'Shift + clic para sumar · Shift + arrastre para seleccionar varios'}</span>{selectedNodeIds.length > 1 && <button type="button" className="map-action" onClick={clearSelection}>Limpiar selección</button>}</div>
    {showOpportunities && <div className="map-search-results map-opportunities" aria-label="Oportunidades editoriales"><strong>Oportunidades editoriales</strong>{unpublishedInMap.length > 0 && <button type="button" onClick={() => { setFilter('unpublished'); setShowOpportunities(false) }}><strong>{unpublishedInMap.length} idea(s) del mapa sin publicación</strong><small>resaltar</small></button>}{groups.map(group => <button type="button" key={group[0].id} onClick={() => focusNode(group[0])}><strong>{group.length} ideas conectadas sin publicación</strong><small>{group[0].title} y {group.length - 1} más · podrían ser una pieza</small></button>)}{!opportunityCount && <span>No hay oportunidades por ahora.</span>}</div>}
    {showPendingIdeas && <div className="map-search-results map-pending-ideas" aria-label="Ideas pendientes sin añadir al mapa"><strong>Ideas pendientes sin mapa</strong>{pendingIdeas.slice(0, 10).map(idea => <button type="button" key={idea.id} onClick={() => addIdeaNode(idea)}><strong>{idea.title || 'Idea sin título'}</strong><small>{idea.status === 'inbox' ? 'Bandeja' : 'En desarrollo'} · añadir</small></button>)}{pendingIdeas.length > 10 && <span>+{pendingIdeas.length - 10} ideas</span>}{!pendingIdeas.length && <span>No hay ideas pendientes sin añadir.</span>}</div>}
    {query && <div className="map-search-results" role="listbox" aria-label="Resultados de búsqueda">{matchedNodes.slice(0, 8).map(node => <button type="button" key={node.id} onClick={() => focusNode(node)}><strong>{node.title}</strong><small>{kindLabels[node.kind]}{node.folderId ? ` · ${folderPath(folders, node.folderId).map(folder => folder.name).join(' / ')}` : ''}</small></button>)}{matchedNodes.length > 8 && <span>+{matchedNodes.length - 8} resultados</span>}{!matchedNodes.length && <span>Sin resultados en tus mapas y carpetas.</span>}</div>}
    <div className={'concept-map-viewport ' + (focusActive ? 'focus-active ' : '') + (linkStartId ? 'linking' : '')} ref={viewportRef} style={{ backgroundSize: `${20 * camera.zoom}px ${20 * camera.zoom}px`, backgroundPosition: `${-camera.x * camera.zoom}px ${-camera.y * camera.zoom}px` }} onPointerDown={beginPan} onPointerMove={handlePointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer}>
      <svg className="concept-links" width={viewport.width} height={viewport.height}>
        <defs>{(['normal', 'emphasized', 'selected'] as const).map(state => <marker key={state} id={'concept-arrow-' + state} className={'arrow-' + state} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" /></marker>)}</defs>
        {links.map(link => {
          const from = folderNodeById.get(link.fromNodeId); const to = folderNodeById.get(link.toNodeId)
          // Draw a link when at least one end is on screen, so arrows to nodes just outside the view are not cut off.
          if (!from || !to || (!visibleIds.has(from.id) && !visibleIds.has(to.id))) return null
          const state = arrowFor(link); const forward = to.x + nodeSize.width / 2 >= from.x + nodeSize.width / 2
          const x1 = ((forward ? from.x + nodeSize.width : from.x) - camera.x) * camera.zoom; const y1 = (from.y + 68 - camera.y) * camera.zoom
          const x2 = ((forward ? to.x : to.x + nodeSize.width) - camera.x) * camera.zoom; const y2 = (to.y + 68 - camera.y) * camera.zoom
          const middleX = (x1 + x2) / 2; const middleY = (y1 + y2) / 2
          const dimmed = focusActive && state === 'normal'
          return <g className={'concept-link ' + state + (dimmed ? ' dimmed' : '')} key={link.id}><path d={`M ${x1} ${y1} C ${middleX} ${y1}, ${middleX} ${y2}, ${x2} ${y2}`} markerEnd={`url(#concept-arrow-${state})`} /><foreignObject x={middleX - 60} y={middleY - 12} width="120" height="25"><button type="button" title={`«${from.title}» ${relationLabel(link.relation)} «${to.title}» — clic para editar`} onClick={() => selectLink(link.id)}>{relationLabel(link.relation)} →</button></foreignObject></g>
        })}
      </svg>
      {selectionBox && (() => { const rect = viewportRef.current?.getBoundingClientRect(); const left = Math.min(selectionBox.startX, selectionBox.x) - (rect?.left || 0); const top = Math.min(selectionBox.startY, selectionBox.y) - (rect?.top || 0); return <div className="concept-selection-box" style={{ left, top, width: Math.abs(selectionBox.x - selectionBox.startX), height: Math.abs(selectionBox.y - selectionBox.startY) }} /> })()}
      {visibleWorld.map(node => {
        const Icon = kindIcons[node.kind]
        const isDimmed = (focusActive && node.id !== selectedId && !connectedIds.has(node.id)) || !matchesFilter(node)
        return <article key={node.id} className={'concept-node ' + node.kind + (selectedNodeIds.includes(node.id) ? ' selected' : '') + (linkStartId === node.id ? ' link-source' : '') + (isDimmed ? ' dimmed' : '') + (query && matchedIds.has(node.id) ? ' search-match' : '')} style={{ transform: `translate3d(${(node.x - camera.x) * camera.zoom}px, ${(node.y - camera.y) * camera.zoom}px, 0) scale(${camera.zoom})` }} onClick={event => { if (event.shiftKey) { const next = selectedNodeIds.includes(node.id) ? selectedNodeIds.filter(id => id !== node.id) : [...selectedNodeIds, node.id]; setSelectedNodeIds(next); setSelectedId(next.length === 1 ? next[0] : null); return } if (selectedNodeIds.length > 1 && selectedNodeIds.includes(node.id)) return; setSelectedNodeIds([node.id]); void selectNode(node.id) }} onPointerDown={event => { if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return; event.stopPropagation(); movedRef.current = false; if (event.shiftKey) { setSelectionShortcutNotice('Shift + clic suma o quita este nodo de la selección.'); return } if (!selectedNodeIds.includes(node.id)) { setSelectedNodeIds([node.id]); setSelectedId(node.id) } event.currentTarget.setPointerCapture(event.pointerId); const ids = selectedNodeIds.includes(node.id) && selectedNodeIds.length > 1 ? selectedNodeIds : [node.id]; setDrag({ ids, startX: event.clientX, startY: event.clientY, positions: folderNodes.filter(item => ids.includes(item.id)).map(item => ({ id: item.id, x: item.x, y: item.y })) }) }}><header><span><Icon size={14} /> {kindLabels[node.kind]}</span><GitBranch size={15} /></header><strong>{node.title}</strong>{node.body && <p>{node.body}</p>}</article>
      })}
      {!folderNodes.length && <div className="concept-empty"><Network size={30} /><strong>Esta carpeta está vacía</strong><span>Añade ideas, publicaciones o recursos desde los controles de abajo.</span></div>}
    </div>
    {selectedLink && (() => { const from = nodes.find(node => node.id === selectedLink.fromNodeId); const to = nodes.find(node => node.id === selectedLink.toNodeId); return <aside className="concept-detail concept-link-panel"><header><div><span>Conexión</span><h2 className="concept-link-sentence">«{from?.title || nodeTitleOf(selectedLink.fromNodeId)}» <em>{relationLabel(selectedLink.relation)}</em> «{to?.title || nodeTitleOf(selectedLink.toNodeId)}»</h2></div><div className="concept-detail-tools"><button type="button" className="map-icon-button" aria-label="Cerrar conexión" onClick={() => setSelectedLinkId(null)}><X size={16} /></button></div></header><div className="concept-link-controls"><label className="relation-control"><span>Tipo</span><select aria-label="Tipo de la conexión" value={selectedLink.relation || ''} onChange={event => updateLink(selectedLink, { relation: (event.target.value || null) as ConceptRelation | null })}>{relationOptions.map(value => <option key={value || 'unclassified'} value={value || ''}>{relationLabel(value)}</option>)}</select></label><button type="button" className="map-action" title="La flecha apunta al segundo nodo; invertirla cambia cuál es el origen" onClick={() => updateLink(selectedLink, { fromNodeId: selectedLink.toNodeId, toNodeId: selectedLink.fromNodeId })}><ArrowRightLeft size={15} /> Invertir dirección</button><button type="button" className="map-action danger" onClick={() => void removeLink(selectedLink.id)}><Trash2 size={15} /> Quitar conexión</button></div><span className="concept-detail-empty">La flecha va de «{from?.title || '…'}» (origen) hacia «{to?.title || '…'}» (destino).</span></aside> })()}
    {selected && <aside className="concept-detail"><header><div><span>{kindLabels[selected.kind]}</span>{editingNode ? <><label className="concept-edit-field">Título<input value={nodeTitle} maxLength={240} onChange={event => setNodeTitle(event.target.value)} /></label><label className="concept-edit-field">Descripción<textarea value={nodeBody} maxLength={20_000} onChange={event => setNodeBody(event.target.value)} /></label>{sourceOf(selected) && <label className="concept-edit-check"><input type="checkbox" checked={syncSource} onChange={event => setSyncSource(event.target.checked)} /> Actualizar también {selected.kind === 'idea' ? 'la idea' : 'la publicación'} original <small>(si no, el texto queda solo como nota de este mapa)</small></label>}</> : <h2>{selected.title}</h2>}</div><div className="concept-detail-tools">{editingNode ? <><button type="button" className="map-icon-button" aria-label="Guardar cambios" disabled={!nodeTitle.trim()} onClick={() => void saveNodeDetails()}><Save size={15} /></button><button type="button" className="map-icon-button" aria-label="Cancelar edición" onClick={() => setEditingNode(false)}><X size={16} /></button></> : <button type="button" className="map-icon-button" aria-label="Editar detalles" title="Editar (E)" onClick={beginEditNode}><Pencil size={15} /></button>}<button type="button" className="map-icon-button" aria-label="Cerrar detalles" title="Deseleccionar (Esc)" onClick={clearSelection}><X size={16} /></button></div></header>
      {!editingNode && selected.body && <p>{selected.body}</p>}
      {!editingNode && contextRows(selected).length > 0 && <dl className="concept-detail-meta">{contextRows(selected).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      {!editingNode && sourceDiffers(selected) && <div className="concept-detail-notice"><span>El texto de este nodo es distinto del original.</span><button type="button" className="map-action" onClick={() => void restoreFromSource()}>Usar texto original</button></div>}
      {selected.kind === 'post' && selected.sourceId && postById.has(selected.sourceId) && <button type="button" className="map-action" onClick={() => { selectPost(selected.sourceId); setView('board') }}><ExternalLink size={15} /> Abrir publicación</button>}
      {selected.kind === 'post' && counterpart?.kind === 'idea' && <button type="button" className="map-action" onClick={() => { selectIdea(counterpart.id); setView('ideas') }}><ExternalLink size={15} /> Abrir idea relacionada</button>}
      {selected.kind === 'idea' && selected.sourceId && ideaById.has(selected.sourceId) && <><button type="button" className="map-action" onClick={() => { selectIdea(selected.sourceId); setView('ideas') }}><ExternalLink size={15} /> Ver idea</button>{counterpart?.kind === 'post' && <button type="button" className="map-action" onClick={() => { selectPost(counterpart.id); setView('board') }}><ExternalLink size={15} /> Abrir publicación relacionada</button>}<div className="concept-detail-links"><div className="concept-similar-heading"><strong>Ideas parecidas</strong><button type="button" className="map-action" disabled={loadingSimilar} onClick={findSimilarIdeas}>{loadingSimilar ? 'Buscando…' : 'Explorar'}</button></div>{similarIdeas.length ? similarIdeas.map(idea => { const existing = nodes.find(node => node.kind === 'idea' && node.sourceId === idea.id); const alreadyLinked = Boolean(existing && links.some(link => (link.fromNodeId === selected.id && link.toNodeId === existing.id) || (link.toNodeId === selected.id && link.fromNodeId === existing.id))); return <div className="concept-similar-row" key={idea.id}><button type="button" onClick={() => existing ? focusNode(existing) : addIdeaNode(idea)}><span>{idea.title || 'Idea sin título'}</span><small>{Math.round(idea.similarity * 100)}% · {existing ? 'ver en el mapa' : 'añadir al mapa'}</small></button>{!alreadyLinked && <button type="button" className="map-action" title="Crear una conexión «se relaciona con» (puedes cambiarla después)" onClick={() => void connectSimilar(idea)}><Link2 size={14} /> Conectar</button>}</div> }) : <span className="concept-detail-empty">Explora ideas del mismo espacio para descubrir conexiones.</span>}</div></>}
      {counterpart && !counterpartLinked && <div className="concept-detail-notice"><span>{counterpartNode ? `Hay ${counterpart.kind === 'post' ? 'una publicación' : 'una idea'} relacionada en el mapa sin conectar.` : `Tiene ${counterpart.kind === 'post' ? 'una publicación' : 'una idea'} relacionada que aún no está en el mapa.`}</span><button type="button" className="map-action" onClick={() => void connectCounterpart()}><Link2 size={14} /> {counterpartNode ? 'Conectar' : 'Añadir y conectar'}</button></div>}
      <div className="concept-detail-links"><strong>Conexiones ({connectedLinks.length})</strong>{connectedLinks.length ? connectedLinks.map(link => { const outgoing = link.fromNodeId === selected.id; const other = nodes.find(node => node.id === (outgoing ? link.toNodeId : link.fromNodeId)); return other ? <button type="button" key={link.id} title={outgoing ? `«${selected.title}» ${relationLabel(link.relation)} «${other.title}»` : `«${other.title}» ${relationLabel(link.relation)} «${selected.title}»`} onClick={() => focusNode(other)}><span>{other.title}</span><small>{outgoing ? '→ saliente' : '← entrante'} · {relationLabel(link.relation)} · {kindLabels[other.kind]}{other.folderId !== activeFolderId ? ` · ${folderPath(folders, other.folderId).map(folder => folder.name).join(' / ') || 'Mapa'}` : ''}</small></button> : null }) : <span className="concept-detail-empty">Todavía no hay conexiones.</span>}</div></aside>}
    <div className="map-source-row"><select className="map-source-select" aria-label="Añadir idea al mapa" defaultValue="" onChange={event => { if (event.target.value) { addIdea(event.target.value); event.target.value = '' } }}><option value="">Añadir idea existente</option>{availableIdeas.filter(idea => !mappedIdeaIds.has(idea.id)).map(idea => <option key={idea.id} value={idea.id}>{idea.title || 'Idea sin título'}</option>)}</select><select className="map-source-select" aria-label="Añadir publicación al mapa" defaultValue="" onChange={event => { if (event.target.value) { addPost(event.target.value); event.target.value = '' } }}><option value="">Añadir publicación existente</option>{availablePosts.filter(post => !mappedPostIds.has(post.id)).map(post => <option key={post.id} value={post.id}>{post.title || 'Publicación sin título'}</option>)}</select><span className="map-shortcuts" title="Atajos de teclado">Esc deseleccionar · / buscar · C conectar · E editar · F encuadrar · +/- zoom · Alt+← anterior</span></div>
    {folderOpen && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setFolderOpen(false) }}><form className="space-dialog resource-dialog" onSubmit={event => { event.preventDefault(); void createFolder() }}><header><div><span>NUEVA CARPETA</span><h2>{activeFolderId ? 'Subcarpeta del mapa' : 'Carpeta del mapa'}</h2></div><button type="button" className="icon-button" onClick={() => setFolderOpen(false)}><X size={18} /></button></header><label>Nombre<input autoFocus value={folderName} maxLength={120} onChange={event => setFolderName(event.target.value)} placeholder="Ej. Investigación de campaña" /></label><footer><button type="button" className="ghost-button" onClick={() => setFolderOpen(false)}>Cancelar</button><button className="save-button" disabled={!folderName.trim()}>Crear carpeta</button></footer></form></div>}
    {ideaOpen && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setIdeaOpen(false) }}><form className="space-dialog resource-dialog" onSubmit={event => { event.preventDefault(); void createIdea() }}><header><div><span>NUEVA IDEA</span><h2>Idea para el mapa</h2></div><button type="button" className="icon-button" onClick={() => setIdeaOpen(false)}><X size={18} /></button></header><label>Título<input autoFocus value={ideaTitle} maxLength={240} onChange={event => setIdeaTitle(event.target.value)} placeholder="Ej. Primer argumento del reel" /></label><label>Desarrollo<textarea value={ideaBody} maxLength={20_000} onChange={event => setIdeaBody(event.target.value)} placeholder="Anota el enfoque o datos importantes" /></label><footer><button type="button" className="ghost-button" onClick={() => setIdeaOpen(false)}>Cancelar</button><button className="save-button" disabled={!ideaTitle.trim()}>Crear idea</button></footer></form></div>}
    {resourceOpen && <div className="space-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setResourceOpen(false) }}><form className="space-dialog resource-dialog" onSubmit={event => { event.preventDefault(); addResource() }}><header><div><span>RECURSO GENERAL</span><h2>Nuevo elemento de contexto</h2></div><button type="button" className="icon-button" onClick={() => setResourceOpen(false)}><X size={18} /></button></header><label>Título<input autoFocus value={resourceTitle} maxLength={240} onChange={event => setResourceTitle(event.target.value)} placeholder="Ej. Guía de tono de marca" /></label><label>Notas<textarea value={resourceBody} maxLength={20_000} onChange={event => setResourceBody(event.target.value)} placeholder="Enlace, contexto o recordatorio" /></label><footer><button type="button" className="ghost-button" onClick={() => setResourceOpen(false)}>Cancelar</button><button className="save-button" disabled={!resourceTitle.trim()}>Añadir al mapa</button></footer></form></div>}
    {selectionShortcutNotice && <div className="global-undo-notice" role="status" aria-live="polite">{selectionShortcutNotice}</div>}
  </section>
}

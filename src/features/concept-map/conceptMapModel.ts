import type { ConceptMapFolder, ConceptMapLink, ConceptMapNode, ConceptNodeKind, ConceptRelation, Idea } from '../../shared/types'

export const nodeSize = { width: 220, height: 116 }

export const relationLabels: Record<ConceptRelation | 'unclassified', string> = {
  references: 'hace referencia a', depends_on: 'depende de', related: 'se relaciona con', develops: 'desarrolla',
  example_of: 'es un ejemplo de', requires: 'requiere', contradicts: 'contradice', unclassified: 'sin clasificar',
}
export const relationOptions: Array<ConceptRelation | null> = [null, 'related', 'references', 'develops', 'example_of', 'depends_on', 'requires', 'contradicts']
export function relationLabel(relation: ConceptRelation | null) { return relationLabels[relation || 'unclassified'] }

export const kindLabels: Record<ConceptNodeKind, string> = { idea: 'Idea', post: 'Publicación', resource: 'Recurso general' }

export type NodeFilter = 'all' | 'idea' | 'post' | 'resource' | 'orphan' | 'unpublished'
export const filterLabels: Record<NodeFilter, string> = {
  all: 'Todo', idea: 'Ideas', post: 'Publicaciones', resource: 'Recursos', orphan: 'Sin conexiones', unpublished: 'Ideas sin publicar',
}
export const filterOrder: NodeFilter[] = ['all', 'idea', 'post', 'resource', 'orphan', 'unpublished']

export const ideaStatusLabels: Record<string, string> = { inbox: 'Bandeja', developing: 'En desarrollo', ready: 'Lista', converted: 'Convertida', archived: 'Archivada' }
export const postStatusLabels: Record<string, string> = { idea: 'Idea', draft: 'Borrador', review: 'Revisión', approved: 'Aprobada', scheduled: 'Programada', published: 'Publicada', archived: 'Archivada' }
export const priorityLabels: Record<string, string> = { low: 'Baja', normal: 'Normal', high: 'Alta' }
export const contentTypeLabels: Record<string, string> = { reel: 'Reel', carousel: 'Carrusel', story: 'Historia', post: 'Publicación', thread: 'Hilo' }

export function formatDate(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** True when the node text is the placeholder used for untitled sources or equals the source title. */
export function sameTitle(nodeTitle: string, sourceTitle: string) {
  const source = sourceTitle.trim()
  return source ? nodeTitle === source : /sin t[ií]tulo$/i.test(nodeTitle)
}

/** An idea that is still open (not converted/archived) and has no publication attached. */
export function isUnpublishedIdea(idea: Idea | undefined) {
  if (!idea) return false
  if (idea.postId || idea.combinedPostId || idea.combinedPostIds?.length) return false
  return idea.status === 'inbox' || idea.status === 'developing' || idea.status === 'ready'
}

const slotX = (index: number) => 52 + (index % 5) * 270
const slotY = (index: number) => 92 + Math.floor(index / 5) * 182

/** First grid slot that does not overlap an existing node (the old count-based slot overlapped after moves/deletes). */
export function findFreeSlot(nodes: ConceptMapNode[]) {
  for (let index = 0; index < nodes.length + 200; index++) {
    const x = slotX(index); const y = slotY(index)
    if (!nodes.some(node => Math.abs(node.x - x) < nodeSize.width && Math.abs(node.y - y) < nodeSize.height)) return { x, y }
  }
  return { x: slotX(0), y: slotY(0) }
}

export type LayoutMode = 'kind' | 'status' | 'grid'
export const layoutLabels: Record<LayoutMode, string> = { kind: 'Por tipo', status: 'Por estado', grid: 'Cuadrícula' }

const kindOrder: ConceptNodeKind[] = ['idea', 'post', 'resource']
const maxRowsPerColumn = 6

/** Computes new positions. Groups become columns (wrapping after 6 rows) so nothing overlaps. */
export function arrangeNodes(nodes: ConceptMapNode[], mode: LayoutMode, groupOf: (node: ConceptMapNode) => string) {
  const result = new Map<string, { x: number; y: number }>()
  const byTitle = (a: ConceptMapNode, b: ConceptMapNode) => a.title.localeCompare(b.title, 'es')
  if (mode === 'grid') {
    ;[...nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach((node, index) => result.set(node.id, { x: slotX(index), y: slotY(index) }))
    return result
  }
  const buckets = new Map<string, ConceptMapNode[]>()
  for (const node of nodes) { const key = groupOf(node); const list = buckets.get(key); if (list) list.push(node); else buckets.set(key, [node]) }
  const keys = [...buckets.keys()].sort((a, b) => mode === 'kind' ? kindOrder.indexOf(a as ConceptNodeKind) - kindOrder.indexOf(b as ConceptNodeKind) : a.localeCompare(b, 'es'))
  let column = 0
  for (const key of keys) {
    const group = buckets.get(key)!.sort(byTitle)
    group.forEach((node, index) => result.set(node.id, { x: 52 + (column + Math.floor(index / maxRowsPerColumn)) * 270, y: 92 + (index % maxRowsPerColumn) * 160 }))
    column += Math.ceil(group.length / maxRowsPerColumn)
  }
  return result
}

/**
 * Connected groups of 3+ ideas with no publication anywhere in the group: candidates to become one piece.
 * `hasPost` lets the caller exclude ideas that already have a publication outside the map.
 */
export function opportunityGroups(nodes: ConceptMapNode[], links: ConceptMapLink[], hasPost: (node: ConceptMapNode) => boolean) {
  const parent = new Map<string, string>(nodes.map(node => [node.id, node.id]))
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root)!
    let current = id
    while (parent.get(current) !== root) { const next = parent.get(current)!; parent.set(current, root); current = next }
    return root
  }
  for (const link of links) if (parent.has(link.fromNodeId) && parent.has(link.toNodeId)) parent.set(find(link.fromNodeId), find(link.toNodeId))
  const components = new Map<string, ConceptMapNode[]>()
  for (const node of nodes) { const root = find(node.id); const list = components.get(root); if (list) list.push(node); else components.set(root, [node]) }
  return [...components.values()]
    .filter(group => !group.some(node => node.kind === 'post' || hasPost(node)))
    .map(group => group.filter(node => node.kind === 'idea'))
    .filter(ideas => ideas.length >= 3)
    .sort((a, b) => b.length - a.length)
}

export function descendantFolderIds(folders: ConceptMapFolder[], rootId: string | null) {
  const ids = new Set<string>()
  if (rootId) ids.add(rootId)
  let grew = true
  while (grew) {
    grew = false
    for (const folder of folders) if (!ids.has(folder.id) && (folder.parentId ? ids.has(folder.parentId) : rootId === null)) { ids.add(folder.id); grew = true }
  }
  return ids
}

/** Self-contained snapshot of a folder (and its subfolders) with the connections between its nodes. */
export function buildExport(folders: ConceptMapFolder[], nodes: ConceptMapNode[], links: ConceptMapLink[], rootId: string | null, scopeName: string) {
  const folderIds = descendantFolderIds(folders, rootId)
  const inScope = (folderId: string | null) => folderId === null ? rootId === null : folderIds.has(folderId)
  const exportNodes = nodes.filter(node => inScope(node.folderId))
  const nodeIds = new Set(exportNodes.map(node => node.id))
  return {
    format: 'caballocci-concept-map', version: 1, exportedAt: new Date().toISOString(), scope: scopeName,
    folders: folders.filter(folder => folderIds.has(folder.id)),
    nodes: exportNodes,
    links: links.filter(link => nodeIds.has(link.fromNodeId) && nodeIds.has(link.toNodeId)).map(link => ({ ...link, relationLabel: relationLabel(link.relation) })),
  }
}
import type { IpcMainInvokeEvent } from 'electron'
import type { PlannerDatabase } from './database'
import { validateArgumentCount, validateConceptFolderInput, validateConceptLinkInput, validateConceptNodeInput, validateId } from './ipc-validation'

type ConceptMapIpcDependencies = {
  database: PlannerDatabase
  handle(channel: string, callback: (args: unknown[], event: IpcMainInvokeEvent) => unknown): void
  withoutArguments(callback: () => unknown): (args: unknown[]) => unknown
}
function mapConceptNode(row: Record<string, unknown>) {
  return {
    id: row.id, folderId: row.folder_id || null, kind: row.kind, sourceId: row.source_id || null,
    title: row.title, body: row.body, x: row.x, y: row.y,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function mapConceptFolder(row: Record<string, unknown>) {
  return { id: row.id, parentId: row.parent_id || null, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }
}

function mapConceptLink(row: Record<string, unknown>) {
  return {
    id: row.id, fromNodeId: row.from_node_id, toNodeId: row.to_node_id,
    relation: row.relation, createdAt: row.created_at,
  }
}

export function registerConceptMapIpcHandlers({ database, handle, withoutArguments }: ConceptMapIpcDependencies) {
  handle('concept-map:list', withoutArguments(() => {
    const conceptMap = database.listConceptMap()
    return { nodes: conceptMap.nodes.map(mapConceptNode), links: conceptMap.links.map(mapConceptLink), folders: conceptMap.folders.map(mapConceptFolder) }
  }))
  handle('concept-map:save-node', args => {
    validateArgumentCount(args, 1)
    return mapConceptNode(database.saveConceptNode(validateConceptNodeInput(args[0])))
  })
  handle('concept-map:remove-node', args => {
    validateArgumentCount(args, 1)
    return database.removeConceptNode(validateId(args[0], 'conceptMap.node.id'))
  })
  handle('concept-map:save-link', args => {
    validateArgumentCount(args, 1)
    return mapConceptLink(database.saveConceptLink(validateConceptLinkInput(args[0])))
  })
  handle('concept-map:remove-link', args => {
    validateArgumentCount(args, 1)
    return database.removeConceptLink(validateId(args[0], 'conceptMap.link.id'))
  })
  handle('concept-map:save-folder', args => {
    validateArgumentCount(args, 1)
    return mapConceptFolder(database.saveConceptFolder(validateConceptFolderInput(args[0])))
  })
  handle('concept-map:remove-folder', args => {
    validateArgumentCount(args, 1)
    return database.removeConceptFolder(validateId(args[0], 'conceptMap.folder.id'))
  })
}


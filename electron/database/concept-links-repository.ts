import type { Database } from 'sql.js'
import { firstRow, rows } from './sql'
import type { Row } from './types'

export class ConceptLinksRepository {
  constructor(private readonly db: Database, private readonly persist: () => void) {}
  list() {
    return {
      nodes: rows(this.db, 'SELECT * FROM concept_map_nodes ORDER BY created_at ASC'),
      links: rows(this.db, 'SELECT * FROM concept_map_links ORDER BY created_at ASC'),
      folders: rows(this.db, 'SELECT * FROM concept_map_folders ORDER BY created_at ASC'),
    }
  }

  saveNode(input: Row): Row {
    const now = new Date().toISOString()
    const id = String(input.id || crypto.randomUUID())
    const current = firstRow(this.db, `SELECT * FROM concept_map_nodes WHERE id = '${id.replaceAll("'", "''")}'`)
    this.db.run(`INSERT OR REPLACE INTO concept_map_nodes
      (id,folder_id,kind,source_id,title,body,x,y,created_at,updated_at)
      VALUES ($id,$folderId,$kind,$sourceId,$title,$body,$x,$y,$createdAt,$updatedAt)`, {
      $id: id,
      $folderId: input.folderId ? String(input.folderId) : null,
      $kind: String(input.kind),
      $sourceId: input.sourceId ? String(input.sourceId) : null,
      $title: String(input.title || ''),
      $body: String(input.body || ''),
      $x: Number(input.x),
      $y: Number(input.y),
      $createdAt: current?.created_at ? String(current.created_at) : now,
      $updatedAt: now,
    })
    this.persist()
    return this.node(id)!
  }

  removeNode(id: string) {
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run('DELETE FROM concept_map_links WHERE from_node_id = ? OR to_node_id = ?', [id, id])
      this.db.run('DELETE FROM concept_map_nodes WHERE id = ?', [id])
      this.db.run('COMMIT')
      this.persist()
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  save(input: Row): Row {
    const now = new Date().toISOString()
    const id = String(input.id || crypto.randomUUID())
    this.db.run('INSERT OR REPLACE INTO concept_map_links (id,from_node_id,to_node_id,relation,created_at) VALUES (?,?,?,?,?)', [id, String(input.fromNodeId), String(input.toNodeId), String(input.relation), now])
    this.persist()
    return this.link(id)!
  }

  remove(id: string) { this.db.run('DELETE FROM concept_map_links WHERE id = ?', [id]); this.persist() }

  saveFolder(input: Row): Row {
    const now = new Date().toISOString()
    const id = String(input.id || crypto.randomUUID())
    const current = firstRow(this.db, `SELECT * FROM concept_map_folders WHERE id = '${id.replaceAll("'", "''")}'`)
    this.db.run(`INSERT OR REPLACE INTO concept_map_folders
      (id,parent_id,name,created_at,updated_at)
      VALUES ($id,$parentId,$name,$createdAt,$updatedAt)`, {
      $id: id,
      $parentId: input.parentId ? String(input.parentId) : null,
      $name: String(input.name),
      $createdAt: current?.created_at ? String(current.created_at) : now,
      $updatedAt: now,
    })
    this.persist()
    return this.folder(id)!
  }

  removeFolder(id: string): { parentId: string | null } {
    const folder = this.folder(id)
    if (!folder) throw new Error('Carpeta del mapa no encontrada')
    const parentId = folder.parent_id ? String(folder.parent_id) : null
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run('UPDATE concept_map_nodes SET folder_id = ? WHERE folder_id = ?', [parentId, id])
      this.db.run('UPDATE concept_map_folders SET parent_id = ?, updated_at = ? WHERE parent_id = ?', [parentId, new Date().toISOString(), id])
      this.db.run('DELETE FROM concept_map_folders WHERE id = ?', [id])
      this.db.run('COMMIT')
      this.persist()
      return { parentId }
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  private node(id: string) { return firstRow(this.db, `SELECT * FROM concept_map_nodes WHERE id = '${id.replaceAll("'", "''")}'`) }
  private link(id: string) { return firstRow(this.db, `SELECT * FROM concept_map_links WHERE id = '${id.replaceAll("'", "''")}'`) }
  private folder(id: string) { return firstRow(this.db, `SELECT * FROM concept_map_folders WHERE id = '${id.replaceAll("'", "''")}'`) }
}

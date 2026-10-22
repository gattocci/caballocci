import type { Database } from 'sql.js'
import { firstRow, rows, sqlString } from './sql'
import type { Row } from './types'

type EventWriter = (type: string, entity: string, entityId: string, payload: Record<string, unknown>, at: string) => void

export class IdeasRepository {
  constructor(private readonly db: Database, private readonly persist: () => void, private readonly hash: (title: string, body: string) => string, private readonly event: EventWriter) {}

  list(): Row[] {
    const result = this.db.exec("SELECT * FROM ideas ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, updated_at DESC")
    if (!result[0]) return []
    const links = new Map<string, string[]>()
    rows(this.db, "SELECT idea_id,post_id FROM post_ideas WHERE relation = 'combined' ORDER BY created_at DESC").forEach(row => { const key = String(row.idea_id); links.set(key, [...(links.get(key) || []), String(row.post_id)]) })
    return result[0].values.map(values => { const row = Object.fromEntries(result[0].columns.map((key, index) => [key, values[index]])); return { ...row, combined_post_ids: JSON.stringify(links.get(String(row.id)) || []) } })
  }

  get(id: string): Row | undefined {
    const row = firstRow(this.db, 'SELECT * FROM ideas WHERE id = ' + sqlString(id)); if (!row) return undefined
    const links = rows(this.db, "SELECT post_id FROM post_ideas WHERE idea_id = " + sqlString(id) + " AND relation = 'combined' ORDER BY created_at DESC")
    return { ...row, combined_post_ids: JSON.stringify(links.map(link => String(link.post_id))) }
  }

  save(input: Row, shouldPersist = true): Row {
    const now = new Date().toISOString(); const id = String(input.id || crypto.randomUUID()); const current = this.get(id)
    this.db.run(`INSERT OR REPLACE INTO ideas (id,space,title,body,tags,media,status,priority,due_at,post_id,combined_post_id,created_at,updated_at,content_hash,source_name)
      VALUES ($id,$space,$title,$body,$tags,$media,$status,$priority,$dueDate,$postId,$combinedPostId,$createdAt,$updatedAt,$contentHash,$sourceName)`, {
      $id: id, $space: String(input.space || 'Mi contenido'), $title: String(input.title || ''), $body: String(input.body || ''), $tags: JSON.stringify(input.tags || []), $media: JSON.stringify(input.media || []), $status: String(input.status || 'inbox'), $priority: String(input.priority || 'normal'), $dueDate: input.dueDate ? String(input.dueDate) : null, $postId: current?.post_id ? String(current.post_id) : null, $combinedPostId: current?.combined_post_id ? String(current.combined_post_id) : null, $createdAt: current?.created_at ? String(current.created_at) : now, $updatedAt: now, $contentHash: this.hash(String(input.title || ''), String(input.body || '')), $sourceName: String(input.sourceName || current?.source_name || ''),
    })
    this.event(current ? 'idea_edited' : 'idea_created', 'idea', id, { title: String(input.title || '') }, now); if (shouldPersist) this.persist(); return this.get(id)!
  }

  saveMany(inputs: Row[]) {
    const existing = rows(this.db, "SELECT id,title,source_name,content_hash FROM ideas WHERE content_hash <> ''"); const byHash = new Map(existing.map(row => [String(row.content_hash), row])); const created: Row[] = []; const duplicates: Row[] = []; let skipped = 0
    this.db.run('BEGIN TRANSACTION')
    try {
      for (const input of inputs) {
        const hash = this.hash(String(input.title || ''), String(input.body || '')); const match = byHash.get(hash)
        if (match) { skipped++; duplicates.push({ title: String(input.title || ''), sourceName: String(input.sourceName || ''), existingId: String(match.id || ''), existingTitle: String(match.title || ''), existingSourceName: String(match.source_name || '') }); continue }
        const id = String(input.id || crypto.randomUUID()); const now = new Date().toISOString()
        this.db.run('INSERT OR REPLACE INTO ideas (id,space,title,body,tags,media,status,priority,due_at,post_id,combined_post_id,created_at,updated_at,content_hash,source_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, String(input.space || 'Mi contenido'), String(input.title || ''), String(input.body || ''), JSON.stringify(input.tags || []), JSON.stringify(input.media || []), String(input.status || 'inbox'), String(input.priority || 'normal'), input.dueDate ? String(input.dueDate) : null, null, null, String(input.createdAt || now), now, hash, String(input.sourceName || '')])
        this.event('idea_created', 'idea', id, { title: String(input.title || '') }, now); const saved = this.get(id); if (saved) created.push(saved); byHash.set(hash, { id, title: String(input.title || ''), source_name: String(input.sourceName || ''), content_hash: hash })
      }
      const first = inputs[0]; if (first) this.db.run('INSERT INTO idea_import_runs (id,file_name,space,total,created,skipped,imported_at) VALUES (?,?,?,?,?,?,?)', [crypto.randomUUID(), String(first.sourceName || 'ImportaciÃ³n manual'), String(first.space || ''), inputs.length, created.length, skipped, new Date().toISOString()])
      this.db.run('COMMIT'); if (inputs.length) this.persist(); return { created, skipped, duplicates }
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  listImportRuns() { return rows(this.db, 'SELECT id,file_name,space,total,created,skipped,imported_at FROM idea_import_runs ORDER BY imported_at DESC') }

  remove(id: string) {
    this.db.run('BEGIN TRANSACTION')
    try {
      const now = new Date().toISOString()
      this.db.run('UPDATE posts SET source_idea_id = NULL WHERE source_idea_id = ?', [id])
      this.db.run('DELETE FROM ideas WHERE id = ?', [id])
      this.db.run('DELETE FROM post_ideas WHERE idea_id = ?', [id])
      this.db.run('DELETE FROM embeddings WHERE idea_id = ?', [id])
      this.db.run('DELETE FROM idea_cluster_members WHERE idea_id = ?', [id])
      this.db.run('DELETE FROM idea_clusters WHERE name_manually_edited = 0 AND NOT EXISTS (SELECT 1 FROM idea_cluster_members WHERE cluster_id = idea_clusters.id)')
      this.event('idea_deleted', 'idea', id, {}, now)
      this.db.run('COMMIT')
      this.persist()
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }
}

import type { Database } from 'sql.js'
import { firstRow, rows, sqlString } from './sql'
import type { Row } from './types'

type EventWriter = (type: string, entity: string, entityId: string, payload: Record<string, unknown>, at: string) => void

export class PostsRepository {
  constructor(private readonly db: Database, private readonly persist: () => void, private readonly event: EventWriter) {}

  list(): Row[] {
    const result = this.db.exec('SELECT * FROM posts ORDER BY COALESCE(scheduled_at, updated_at) ASC')
    if (!result[0]) return []
    const links = new Map<string, string[]>()
    rows(this.db, "SELECT post_id,idea_id FROM post_ideas WHERE relation = 'combined' ORDER BY position").forEach(row => {
      const key = String(row.post_id); links.set(key, [...(links.get(key) || []), String(row.idea_id)])
    })
    return result[0].values.map(values => {
      const row = Object.fromEntries(result[0].columns.map((key, index) => [key, values[index]]))
      const ids = links.get(String(row.id)) || []
      return { ...row, combined_idea_ids: JSON.stringify(ids), combined_idea_count: ids.length }
    })
  }

  get(id: string): Row | undefined {
    const row = firstRow(this.db, 'SELECT * FROM posts WHERE id = ' + sqlString(id))
    if (!row) return undefined
    const links = rows(this.db, "SELECT idea_id FROM post_ideas WHERE post_id = " + sqlString(id) + " AND relation = 'combined' ORDER BY position")
    return { ...row, combined_idea_ids: JSON.stringify(links.map(link => String(link.idea_id))), combined_idea_count: links.length }
  }

  project(id: string) { return firstRow(this.db, 'SELECT project FROM posts WHERE id = ' + sqlString(id))?.project as string | undefined }

  save(input: Row, ideaLookup: (id: string) => Row | undefined): Row {
    const now = new Date().toISOString(); const id = String(input.id || crypto.randomUUID()); const current = this.get(id)
    const linked = firstRow(this.db, 'SELECT id FROM content_records WHERE post_id = ' + sqlString(id))
    const titleEdited = linked && current && String(current.title || '') !== String(input.title || '') ? 1 : Number(current?.title_manually_edited || 0)
    const values = { id, title: input.title || 'Sin tÃ­tulo', caption: input.caption || '', notes: input.notes || '', hashtags: JSON.stringify(input.hashtags || []), mentions: JSON.stringify(input.mentions || []), platforms: JSON.stringify(input.platforms || []), distribution: JSON.stringify(input.distribution || (Array.isArray(input.platforms) ? input.platforms : []).map((platform: unknown) => ({ id: String(platform), name: String(platform), status: 'pending' }))), contentType: input.contentType || 'post', status: input.status || 'idea', scheduledAt: input.scheduledAt || null, durationMinutes: input.durationMinutes || 60, project: input.project || '', color: input.color || '#ff6b4a', media: JSON.stringify(input.media || []), ideaBlocks: JSON.stringify(input.ideaBlocks || []), sourceIdeaId: current?.source_idea_id || null, createdAt: current?.created_at || input.createdAt || now, updatedAt: now, titleManuallyEdited: titleEdited }
    this.db.run(`INSERT OR REPLACE INTO posts (id,title,caption,notes,hashtags,mentions,platforms,distribution_json,content_type,status,scheduled_at,duration_minutes,project,color,media,idea_blocks,source_idea_id,title_manually_edited,created_at,updated_at)
      VALUES ($id,$title,$caption,$notes,$hashtags,$mentions,$platforms,$distribution,$contentType,$status,$scheduledAt,$durationMinutes,$project,$color,$media,$ideaBlocks,$sourceIdeaId,$titleManuallyEdited,$createdAt,$updatedAt)`, Object.fromEntries(Object.entries(values).map(([key, value]) => [`$${key}`, value])) as Record<string, string | number | null>)
    if (!current || String(current.status) !== String(values.status)) this.db.run('INSERT INTO status_history (post_id,from_status,to_status,changed_at) VALUES (?,?,?,?)', [id, current ? String(current.status) : null, String(values.status), now])
    if (titleEdited) this.db.run('UPDATE content_records SET title_manually_edited = 1, updated_at = ? WHERE post_id = ?', [now, id])
    this.syncIdeas(id, input.ideaBlocks, now, ideaLookup)
    this.event(current ? 'post_edited' : 'post_created', 'post', id, { title: String(input.title || '') }, now); this.persist()
    return this.get(id)!
  }

  remove(id: string) {
    this.db.run('BEGIN TRANSACTION')
    try {
      const now = new Date().toISOString()
      this.db.run("UPDATE ideas SET post_id = NULL, status = CASE WHEN status = 'converted' THEN 'ready' ELSE status END, updated_at = ? WHERE post_id = ?", [now, id])
      const combined = rows(this.db, `SELECT ideas.id,ideas.tags FROM ideas INNER JOIN post_ideas ON post_ideas.idea_id = ideas.id WHERE post_ideas.post_id = ${sqlString(id)} AND post_ideas.relation = 'combined'`)
      for (const idea of combined) {
        const remaining = firstRow(this.db, `SELECT post_id FROM post_ideas WHERE idea_id = ${sqlString(String(idea.id))} AND relation = 'combined' AND post_id <> ${sqlString(id)} ORDER BY created_at DESC`)
        const tags = this.parseTags(idea.tags).filter(tag => tag.toLocaleLowerCase() !== 'combinada'); if (remaining) tags.push('combinada')
        this.db.run('UPDATE ideas SET combined_post_id = ?, tags = ?, updated_at = ? WHERE id = ?', [remaining?.post_id ? String(remaining.post_id) : null, JSON.stringify(tags), now, String(idea.id)])
      }
      this.db.run('DELETE FROM posts WHERE id = ?', [id]); this.db.run('DELETE FROM post_ideas WHERE post_id = ?', [id]); this.db.run('DELETE FROM work_group_posts WHERE post_id = ?', [id]); this.event('post_deleted', 'post', id, {}, now); this.db.run('COMMIT'); this.persist()
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  reassignProject(fromProject: string, toProject: string) {
    const now = new Date().toISOString(); this.db.run('BEGIN TRANSACTION')
    try { this.db.run('UPDATE posts SET project = ?, updated_at = ? WHERE project = ?', [toProject, now, fromProject]); this.db.run('UPDATE ideas SET space = ?, updated_at = ? WHERE space = ?', [toProject, now, fromProject]); this.db.run('COMMIT'); this.persist() } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  private syncIdeas(postId: string, blocks: unknown, now: string, ideaLookup: (id: string) => Row | undefined) {
    if (!Array.isArray(blocks)) return
    const existing = new Map(rows(this.db, `SELECT idea_id,relation FROM post_ideas WHERE post_id = ${sqlString(postId)}`).map(row => [String(row.idea_id), String(row.relation)]))
    this.db.run('DELETE FROM post_ideas WHERE post_id = ?', [postId])
    blocks.forEach((block, position) => {
      if (!block || typeof block !== 'object') return
      const ideaId = String((block as Row).id || ''); if (!ideaId) return
      const idea = ideaLookup(ideaId); const relation = existing.get(ideaId) || (idea?.combined_post_id === postId ? 'combined' : idea?.post_id === postId ? 'individual' : null)
      if (relation) this.db.run('INSERT OR REPLACE INTO post_ideas (post_id,idea_id,relation,position,created_at) VALUES (?,?,?,?,?)', [postId, ideaId, relation, position, now])
    })
  }
  private parseTags(value: unknown): string[] { try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [] } catch { return [] } }
}

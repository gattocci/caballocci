import type { Database } from 'sql.js'
import { rows, sqlString } from './sql'
import type { Row } from './types'

type SourceReader = (id: string) => Row | undefined
type RecordReader = (sourceId?: string) => Row[]
type EntityReader = (id: string) => Row | undefined

export class SourceImportRepository {
  constructor(
    private readonly db: Database,
    private readonly persist: () => void,
    private readonly source: SourceReader,
    private readonly records: RecordReader,
    private readonly post: EntityReader,
    private readonly idea: EntityReader,
  ) {}

  applyImport(sourceId: string, items: Row[]) {
    const now = new Date().toISOString()
    const result = { new: 0, updated: 0, unchanged: 0, invalid: 0, total: items.length }
    const source = this.source(sourceId)
    const targetProject = String(source?.target_project || 'Mi contenido')
    const importMode = String(source?.import_mode || 'post')
    const initialStatus = String(source?.initial_status || 'idea')
    this.db.run('BEGIN TRANSACTION')
    try {
      for (const item of items) {
        const kind = String(item.kind)
        if (kind === 'invalid') { result.invalid += 1; continue }
        const record = item.record as Row
        const hash = String(item.contentHash)
        const ref = String(record.externalRef)
        const current = rows(this.db, 'SELECT * FROM content_records WHERE source_id = ' + sqlString(sourceId) + ' AND external_ref = ' + sqlString(ref)).at(0)
        if (!current) {
          const postId = importMode === 'idea' ? null : crypto.randomUUID()
          const contentId = crypto.randomUUID()
          if (postId) this.insertPost(postId, String(record.title), String(record.contentType || 'post'), initialStatus, targetProject, now)
          const ideaId = importMode === 'idea' || importMode === 'both' ? crypto.randomUUID() : null
          if (ideaId) this.insertIdea(ideaId, targetProject, String(record.title), this.recordBody(record), now)
          this.db.run(`INSERT INTO content_records (id,post_id,idea_id,source_id,external_ref,source_kind,content_hash,raw_json,normalized_json,enriched_json,suggested_title,title_manually_edited,status,created_at,updated_at,last_seen_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [contentId, postId, ideaId, sourceId, ref, String(record.sourceKind || ''), hash, JSON.stringify(record.raw), JSON.stringify(record), JSON.stringify(record.enriched || {}), null, 0, 'active', now, now, now])
          result.new += 1
          continue
        }

        let postId = current.post_id ? String(current.post_id) : null
        let ideaId = current.idea_id ? String(current.idea_id) : null
        const raw = this.recordRaw(record)
        if (!postId && (importMode === 'post' || importMode === 'both')) {
          postId = crypto.randomUUID()
          this.insertPost(postId, String(record.title), String(record.contentType || 'post'), initialStatus, targetProject, now)
        }
        if (!ideaId && (importMode === 'idea' || importMode === 'both')) {
          ideaId = crypto.randomUUID()
          this.insertIdea(ideaId, targetProject, String(record.title), String(raw.description || raw.body || ''), now)
        }
        if (postId !== (current.post_id ? String(current.post_id) : null) || ideaId !== (current.idea_id ? String(current.idea_id) : null)) {
          this.db.run('UPDATE content_records SET post_id=?, idea_id=?, updated_at=? WHERE id=?', [postId, ideaId, now, String(current.id)])
        }
        if (kind === 'updated') {
          const manuallyEdited = Number(current.title_manually_edited || 0) === 1
          this.db.run(`UPDATE content_records SET source_kind=?,content_hash=?,raw_json=?,normalized_json=?,suggested_title=?,updated_at=?,last_seen_at=? WHERE id=?`, [String(record.sourceKind || ''), hash, JSON.stringify(record.raw), JSON.stringify(record), manuallyEdited ? String(record.title) : null, now, now, String(current.id)])
          if (ideaId) this.db.run('UPDATE ideas SET title=?,body=?,space=?,updated_at=? WHERE id=?', [String(record.title), String(raw.description || raw.body || ''), targetProject, now, ideaId])
          if (!manuallyEdited && postId) this.db.run('UPDATE posts SET title = ?, content_type = ?, updated_at = ? WHERE id = ?', [String(record.title), String(record.contentType || 'post'), now, postId])
          result.updated += 1
        } else {
          this.db.run('UPDATE content_records SET last_seen_at = ? WHERE id = ?', [now, String(current.id)])
          result.unchanged += 1
        }
      }
      this.db.run('COMMIT')
      this.persist()
      return result
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  applySourceDestination(sourceId: string) {
    const source = this.source(sourceId)
    if (!source) throw new Error('Fuente no encontrada')
    const targetProject = String(source.target_project || 'Mi contenido')
    const importMode = String(source.import_mode || 'post')
    const initialStatus = String(source.initial_status || 'idea')
    const records = this.records(sourceId)
    const result = { total: records.length, postsMoved: 0, ideasMoved: 0, postsCreated: 0, ideasCreated: 0 }
    const now = new Date().toISOString()
    this.db.run('BEGIN TRANSACTION')
    try {
      for (const current of records) {
        const normalized = this.parseObject(current.normalized_json)
        const raw = this.parseObject(current.raw_json)
        let postId = current.post_id ? String(current.post_id) : null
        let ideaId = current.idea_id ? String(current.idea_id) : null
        if (importMode === 'post' || importMode === 'both') {
          const post = postId ? this.post(postId) : undefined
          if (post) {
            if (String(post.project) !== targetProject) result.postsMoved += 1
            this.db.run('UPDATE posts SET project = ?, updated_at = ? WHERE id = ?', [targetProject, now, postId])
          } else {
            postId = crypto.randomUUID()
            result.postsCreated += 1
            this.insertPost(postId, String(normalized.title || current.external_ref), String(normalized.contentType || 'post'), initialStatus, targetProject, now)
          }
        }
        if (importMode === 'idea' || importMode === 'both') {
          const idea = ideaId ? this.idea(ideaId) : undefined
          if (idea) {
            if (String(idea.space) !== targetProject) result.ideasMoved += 1
            this.db.run('UPDATE ideas SET space = ?, updated_at = ? WHERE id = ?', [targetProject, now, ideaId])
          } else {
            ideaId = crypto.randomUUID()
            result.ideasCreated += 1
            this.insertIdea(ideaId, targetProject, String(normalized.title || current.external_ref), String(raw.description || raw.body || ''), now)
          }
        }
        if (postId !== (current.post_id ? String(current.post_id) : null) || ideaId !== (current.idea_id ? String(current.idea_id) : null)) {
          this.db.run('UPDATE content_records SET post_id = ?, idea_id = ?, updated_at = ? WHERE id = ?', [postId, ideaId, now, String(current.id)])
        }
      }
      this.db.run('COMMIT')
      this.persist()
      return result
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  private insertPost(id: string, title: string, contentType: string, status: string, project: string, now: string) {
    this.db.run(`INSERT INTO posts (id,title,caption,notes,hashtags,mentions,platforms,content_type,status,scheduled_at,duration_minutes,project,color,media,idea_blocks,source_idea_id,title_manually_edited,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, title, '', '', '[]', '[]', '["instagram"]', contentType, status, null, 60, project, '#e76042', '[]', '[]', null, 0, now, now])
  }

  private insertIdea(id: string, space: string, title: string, body: string, now: string) {
    this.db.run(`INSERT INTO ideas (id,space,title,body,tags,media,status,priority,due_at,post_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [id, space, title, body, '[]', '[]', 'inbox', 'normal', null, null, now, now])
  }

  private recordRaw(record: Row): Row {
    return record.raw && typeof record.raw === 'object' ? record.raw as Row : {}
  }

  private recordBody(record: Row): string {
    const raw = this.recordRaw(record)
    return String(raw.description || raw.body || '')
  }

  private parseObject(value: unknown): Row {
    try {
      const parsed = JSON.parse(String(value || '{}')) as unknown
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Row : {}
    } catch { return {} }
  }
}

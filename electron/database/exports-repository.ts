import type { Database } from 'sql.js'
import { rows, sqlString } from './sql'
import type { Row } from './types'

export class ExportsRepository {
  constructor(private readonly db: Database, private readonly persist: () => void) {}

  listContentTypeTemplates(): Row[] { return rows(this.db, 'SELECT * FROM content_type_templates ORDER BY content_type ASC') }

  saveContentTypeTemplate(input: Row): Row {
    const now = new Date().toISOString()
    const contentType = String(input.contentType)
    const byType = rows(this.db, 'SELECT * FROM content_type_templates WHERE content_type = ' + sqlString(contentType)).at(0)
    const id = String(input.id || byType?.id || crypto.randomUUID())
    const current = rows(this.db, 'SELECT * FROM content_type_templates WHERE id = ' + sqlString(id)).at(0)
    this.db.run(`INSERT OR REPLACE INTO content_type_templates (id,content_type,fields_json,created_at,updated_at)
      VALUES ($id,$contentType,$fields,$createdAt,$updatedAt)`, {
      $id: id, $contentType: contentType, $fields: String(input.fieldsJson || '[]'),
      $createdAt: current?.created_at ? String(current.created_at) : now, $updatedAt: now,
    })
    this.persist()
    return rows(this.db, 'SELECT * FROM content_type_templates WHERE id = ' + sqlString(id)).at(0)!
  }

  listProfiles(): Row[] { return rows(this.db, 'SELECT * FROM export_profiles ORDER BY name COLLATE NOCASE ASC') }
  getProfile(id: string): Row | undefined { return rows(this.db, 'SELECT * FROM export_profiles WHERE id = ' + sqlString(id)).at(0) }

  saveProfile(input: Row): Row {
    const now = new Date().toISOString()
    const id = String(input.id || crypto.randomUUID())
    const current = this.getProfile(id)
    this.db.run(`INSERT OR REPLACE INTO export_profiles (id,name,applies_to_content_type,columns_json,created_at,updated_at)
      VALUES ($id,$name,$contentType,$columns,$createdAt,$updatedAt)`, {
      $id: id, $name: String(input.name), $contentType: String(input.appliesToContentType || 'all'), $columns: String(input.columnsJson || '[]'),
      $createdAt: current?.created_at ? String(current.created_at) : now, $updatedAt: now,
    })
    this.persist()
    return this.getProfile(id)!
  }

  listRows(sourceId?: string, project?: string): Row[] {
    const projectClause = project ? ' AND p.project = ' + sqlString(project) : ''
    if (sourceId) return rows(this.db, `SELECT c.id AS content_id, c.*, p.title AS post_title, p.caption AS post_caption, p.notes AS post_notes, p.hashtags AS post_hashtags, p.mentions AS post_mentions, p.platforms AS post_platforms, p.media AS post_media, p.idea_blocks AS post_idea_blocks, p.project AS post_project, p.status AS post_status, p.scheduled_at AS post_scheduled_at, p.content_type AS post_content_type
      FROM content_records c LEFT JOIN posts p ON p.id = c.post_id WHERE c.source_id = ${sqlString(sourceId)}${projectClause} ORDER BY COALESCE(p.scheduled_at, c.updated_at) ASC`)
    return rows(this.db, `SELECT c.id AS content_id, c.*, p.id AS post_id, p.title AS post_title, p.caption AS post_caption, p.notes AS post_notes, p.hashtags AS post_hashtags, p.mentions AS post_mentions, p.platforms AS post_platforms, p.media AS post_media, p.idea_blocks AS post_idea_blocks, p.project AS post_project, p.status AS post_status, p.scheduled_at AS post_scheduled_at, p.content_type AS post_content_type
      FROM posts p LEFT JOIN content_records c ON c.post_id = p.id WHERE 1 = 1${projectClause} ORDER BY COALESCE(p.scheduled_at, p.updated_at) ASC`)
  }

  listLastSnapshot(profileId: string, sourceId?: string, scope = ''): Row[] {
    const sourceClause = sourceId ? ' AND source_id = ' + sqlString(sourceId) : ' AND source_id IS NULL'
    const run = rows(this.db, 'SELECT id FROM export_runs WHERE profile_id = ' + sqlString(profileId) + sourceClause + ' AND scope = ' + sqlString(scope) + ' ORDER BY created_at DESC LIMIT 1').at(0)
    return run ? rows(this.db, 'SELECT row_key, row_hash FROM export_run_items WHERE run_id = ' + sqlString(String(run.id))) : []
  }

  saveSnapshot(profileId: string, sourceId: string | undefined, scope: string, mode: string, items: { rowKey: string; rowHash: string }[]) {
    const runId = crypto.randomUUID()
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run('INSERT INTO export_runs (id,profile_id,source_id,scope,mode,created_at) VALUES (?,?,?,?,?,?)', [runId, profileId, sourceId || null, scope, mode, new Date().toISOString()])
      for (const item of items) this.db.run('INSERT INTO export_run_items (run_id,row_key,row_hash) VALUES (?,?,?)', [runId, item.rowKey, item.rowHash])
      this.db.run('COMMIT')
      this.persist()
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }
}

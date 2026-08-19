import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { Database } from 'sql.js'

type Row = Record<string, unknown>

interface Migration {
  version: number
  name: string
  up: string
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_planner_schema',
    up: `
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
        hashtags TEXT NOT NULL DEFAULT '[]', mentions TEXT NOT NULL DEFAULT '[]', platforms TEXT NOT NULL DEFAULT '[]',
        content_type TEXT NOT NULL DEFAULT 'post', status TEXT NOT NULL DEFAULT 'idea', scheduled_at TEXT,
        duration_minutes INTEGER NOT NULL DEFAULT 60, project TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '#ff6b4a',
        media TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, post_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, changed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_assets (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL,
        size INTEGER NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'post_idea_blocks',
    up: `ALTER TABLE posts ADD COLUMN idea_blocks TEXT NOT NULL DEFAULT '[]';`,
  },
  {
    version: 3,
    name: 'ideas_inbox',
    up: `
      CREATE TABLE IF NOT EXISTS ideas (
        id TEXT PRIMARY KEY, space TEXT NOT NULL DEFAULT 'Mi contenido',
        title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]', media TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'inbox', priority TEXT NOT NULL DEFAULT 'normal',
        due_at TEXT, post_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ideas_space_idx ON ideas(space);
      CREATE INDEX IF NOT EXISTS ideas_post_idx ON ideas(post_id);
      ALTER TABLE posts ADD COLUMN source_idea_id TEXT;
    `,
  },
  {
    version: 4,
    name: 'concept_map',
    up: `
      CREATE TABLE IF NOT EXISTS concept_map_nodes (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, source_id TEXT,
        title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
        x REAL NOT NULL DEFAULT 40, y REAL NOT NULL DEFAULT 40,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS concept_map_links (
        id TEXT PRIMARY KEY, from_node_id TEXT NOT NULL, to_node_id TEXT NOT NULL,
        relation TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS concept_map_links_from_idx ON concept_map_links(from_node_id);
      CREATE INDEX IF NOT EXISTS concept_map_links_to_idx ON concept_map_links(to_node_id);
    `,
  },
  {
    version: 5,
    name: 'concept_map_folders',
    up: `
      CREATE TABLE IF NOT EXISTS concept_map_folders (
        id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      ALTER TABLE concept_map_nodes ADD COLUMN folder_id TEXT;
      CREATE INDEX IF NOT EXISTS concept_map_nodes_folder_idx ON concept_map_nodes(folder_id);
      CREATE INDEX IF NOT EXISTS concept_map_folders_parent_idx ON concept_map_folders(parent_id);
    `,
  },
  {
    version: 6,
    name: 'external_content_sources',
    up: `
      ALTER TABLE posts ADD COLUMN title_manually_edited INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'GET', format TEXT NOT NULL DEFAULT 'json',
        records_path TEXT, headers_ciphertext TEXT NOT NULL DEFAULT '', body_template TEXT,
        auth_type TEXT NOT NULL DEFAULT 'none', auth_ciphertext TEXT,
        max_records INTEGER NOT NULL DEFAULT 500, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_definitions (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, field_map_json TEXT NOT NULL,
        content_type_map_json TEXT NOT NULL DEFAULT '{}', custom_field_defaults_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS source_definitions_source_idx ON source_definitions(source_id);
      CREATE TABLE IF NOT EXISTS content_records (
        id TEXT PRIMARY KEY, post_id TEXT, source_id TEXT NOT NULL, external_ref TEXT NOT NULL,
        source_kind TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL, raw_json TEXT NOT NULL,
        normalized_json TEXT NOT NULL, enriched_json TEXT NOT NULL DEFAULT '{}', suggested_title TEXT,
        title_manually_edited INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
        UNIQUE(source_id, external_ref)
      );
      CREATE INDEX IF NOT EXISTS content_records_post_idx ON content_records(post_id);
      CREATE INDEX IF NOT EXISTS content_records_source_idx ON content_records(source_id);
      CREATE TABLE IF NOT EXISTS content_type_templates (
        id TEXT PRIMARY KEY, content_type TEXT NOT NULL UNIQUE, fields_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS export_profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, applies_to_content_type TEXT NOT NULL DEFAULT 'all',
        columns_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS import_runs (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, definition_id TEXT, summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 7,
    name: 'export_snapshots',
    up: `
      CREATE TABLE IF NOT EXISTS export_runs (
        id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, source_id TEXT, mode TEXT NOT NULL DEFAULT 'delta', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS export_run_items (
        run_id TEXT NOT NULL, row_key TEXT NOT NULL, row_hash TEXT NOT NULL,
        PRIMARY KEY (run_id, row_key)
      );
      CREATE INDEX IF NOT EXISTS export_runs_profile_idx ON export_runs(profile_id, source_id, created_at);
      CREATE INDEX IF NOT EXISTS export_run_items_key_idx ON export_run_items(row_key);
    `,
  },
  {
    version: 8,
    name: 'export_snapshot_scope',
    up: `ALTER TABLE export_runs ADD COLUMN scope TEXT NOT NULL DEFAULT ''; CREATE INDEX IF NOT EXISTS export_runs_scope_idx ON export_runs(profile_id, source_id, scope, created_at);`,
  },
  {
    version: 9,
    name: 'source_import_destination',
    up: `ALTER TABLE sources ADD COLUMN target_project TEXT NOT NULL DEFAULT 'Mi contenido'; ALTER TABLE sources ADD COLUMN import_mode TEXT NOT NULL DEFAULT 'post'; ALTER TABLE sources ADD COLUMN initial_status TEXT NOT NULL DEFAULT 'idea';`,
  },
  {
    version: 10,
    name: 'content_record_idea_link',
    up: `ALTER TABLE content_records ADD COLUMN idea_id TEXT; CREATE INDEX IF NOT EXISTS content_records_idea_idx ON content_records(idea_id);`,
  },
]

export class PlannerDatabase {
  private db!: Database
  private readonly existedAtStartup: boolean

  constructor(
    private readonly filePath: string,
    private readonly wasmPath: string,
    private readonly backupsDirectory: string,
  ) {
    this.existedAtStartup = fs.existsSync(filePath)
  }

  async init() {
    const SQL = await initSqlJs({ locateFile: () => this.wasmPath })
    this.db = this.existedAtStartup ? new SQL.Database(fs.readFileSync(this.filePath)) : new SQL.Database()
    this.runMigrations()
    if (!this.existedAtStartup && this.count() === 0) this.seed()
    this.persist()
  }

  createBackup(reason: 'before-migration' | 'before-update' | 'manual' = 'manual') {
    this.persist()
    fs.mkdirSync(this.backupsDirectory, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const destination = path.join(this.backupsDirectory, `caballocci-${timestamp}-${reason}.sqlite`)
    fs.copyFileSync(this.filePath, destination, fs.constants.COPYFILE_EXCL)
    return destination
  }

  list(): Row[] {
    const result = this.db.exec('SELECT * FROM posts ORDER BY COALESCE(scheduled_at, updated_at) ASC')
    if (!result[0]) return []
    return result[0].values.map((values) => Object.fromEntries(result[0].columns.map((key, index) => [key, values[index]])))
  }

  save(input: Row): Row {
    const now = new Date().toISOString()
    const id = String(input.id || crypto.randomUUID())
    const current = this.one(id)
    const linkedContent = this.rows('SELECT id FROM content_records WHERE post_id = ' + this.sqlString(id)).at(0)
    const titleManuallyEdited = linkedContent && current && String(current.title || '') !== String(input.title || '') ? 1 : Number(current?.title_manually_edited || 0)
    const createdAt = current?.created_at || input.createdAt || now
    const values = {
      id, title: input.title || 'Sin título', caption: input.caption || '', notes: input.notes || '',
      hashtags: JSON.stringify(input.hashtags || []), mentions: JSON.stringify(input.mentions || []),
      platforms: JSON.stringify(input.platforms || []), contentType: input.contentType || 'post', status: input.status || 'idea',
      scheduledAt: input.scheduledAt || null, durationMinutes: input.durationMinutes || 60, project: input.project || '',
      color: input.color || '#ff6b4a', media: JSON.stringify(input.media || []), ideaBlocks: JSON.stringify(input.ideaBlocks || []),
      sourceIdeaId: current?.source_idea_id || null, createdAt, updatedAt: now,
      titleManuallyEdited,
    }
    this.db.run(`INSERT OR REPLACE INTO posts
      (id,title,caption,notes,hashtags,mentions,platforms,content_type,status,scheduled_at,duration_minutes,project,color,media,idea_blocks,source_idea_id,title_manually_edited,created_at,updated_at)
      VALUES ($id,$title,$caption,$notes,$hashtags,$mentions,$platforms,$contentType,$status,$scheduledAt,$durationMinutes,$project,$color,$media,$ideaBlocks,$sourceIdeaId,$titleManuallyEdited,$createdAt,$updatedAt)`,
      Object.fromEntries(Object.entries(values).map(([key, value]) => [`$${key}`, value])) as Record<string, string | number | null>)
    const previousStatus = current ? String(current.status) : null
    const nextStatus = String(values.status)
    if (!current || previousStatus !== nextStatus) {
      this.db.run('INSERT INTO status_history (post_id,from_status,to_status,changed_at) VALUES (?,?,?,?)', [id, previousStatus, nextStatus, now])
    }
    if (titleManuallyEdited) this.db.run('UPDATE content_records SET title_manually_edited = 1, updated_at = ? WHERE post_id = ?', [now, id])
    this.persist()
    return this.one(id)!
  }

  listSources(): Row[] { return this.rows('SELECT * FROM sources ORDER BY name COLLATE NOCASE ASC') }

  getSource(id: string): Row | undefined { return this.rows('SELECT * FROM sources WHERE id = ' + this.sqlString(id)).at(0) }

  saveSource(input: Row): Row {
    const now = new Date().toISOString()
    const id = String(input.id || crypto.randomUUID())
    const current = this.getSource(id)
    this.db.run(`INSERT OR REPLACE INTO sources
      (id,name,base_url,method,format,records_path,headers_ciphertext,body_template,auth_type,auth_ciphertext,max_records,target_project,import_mode,initial_status,created_at,updated_at)
      VALUES ($id,$name,$baseUrl,$method,$format,$recordsPath,$headers,$body,$authType,$auth,$maxRecords,$targetProject,$importMode,$initialStatus,$createdAt,$updatedAt)`, {
      $id: id, $name: String(input.name), $baseUrl: String(input.baseUrl), $method: String(input.method), $format: String(input.format),
      $recordsPath: input.recordsPath ? String(input.recordsPath) : null, $headers: String(input.headersCiphertext || ''),
      $body: input.bodyTemplate ? String(input.bodyTemplate) : null, $authType: String(input.authType || 'none'),
      $auth: input.authCiphertext ? String(input.authCiphertext) : null, $maxRecords: Number(input.maxRecords || 500),
      $targetProject: String(input.targetProject || 'Mi contenido'), $importMode: String(input.importMode || 'post'), $initialStatus: String(input.initialStatus || 'idea'),
      $createdAt: current?.created_at ? String(current.created_at) : now, $updatedAt: now,
    })
    this.persist()
    return this.getSource(id)!
  }

  removeSource(id: string) {
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run('DELETE FROM content_records WHERE source_id = ?', [id])
      this.db.run('DELETE FROM source_definitions WHERE source_id = ?', [id])
      this.db.run('DELETE FROM sources WHERE id = ?', [id])
      this.db.run('COMMIT'); this.persist()
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  listSourceDefinitions(sourceId?: string): Row[] {
    return sourceId ? this.rows('SELECT * FROM source_definitions WHERE source_id = ' + this.sqlString(sourceId) + ' ORDER BY updated_at DESC') : this.rows('SELECT * FROM source_definitions ORDER BY updated_at DESC')
  }

  getSourceDefinition(id: string): Row | undefined { return this.rows('SELECT * FROM source_definitions WHERE id = ' + this.sqlString(id)).at(0) }

  saveSourceDefinition(input: Row): Row {
    const now = new Date().toISOString(); const id = String(input.id || crypto.randomUUID()); const current = this.getSourceDefinition(id)
    this.db.run(`INSERT OR REPLACE INTO source_definitions
      (id,source_id,field_map_json,content_type_map_json,custom_field_defaults_json,created_at,updated_at)
      VALUES ($id,$sourceId,$fieldMap,$typeMap,$defaults,$createdAt,$updatedAt)`, {
      $id: id, $sourceId: String(input.sourceId), $fieldMap: String(input.fieldMapJson || '{}'),
      $typeMap: String(input.contentTypeMapJson || '{}'), $defaults: String(input.customFieldDefaultsJson || '{}'),
      $createdAt: current?.created_at ? String(current.created_at) : now, $updatedAt: now,
    })
    this.persist(); return this.getSourceDefinition(id)!
  }

  listContentRecords(sourceId?: string): Row[] {
    return sourceId ? this.rows('SELECT * FROM content_records WHERE source_id = ' + this.sqlString(sourceId) + ' ORDER BY updated_at DESC') : this.rows('SELECT * FROM content_records ORDER BY updated_at DESC')
  }

  getContentRecordForPost(postId: string): Row | undefined {
    return this.rows('SELECT * FROM content_records WHERE post_id = ' + this.sqlString(postId) + ' ORDER BY updated_at DESC LIMIT 1').at(0)
  }

  saveContentEnriched(id: string, enrichedJson: string): Row {
    const current = this.rows('SELECT * FROM content_records WHERE id = ' + this.sqlString(id)).at(0)
    if (!current) throw new Error('Registro importado no encontrado')
    const now = new Date().toISOString()
    this.db.run('UPDATE content_records SET enriched_json = ?, updated_at = ? WHERE id = ?', [enrichedJson, now, id])
    this.persist()
    return this.rows('SELECT * FROM content_records WHERE id = ' + this.sqlString(id)).at(0)!
  }

  listContentTypeTemplates(): Row[] { return this.rows('SELECT * FROM content_type_templates ORDER BY content_type ASC') }

  saveContentTypeTemplate(input: Row): Row {
    const now = new Date().toISOString(); const contentType = String(input.contentType)
    const byType = this.rows('SELECT * FROM content_type_templates WHERE content_type = ' + this.sqlString(contentType)).at(0)
    const id = String(input.id || byType?.id || crypto.randomUUID())
    const current = this.rows('SELECT * FROM content_type_templates WHERE id = ' + this.sqlString(id)).at(0)
    this.db.run(`INSERT OR REPLACE INTO content_type_templates (id,content_type,fields_json,created_at,updated_at)
      VALUES ($id,$contentType,$fields,$createdAt,$updatedAt)`, {
      $id: id, $contentType: contentType, $fields: String(input.fieldsJson || '[]'),
      $createdAt: current?.created_at ? String(current.created_at) : now, $updatedAt: now,
    })
    this.persist(); return this.rows('SELECT * FROM content_type_templates WHERE id = ' + this.sqlString(id)).at(0)!
  }

  listExportProfiles(): Row[] { return this.rows('SELECT * FROM export_profiles ORDER BY name COLLATE NOCASE ASC') }

  getExportProfile(id: string): Row | undefined { return this.rows('SELECT * FROM export_profiles WHERE id = ' + this.sqlString(id)).at(0) }

  saveExportProfile(input: Row): Row {
    const now = new Date().toISOString(); const id = String(input.id || crypto.randomUUID()); const current = this.getExportProfile(id)
    this.db.run(`INSERT OR REPLACE INTO export_profiles (id,name,applies_to_content_type,columns_json,created_at,updated_at)
      VALUES ($id,$name,$contentType,$columns,$createdAt,$updatedAt)`, {
      $id: id, $name: String(input.name), $contentType: String(input.appliesToContentType || 'all'), $columns: String(input.columnsJson || '[]'),
      $createdAt: current?.created_at ? String(current.created_at) : now, $updatedAt: now,
    })
    this.persist(); return this.getExportProfile(id)!
  }

  listExportRows(sourceId?: string, project?: string): Row[] {
    const projectClause = project ? ' AND p.project = ' + this.sqlString(project) : ''
    if (sourceId) return this.rows(`SELECT c.id AS content_id, c.*, p.title AS post_title, p.caption AS post_caption, p.notes AS post_notes, p.hashtags AS post_hashtags, p.mentions AS post_mentions, p.platforms AS post_platforms, p.media AS post_media, p.idea_blocks AS post_idea_blocks, p.project AS post_project, p.status AS post_status, p.scheduled_at AS post_scheduled_at, p.content_type AS post_content_type
      FROM content_records c LEFT JOIN posts p ON p.id = c.post_id WHERE c.source_id = ${this.sqlString(sourceId)}${projectClause} ORDER BY COALESCE(p.scheduled_at, c.updated_at) ASC`)
    return this.rows(`SELECT c.id AS content_id, c.*, p.id AS post_id, p.title AS post_title, p.caption AS post_caption, p.notes AS post_notes, p.hashtags AS post_hashtags, p.mentions AS post_mentions, p.platforms AS post_platforms, p.media AS post_media, p.idea_blocks AS post_idea_blocks, p.project AS post_project, p.status AS post_status, p.scheduled_at AS post_scheduled_at, p.content_type AS post_content_type
      FROM posts p LEFT JOIN content_records c ON c.post_id = p.id WHERE 1 = 1${projectClause} ORDER BY COALESCE(p.scheduled_at, p.updated_at) ASC`)
  }

  listLastExportSnapshot(profileId: string, sourceId?: string, scope = ''): Row[] {
    const sourceClause = sourceId ? ' AND source_id = ' + this.sqlString(sourceId) : ' AND source_id IS NULL'
    const run = this.rows('SELECT id FROM export_runs WHERE profile_id = ' + this.sqlString(profileId) + sourceClause + ' AND scope = ' + this.sqlString(scope) + ' ORDER BY created_at DESC LIMIT 1').at(0)
    return run ? this.rows('SELECT row_key, row_hash FROM export_run_items WHERE run_id = ' + this.sqlString(String(run.id))) : []
  }

  saveExportSnapshot(profileId: string, sourceId: string | undefined, scope: string, mode: string, items: { rowKey: string; rowHash: string }[]) {
    const runId = crypto.randomUUID(); const now = new Date().toISOString()
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run('INSERT INTO export_runs (id,profile_id,source_id,scope,mode,created_at) VALUES (?,?,?,?,?,?)', [runId, profileId, sourceId || null, scope, mode, now])
      for (const item of items) this.db.run('INSERT INTO export_run_items (run_id,row_key,row_hash) VALUES (?,?,?)', [runId, item.rowKey, item.rowHash])
      this.db.run('COMMIT'); this.persist()
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  applyImport(sourceId: string, items: Row[]) {
    const now = new Date().toISOString(); const result = { new: 0, updated: 0, unchanged: 0, invalid: 0, total: items.length }
    const source = this.getSource(sourceId)
    const targetProject = String(source?.target_project || 'Mi contenido')
    const importMode = String(source?.import_mode || 'post')
    const initialStatus = String(source?.initial_status || 'idea')
    this.db.run('BEGIN TRANSACTION')
    try {
      for (const item of items) {
        const kind = String(item.kind); if (kind === 'invalid') { result.invalid += 1; continue }
        const record = item.record as Row; const hash = String(item.contentHash)
        const ref = String(record.externalRef); const current = this.rows('SELECT * FROM content_records WHERE source_id = ' + this.sqlString(sourceId) + ' AND external_ref = ' + this.sqlString(ref)).at(0)
        if (!current) {
          const postId = importMode === 'idea' ? null : crypto.randomUUID(); const contentId = crypto.randomUUID()
          if (postId) this.db.run(`INSERT INTO posts (id,title,caption,notes,hashtags,mentions,platforms,content_type,status,scheduled_at,duration_minutes,project,color,media,idea_blocks,source_idea_id,title_manually_edited,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [postId, String(record.title), '', '', '[]', '[]', '["instagram"]', String(record.contentType || 'post'), initialStatus, null, 60, targetProject, '#e76042', '[]', '[]', null, 0, now, now])
          const ideaId = importMode === 'idea' || importMode === 'both' ? crypto.randomUUID() : null
          if (ideaId) {
            const raw = record.raw && typeof record.raw === 'object' ? record.raw as Row : {}
            this.db.run(`INSERT INTO ideas (id,space,title,body,tags,media,status,priority,due_at,post_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [ideaId, targetProject, String(record.title), String(raw.description || raw.body || ''), '[]', '[]', 'inbox', 'normal', null, null, now, now])
          }
          this.db.run(`INSERT INTO content_records (id,post_id,idea_id,source_id,external_ref,source_kind,content_hash,raw_json,normalized_json,enriched_json,suggested_title,title_manually_edited,status,created_at,updated_at,last_seen_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [contentId, postId, ideaId, sourceId, ref, String(record.sourceKind || ''), hash, JSON.stringify(record.raw), JSON.stringify(record), JSON.stringify(record.enriched || {}), null, 0, 'active', now, now, now])
          result.new += 1
        } else {
          // Sources imported before a destination was configured can be reconciled later.
          // Only add a missing link; existing planner items keep their user-selected location.
          let postId = current.post_id ? String(current.post_id) : null
          let ideaId = current.idea_id ? String(current.idea_id) : null
          const raw = record.raw && typeof record.raw === 'object' ? record.raw as Row : {}
          if (!postId && (importMode === 'post' || importMode === 'both')) {
            postId = crypto.randomUUID()
            this.db.run(`INSERT INTO posts (id,title,caption,notes,hashtags,mentions,platforms,content_type,status,scheduled_at,duration_minutes,project,color,media,idea_blocks,source_idea_id,title_manually_edited,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [postId, String(record.title), '', '', '[]', '[]', '["instagram"]', String(record.contentType || 'post'), initialStatus, null, 60, targetProject, '#e76042', '[]', '[]', null, 0, now, now])
          }
          if (!ideaId && (importMode === 'idea' || importMode === 'both')) {
            ideaId = crypto.randomUUID()
            this.db.run(`INSERT INTO ideas (id,space,title,body,tags,media,status,priority,due_at,post_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [ideaId, targetProject, String(record.title), String(raw.description || raw.body || ''), '[]', '[]', 'inbox', 'normal', null, null, now, now])
          }
          if (postId !== (current.post_id ? String(current.post_id) : null) || ideaId !== (current.idea_id ? String(current.idea_id) : null)) {
            this.db.run('UPDATE content_records SET post_id=?, idea_id=?, updated_at=? WHERE id=?', [postId, ideaId, now, String(current.id)])
          }

          if (kind === 'updated') {
          const manuallyEdited = Number(current.title_manually_edited || 0) === 1
          this.db.run(`UPDATE content_records SET source_kind=?,content_hash=?,raw_json=?,normalized_json=?,suggested_title=?,updated_at=?,last_seen_at=? WHERE id=?`, [String(record.sourceKind || ''), hash, JSON.stringify(record.raw), JSON.stringify(record), manuallyEdited ? String(record.title) : null, now, now, String(current.id)])
          if (ideaId) {
            this.db.run('UPDATE ideas SET title=?,body=?,space=?,updated_at=? WHERE id=?', [String(record.title), String(raw.description || raw.body || ''), targetProject, now, ideaId])
          }
          if (!manuallyEdited && postId) this.db.run('UPDATE posts SET title = ?, content_type = ?, updated_at = ? WHERE id = ?', [String(record.title), String(record.contentType || 'post'), now, postId])
          result.updated += 1
          } else {
            this.db.run('UPDATE content_records SET last_seen_at = ? WHERE id = ?', [now, String(current.id)])
            result.unchanged += 1
          }
        }
      }
      this.db.run('COMMIT'); this.persist(); return result
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  applySourceDestination(sourceId: string) {
    const source = this.getSource(sourceId)
    if (!source) throw new Error('Fuente no encontrada')
    const targetProject = String(source.target_project || 'Mi contenido')
    const importMode = String(source.import_mode || 'post')
    const initialStatus = String(source.initial_status || 'idea')
    const records = this.listContentRecords(sourceId)
    const result = { total: records.length, postsMoved: 0, ideasMoved: 0, postsCreated: 0, ideasCreated: 0 }
    const now = new Date().toISOString()
    this.db.run('BEGIN TRANSACTION')
    try {
      for (const current of records) {
        let normalized: Row = {}; let raw: Row = {}
        try { const parsed = JSON.parse(String(current.normalized_json || '{}')) as unknown; if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) normalized = parsed as Row } catch { /* Empty fallback. */ }
        try { const parsed = JSON.parse(String(current.raw_json || '{}')) as unknown; if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) raw = parsed as Row } catch { /* Empty fallback. */ }
        let postId = current.post_id ? String(current.post_id) : null
        let ideaId = current.idea_id ? String(current.idea_id) : null

        if (importMode === 'post' || importMode === 'both') {
          const post = postId ? this.one(postId) : undefined
          if (post) {
            if (String(post.project) !== targetProject) result.postsMoved += 1
            this.db.run('UPDATE posts SET project = ?, updated_at = ? WHERE id = ?', [targetProject, now, postId])
          } else {
            postId = crypto.randomUUID(); result.postsCreated += 1
            this.db.run(`INSERT INTO posts (id,title,caption,notes,hashtags,mentions,platforms,content_type,status,scheduled_at,duration_minutes,project,color,media,idea_blocks,source_idea_id,title_manually_edited,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [postId, String(normalized.title || current.external_ref), '', '', '[]', '[]', '["instagram"]', String(normalized.contentType || 'post'), initialStatus, null, 60, targetProject, '#e76042', '[]', '[]', null, 0, now, now])
          }
        }

        if (importMode === 'idea' || importMode === 'both') {
          const idea = ideaId ? this.ideaOne(ideaId) : undefined
          if (idea) {
            if (String(idea.space) !== targetProject) result.ideasMoved += 1
            this.db.run('UPDATE ideas SET space = ?, updated_at = ? WHERE id = ?', [targetProject, now, ideaId])
          } else {
            ideaId = crypto.randomUUID(); result.ideasCreated += 1
            this.db.run(`INSERT INTO ideas (id,space,title,body,tags,media,status,priority,due_at,post_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [ideaId, targetProject, String(normalized.title || current.external_ref), String(raw.description || raw.body || ''), '[]', '[]', 'inbox', 'normal', null, null, now, now])
          }
        }

        if (postId !== (current.post_id ? String(current.post_id) : null) || ideaId !== (current.idea_id ? String(current.idea_id) : null)) {
          this.db.run('UPDATE content_records SET post_id = ?, idea_id = ?, updated_at = ? WHERE id = ?', [postId, ideaId, now, String(current.id)])
        }
      }
      this.db.run('COMMIT'); this.persist(); return result
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  remove(id: string) {
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run("UPDATE ideas SET post_id = NULL, status = CASE WHEN status = 'converted' THEN 'ready' ELSE status END, updated_at = ? WHERE post_id = ?", [new Date().toISOString(), id])
      this.db.run('DELETE FROM posts WHERE id = ?', [id])
      this.db.run('COMMIT')
      this.persist()
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  reassignProject(fromProject: string, toProject: string) {
    const now = new Date().toISOString()
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run('UPDATE posts SET project = ?, updated_at = ? WHERE project = ?', [toProject, now, fromProject])
      this.db.run('UPDATE ideas SET space = ?, updated_at = ? WHERE space = ?', [toProject, now, fromProject])
      this.db.run('COMMIT')
      this.persist()
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  listIdeas(): Row[] {
    const result = this.db.exec(`SELECT * FROM ideas ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, updated_at DESC`)
    if (!result[0]) return []
    return result[0].values.map(values => Object.fromEntries(result[0].columns.map((key, index) => [key, values[index]])))
  }

  saveIdea(input: Row): Row {
    const now = new Date().toISOString()
    const id = String(input.id || crypto.randomUUID())
    const current = this.ideaOne(id)
    this.db.run(`INSERT OR REPLACE INTO ideas
      (id,space,title,body,tags,media,status,priority,due_at,post_id,created_at,updated_at)
      VALUES ($id,$space,$title,$body,$tags,$media,$status,$priority,$dueDate,$postId,$createdAt,$updatedAt)`, {
      $id: id,
      $space: String(input.space || 'Mi contenido'),
      $title: String(input.title || ''),
      $body: String(input.body || ''),
      $tags: JSON.stringify(input.tags || []),
      $media: JSON.stringify(input.media || []),
      $status: String(input.status || 'inbox'),
      $priority: String(input.priority || 'normal'),
      $dueDate: input.dueDate ? String(input.dueDate) : null,
      $postId: current?.post_id ? String(current.post_id) : null,
      $createdAt: current?.created_at ? String(current.created_at) : now,
      $updatedAt: now,
    })
    this.persist()
    return this.ideaOne(id)!
  }

  removeIdea(id: string) {
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run('UPDATE posts SET source_idea_id = NULL WHERE source_idea_id = ?', [id])
      this.db.run('DELETE FROM ideas WHERE id = ?', [id])
      this.db.run('COMMIT')
      this.persist()
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  convertIdea(id: string): { idea: Row; post: Row } {
    const idea = this.ideaOne(id)
    if (!idea) throw new Error('Idea no encontrada')
    if (idea.post_id) {
      const existingPost = this.one(String(idea.post_id))
      if (existingPost) return { idea, post: existingPost }
    }

    const now = new Date().toISOString()
    const postId = crypto.randomUUID()
    const tags = this.parseStringArray(idea.tags)
    const hashtags = tags.map(tag => tag.startsWith('#') ? tag : `#${tag}`)
    const ideaBlocks = JSON.stringify([{ id: String(idea.id), title: String(idea.title), text: String(idea.body) }])
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run(`INSERT INTO posts
        (id,title,caption,notes,hashtags,mentions,platforms,content_type,status,scheduled_at,duration_minutes,project,color,media,idea_blocks,source_idea_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        postId, String(idea.title || 'Nueva publicación'), String(idea.body || ''), '', JSON.stringify(hashtags), '[]', '["instagram"]', 'post', 'idea',
        idea.due_at ? String(idea.due_at) : null, 60, String(idea.space || 'Mi contenido'), '#e76042', String(idea.media || '[]'), ideaBlocks, String(idea.id), now, now,
      ])
      this.db.run('INSERT INTO status_history (post_id,from_status,to_status,changed_at) VALUES (?,?,?,?)', [postId, null, 'idea', now])
      this.db.run("UPDATE ideas SET post_id = ?, status = 'converted', updated_at = ? WHERE id = ?", [postId, now, id])
      this.db.run('COMMIT')
      this.persist()
      return { idea: this.ideaOne(id)!, post: this.one(postId)! }
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  listConceptMap(): { nodes: Row[]; links: Row[]; folders: Row[] } {
    return {
      nodes: this.rows('SELECT * FROM concept_map_nodes ORDER BY created_at ASC'),
      links: this.rows('SELECT * FROM concept_map_links ORDER BY created_at ASC'),
      folders: this.rows('SELECT * FROM concept_map_folders ORDER BY created_at ASC'),
    }
  }

  saveConceptNode(input: Row): Row {
    const now = new Date().toISOString()
    const id = String(input.id || crypto.randomUUID())
    const current = this.conceptNodeOne(id)
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
    return this.conceptNodeOne(id)!
  }

  removeConceptNode(id: string) {
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

  saveConceptLink(input: Row): Row {
    const now = new Date().toISOString()
    const id = String(input.id || crypto.randomUUID())
    this.db.run(`INSERT OR REPLACE INTO concept_map_links
      (id,from_node_id,to_node_id,relation,created_at)
      VALUES ($id,$fromNodeId,$toNodeId,$relation,$createdAt)`, {
      $id: id,
      $fromNodeId: String(input.fromNodeId),
      $toNodeId: String(input.toNodeId),
      $relation: String(input.relation),
      $createdAt: now,
    })
    this.persist()
    return this.conceptLinkOne(id)!
  }

  removeConceptLink(id: string) {
    this.db.run('DELETE FROM concept_map_links WHERE id = ?', [id])
    this.persist()
  }

  saveConceptFolder(input: Row): Row {
    const now = new Date().toISOString()
    const id = String(input.id || crypto.randomUUID())
    const current = this.conceptFolderOne(id)
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
    return this.conceptFolderOne(id)!
  }

  removeConceptFolder(id: string): { parentId: string | null } {
    const folder = this.conceptFolderOne(id)
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

  listMedia(): Row[] {
    const result = this.db.exec('SELECT id,name,kind,size,mode FROM media_assets ORDER BY created_at DESC')
    if (!result[0]) return []
    return result[0].values.map(values => Object.fromEntries(result[0].columns.map((key, index) => [key, values[index]])))
  }

  getMediaPath(id: string): string | undefined {
    return this.getMediaFile(id)?.path
  }

  getMediaFile(id: string): { path: string; kind: string } | undefined {
    const statement = this.db.prepare('SELECT path,kind FROM media_assets WHERE id = ?')
    try {
      statement.bind([id])
      if (!statement.step()) return undefined
      const row = statement.getAsObject()
      if (typeof row.path !== 'string' || typeof row.kind !== 'string') return undefined
      return { path: row.path, kind: row.kind }
    } finally {
      statement.free()
    }
  }

  saveMedia(assets: Row[]) {
    const now = new Date().toISOString()
    assets.forEach(asset => this.db.run(
      'INSERT OR REPLACE INTO media_assets (id,name,path,kind,size,mode,created_at) VALUES (?,?,?,?,?,?,?)',
      [String(asset.id), String(asset.name), String(asset.path), String(asset.kind), Number(asset.size), String(asset.mode), now],
    ))
    this.persist()
  }

  private runMigrations() {
    const currentVersion = Number(this.db.exec('PRAGMA user_version')[0]?.values[0]?.[0] || 0)
    const pending = migrations.filter(migration => migration.version > currentVersion)
    if (pending.length === 0) return
    if (this.existedAtStartup) this.backupCurrentFile('before-migration')

    for (const migration of pending) {
      this.db.run('BEGIN TRANSACTION')
      try {
        this.db.run(migration.up)
        this.db.run(`PRAGMA user_version = ${migration.version}`)
        this.db.run('COMMIT')
      } catch (error) {
        this.db.run('ROLLBACK')
        throw new Error(`Falló la migración ${migration.version} (${migration.name})`, { cause: error })
      }
    }
  }

  private backupCurrentFile(reason: 'before-migration') {
    fs.mkdirSync(this.backupsDirectory, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const destination = path.join(this.backupsDirectory, `caballocci-${timestamp}-${reason}.sqlite`)
    fs.copyFileSync(this.filePath, destination, fs.constants.COPYFILE_EXCL)
  }

  private rows(sql: string): Row[] {
    const result = this.db.exec(sql)
    if (!result[0]) return []
    return result[0].values.map(values => Object.fromEntries(result[0].columns.map((key, index) => [key, values[index]])))
  }
  private one(id: string): Row | undefined { return this.list().find((row) => row.id === id) }
  private ideaOne(id: string): Row | undefined { return this.listIdeas().find((row) => row.id === id) }
  private conceptNodeOne(id: string): Row | undefined { return this.rows('SELECT * FROM concept_map_nodes WHERE id = ' + this.sqlString(id)).at(0) }
  private conceptLinkOne(id: string): Row | undefined { return this.rows('SELECT * FROM concept_map_links WHERE id = ' + this.sqlString(id)).at(0) }
  private conceptFolderOne(id: string): Row | undefined { return this.rows('SELECT * FROM concept_map_folders WHERE id = ' + this.sqlString(id)).at(0) }
  private sqlString(value: string) { return "'" + value.replaceAll("'", "''") + "'" }
  private count() { return Number(this.db.exec('SELECT COUNT(*) AS n FROM posts')[0]?.values[0]?.[0] || 0) }

  private parseStringArray(value: unknown): string[] {
    try {
      const parsed = JSON.parse(String(value || '[]'))
      return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    fs.writeFileSync(temporaryPath, Buffer.from(this.db.export()))
    fs.renameSync(temporaryPath, this.filePath)
  }

  private seed() {
    const base = new Date(); base.setHours(10, 0, 0, 0)
    const at = (offset: number, hour: number) => { const date = new Date(base); date.setDate(date.getDate() + offset); date.setHours(hour); return date.toISOString() }
    const samples = [
      { title:'Cómo planeamos un mes en 30 min', caption:'Un sistema simple vence a una semana caótica. Guarda este proceso para tu próxima sesión de contenido.', hashtags:['#ContentPlanning','#CreatorTips'], platforms:['instagram'], contentType:'reel', status:'scheduled', scheduledAt:at(0,11), durationMinutes:45, project:'Marca personal', color:'#ef6548' },
      { title:'Detrás de campaña Aurora', caption:'Del primer boceto al resultado final. Este es el trabajo que normalmente no se ve.', hashtags:['#BehindTheScenes'], platforms:['instagram','facebook'], contentType:'carousel', status:'approved', scheduledAt:at(1,15), durationMinutes:60, project:'Campaña Aurora', color:'#35a780' },
      { title:'Hilo: 5 aprendizajes del trimestre', caption:'Cinco decisiones pequeñas que cambiaron nuestros resultados este trimestre.', hashtags:['#Marketing'], platforms:['x'], contentType:'thread', status:'draft', scheduledAt:at(2,9), durationMinutes:30, project:'Editorial', color:'#4b8ed8' },
      { title:'Pregunta a la comunidad', caption:'¿Qué parte de crear contenido te consume más tiempo?', hashtags:['#Community'], platforms:['facebook','x'], contentType:'post', status:'review', scheduledAt:at(3,18), durationMinutes:30, project:'Comunidad', color:'#e5ac39' },
      { title:'Lanzamiento: plantilla semanal', caption:'La plantilla que usamos cada lunes ya está disponible.', hashtags:['#ProductLaunch','#Templates'], platforms:['instagram','facebook','x'], contentType:'carousel', status:'idea', scheduledAt:at(5,12), durationMinutes:60, project:'Producto', color:'#9a72d8' },
    ]
    samples.forEach((sample) => this.save(sample as unknown as Row))
  }
}

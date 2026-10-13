import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import initSqlJs, { Database } from 'sql.js'
import { env, pipeline } from '@huggingface/transformers'

type Row = Record<string, unknown>
type IdeaAnalysisOptions = {
  editorialPrefixes: string[]
  stripColonPrefixes: boolean
  stripBracketedText: boolean
  stripNumbers: boolean
  ignoreTitleNumbersInClusterNames: boolean
  minTokenLength: number
  genericTermThreshold: number
}
const defaultIdeaAnalysisOptions: IdeaAnalysisOptions = {
  editorialPrefixes: [],
  stripColonPrefixes: true,
  stripBracketedText: true,
  stripNumbers: true,
  ignoreTitleNumbersInClusterNames: true,
  minTokenLength: 3,
  genericTermThreshold: 0.08,
}

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
  {
    version: 11,
    name: 'catalog_integrations',
    up: `
      CREATE TABLE IF NOT EXISTS catalog_integration_config (
        id INTEGER PRIMARY KEY CHECK (id = 1), endpoint TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '', token_ciphertext TEXT NOT NULL DEFAULT '',
        default_kind TEXT NOT NULL DEFAULT 'resource', updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS catalog_syncs (
        post_id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL,
        kind TEXT NOT NULL, remote_id TEXT, public_url TEXT, action TEXT NOT NULL,
        error_json TEXT, updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 12,
    name: 'catalog_scoped_config_and_fields',
    up: `
      ALTER TABLE catalog_integration_config ADD COLUMN scope TEXT NOT NULL DEFAULT '';
      CREATE UNIQUE INDEX IF NOT EXISTS catalog_config_scope_idx ON catalog_integration_config(scope);
      CREATE TABLE IF NOT EXISTS catalog_post_fields (
        post_id TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
        use_hashtags INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'resource', updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 13,
    name: 'catalog_config_multi_scope_ids',
    up: `
      ALTER TABLE catalog_integration_config RENAME TO catalog_integration_config_old;
      CREATE TABLE catalog_integration_config (
        id INTEGER PRIMARY KEY, endpoint TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '', token_ciphertext TEXT NOT NULL DEFAULT '',
        default_kind TEXT NOT NULL DEFAULT 'resource', updated_at TEXT NOT NULL, scope TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO catalog_integration_config (id,endpoint,created_by,token_ciphertext,default_kind,updated_at,scope)
        SELECT id,endpoint,created_by,token_ciphertext,default_kind,updated_at,scope FROM catalog_integration_config_old;
      DROP TABLE catalog_integration_config_old;
      CREATE UNIQUE INDEX IF NOT EXISTS catalog_config_scope_idx ON catalog_integration_config(scope);
    `,
  },
  {
    version: 14,
    name: 'catalog_resource_category',
    up: `ALTER TABLE catalog_post_fields ADD COLUMN category_id INTEGER;`,
  },
  {
    version: 15,
    name: 'catalog_copy_text',
    up: `ALTER TABLE catalog_post_fields ADD COLUMN copy_text TEXT NOT NULL DEFAULT '';`,
  },
  {
    version: 16,
    name: 'catalog_category_slug',
    up: `ALTER TABLE catalog_post_fields ADD COLUMN category_slug TEXT NOT NULL DEFAULT '';`,
  },
  {
    version: 17,
    name: 'catalog_response_diagnostics',
    up: `ALTER TABLE catalog_syncs ADD COLUMN request_url TEXT; ALTER TABLE catalog_syncs ADD COLUMN response_status INTEGER; ALTER TABLE catalog_syncs ADD COLUMN response_headers_json TEXT; ALTER TABLE catalog_syncs ADD COLUMN response_body TEXT;`,
  },
  {
    version: 18,
    name: 'post_distribution_targets',
    up: `ALTER TABLE posts ADD COLUMN distribution_json TEXT NOT NULL DEFAULT '[]';`,
  },
  {
    version: 19,
    name: 'post_board_calendar_indexes',
    up: `
      CREATE INDEX IF NOT EXISTS posts_status_idx ON posts(status);
      CREATE INDEX IF NOT EXISTS posts_project_idx ON posts(project);
      CREATE INDEX IF NOT EXISTS posts_scheduled_at_idx ON posts(scheduled_at);
      CREATE INDEX IF NOT EXISTS posts_project_status_idx ON posts(project, status);
    `,
  },
  {
    version: 20,
    name: 'idea_import_identity',
    up: `ALTER TABLE ideas ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''; ALTER TABLE ideas ADD COLUMN source_name TEXT NOT NULL DEFAULT ''; CREATE INDEX IF NOT EXISTS ideas_content_hash_idx ON ideas(content_hash);`,
  },
  {
    version: 21,
    name: 'renderer_preferences_backup',
    up: `CREATE TABLE IF NOT EXISTS app_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);`,
  },
  {
    version: 22,
    name: 'idea_combined_post_link',
    up: `ALTER TABLE ideas ADD COLUMN combined_post_id TEXT; CREATE INDEX IF NOT EXISTS ideas_combined_post_idx ON ideas(combined_post_id);`,
  },
  {
    version: 23,
    name: 'idea_relations_ai_foundation',
    up: `
      CREATE TABLE IF NOT EXISTS post_ideas (
        post_id TEXT NOT NULL, idea_id TEXT NOT NULL, relation TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
        PRIMARY KEY (post_id, idea_id, relation)
      );
      CREATE INDEX IF NOT EXISTS post_ideas_idea_idx ON post_ideas(idea_id);
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, entity TEXT NOT NULL,
        entity_id TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_entity_idx ON events(entity, entity_id, created_at);
      CREATE TABLE IF NOT EXISTS embeddings (
        idea_id TEXT NOT NULL, model TEXT NOT NULL, model_version TEXT NOT NULL,
        content_hash TEXT NOT NULL, vector BLOB NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (idea_id, model, model_version)
      );
      CREATE TABLE IF NOT EXISTS idea_clusters (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, algorithm TEXT NOT NULL,
        model TEXT NOT NULL, model_version TEXT NOT NULL, calculated_at TEXT NOT NULL,
        name_manually_edited INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS idea_cluster_members (
        cluster_id TEXT NOT NULL, idea_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
        score REAL, PRIMARY KEY (cluster_id, idea_id)
      );
      CREATE INDEX IF NOT EXISTS idea_cluster_members_idea_idx ON idea_cluster_members(idea_id);
    `,
  },
]

export class PlannerDatabase {
  private db!: Database
  private readonly existedAtStartup: boolean
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private persistQueued = false
  private semanticExtractor: Promise<any> | null = null

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
    this.ensureCatalogColumns()
    if (!this.existedAtStartup && this.count() === 0) this.seed()
    this.persist()
    this.flush()
  }

  private ensureCatalogColumns() {
    const columns = (table: string) => new Set(this.rows(`PRAGMA table_info(${table})`).map(row => String(row.name)))
    const postFields = columns('catalog_post_fields')
    const syncs = columns('catalog_syncs')
    const additions: Array<[string, string]> = [
      ['category_slug', "TEXT NOT NULL DEFAULT ''"],
    ]
    for (const [name, definition] of additions) if (!postFields.has(name)) this.db.run(`ALTER TABLE catalog_post_fields ADD COLUMN ${name} ${definition}`)
    const syncAdditions: Array<[string, string]> = [['request_url', 'TEXT'], ['response_status', 'INTEGER'], ['response_headers_json', 'TEXT'], ['response_body', 'TEXT']]
    for (const [name, definition] of syncAdditions) if (!syncs.has(name)) this.db.run(`ALTER TABLE catalog_syncs ADD COLUMN ${name} ${definition}`)
    this.persist()
    this.ensureIdeaHashes()
    this.ensurePostIdeaLinks()
  }

  private ideaHash(title: string, body: string) {
    void title
    const normalized = body.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
    return createHash('sha256').update(normalized).digest('hex')
  }

  private ensureIdeaHashes() {
    const rows = this.rows('SELECT id,title,body,content_hash FROM ideas')
    if (!rows.length) return
    this.db.run('BEGIN TRANSACTION')
    try {
      let changed = false
      for (const row of rows) {
        const hash = this.ideaHash(String(row.title || ''), String(row.body || ''))
        if (String(row.content_hash || '') !== hash) { this.db.run('UPDATE ideas SET content_hash = ? WHERE id = ?', [hash, String(row.id)]); changed = true }
      }
      this.db.run('COMMIT'); if (changed) this.persist()
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  private ensurePostIdeaLinks() {
    const posts = this.rows('SELECT id,idea_blocks FROM posts')
    if (!posts.length) return
    const now = new Date().toISOString()
    this.db.run('BEGIN TRANSACTION')
    try {
      let changed = false
      for (const post of posts) {
        const existing = this.rows(`SELECT 1 FROM post_ideas WHERE post_id = ${this.sqlString(String(post.id))} LIMIT 1`)
        if (existing.length) continue
        let blocks: unknown[] = []
        try { const parsed = JSON.parse(String(post.idea_blocks || '[]')) as unknown; if (Array.isArray(parsed)) blocks = parsed } catch { blocks = [] }
        blocks.forEach((block, position) => {
          if (typeof block !== 'object' || block === null) return
          const ideaId = String((block as Record<string, unknown>).id || '')
          if (!ideaId || !this.ideaOne(ideaId)) return
          this.db.run('INSERT OR IGNORE INTO post_ideas (post_id,idea_id,relation,position,created_at) VALUES (?,?,?,?,?)', [String(post.id), ideaId, 'combined', position, now])
          this.db.run('UPDATE ideas SET combined_post_id = COALESCE(combined_post_id, ?), updated_at = ? WHERE id = ?', [String(post.id), now, ideaId])
          changed = true
        })
      }
      this.db.run('COMMIT'); if (changed) this.persist()
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  createBackup(reason: 'before-migration' | 'before-update' | 'manual' = 'manual') {
    this.flush()
    fs.mkdirSync(this.backupsDirectory, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const destination = path.join(this.backupsDirectory, `caballocci-${timestamp}-${reason}.sqlite`)
    fs.copyFileSync(this.filePath, destination, fs.constants.COPYFILE_EXCL)
    return destination
  }

  list(): Row[] {
    const result = this.db.exec('SELECT * FROM posts ORDER BY COALESCE(scheduled_at, updated_at) ASC')
    if (!result[0]) return []
    return result[0].values.map((values) => {
      const row = Object.fromEntries(result[0].columns.map((key, index) => [key, values[index]]))
      const links = this.rows(`SELECT idea_id FROM post_ideas WHERE post_id = ${this.sqlString(String(row.id))} AND relation = 'combined' ORDER BY position`)
      return { ...row, combined_idea_ids: JSON.stringify(links.map(link => String(link.idea_id))), combined_idea_count: links.length }
    })
  }

  savePreferences(entries: Record<string, string>) {
    const now = new Date().toISOString()
    this.db.run('BEGIN TRANSACTION')
    try {
      for (const [key, value] of Object.entries(entries)) this.db.run('INSERT OR REPLACE INTO app_preferences (key,value,updated_at) VALUES (?,?,?)', [key, value, now])
      this.db.run('COMMIT'); if (Object.keys(entries).length) this.persist()
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  removePreference(key: string) {
    this.db.run('DELETE FROM app_preferences WHERE key = ?', [key])
    this.persist()
  }

  listPreferences() {
    return Object.fromEntries(this.rows('SELECT key,value FROM app_preferences').map(row => [String(row.key), String(row.value)]))
  }

  projectForPost(id: string): string | undefined {
    return this.rows('SELECT project FROM posts WHERE id = ' + this.sqlString(id)).at(0)?.project as string | undefined
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
      platforms: JSON.stringify(input.platforms || []), distribution: JSON.stringify(input.distribution || (Array.isArray(input.platforms) ? input.platforms : []).map((id: unknown) => ({ id: String(id), name: String(id), status: 'pending' }))), contentType: input.contentType || 'post', status: input.status || 'idea',
      scheduledAt: input.scheduledAt || null, durationMinutes: input.durationMinutes || 60, project: input.project || '',
      color: input.color || '#ff6b4a', media: JSON.stringify(input.media || []), ideaBlocks: JSON.stringify(input.ideaBlocks || []),
      sourceIdeaId: current?.source_idea_id || null, createdAt, updatedAt: now,
      titleManuallyEdited,
    }
    this.db.run(`INSERT OR REPLACE INTO posts
      (id,title,caption,notes,hashtags,mentions,platforms,distribution_json,content_type,status,scheduled_at,duration_minutes,project,color,media,idea_blocks,source_idea_id,title_manually_edited,created_at,updated_at)
      VALUES ($id,$title,$caption,$notes,$hashtags,$mentions,$platforms,$distribution,$contentType,$status,$scheduledAt,$durationMinutes,$project,$color,$media,$ideaBlocks,$sourceIdeaId,$titleManuallyEdited,$createdAt,$updatedAt)`,
      Object.fromEntries(Object.entries(values).map(([key, value]) => [`$${key}`, value])) as Record<string, string | number | null>)
    const previousStatus = current ? String(current.status) : null
    const nextStatus = String(values.status)
    if (!current || previousStatus !== nextStatus) {
      this.db.run('INSERT INTO status_history (post_id,from_status,to_status,changed_at) VALUES (?,?,?,?)', [id, previousStatus, nextStatus, now])
    }
    if (titleManuallyEdited) this.db.run('UPDATE content_records SET title_manually_edited = 1, updated_at = ? WHERE post_id = ?', [now, id])
    this.syncPostIdeas(id, input.ideaBlocks, now)
    this.recordEvent(current ? 'post_edited' : 'post_created', 'post', id, { title: String(input.title || '') }, now)
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

  getPost(id: string): Row | undefined { return this.one(id) }

  getCatalogConfig(scope = ''): Row | undefined { return this.rows('SELECT * FROM catalog_integration_config WHERE scope = ' + this.sqlString(scope)).at(0) }

  saveCatalogConfig(input: Row): Row {
    const now = new Date().toISOString()
    const scope = String(input.scope || '')
    const current = this.getCatalogConfig(scope)
    // Migration 11 created this column as INTEGER; keep numeric ids for existing databases.
    const nextId = Number(this.rows('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM catalog_integration_config').at(0)?.next_id || 1)
    const id = current?.id ? Number(current.id) : nextId
    this.db.run(`INSERT OR REPLACE INTO catalog_integration_config (id,endpoint,created_by,token_ciphertext,default_kind,updated_at,scope)
      VALUES (?,?,?,?,?,?,?)`, [id, String(input.endpoint || ''), String(input.createdBy || ''), String(input.tokenCiphertext || ''), String(input.defaultKind || 'resource'), now, scope] as (string | number | null)[])
    this.persist(); return this.getCatalogConfig(scope)!
  }

  getCatalogPostFields(postId: string): Row | undefined { return this.rows('SELECT * FROM catalog_post_fields WHERE post_id = ' + this.sqlString(postId)).at(0) }

  saveCatalogPostFields(input: Row): Row {
    const now = new Date().toISOString()
    this.db.run(`INSERT OR REPLACE INTO catalog_post_fields (post_id,summary,content,use_hashtags,kind,category_id,copy_text,category_slug,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`, [String(input.postId), String(input.summary || ''), String(input.content || ''), input.useHashtags ? 1 : 0, String(input.kind || 'resource'), input.categoryId == null ? null : Number(input.categoryId), '', String(input.categorySlug || ''), now])
    this.persist(); return this.getCatalogPostFields(String(input.postId))!
  }

  getCatalogSync(postId: string): Row | undefined { return this.rows('SELECT * FROM catalog_syncs WHERE post_id = ' + this.sqlString(postId)).at(0) }

  saveCatalogSync(input: Row): Row {
    const now = new Date().toISOString()
    this.db.run(`INSERT OR REPLACE INTO catalog_syncs (post_id,source,external_id,kind,remote_id,public_url,action,error_json,request_url,response_status,response_headers_json,response_body,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [String(input.postId), String(input.source || 'caballocci'), String(input.externalId), String(input.kind), input.remoteId ? String(input.remoteId) : null, input.publicUrl ? String(input.publicUrl) : null, String(input.action), input.errorJson ? String(input.errorJson) : null, String(input.requestUrl || ''), input.responseStatus == null ? null : Number(input.responseStatus), String(input.responseHeadersJson || '{}'), String(input.responseBody || ''), now])
    this.persist(); return this.getCatalogSync(String(input.postId))!
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
      const combinedIdeas = this.rows(`SELECT ideas.id,ideas.tags FROM ideas INNER JOIN post_ideas ON post_ideas.idea_id = ideas.id WHERE post_ideas.post_id = ${this.sqlString(id)} AND post_ideas.relation = 'combined'`)
      for (const idea of combinedIdeas) {
        const remaining = this.rows(`SELECT post_id FROM post_ideas WHERE idea_id = ${this.sqlString(String(idea.id))} AND relation = 'combined' AND post_id <> ${this.sqlString(id)} ORDER BY created_at DESC`).at(0)
        const tags = this.parseStringArray(idea.tags).filter(tag => tag.toLocaleLowerCase() !== 'combinada')
        if (remaining) tags.push('combinada')
        this.db.run('UPDATE ideas SET combined_post_id = ?, tags = ?, updated_at = ? WHERE id = ?', [remaining?.post_id ? String(remaining.post_id) : null, JSON.stringify(tags), new Date().toISOString(), String(idea.id)])
      }
      this.db.run('DELETE FROM posts WHERE id = ?', [id])
      this.db.run('DELETE FROM post_ideas WHERE post_id = ?', [id])
      this.recordEvent('post_deleted', 'post', id, {}, new Date().toISOString())
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
    return result[0].values.map(values => {
      const row = Object.fromEntries(result[0].columns.map((key, index) => [key, values[index]]))
      const links = this.rows(`SELECT post_id FROM post_ideas WHERE idea_id = ${this.sqlString(String(row.id))} AND relation = 'combined' ORDER BY created_at DESC`)
      return { ...row, combined_post_ids: JSON.stringify(links.map(link => String(link.post_id))) }
    })
  }

  saveIdea(input: Row, shouldPersist = true): Row {
    const now = new Date().toISOString()
    const id = String(input.id || crypto.randomUUID())
    const current = this.ideaOne(id)
    this.db.run(`INSERT OR REPLACE INTO ideas
      (id,space,title,body,tags,media,status,priority,due_at,post_id,combined_post_id,created_at,updated_at,content_hash,source_name)
      VALUES ($id,$space,$title,$body,$tags,$media,$status,$priority,$dueDate,$postId,$combinedPostId,$createdAt,$updatedAt,$contentHash,$sourceName)`, {
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
      $combinedPostId: current?.combined_post_id ? String(current.combined_post_id) : null,
      $createdAt: current?.created_at ? String(current.created_at) : now,
      $updatedAt: now,
      $contentHash: this.ideaHash(String(input.title || ''), String(input.body || '')),
      $sourceName: String(input.sourceName || current?.source_name || ''),
    })
    this.recordEvent(current ? 'idea_edited' : 'idea_created', 'idea', id, { title: String(input.title || '') }, now)
    if (shouldPersist) this.persist()
    return this.ideaOne(id)!
  }

  saveIdeasMany(inputs: Row[]) {
    const existing = this.rows("SELECT id,title,source_name,content_hash FROM ideas WHERE content_hash <> ''")
    const seen = new Set(existing.map(row => String(row.content_hash)))
    const created: Row[] = []; const duplicates: Row[] = []; let skipped = 0
    this.db.run('BEGIN TRANSACTION')
    try {
      for (const input of inputs) {
        const hash = this.ideaHash(String(input.title || ''), String(input.body || ''))
        if (seen.has(hash)) { skipped += 1; const match = existing.find(row => String(row.content_hash) === hash); duplicates.push({ title: String(input.title || ''), sourceName: String(input.sourceName || ''), existingId: String(match?.id || ''), existingTitle: String(match?.title || ''), existingSourceName: String(match?.source_name || '') }); continue }
        const saved = this.saveIdea(input, false)
        created.push(saved); seen.add(hash)
      }
      this.db.run('COMMIT')
      if (created.length) this.persist()
      return { created, skipped, duplicates }
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  removeIdea(id: string) {
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run('UPDATE posts SET source_idea_id = NULL WHERE source_idea_id = ?', [id])
      this.db.run('DELETE FROM ideas WHERE id = ?', [id])
      this.db.run('DELETE FROM post_ideas WHERE idea_id = ?', [id])
      this.db.run('DELETE FROM embeddings WHERE idea_id = ?', [id])
      this.db.run('DELETE FROM idea_cluster_members WHERE idea_id = ?', [id])
      this.recordEvent('idea_deleted', 'idea', id, {}, new Date().toISOString())
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
      if (existingPost) {
        let blocks: unknown[] = []
        try { const parsed = JSON.parse(String(existingPost.idea_blocks || '[]')) as unknown; if (Array.isArray(parsed)) blocks = parsed } catch { /* Treat malformed blocks as a normal post link. */ }
        const isCombined = blocks.length > 1 && blocks.some(block => typeof block === 'object' && block !== null && String((block as Record<string, unknown>).id || '') === id)
        if (!isCombined) return { idea, post: existingPost }
        const tags = Array.from(new Set([...this.parseStringArray(idea.tags), 'combinada']))
        this.db.run("UPDATE ideas SET post_id = NULL, combined_post_id = ?, status = 'ready', tags = ?, updated_at = ? WHERE id = ?", [String(existingPost.id), JSON.stringify(tags), new Date().toISOString(), id])
      }
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
      this.db.run('INSERT OR REPLACE INTO post_ideas (post_id,idea_id,relation,position,created_at) VALUES (?,?,?,?,?)', [postId, id, 'individual', 0, now])
      this.recordEvent('converted', 'idea', id, { postId }, now)
      this.db.run('COMMIT')
      this.persist()
      return { idea: this.ideaOne(id)!, post: this.one(postId)! }
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  combineIdeas(ids: string[]): { ideas: Row[]; post: Row } {
    const ideas = ids.map(id => this.ideaOne(id))
    if (ideas.some(idea => !idea)) throw new Error('Una de las ideas seleccionadas no existe')
    const selected = ideas as Row[]
    if (selected.some(idea => idea.post_id)) throw new Error('Las ideas seleccionadas ya tienen una publicacion')
    const first = selected[0]
    const now = new Date().toISOString()
    const postId = crypto.randomUUID()
    const blocks = selected.map(idea => ({ id: String(idea.id), title: String(idea.title || ''), text: String(idea.body || '') }))
    const tags = Array.from(new Set([...selected.flatMap(idea => this.parseStringArray(idea.tags)), 'combinada']))
    const hashtags = tags.map(tag => tag.startsWith('#') ? tag : `#${tag}`)
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run(`INSERT INTO posts
        (id,title,caption,notes,hashtags,mentions,platforms,distribution_json,content_type,status,scheduled_at,duration_minutes,project,color,media,idea_blocks,source_idea_id,title_manually_edited,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        postId, String(first.title || 'Nueva publicacion'), '', '', JSON.stringify(hashtags), '[]', '["instagram"]',
        JSON.stringify([{ id: 'instagram', name: 'instagram', status: 'pending' }]), 'carousel', 'idea', null, 60,
        String(first.space || 'Mi contenido'), '#e76042', '[]', JSON.stringify(blocks), String(first.id), 0, now, now,
      ])
      this.db.run('INSERT INTO status_history (post_id,from_status,to_status,changed_at) VALUES (?,?,?,?)', [postId, null, 'idea', now])
      selected.forEach((idea, position) => {
        this.db.run("UPDATE ideas SET post_id = NULL, combined_post_id = COALESCE(combined_post_id, ?), status = 'ready', tags = ?, updated_at = ? WHERE id = ?", [postId, JSON.stringify(Array.from(new Set([...this.parseStringArray(idea.tags), 'combinada']))), now, String(idea.id)])
        this.db.run('INSERT INTO post_ideas (post_id,idea_id,relation,position,created_at) VALUES (?,?,?,?,?)', [postId, String(idea.id), 'combined', position, now])
      })
      this.recordEvent('combined', 'post', postId, { ideaIds: ids }, now)
      this.db.run('COMMIT')
      this.persist()
      return { ideas: ids.map(id => this.ideaOne(id)!), post: this.one(postId)! }
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  uncombinePost(postId: string): { ideas: Row[]; post: Row } {
    const post = this.one(postId)
    if (!post) throw new Error('Publicacion no encontrada')
    let links = this.rows(`SELECT idea_id FROM post_ideas WHERE post_id = ${this.sqlString(postId)} AND relation = 'combined' ORDER BY position ASC`)
    if (!links.length) {
      try {
        const blocks = JSON.parse(String(post.idea_blocks || '[]')) as unknown
        if (Array.isArray(blocks)) links = blocks.filter(block => typeof block === 'object' && block !== null).map(block => ({ idea_id: (block as Record<string, unknown>).id })).filter(link => typeof link.idea_id === 'string' && Boolean(this.ideaOne(String(link.idea_id))))
      } catch { links = [] }
    }
    const now = new Date().toISOString()
    this.db.run('BEGIN TRANSACTION')
    try {
      for (const link of links) {
        const idea = this.ideaOne(String(link.idea_id))
        if (!idea) continue
        const remaining = this.rows(`SELECT post_id FROM post_ideas WHERE idea_id = ${this.sqlString(String(link.idea_id))} AND relation = 'combined' AND post_id <> ${this.sqlString(postId)} ORDER BY created_at DESC`).at(0)
        const tags = this.parseStringArray(idea.tags).filter(tag => tag.toLocaleLowerCase() !== 'combinada')
        if (remaining) tags.push('combinada')
        this.db.run("UPDATE ideas SET combined_post_id = ?, tags = ?, updated_at = ? WHERE id = ?", [remaining?.post_id ? String(remaining.post_id) : null, JSON.stringify(tags), now, String(link.idea_id)])
      }
      this.db.run("DELETE FROM post_ideas WHERE post_id = ? AND relation = 'combined'", [postId])
      this.recordEvent('uncombined', 'post', postId, { ideaIds: links.map(link => String(link.idea_id)) }, now)
      this.db.run('COMMIT'); this.persist()
      return { ideas: links.map(link => this.ideaOne(String(link.idea_id))).filter(Boolean) as Row[], post: this.one(postId)! }
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  listEvents(entity?: string, entityId?: string): Row[] {
    const clauses = [entity ? `entity = ${this.sqlString(entity)}` : '', entityId ? `entity_id = ${this.sqlString(entityId)}` : ''].filter(Boolean)
    return this.rows(`SELECT * FROM events${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 500`)
  }

  async refreshIdeaEmbeddings(ids?: string[], ignoredTerms: string[] = [], options: IdeaAnalysisOptions = defaultIdeaAnalysisOptions): Promise<{ updated: number; model: string; modelVersion: string }> {
    const model = 'multilingual-e5-small'
    const modelVersion = '4'
    const ignored = new Set(ignoredTerms.map(term => term.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim()).filter(Boolean))
    const corpus = this.listIdeas()
    const automaticTerms = this.semanticGenericTerms(corpus, ignored, options)
    const selected = ids?.length ? ids.map(id => corpus.find(idea => idea.id === id)).filter(Boolean) as Row[] : corpus
    const extractor = await this.getSemanticExtractor()
    const now = new Date().toISOString()
    // Generate vectors before opening the SQL.js transaction. The extractor
    // is asynchronous; keeping a transaction open across await allowed an
    // import to start another transaction and corrupt the WASM database.
    const pending: Array<{ ideaId: string; hash: string; vector: Uint8Array }> = []
    try {
      for (const idea of selected) {
        const title = String(idea.title || '')
        const body = String(idea.body || '')
        const hash = createHash('sha256').update(`${model}:${modelVersion}|${JSON.stringify(options)}|${[...ignored].sort().join(',')}|${[...automaticTerms].sort().join(',')}|${this.ideaHash(title, body)}`).digest('hex')
        const existing = this.rows(`SELECT content_hash FROM embeddings WHERE idea_id = ${this.sqlString(String(idea.id))} AND model = ${this.sqlString(model)} AND model_version = ${this.sqlString(modelVersion)}`).at(0)
        if (existing && String(existing.content_hash) === hash) continue
        // E5 requires mean pooling over token embeddings and L2 normalization.
        const semanticText = this.semanticText(title, body, automaticTerms, options)
        const output = await extractor(`passage: ${semanticText}`, { pooling: 'mean', normalize: true })
        const vector = this.semanticVector(output)
        pending.push({ ideaId: String(idea.id), hash, vector })
      }
      if (!pending.length) return { updated: 0, model, modelVersion }
      this.db.run('BEGIN TRANSACTION')
      for (const item of pending) this.db.run('INSERT OR REPLACE INTO embeddings (idea_id,model,model_version,content_hash,vector,created_at) VALUES (?,?,?,?,?,?)', [item.ideaId, model, modelVersion, item.hash, item.vector, now])
      this.db.run('COMMIT'); if (selected.length) this.persist()
      return { updated: pending.length, model, modelVersion }
    } catch (error) { try { this.db.run('ROLLBACK') } catch { /* transaction may not have started */ } throw error }
  }

  async listIdeaNeighbors(id: string, limit = 8, ignoredTerms: string[] = [], options: IdeaAnalysisOptions = defaultIdeaAnalysisOptions): Promise<Row[]> {
    const source = this.ideaOne(id)
    if (!source) throw new Error('Idea no encontrada')
    await this.refreshIdeaEmbeddings(undefined, ignoredTerms, options)
    const sourceVector = this.embeddingVector(id)
    if (!sourceVector) return []
    return this.listIdeas().filter(idea => idea.id !== id).map(idea => ({ idea, score: this.cosine(sourceVector, this.embeddingVector(String(idea.id)) || []) })).filter(item => item.score > 0.025).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(30, limit))).map(item => ({ ...item.idea, similarity: Number(item.score.toFixed(4)) }))
  }

  async proposeIdeaClusters(threshold = 0.65, ignoredTerms: string[] = [], options: IdeaAnalysisOptions = defaultIdeaAnalysisOptions): Promise<Array<{ id: string; name: string; ideaIds: string[]; scores: number[] }>> {
    const ignored = new Set(ignoredTerms.map(term => term.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim()).filter(Boolean))
    await this.refreshIdeaEmbeddings(undefined, [...ignored], options)
    const ideas = this.listIdeas()
    const namingIgnored = new Set([...ignored, ...this.semanticGenericTerms(ideas, ignored, options)])
    const documentFrequency = new Map<string, number>()
    for (const idea of ideas) for (const token of new Set(this.ideaTokens(idea, ignored, options.ignoreTitleNumbersInClusterNames))) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1)
    const vectors = new Map(ideas.map(idea => [String(idea.id), this.embeddingVector(String(idea.id)) || []]))
    const neighborCount = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(ideas.length))))
    const nearest = new Map<string, Set<string>>()
    for (const idea of ideas) {
      const id = String(idea.id)
      const matches = ideas.filter(other => other.id !== idea.id).map(other => ({ id: String(other.id), score: this.cosine(vectors.get(id) || [], vectors.get(String(other.id)) || []) })).filter(match => match.score >= threshold).sort((a, b) => b.score - a.score).slice(0, neighborCount)
      nearest.set(id, new Set(matches.map(match => match.id)))
    }
    const groups: string[][] = []
    const remaining = new Set(ideas.map(idea => String(idea.id)))
    // Complete-linkage style grouping prevents long similarity chains from
    // turning an entire corpus into one giant cluster.
    while (remaining.size) {
      const root = [...remaining][0]
      const group = [root]
      remaining.delete(root)
      for (const candidate of [...remaining]) {
        const compatible = group.every(member => {
          const score = this.cosine(vectors.get(member) || [], vectors.get(candidate) || [])
          return score >= threshold && nearest.get(member)?.has(candidate) && nearest.get(candidate)?.has(member)
        })
        if (compatible) { group.push(candidate); remaining.delete(candidate) }
      }
      if (group.length >= 2) groups.push(group)
    }
    const candidates = groups.filter(group => group.length >= 2).map(group => {
      const members = group.map(id => ideas.find(idea => String(idea.id) === id)!).filter(Boolean)
      const terms = this.clusterTerms(members, namingIgnored, documentFrequency, ideas.length, options.ignoreTitleNumbersInClusterNames)
      const name = terms.slice(0, 3).join(' ') || 'Cluster sin nombre'
      const cohesion = members.length < 2 ? 0 : members.reduce((sum, idea, index) => sum + members.slice(index + 1).reduce((pairSum, other) => pairSum + this.cosine(vectors.get(String(idea.id)) || [], vectors.get(String(other.id)) || []), 0), 0) / (members.length * (members.length - 1) / 2)
      return { id: crypto.randomUUID(), name: name[0]?.toLocaleUpperCase() + name.slice(1), ideaIds: group, scores: group.map(() => cohesion) }
    })
    const now = new Date().toISOString()
    this.db.run('BEGIN TRANSACTION')
    try {
      for (const cluster of candidates) {
        this.db.run('INSERT INTO idea_clusters (id,name,algorithm,model,model_version,calculated_at,name_manually_edited) VALUES (?,?,?,?,?,?,0)', [cluster.id, cluster.name, 'complete-linkage-mutual-nearest', 'multilingual-e5-small', '4', now])
        cluster.ideaIds.forEach((ideaId, position) => this.db.run('INSERT INTO idea_cluster_members (cluster_id,idea_id,position,score) VALUES (?,?,?,?)', [cluster.id, ideaId, position, cluster.scores[position]]))
      }
      this.recordEvent('clusters_proposed', 'ideas', 'workspace', { count: candidates.length, threshold }, now)
      this.db.run('COMMIT'); this.persist()
      return candidates
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  private async getSemanticExtractor() {
    if (!this.semanticExtractor) {
      env.allowLocalModels = false
      env.allowRemoteModels = true
      this.semanticExtractor = pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' })
    }
    return this.semanticExtractor
  }

  previewIdeaAnalysis(ignoredTerms: string[] = [], options: IdeaAnalysisOptions = defaultIdeaAnalysisOptions) {
    const ignored = new Set(ignoredTerms.map(term => term.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim()).filter(Boolean))
    return { automaticTerms: [...this.semanticGenericTerms(this.listIdeas(), ignored, options)].sort() }
  }

  private semanticTitle(title: string, options: IdeaAnalysisOptions) {
    const value = title.trim()
    const afterColon = options.stripColonPrefixes ? value.match(/^[^:]{2,40}:\s*(.+)$/)?.[1] : undefined
    if (afterColon) return afterColon
    const configuredPrefix = options.editorialPrefixes.find(item => item.trim() && value.toLocaleLowerCase().startsWith(item.trim().toLocaleLowerCase()))
    return configuredPrefix ? value.slice(configuredPrefix.length).replace(/^\s*[+\-–—]?\s*\d*\s*/, '').trim() || value : value
    return value.replace(/^(?:prompt(?:\s+prohibido)?|modo\s+dios)\b\s*[+\-–—]?\s*\d*\s*/i, '').trim() || value
  }

  private semanticText(title: string, body: string, genericTerms: Set<string>, options: IdeaAnalysisOptions) {
    const clean = (value: string) => value
      .replace(options.stripBracketedText ? /\[[^\]]*\]/g : /$^/, ' ')
      .replace(options.stripNumbers ? /\b\d+(?:[.,]\d+)?\b/g : /$^/, ' ')
      .replace(/\s+/g, ' ').trim()
    const titleText = clean(this.semanticTitle(title, options))
    const bodyText = clean(body)
    const removeGeneric = (value: string) => value.split(/\s+/).filter(token => {
      const normalized = token.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}]/gu, '')
      return normalized.length >= options.minTokenLength && !genericTerms.has(normalized)
    }).join(' ')
    const cleanedBody = removeGeneric(bodyText)
    const cleanedTitle = removeGeneric(titleText)
    return `${cleanedBody} ${cleanedTitle} ${cleanedBody}`.trim()
  }

  private semanticGenericTerms(ideas: Row[], ignored: Set<string>, options: IdeaAnalysisOptions) {
    const frequency = new Map<string, number>()
    const total = ideas.length || 1
    for (const idea of ideas) {
      const tokens = new Set(this.analysisTokens(this.semanticText(String(idea.title || ''), String(idea.body || ''), new Set(), options), ignored))
      for (const token of tokens) frequency.set(token, (frequency.get(token) || 0) + 1)
    }
    // Corpus-wide template language is weak semantic evidence. Keep this
    // automatic so the user does not need to curate a permanent stop-list.
    return new Set([...frequency.entries()].filter(([, count]) => count / total >= options.genericTermThreshold).map(([token]) => token))
  }

  private semanticVector(output: any): Uint8Array {
    const values = output?.tolist ? output.tolist() : output?.data ? Array.from(output.data) : []
    const flat = Array.isArray(values) ? (Array.isArray(values[0]) ? values[0] : values) : []
    return new TextEncoder().encode(JSON.stringify(flat.map(Number)))
  }

  listIdeaClusters(): Array<{ id: string; name: string; algorithm: string; model: string; model_version: string; calculated_at: string; ideaIds: string[] }> {
    return this.rows('SELECT * FROM idea_clusters ORDER BY calculated_at DESC').map(cluster => ({
      id: String(cluster.id), name: String(cluster.name), algorithm: String(cluster.algorithm), model: String(cluster.model), model_version: String(cluster.model_version), calculated_at: String(cluster.calculated_at),
      ideaIds: this.rows(`SELECT idea_id FROM idea_cluster_members WHERE cluster_id = ${this.sqlString(String(cluster.id))} ORDER BY position`).map(row => String(row.idea_id)),
    }))
  }

  private localEmbedding(tokens: string[], documentFrequency: Map<string, number>, totalDocuments: number): Uint8Array {
    const frequencies = new Map<string, number>()
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1)
    const vector: Record<string, number> = {}
    for (const [token, frequency] of frequencies) {
      const idf = Math.log(1 + (totalDocuments - (documentFrequency.get(token) || 0) + 0.5) / ((documentFrequency.get(token) || 0) + 0.5))
      vector[token] = (1 + Math.log(frequency)) * idf
    }
    const norm = Math.sqrt(Object.values(vector).reduce((sum, value) => sum + value * value, 0)) || 1
    for (const token of Object.keys(vector)) vector[token] /= norm
    return new TextEncoder().encode(JSON.stringify(vector))
  }

  private embeddingVector(id: string): number[] | null {
    const row = this.rows(`SELECT vector FROM embeddings WHERE idea_id = ${this.sqlString(id)} AND model = 'multilingual-e5-small' AND model_version = '4'`).at(0)
    if (!row?.vector) return null
    const bytes = row.vector instanceof Uint8Array ? row.vector : new Uint8Array(row.vector as ArrayBuffer)
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
      return Array.isArray(parsed) ? parsed.map(Number) : null
    } catch { return null }
  }

  private cosine(a: number[], b: number[]) {
    if (!a.length || !b.length || a.length !== b.length) return 0
    return a.reduce((sum, value, index) => sum + value * b[index], 0)
  }

  private clusterTerms(ideas: Row[], ignored: Set<string>, corpusFrequency: Map<string, number>, corpusSize: number, ignoreTitleNumbers: boolean) {
    const documents = ideas.map(idea => this.ideaTokens(idea, ignored, ignoreTitleNumbers))
    const frequency = new Map<string, number>()
    documents.forEach(tokens => tokens.forEach(token => frequency.set(token, (frequency.get(token) || 0) + 1)))
    return [...frequency.entries()].map(([token, count]) => {
      const corpusCount = corpusFrequency.get(token) || 0
      const idf = Math.log(1 + (corpusSize - corpusCount + 0.5) / (corpusCount + 0.5))
      return { token, score: count * idf }
    }).sort((a, b) => b.score - a.score).map(item => item.token)
  }

  private ideaTokens(idea: Row, ignored: Set<string>, ignoreTitleNumbers = false) {
    const titleText = String(idea.title || '').replace(ignoreTitleNumbers ? /\b\d+(?:[.,]\d+)?\b/g : /$^/, ' ')
    const title = this.analysisTokens(titleText, ignored)
    const body = this.analysisTokens(String(idea.body || ''), ignored)
    return [...title.flatMap(token => [token, token]), ...body]
  }

  private analysisTokens(value: string, ignored: Set<string>) {
    return value.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]{3,}/gu)?.filter(token => !ignored.has(token)) || []
  }

  private recordEvent(type: string, entity: string, entityId: string, payload: Record<string, unknown>, createdAt = new Date().toISOString()) {
    this.db.run('INSERT INTO events (id,type,entity,entity_id,payload,created_at) VALUES (?,?,?,?,?,?)', [crypto.randomUUID(), type, entity, entityId, JSON.stringify(payload), createdAt])
  }

  private syncPostIdeas(postId: string, blocks: unknown, now: string) {
    if (!Array.isArray(blocks)) return
    const existing = new Map(this.rows(`SELECT idea_id,relation FROM post_ideas WHERE post_id = ${this.sqlString(postId)}`).map(row => [String(row.idea_id), String(row.relation)]))
    this.db.run('DELETE FROM post_ideas WHERE post_id = ?', [postId])
    blocks.forEach((block, position) => {
      if (typeof block !== 'object' || block === null) return
      const id = String((block as Record<string, unknown>).id || '')
      if (!id) return
      const idea = this.ideaOne(id)
      const relation = existing.get(id) || (idea?.combined_post_id === postId ? 'combined' : idea?.post_id === postId ? 'individual' : null)
      if (!relation) return
      this.db.run('INSERT OR REPLACE INTO post_ideas (post_id,idea_id,relation,position,created_at) VALUES (?,?,?,?,?)', [postId, id, relation, position, now])
    })
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

  flush() {
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null }
    if (!this.persistQueued) return
    this.persistQueued = false
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    fs.writeFileSync(temporaryPath, Buffer.from(this.db.export()))
    fs.renameSync(temporaryPath, this.filePath)
  }

  private persist() {
    this.persistQueued = true
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => this.flush(), 1500)
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

export interface Migration {
  version: number
  name: string
  up: string
}
export const migrations: Migration[] = [
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
  {
    version: 24,
    name: 'idea_import_history',
    up: `
      CREATE TABLE IF NOT EXISTS idea_import_runs (
        id TEXT PRIMARY KEY, file_name TEXT NOT NULL, space TEXT NOT NULL DEFAULT '',
        total INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0, imported_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idea_import_runs_date_idx ON idea_import_runs(imported_at);
    `,
  },
]


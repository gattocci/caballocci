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
    const createdAt = current?.created_at || input.createdAt || now
    const values = {
      id, title: input.title || 'Sin título', caption: input.caption || '', notes: input.notes || '',
      hashtags: JSON.stringify(input.hashtags || []), mentions: JSON.stringify(input.mentions || []),
      platforms: JSON.stringify(input.platforms || []), contentType: input.contentType || 'post', status: input.status || 'idea',
      scheduledAt: input.scheduledAt || null, durationMinutes: input.durationMinutes || 60, project: input.project || '',
      color: input.color || '#ff6b4a', media: JSON.stringify(input.media || []), ideaBlocks: JSON.stringify(input.ideaBlocks || []),
      sourceIdeaId: current?.source_idea_id || null, createdAt, updatedAt: now,
    }
    this.db.run(`INSERT OR REPLACE INTO posts
      (id,title,caption,notes,hashtags,mentions,platforms,content_type,status,scheduled_at,duration_minutes,project,color,media,idea_blocks,source_idea_id,created_at,updated_at)
      VALUES ($id,$title,$caption,$notes,$hashtags,$mentions,$platforms,$contentType,$status,$scheduledAt,$durationMinutes,$project,$color,$media,$ideaBlocks,$sourceIdeaId,$createdAt,$updatedAt)`,
      Object.fromEntries(Object.entries(values).map(([key, value]) => [`$${key}`, value])) as Record<string, string | number | null>)
    const previousStatus = current ? String(current.status) : null
    const nextStatus = String(values.status)
    if (!current || previousStatus !== nextStatus) {
      this.db.run('INSERT INTO status_history (post_id,from_status,to_status,changed_at) VALUES (?,?,?,?)', [id, previousStatus, nextStatus, now])
    }
    this.persist()
    return this.one(id)!
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

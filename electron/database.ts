import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { Database } from 'sql.js'

type Row = Record<string, unknown>

export class PlannerDatabase {
  private db!: Database
  constructor(private readonly filePath: string, private readonly wasmPath: string) {}

  async init() {
    const SQL = await initSqlJs({ locateFile: () => this.wasmPath })
    this.db = fs.existsSync(this.filePath) ? new SQL.Database(fs.readFileSync(this.filePath)) : new SQL.Database()
    this.db.run(`
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
    `)
    if (this.count() === 0) this.seed()
    this.persist()
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
      color: input.color || '#ff6b4a', media: JSON.stringify(input.media || []), createdAt, updatedAt: now,
    }
    this.db.run(`INSERT OR REPLACE INTO posts
      (id,title,caption,notes,hashtags,mentions,platforms,content_type,status,scheduled_at,duration_minutes,project,color,media,created_at,updated_at)
      VALUES ($id,$title,$caption,$notes,$hashtags,$mentions,$platforms,$contentType,$status,$scheduledAt,$durationMinutes,$project,$color,$media,$createdAt,$updatedAt)`,
      Object.fromEntries(Object.entries(values).map(([k, v]) => [`$${k}`, v])) as Record<string, string | number | null>)
    const previousStatus = current ? String(current.status) : null
    const nextStatus = String(values.status)
    if (!current || previousStatus !== nextStatus) {
      this.db.run('INSERT INTO status_history (post_id,from_status,to_status,changed_at) VALUES (?,?,?,?)', [id, previousStatus, nextStatus, now])
    }
    this.persist()
    return this.one(id)!
  }

  remove(id: string) { this.db.run('DELETE FROM posts WHERE id = ?', [id]); this.persist() }
  listMedia(): Row[] {
    const result = this.db.exec('SELECT id,name,path,kind,size,mode FROM media_assets ORDER BY created_at DESC')
    if (!result[0]) return []
    return result[0].values.map(values => Object.fromEntries(result[0].columns.map((key, index) => [key, values[index]])))
  }
  saveMedia(assets: Row[]) {
    const now = new Date().toISOString()
    assets.forEach(asset => this.db.run(
      'INSERT OR REPLACE INTO media_assets (id,name,path,kind,size,mode,created_at) VALUES (?,?,?,?,?,?,?)',
      [String(asset.id), String(asset.name), String(asset.path), String(asset.kind), Number(asset.size), String(asset.mode), now],
    ))
    this.persist()
  }
  private one(id: string): Row | undefined { return this.list().find((row) => row.id === id) }
  private count() { return Number(this.db.exec('SELECT COUNT(*) AS n FROM posts')[0]?.values[0]?.[0] || 0) }
  private persist() { fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); fs.writeFileSync(this.filePath, Buffer.from(this.db.export())) }
  private seed() {
    const base = new Date(); base.setHours(10, 0, 0, 0)
    const at = (offset: number, hour: number) => { const d = new Date(base); d.setDate(d.getDate() + offset); d.setHours(hour); return d.toISOString() }
    const samples = [
      { title:'Cómo planeamos un mes en 30 min', caption:'Un sistema simple vence a una semana caótica. Guarda este proceso para tu próxima sesión de contenido.', hashtags:['#ContentPlanning','#CreatorTips'], platforms:['instagram'], contentType:'reel', status:'scheduled', scheduledAt:at(0,11), durationMinutes:45, project:'Marca personal', color:'#ef6548' },
      { title:'Detrás de campaña Aurora', caption:'Del primer boceto al resultado final. Este es el trabajo que normalmente no se ve.', hashtags:['#BehindTheScenes'], platforms:['instagram','facebook'], contentType:'carousel', status:'approved', scheduledAt:at(1,15), durationMinutes:60, project:'Campaña Aurora', color:'#35a780' },
      { title:'Hilo: 5 aprendizajes del trimestre', caption:'Cinco decisiones pequeñas que cambiaron nuestros resultados este trimestre.', hashtags:['#Marketing'], platforms:['x'], contentType:'thread', status:'draft', scheduledAt:at(2,9), durationMinutes:30, project:'Editorial', color:'#4b8ed8' },
      { title:'Pregunta a la comunidad', caption:'¿Qué parte de crear contenido te consume más tiempo?', hashtags:['#Community'], platforms:['facebook','x'], contentType:'post', status:'review', scheduledAt:at(3,18), durationMinutes:30, project:'Comunidad', color:'#e5ac39' },
      { title:'Lanzamiento: plantilla semanal', caption:'La plantilla que usamos cada lunes ya está disponible.', hashtags:['#ProductLaunch','#Templates'], platforms:['instagram','facebook','x'], contentType:'carousel', status:'idea', scheduledAt:at(5,12), durationMinutes:60, project:'Producto', color:'#9a72d8' }
    ]
    samples.forEach((sample) => this.save(sample as unknown as Row))
  }
}

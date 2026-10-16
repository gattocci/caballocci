import type { Database } from 'sql.js'
import { rows } from './sql'
import type { Row } from './types'

export class MediaRepository {
  constructor(private readonly db: Database, private readonly persist: () => void) {}

  list(): Row[] { return rows(this.db, 'SELECT id,name,kind,size,mode FROM media_assets ORDER BY created_at DESC') }

  getPath(id: string): string | undefined { return this.getFile(id)?.path }

  getFile(id: string): { path: string; kind: string } | undefined {
    const statement = this.db.prepare('SELECT path,kind FROM media_assets WHERE id = ?')
    try {
      statement.bind([id])
      if (!statement.step()) return undefined
      const row = statement.getAsObject()
      if (typeof row.path !== 'string' || typeof row.kind !== 'string') return undefined
      return { path: row.path, kind: row.kind }
    } finally { statement.free() }
  }

  save(assets: Row[]) {
    const now = new Date().toISOString()
    assets.forEach(asset => this.db.run(
      'INSERT OR REPLACE INTO media_assets (id,name,path,kind,size,mode,created_at) VALUES (?,?,?,?,?,?,?)',
      [String(asset.id), String(asset.name), String(asset.path), String(asset.kind), Number(asset.size), String(asset.mode), now],
    ))
    this.persist()
  }
}

import type { Database } from 'sql.js'
import { rows } from './sql'
import type { Row } from './types'

export class MediaRepository {
  constructor(private readonly db: Database, private readonly persist: () => void) {}

  list(): Row[] { return rows(this.db, 'SELECT id,name,kind,size,mode FROM media_assets ORDER BY created_at DESC') }

  getPath(id: string): string | undefined { return this.getFile(id)?.path }

  findByPath(filePath: string): Row | undefined {
    const statement = this.db.prepare('SELECT id,name,kind,size,mode FROM media_assets WHERE path = ?')
    try {
      statement.bind([filePath])
      if (!statement.step()) return undefined
      return statement.getAsObject() as Row
    } finally { statement.free() }
  }

  updatePath(id: string, filePath: string) {
    this.db.run('UPDATE media_assets SET path = ?, name = ? WHERE id = ?', [filePath, filePath.split(/[\\/]/).at(-1) || '', id])
    this.persist()
  }

  getFile(id: string): { path: string; kind: string; mode: string; archivePath?: string; entryName?: string } | undefined {
    const statement = this.db.prepare(`SELECT m.path,m.kind,m.mode,a.archive_path,c.entry_name
      FROM media_assets m
      LEFT JOIN compressed_media_assets c ON c.asset_id = m.id
      LEFT JOIN media_compression_archives a ON a.id = c.archive_id
      WHERE m.id = ?`)
    try {
      statement.bind([id])
      if (!statement.step()) return undefined
      const row = statement.getAsObject()
      if (typeof row.path !== 'string' || typeof row.kind !== 'string' || typeof row.mode !== 'string') return undefined
      return {
        path: row.path,
        kind: row.kind,
        mode: row.mode,
        ...(typeof row.archive_path === 'string' ? { archivePath: row.archive_path } : {}),
        ...(typeof row.entry_name === 'string' ? { entryName: row.entry_name } : {}),
      }
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

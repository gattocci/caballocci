import type { Database } from 'sql.js'
import { firstRow, rows, sqlString } from './sql'
import { repairIdeaHashes, repairPostIdeaLinks } from './bootstrap'

export function ensureCatalogColumns(db: Database, persist: () => void, ideaHash: (title: string, body: string) => string) {
  const columns = (table: string) => new Set(rows(db, `PRAGMA table_info(${table})`).map(row => String(row.name)))
  const postFields = columns('catalog_post_fields')
  const syncs = columns('catalog_syncs')
  const additions: Array<[string, string]> = [['category_slug', "TEXT NOT NULL DEFAULT ''"]]
  for (const [name, definition] of additions) if (!postFields.has(name)) db.run(`ALTER TABLE catalog_post_fields ADD COLUMN ${name} ${definition}`)
  const syncAdditions: Array<[string, string]> = [['request_url', 'TEXT'], ['response_status', 'INTEGER'], ['response_headers_json', 'TEXT'], ['response_body', 'TEXT']]
  for (const [name, definition] of syncAdditions) if (!syncs.has(name)) db.run(`ALTER TABLE catalog_syncs ADD COLUMN ${name} ${definition}`)
  persist()
  repairIdeaHashes(db, ideaHash, persist)
  repairPostIdeaLinks(db, id => Boolean(firstRow(db, 'SELECT id FROM ideas WHERE id = ' + sqlString(id))), persist)
}

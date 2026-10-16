import type { Database } from 'sql.js'
import { rows } from './sql'

export class PreferencesRepository {
  constructor(private readonly db: Database, private readonly persist: () => void) {}

  save(entries: Record<string, string>) {
    const now = new Date().toISOString()
    this.db.run('BEGIN TRANSACTION')
    try {
      for (const [key, value] of Object.entries(entries)) this.db.run('INSERT OR REPLACE INTO app_preferences (key,value,updated_at) VALUES (?,?,?)', [key, value, now])
      this.db.run('COMMIT')
      if (Object.keys(entries).length) this.persist()
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  remove(key: string) { this.db.run('DELETE FROM app_preferences WHERE key = ?', [key]); this.persist() }

  list() { return Object.fromEntries(rows(this.db, 'SELECT key,value FROM app_preferences').map(row => [String(row.key), String(row.value)])) }
}

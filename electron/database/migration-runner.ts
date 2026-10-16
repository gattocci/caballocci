import type { Database } from 'sql.js'
import { migrations } from './migrations'

export function runMigrations(db: Database, existedAtStartup: boolean, backup: () => void) {
  const currentVersion = Number(db.exec('PRAGMA user_version')[0]?.values[0]?.[0] || 0)
  const pending = migrations.filter(migration => migration.version > currentVersion)
  if (!pending.length) return
  if (existedAtStartup) backup()

  for (const migration of pending) {
    db.run('BEGIN TRANSACTION')
    try {
      db.run(migration.up)
      db.run(`PRAGMA user_version = ${migration.version}`)
      db.run('COMMIT')
    } catch (error) {
      db.run('ROLLBACK')
      throw new Error(`Falló la migración ${migration.version} (${migration.name})`, { cause: error })
    }
  }
}

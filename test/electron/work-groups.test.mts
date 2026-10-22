import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'

const require = createRequire(import.meta.url)
const { runMigrations } = require('../../dist-electron/database/migration-runner.js') as {
  runMigrations(db: Database, existedAtStartup: boolean, backup: () => void): void
}
const { WorkGroupsRepository } = require('../../dist-electron/database/work-groups-repository.js') as {
  WorkGroupsRepository: new (db: Database, persist: () => void) => {
    list(): Array<Record<string, unknown>>
    save(input: Record<string, unknown>): Record<string, unknown>
    setPosts(id: string, postIds: string[]): Record<string, unknown>
    setArchived(id: string, archived: boolean): Record<string, unknown>
    remove(id: string): void
  }
}

test('persists many-to-many work group membership and archives independently of post status', async t => {
  const SQL = await initSqlJs({ locateFile: file => path.resolve('node_modules/sql.js/dist', file) })
  const db = new SQL.Database()
  t.after(() => db.close())
  runMigrations(db, false, () => assert.fail('A new database must not require a backup'))

  db.run("INSERT INTO posts (id,title,status,created_at,updated_at) VALUES ('post-a','A','draft','now','now'),('post-b','B','approved','now','now')")
  const repository = new WorkGroupsRepository(db, () => {})
  const campaign = repository.save({ name: 'Campaña', description: '' })
  const series = repository.save({ name: 'Serie', description: '' })

  repository.setPosts(String(campaign.id), ['post-a', 'post-b'])
  repository.setPosts(String(series.id), ['post-a'])
  const archived = repository.setArchived(String(campaign.id), true)

  assert.deepEqual(archived.post_ids, ['post-a', 'post-b'])
  assert.ok(archived.archived_at)
  assert.deepEqual(repository.list().find(group => group.id === series.id)?.post_ids, ['post-a'])
  assert.deepEqual(db.exec('SELECT id,status FROM posts ORDER BY id')[0].values, [['post-a', 'draft'], ['post-b', 'approved']])

  const restored = repository.setArchived(String(campaign.id), false)
  assert.equal(restored.archived_at, null)
  assert.throws(() => repository.setPosts(String(campaign.id), ['missing-post']), /No se encontró una de las publicaciones/)
  assert.deepEqual(repository.list().find(group => group.id === campaign.id)?.post_ids, ['post-a', 'post-b'])

  repository.remove(String(campaign.id))
  assert.equal(repository.list().some(group => group.id === campaign.id), false)
  assert.deepEqual(db.exec('SELECT id,status FROM posts ORDER BY id')[0].values, [['post-a', 'draft'], ['post-b', 'approved']])
  assert.deepEqual(repository.list().find(group => group.id === series.id)?.post_ids, ['post-a'])
})

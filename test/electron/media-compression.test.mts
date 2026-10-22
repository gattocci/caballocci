import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'

const require = createRequire(import.meta.url)
const { runMigrations } = require('../../dist-electron/database/migration-runner.js') as {
  runMigrations(db: Database, existedAtStartup: boolean, backup: () => void): void
}
const { MediaCompressionRepository } = require('../../dist-electron/database/media-compression-repository.js') as {
  MediaCompressionRepository: new (db: Database, persist: () => void) => {
    compress(
      targetType: 'group' | 'post',
      targetId: string,
      candidates: Array<{ id: string; name: string; kind: string; path: string; size: number; mode: string }>,
      references: Map<string, Set<string>>,
      includedPostIds: Set<string>,
      archiveDirectory: string,
      managedRoot: string,
    ): Promise<{ compressed: number; skipped: number; releasedBytes: number }>
    restore(assetIds: string[], managedRoot: string): { restored: number }
    state(assetId: string): { archivePath: string; entryName: string } | undefined
  }
}

test('compresses managed unshared media into an internal ZIP and restores the original file', async t => {
  const SQL = await initSqlJs({ locateFile: file => path.resolve('node_modules/sql.js/dist', file) })
  const db = new SQL.Database()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caballocci-compression-'))
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }) })
  runMigrations(db, false, () => assert.fail('A new database must not require a backup'))

  const originalPath = path.join(root, 'managed', 'Spaces', 'Campaign', 'Posts', 'post-a', 'photo.png')
  const archiveDirectory = path.join(root, 'managed', 'Media', 'Archives')
  const originalBytes = Buffer.alloc(100_000, 'x')
  fs.mkdirSync(path.dirname(originalPath), { recursive: true })
  fs.writeFileSync(originalPath, originalBytes)
  db.run("INSERT INTO posts (id,title,status,created_at,updated_at) VALUES ('post-a','A','archived','now','now')")
  db.run('INSERT INTO media_assets (id,name,path,kind,size,mode,created_at) VALUES (?,?,?,?,?,?,?)', [
    'asset-a', 'photo.png', originalPath, 'image', originalBytes.length, 'copy', 'now',
  ])
  const repository = new MediaCompressionRepository(db, () => {})
  const candidate = { id: 'asset-a', name: 'photo.png', kind: 'image', path: originalPath, size: originalBytes.length, mode: 'copy' }

  const compressed = await repository.compress('post', 'post-a', [candidate], new Map([['asset-a', new Set(['post-a'])]]), new Set(['post-a']), archiveDirectory, path.join(root, 'managed'))
  assert.equal(compressed.compressed, 1)
  assert.ok(compressed.releasedBytes > 0)
  assert.equal(fs.existsSync(originalPath), false)
  const state = repository.state('asset-a')
  assert.ok(state)
  assert.ok(fs.existsSync(state.archivePath))

  const restored = repository.restore(['asset-a'], path.join(root, 'managed'))
  assert.equal(restored.restored, 1)
  assert.deepEqual(fs.readFileSync(originalPath), originalBytes)
  assert.equal(repository.state('asset-a'), undefined)
  assert.equal(fs.existsSync(state.archivePath), false)
})

test('does not delete shared or externally referenced media during compression', async t => {
  const SQL = await initSqlJs({ locateFile: file => path.resolve('node_modules/sql.js/dist', file) })
  const db = new SQL.Database()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caballocci-compression-safety-'))
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }) })
  runMigrations(db, false, () => assert.fail('A new database must not require a backup'))

  const managedPath = path.join(root, 'managed', 'shared.png')
  const externalPath = path.join(root, 'external', 'reference.png')
  fs.mkdirSync(path.dirname(managedPath), { recursive: true })
  fs.mkdirSync(path.dirname(externalPath), { recursive: true })
  fs.writeFileSync(managedPath, 'shared')
  fs.writeFileSync(externalPath, 'external')
  const repository = new MediaCompressionRepository(db, () => {})
  const candidates = [
    { id: 'shared', name: 'shared.png', kind: 'image', path: managedPath, size: 6, mode: 'copy' },
    { id: 'external', name: 'reference.png', kind: 'image', path: externalPath, size: 8, mode: 'reference' },
  ]
  const references = new Map([
    ['shared', new Set(['post-a', 'post-b'])],
    ['external', new Set(['post-a'])],
  ])
  const result = await repository.compress('group', 'group-a', candidates, references, new Set(['post-a']), path.join(root, 'managed', 'Archives'), path.join(root, 'managed'))

  assert.deepEqual(result, { compressed: 0, skipped: 2, releasedBytes: 0 })
  assert.equal(fs.readFileSync(managedPath, 'utf8'), 'shared')
  assert.equal(fs.readFileSync(externalPath, 'utf8'), 'external')
})

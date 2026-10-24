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
const { MobileSyncRepository } = require('../../dist-electron/database/mobile-sync-repository.js') as {
  MobileSyncRepository: new (db: Database, persist: () => void) => {
    listUsage(): Array<Record<string, unknown>>
    recordUsage(event: { eventId: string; postId: string; targetId: string; action: 'used'; usedAt: string; deviceId: string; version: number }): boolean
  }
}
const { importMobileUsageFiles, mergeMobilePublications, nextMobileBatch, nextMobileSpaceOrder, parseMobileUsageEvent, recordMobileBatch, writeMobileCatalog } = require('../../dist-electron/mobile-sync.js') as {
  nextMobileBatch(root: string): string
  nextMobileSpaceOrder(root: string, spaceName: string): number
  mergeMobilePublications(existing: Array<{ postId: string; targetId: string }>, replacements: Array<{ postId: string; targetId: string }>): Array<{ postId: string; targetId: string }>
  recordMobileBatch(root: string, batch: string, postIds: string[]): void
  importMobileUsageFiles(
    root: string,
    targetExists: (postId: string, targetId: string) => boolean,
    recordUsage: (event: { eventId: string; postId: string; targetId: string; action: 'used'; usedAt: string; deviceId: string; version: number }) => boolean,
  ): {
    imported: number
    duplicates: number
    invalid: Array<{ file: string; reason: string }>
    unknown: Array<{ file: string; postId: string; targetId: string }>
  }
  parseMobileUsageEvent(value: unknown): { postId: string; targetId: string; usedAt: string }
  writeMobileCatalog(root: string, publications: Array<Record<string, unknown>>, generatedAt?: string): {
    schema: string
    version: number
    publications: Array<Record<string, unknown>>
  }
}

function event(eventId: string, postId = 'post-a', targetId = 'instagram') {
  return {
    schema: 'caballocci.mobile-sync.usage',
    version: 1,
    eventId,
    postId,
    targetId,
    action: 'used',
    usedAt: '2026-10-24T05:30:00.000Z',
    deviceId: 'device-a',
  }
}

test('replaces exported catalog entries but preserves selected posts omitted from this batch', () => {
  const existing = [
    { postId: 'exported', targetId: 'old-target' },
    { postId: 'omitted', targetId: 'existing-target' },
    { postId: 'untouched', targetId: 'other-target' },
  ]
  const merged = mergeMobilePublications(existing, [
    { postId: 'exported', targetId: 'new-target' },
  ])

  assert.deepEqual(merged, [
    { postId: 'omitted', targetId: 'existing-target' },
    { postId: 'untouched', targetId: 'other-target' },
    { postId: 'exported', targetId: 'new-target' },
  ])
})

test('assigns sequential alphabetic batch labels and records exported IDs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caballocci-mobile-batches-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const labels = Array.from({ length: 28 }, () => nextMobileBatch(root))
  recordMobileBatch(root, labels[27]!, ['post-a', 'post-b'])
  const history = JSON.parse(fs.readFileSync(path.join(root, 'pc-outbox', 'batch-history.json'), 'utf8')) as Array<{
    batch: string
    exportedAt: string
    postIds: string[]
  }>

  assert.deepEqual(labels.slice(0, 26), Array.from({ length: 26 }, (_, index) => String.fromCharCode(97 + index)))
  assert.deepEqual(labels.slice(26), ['aa', 'ab'])
  assert.equal(history.length, 1)
  assert.equal(history[0]?.batch, 'ab')
  assert.deepEqual(history[0]?.postIds, ['post-a', 'post-b'])
  assert.equal(typeof history[0]?.exportedAt, 'string')
})

test('keeps a continuous album order per space, independent of batch sequence', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caballocci-mobile-space-order-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  assert.equal(nextMobileBatch(root), 'a')
  assert.equal(nextMobileSpaceOrder(root, 'Marketing'), 1)
  assert.equal(nextMobileBatch(root), 'b')
  assert.equal(nextMobileSpaceOrder(root, 'Marketing'), 2)
  assert.equal(nextMobileSpaceOrder(root, 'Diseño'), 1)

  const sequences = JSON.parse(fs.readFileSync(path.join(root, 'pc-outbox', 'space-sequences.json'), 'utf8')) as Record<string, number>
  assert.deepEqual(sequences, { marketing: 2, diseño: 1 })
})

test('exports one versioned catalog with independent destination entries', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caballocci-mobile-catalog-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const result = writeMobileCatalog(root, [
    { postId: 'post-a', targetId: 'instagram', targetName: 'Instagram', manifestPath: 'pc-outbox/a/manifest.json', captionPath: 'pc-outbox/a/caption.txt', scheduledAt: null, used: false },
    { postId: 'post-a', targetId: 'facebook', targetName: 'Facebook', manifestPath: 'pc-outbox/a/manifest.json', captionPath: 'pc-outbox/a/caption.txt', scheduledAt: null, used: false },
  ], '2026-10-24T05:30:00.000Z')
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'pc-outbox', 'catalog.json'), 'utf8')) as typeof result

  assert.equal(result.schema, 'caballocci.mobile-sync.catalog')
  assert.equal(result.version, 1)
  assert.deepEqual(saved.publications.map(item => item.targetId), ['instagram', 'facebook'])
  assert.equal('title' in saved.publications[0], false)
  assert.equal('media' in saved.publications[0], false)
  assert.equal(typeof saved.publications[0]?.manifestPath, 'string')
  assert.equal(saved.publications[0]?.manifestPath, saved.publications[1]?.manifestPath)
})

test('validates per-destination event identifiers and UTC timestamps', () => {
  assert.deepEqual(parseMobileUsageEvent(event('event-a')), {
    schema: 'caballocci.mobile-sync.usage',
    version: 1,
    eventId: 'event-a',
    postId: 'post-a',
    targetId: 'instagram',
    action: 'used',
    usedAt: '2026-10-24T05:30:00.000Z',
    deviceId: 'device-a',
  })
  assert.throws(() => parseMobileUsageEvent({ ...event('event-a'), usedAt: '2026-10-24T05:30:00-05:00' }), /UTC/)
  assert.throws(() => parseMobileUsageEvent({ ...event('event-a'), targetId: '../unsafe' }), /identificadores/)
})

test('imports valid events idempotently and reports incomplete, invalid, and unknown events', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caballocci-mobile-import-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const inbox = path.join(root, 'android-inbox', 'device-a')
  fs.mkdirSync(inbox, { recursive: true })
  fs.writeFileSync(path.join(inbox, 'event-a.json'), JSON.stringify(event('event-a')))
  fs.writeFileSync(path.join(inbox, 'event-duplicate.json'), JSON.stringify(event('event-a')))
  fs.writeFileSync(path.join(inbox, 'event-unknown.json'), JSON.stringify(event('event-b', 'missing-post', 'instagram')))
  fs.writeFileSync(path.join(inbox, 'event-invalid.json'), '{"version":')
  fs.writeFileSync(path.join(inbox, 'event-wrong-device.json'), JSON.stringify({ ...event('event-c'), deviceId: 'other-device' }))
  fs.writeFileSync(path.join(inbox, 'event-incomplete.tmp'), '{"version":')

  const persisted = new Set<string>()
  const accepted = (postId: string, targetId: string) => postId === 'post-a' && ['instagram', 'facebook'].includes(targetId)
  const record = (value: { eventId: string }) => {
    if (persisted.has(value.eventId)) return false
    persisted.add(value.eventId)
    return true
  }
  const first = importMobileUsageFiles(root, accepted, record)
  assert.equal(first.imported, 1)
  assert.equal(first.duplicates, 1)
  assert.equal(first.invalid.length, 2)
  assert.equal(first.unknown.length, 1)

  const second = importMobileUsageFiles(root, accepted, record)
  assert.equal(second.imported, 0)
  assert.equal(second.duplicates, 2)
  assert.equal(second.invalid.length, 2)
  assert.equal(second.unknown.length, 1)
})

test('persists confirmations per destination without changing editorial status', async t => {
  const SQL = await initSqlJs({ locateFile: file => path.resolve('node_modules/sql.js/dist', file) })
  const db = new SQL.Database()
  t.after(() => db.close())
  runMigrations(db, false, () => assert.fail('A new database must not require a backup'))
  db.run("INSERT INTO posts (id,title,status,platforms,distribution_json,created_at,updated_at) VALUES ('post-a','A','scheduled','[\"instagram\",\"facebook\"]','[{\"id\":\"instagram\",\"status\":\"scheduled\"},{\"id\":\"facebook\",\"status\":\"pending\"}]','now','now')")
  let persists = 0
  const repository = new MobileSyncRepository(db, () => { persists += 1 })
  const base = { postId: 'post-a', action: 'used' as const, usedAt: '2026-10-24T05:30:00.000Z', deviceId: 'device-a', version: 1 }

  assert.equal(repository.recordUsage({ ...base, eventId: 'event-a', targetId: 'instagram' }), true)
  assert.equal(repository.recordUsage({ ...base, eventId: 'event-a', targetId: 'instagram' }), false)
  assert.equal(repository.recordUsage({ ...base, eventId: 'event-b', targetId: 'facebook' }), true)
  assert.equal(repository.listUsage().length, 2)
  assert.equal(persists, 2)
  assert.deepEqual(db.exec('SELECT status,distribution_json FROM posts WHERE id = \"post-a\"')[0].values, [
    ['scheduled', '[{"id":"instagram","status":"scheduled"},{"id":"facebook","status":"pending"}]'],
  ])
})

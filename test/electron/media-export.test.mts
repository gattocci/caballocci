import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { exportPostForPhone, orderPhoneFiles } = require('../../dist-electron/media-export.js') as {
  exportPostForPhone(root: string, post: {
    id: string
    title: string
    caption: string
    hashtags: string[]
    mentions: string[]
    platforms: string[]
    scheduledAt: string | null
  }, files: Array<{ name: string; sourcePath: string; sequence?: number | null }>): {
    exported: number
    skipped: Array<{ name: string; reason: string }>
    warnings: Array<{ name: string; reason: string }>
    folderName: string
  }
  orderPhoneFiles<T extends { name: string; sourcePath: string; presentationRole?: string; sequence?: number | null }>(files: T[]): T[]
}

const post = (id: string, title = 'Café & Día') => ({
  id,
  title,
  caption: 'Texto de la publicación',
  hashtags: ['#cultura', 'lectura'],
  mentions: ['@cuenta', 'amiga'],
  platforms: ['instagram'],
  scheduledAt: null,
})

test('orders explicitly sequenced media in preview order and leaves other positions stable', () => {
  const files = [
    { name: 'slide-3.png', sourcePath: 'third', presentationRole: 'slide' as const, sequence: 3 },
    { name: 'video.mp4', sourcePath: 'video' },
    { name: 'slide-1.png', sourcePath: 'first', presentationRole: 'slide' as const, sequence: 1 },
    { name: 'slide-2.png', sourcePath: 'second', presentationRole: 'slide' as const, sequence: 2 },
  ]

  assert.deepEqual(orderPhoneFiles(files).map(file => file.sourcePath), ['first', 'video', 'second', 'third'])
  assert.deepEqual(orderPhoneFiles([
    { name: '02-segunda-uuid.png', sourcePath: 'second' },
    { name: '01-primera-uuid.png', sourcePath: 'first' },
  ]).map(file => file.sourcePath), ['first', 'second'])
})

test('exports numbered files, caption metadata, and warns about webp and gif', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caballocci-phone-export-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const sources = [
    { name: 'closing.webp', sequence: 3, presentationRole: 'closing' as const },
    { name: 'slide.mp4', sequence: 2, presentationRole: 'slide' as const },
    { name: 'cover.png', sequence: 1, presentationRole: 'cover' as const },
  ].map(({ name, ...visual }, index) => {
    const sourcePath = path.join(root, `source-${index}`)
    fs.writeFileSync(sourcePath, `file-${index}`)
    return { name, sourcePath, ...visual }
  })

  const result = exportPostForPhone(root, post('post-123', 'Café & Día'), sources)
  const folder = path.join(root, result.folderName)
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')) as {
    postId: string
    title: string
    files: string[]
    platforms: string[]
    scheduledAt: string | null
    exportedAt: string
  }

  assert.equal(result.folderName, 'sin-fecha_cafe-dia')
  assert.equal(result.exported, 3)
  assert.deepEqual(result.warnings, [{ name: 'closing.webp', reason: 'format-may-not-upload' }])
  assert.deepEqual(manifest, { postId: 'post-123', title: 'Café & Día', files: ['01.png', '02.mp4', '03.webp'], platforms: ['instagram'], scheduledAt: null, exportedAt: manifest.exportedAt })
  assert.deepEqual(['01.png', '02.mp4', '03.webp'].map(name => fs.readFileSync(path.join(folder, name), 'utf8')), ['file-2', 'file-1', 'file-0'])
  assert.equal(fs.readFileSync(path.join(folder, 'caption.txt'), 'utf8'), 'Texto de la publicación\n\n#cultura #lectura @cuenta @amiga')
  assert.equal('folder' in result, false)
})

test('re-export replaces the previous folder for the same post after title changes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caballocci-phone-idempotent-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const sourcePath = path.join(root, 'source.png')
  fs.writeFileSync(sourcePath, 'image')
  const files = [{ name: 'photo.png', sourcePath }]

  const first = exportPostForPhone(root, post('post-123', 'Título viejo'), files)
  const duplicate = path.join(root, 'duplicate-export')
  fs.mkdirSync(duplicate)
  fs.writeFileSync(path.join(duplicate, 'manifest.json'), JSON.stringify({ postId: 'post-123' }))
  const second = exportPostForPhone(root, post('post-123', 'Título nuevo'), files)
  const exportedFolders = fs.readdirSync(root).filter(name => fs.existsSync(path.join(root, name, 'manifest.json')))

  assert.notEqual(first.folderName, second.folderName)
  assert.deepEqual(exportedFolders, [second.folderName])
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, second.folderName, 'manifest.json'), 'utf8')).postId, 'post-123')
})

test('uses a post ID suffix for distinct posts with the same date and title', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caballocci-phone-collision-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const sourcePath = path.join(root, 'source.png')
  fs.writeFileSync(sourcePath, 'image')
  const files = [{ name: 'photo.png', sourcePath }]

  const first = exportPostForPhone(root, post('post-a', 'Mismo título'), files)
  const second = exportPostForPhone(root, post('post-b', 'Mismo título'), files)

  assert.equal(first.folderName, 'sin-fecha_mismo-titulo')
  assert.equal(second.folderName, 'sin-fecha_mismo-titulo-post-b')
})

test('keeps an existing export intact when a staged copy fails', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caballocci-phone-rollback-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const sourcePath = path.join(root, 'source.png')
  fs.writeFileSync(sourcePath, 'image')
  const first = exportPostForPhone(root, post('post-123'), [{ name: 'photo.png', sourcePath }])

  assert.throws(() => exportPostForPhone(root, post('post-123', 'Cambiado'), [{ name: 'missing.png', sourcePath: path.join(root, 'missing') }]))
  assert.equal(fs.readFileSync(path.join(root, first.folderName, '01.png'), 'utf8'), 'image')
  assert.deepEqual(fs.readdirSync(root).filter(name => name.startsWith('.caballocci-')), [])
})

import fs from 'node:fs'
import path from 'node:path'

export interface PhoneFile {
  name: string
  sourcePath: string
  presentationRole?: 'representative' | 'cover' | 'slide' | 'closing' | 'other'
  sequence?: number | null
}

export interface PhonePost {
  id: string
  title: string
  caption: string
  hashtags: string[]
  mentions: string[]
  platforms: string[]
  scheduledAt: string | null
  batch?: string
  spaceName?: string
  spaceOrder?: number
  used?: boolean
}

export interface PhoneExportWarning {
  name: string
  reason: 'format-may-not-upload'
}

export interface PhoneExportResult {
  exported: number
  skipped: Array<{ name: string; reason: 'document' | 'missing' | 'unsupported' }>
  warnings: PhoneExportWarning[]
  folderName: string
}

function readManifest(directory: string): { postId?: unknown } | undefined {
  try {
    const manifestPath = path.join(directory, 'manifest.json')
    if (!fs.lstatSync(manifestPath).isFile()) return undefined
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { postId?: unknown }
  } catch {
    return undefined
  }
}

function findPreviousExports(root: string, postId: string) {
  const previous: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = path.join(root, entry.name)
    if (readManifest(directory)?.postId === postId) previous.push(directory)
  }
  return previous
}

function pathExists(target: string) {
  try {
    fs.lstatSync(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function slug(value: string) {
  const normalized = value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40)
    .replace(/-+$/g, '')
  return normalized || 'sin-titulo'
}

function folderDate(scheduledAt: string | null) {
  if (!scheduledAt) return 'sin-fecha'
  const date = new Date(scheduledAt)
  if (Number.isNaN(date.getTime())) return 'sin-fecha'
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}_${hour}${minute}`
}

export function phoneExportFolderName(post: Pick<PhonePost, 'title' | 'scheduledAt' | 'batch' | 'spaceName' | 'spaceOrder' | 'used'>) {
  const date = folderDate(post.scheduledAt)
  if (!post.batch) return `${date}_${slug(post.title)}`
  const spaceOrder = Number.isSafeInteger(post.spaceOrder) && Number(post.spaceOrder) > 0
    ? post.spaceOrder
    : 1
  return `${post.batch}-${slug(post.spaceName || 'General').slice(0, 16)}-${spaceOrder}-${slug(post.title)}${post.used ? '-listo' : ''}-${date}`
}

function availableFolderName(root: string, baseName: string, postId: string, previous: string[]) {
  const postSuffix = postId.replace(/[^a-z0-9_-]/gi, '').slice(0, 6) || 'post'
  let candidate = baseName
  let suffix = 0
  while (pathExists(path.join(root, candidate)) && !previous.some(directory => path.resolve(directory) === path.resolve(root, candidate))) {
    suffix += 1
    candidate = `${baseName}-${postSuffix}${suffix > 1 ? `-${suffix}` : ''}`
  }
  return candidate
}

function inferredVisual(file: PhoneFile) {
  const name = file.name.toLocaleLowerCase()
  const numbered = name.match(/^(\d+)[-_ .]/)
  if (/representative|representativa|portada/.test(name)) return { role: 'representative' as const, sequence: undefined }
  if (/cover/.test(name)) return { role: 'cover' as const, sequence: 0 }
  if (/cierre|closing|final/.test(name)) return { role: 'closing' as const, sequence: 10000 }
  if (numbered) return { role: 'slide' as const, sequence: Number(numbered[1]) }
  return { role: file.presentationRole || 'other' as const, sequence: file.sequence }
}

function visualRole(file: PhoneFile) {
  return file.presentationRole || inferredVisual(file).role
}

function visualSequence(file: PhoneFile) {
  return file.sequence === null ? null : file.sequence ?? inferredVisual(file).sequence
}

export function orderPhoneFiles(files: PhoneFile[]) {
  const presentation = files.filter(file => !['representative', 'other'].includes(visualRole(file)))
  const orderedPresentation = [...presentation].sort((first, second) =>
    (visualSequence(first) ?? Number.MAX_SAFE_INTEGER) - (visualSequence(second) ?? Number.MAX_SAFE_INTEGER)
      || first.name.localeCompare(second.name, undefined, { numeric: true }))
  const presentationSet = new Set(presentation)
  let presentationIndex = 0
  return files.map(file => presentationSet.has(file) ? orderedPresentation[presentationIndex++] : file)
}

function normalizedTokens(values: string[], prefix: '#' | '@') {
  return values.map(value => value.trim()).filter(Boolean)
    .map(value => value.startsWith(prefix) ? value : `${prefix}${value}`)
}

function unsupportedFormat(name: string) {
  const extension = path.extname(name).toLowerCase()
  return extension === '.gif' || extension === '.webp'
}

export function exportPostForPhone(root: string, post: PhonePost, files: PhoneFile[]): PhoneExportResult {
  fs.mkdirSync(root, { recursive: true })
  const previous = findPreviousExports(root, post.id)
  const baseName = phoneExportFolderName(post)
  const folderName = availableFolderName(root, baseName, post.id, previous)
  const destination = path.join(root, folderName)
  const staging = fs.mkdtempSync(path.join(root, '.caballocci-export-'))
  const backups: Array<{ original: string; backup: string }> = []
  const orderedFiles = orderPhoneFiles(files)

  try {
    const padding = Math.max(2, String(orderedFiles.length).length)
    const names = orderedFiles.map((file, index) => {
      const extension = path.extname(file.name).toLowerCase()
      const name = `${String(index + 1).padStart(padding, '0')}${extension}`
      fs.copyFileSync(file.sourcePath, path.join(staging, name))
      return name
    })
    const tags = [
      ...normalizedTokens(post.hashtags, '#'),
      ...normalizedTokens(post.mentions, '@'),
    ].join(' ')
    const caption = [post.caption.trim(), tags].filter(Boolean).join('\n\n')
    fs.writeFileSync(path.join(staging, 'caption.txt'), caption, 'utf8')
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({
      postId: post.id,
      title: post.title,
      files: names,
      platforms: post.platforms,
      scheduledAt: post.scheduledAt,
      ...(post.batch ? { batch: post.batch } : {}),
      ...(post.spaceName ? { spaceName: post.spaceName } : {}),
      ...(post.spaceOrder ? { spaceOrder: post.spaceOrder } : {}),
      ...(post.used ? { used: true } : {}),
      exportedAt: new Date().toISOString(),
    }, null, 2), 'utf8')

    try {
      for (const original of previous) {
        const backup = path.join(root, `.caballocci-previous-${crypto.randomUUID()}`)
        fs.renameSync(original, backup)
        backups.push({ original, backup })
      }
      fs.renameSync(staging, destination)
    } catch (error) {
      for (const item of backups.reverse()) {
        if (pathExists(item.backup) && !pathExists(item.original)) fs.renameSync(item.backup, item.original)
      }
      throw error
    }
    for (const item of backups) fs.rmSync(item.backup, { recursive: true, force: true })

    return {
      exported: names.length,
      skipped: [],
      warnings: orderedFiles.filter(file => unsupportedFormat(file.name)).map(file => ({ name: file.name, reason: 'format-may-not-upload' })),
      folderName,
    }
  } catch (error) {
    if (pathExists(staging)) fs.rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

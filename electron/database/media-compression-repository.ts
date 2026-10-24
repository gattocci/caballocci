import AdmZip from 'adm-zip'
import type { Database } from 'sql.js'
import fs from 'node:fs'
import path from 'node:path'
import { firstRow, rows, sqlString } from './sql'

export interface MediaCompressionCandidate {
  id: string
  name: string
  kind: string
  path: string
  size: number
  mode: string
}

export interface MediaCompressionResult {
  compressed: number
  skipped: number
  releasedBytes: number
}

interface CompressionRecord {
  asset_id: string
  archive_id: string
  entry_name: string
  original_path: string
  original_mode: string
  size: number
  archive_path: string
}

function safeName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\.+$/g, '').trim().replace(/^[.-]+/g, '') || 'archivo'
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

export class MediaCompressionRepository {
  private readonly db: Database
  private readonly persist: () => void

  constructor(db: Database, persist: () => void) {
    this.db = db
    this.persist = persist
  }

  state(assetId: string): { archivePath: string; entryName: string } | undefined {
    const row = firstRow(this.db, `SELECT a.archive_path,m.entry_name FROM compressed_media_assets m JOIN media_compression_archives a ON a.id = m.archive_id WHERE m.asset_id = ${sqlString(assetId)}`)
    if (!row || typeof row.archive_path !== 'string' || typeof row.entry_name !== 'string') return undefined
    return { archivePath: row.archive_path, entryName: row.entry_name }
  }

  compressedIds(): string[] {
    return rows(this.db, 'SELECT asset_id FROM compressed_media_assets').map(row => String(row.asset_id))
  }

  assetIdsForTarget(targetType: 'group' | 'post', targetId: string): string[] {
    return rows(this.db, `SELECT m.asset_id FROM compressed_media_assets m
      JOIN media_compression_archives a ON a.id = m.archive_id
      WHERE a.target_type = ${sqlString(targetType)} AND a.target_id = ${sqlString(targetId)}`)
      .map(row => String(row.asset_id))
  }

  async compress(
    targetType: 'group' | 'post',
    targetId: string,
    candidates: MediaCompressionCandidate[],
    references: Map<string, Set<string>>,
    includedPostIds: Set<string>,
    archiveDirectory: string,
    managedRoot: string,
  ): Promise<MediaCompressionResult> {
    const selected = new Map<string, MediaCompressionCandidate>()
    let skipped = 0
    for (const candidate of candidates) {
      const existing = this.state(candidate.id)
      const owners = references.get(candidate.id) || new Set<string>()
      const alreadySelected = selected.has(candidate.id)
      if (alreadySelected || existing || candidate.mode !== 'copy' || !isWithin(managedRoot, candidate.path) ||
          !fs.existsSync(candidate.path) || !fs.statSync(candidate.path).isFile() ||
          [...owners].some(postId => !includedPostIds.has(postId))) {
        skipped += alreadySelected ? 0 : 1
        continue
      }
      selected.set(candidate.id, candidate)
    }
    if (!selected.size) return { compressed: 0, skipped, releasedBytes: 0 }

    const archiveId = crypto.randomUUID()
    const compressedAt = new Date().toISOString()
    const archivePath = path.join(archiveDirectory, `${targetType}-${safeName(targetId)}-${archiveId}.zip`)
    fs.mkdirSync(archiveDirectory, { recursive: true })
    const archive = new AdmZip()
    const records: Array<CompressionRecord> = []
    const sourcePaths = new Set<string>()
    let originalBytes = 0
    let releasedBytes = 0
    const manifest = {
      format: 'caballocci-media-archive',
      version: 1,
      targetType,
      targetId,
      compressedAt,
      assets: [] as Array<{ id: string; name: string; kind: string; originalPath: string; originalMode: string; size: number; entryName: string }>,
    }

    for (const candidate of selected.values()) {
      const existingPath = firstRow(this.db, `SELECT id FROM media_assets WHERE path = ${sqlString(candidate.path)}`)
      if (existingPath && String(existingPath.id) !== candidate.id) {
        skipped += 1
        continue
      }
      const entryName = `media/${candidate.id}/${safeName(path.basename(candidate.name))}`
      archive.addLocalFile(candidate.path, path.posix.dirname(entryName), path.posix.basename(entryName))
      records.push({
        asset_id: candidate.id,
        archive_id: archiveId,
        entry_name: entryName,
        original_path: candidate.path,
        original_mode: candidate.mode,
        size: candidate.size,
        archive_path: archivePath,
      })
      manifest.assets.push({
        id: candidate.id,
        name: candidate.name,
        kind: candidate.kind,
        originalPath: candidate.path,
        originalMode: candidate.mode,
        size: candidate.size,
        entryName,
      })
      if (!sourcePaths.has(candidate.path)) {
        sourcePaths.add(candidate.path)
        originalBytes += candidate.size
      }
    }

    if (!records.length) return { compressed: 0, skipped, releasedBytes: 0 }
    archive.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
    try {
      archive.writeZip(archivePath)
      const verification = new AdmZip(archivePath)
      const verifiedManifest = JSON.parse(verification.readAsText('manifest.json')) as { format?: string; version?: number; assets?: unknown[] }
      if (verifiedManifest.format !== 'caballocci-media-archive' || verifiedManifest.version !== 1 || verifiedManifest.assets?.length !== records.length) {
        throw new Error('El manifiesto ZIP no coincide con los medios que se están comprimiendo.')
      }
      for (const record of records) {
        const entry = verification.getEntry(record.entry_name)
        if (!entry || entry.header.size !== record.size) throw new Error(`No se pudo verificar el medio "${record.asset_id}" en el ZIP.`)
      }
      const archiveSize = fs.statSync(archivePath).size
      if (archiveSize >= originalBytes) {
        fs.rmSync(archivePath, { force: true })
        return { compressed: 0, skipped: skipped + records.length, releasedBytes: 0 }
      }
      releasedBytes = originalBytes - archiveSize
    } catch (error) {
      fs.rmSync(archivePath, { force: true })
      throw new Error('No se pudo crear o verificar el ZIP; los medios originales se conservaron.', { cause: error })
    }

    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run('INSERT INTO media_compression_archives (id,target_type,target_id,archive_path,compressed_at) VALUES (?,?,?,?,?)', [
        archiveId, targetType, targetId, archivePath, compressedAt,
      ])
      records.forEach(record => this.db.run(
        'INSERT INTO compressed_media_assets (asset_id,archive_id,entry_name,original_path,original_mode,size) VALUES (?,?,?,?,?,?)',
        [record.asset_id, record.archive_id, record.entry_name, record.original_path, record.original_mode, record.size],
      ))
      this.db.run('COMMIT')
      this.persist()
    } catch (error) {
      this.db.run('ROLLBACK')
      fs.rmSync(archivePath, { force: true })
      throw error
    }

    for (const filePath of sourcePaths) {
      try {
        fs.unlinkSync(filePath)
      } catch (error) {
        skipped += 1
        throw new Error(`El ZIP se creó y se verificó, pero no se pudo liberar el original "${path.basename(filePath)}". El archivo sigue seguro en el ZIP.`, { cause: error })
      }
    }
    return { compressed: records.length, skipped, releasedBytes }
  }

  restore(assetIds: string[], managedRoot: string) {
    const wanted = new Set(assetIds)
    if (!wanted.size) return { restored: 0 }
    const all: CompressionRecord[] = rows(this.db, `SELECT m.asset_id,m.archive_id,m.entry_name,m.original_path,m.original_mode,m.size,a.archive_path FROM compressed_media_assets m JOIN media_compression_archives a ON a.id = m.archive_id`)
      .filter(row => wanted.has(String(row.asset_id)))
      .map(row => ({
        asset_id: String(row.asset_id),
        archive_id: String(row.archive_id),
        entry_name: String(row.entry_name),
        original_path: String(row.original_path),
        original_mode: String(row.original_mode),
        size: Number(row.size),
        archive_path: String(row.archive_path),
      }))
    if (all.length !== wanted.size) throw new Error('No todos los medios seleccionados están disponibles en el archivo comprimido.')

    const prepared: Array<{ record: CompressionRecord; data: Buffer; temporaryPath: string; alreadyRestored: boolean }> = []
    for (const record of all) {
      if (!isWithin(managedRoot, record.original_path)) throw new Error('La ruta original de un medio está fuera del espacio administrado.')
      const archive = new AdmZip(record.archive_path)
      let manifest: { format?: string; version?: number; assets?: Array<Record<string, unknown>> }
      try { manifest = JSON.parse(archive.readAsText('manifest.json')) as typeof manifest } catch (error) {
        throw new Error('El manifiesto de un ZIP comprimido no se puede leer.', { cause: error })
      }
      const metadata = manifest.assets?.find(asset => asset.id === record.asset_id)
      if (manifest.format !== 'caballocci-media-archive' || manifest.version !== 1 ||
          metadata?.entryName !== record.entry_name || metadata.originalPath !== record.original_path) {
        throw new Error(`Los metadatos del ZIP no coinciden con el medio "${record.asset_id}".`)
      }
      const entry = archive.getEntry(record.entry_name)
      if (!entry) throw new Error(`No se encontró "${record.entry_name}" dentro del ZIP. No se modificó ningún archivo.`)
      const data = entry.getData()
      const alreadyRestored = fs.existsSync(record.original_path)
      if (alreadyRestored && !fs.statSync(record.original_path).isFile()) throw new Error(`La ruta original "${record.original_path}" está ocupada por otro elemento.`)
      if (alreadyRestored && !fs.readFileSync(record.original_path).equals(data)) throw new Error(`Ya existe otro archivo en la ruta original "${record.original_path}". No se sobrescribió.`)
      const directory = path.dirname(record.original_path)
      fs.mkdirSync(directory, { recursive: true })
      prepared.push({ record, data, alreadyRestored, temporaryPath: path.join(directory, `.${path.basename(record.original_path)}.${crypto.randomUUID()}.restore-tmp`) })
    }

    try {
      for (const item of prepared) if (!item.alreadyRestored) fs.writeFileSync(item.temporaryPath, item.data, { flag: 'wx' })
      for (const item of prepared) if (!item.alreadyRestored) fs.renameSync(item.temporaryPath, item.record.original_path)
    } catch (error) {
      for (const item of prepared) {
        fs.rmSync(item.temporaryPath, { force: true })
        if (!item.alreadyRestored && fs.existsSync(item.record.original_path)) fs.rmSync(item.record.original_path, { force: true })
      }
      throw new Error('No se pudieron restaurar los medios; se revirtió la extracción.', { cause: error })
    }

    const archiveIds = new Set(all.map(record => record.archive_id))
    this.db.run('BEGIN TRANSACTION')
    try {
      all.forEach(record => this.db.run('DELETE FROM compressed_media_assets WHERE asset_id = ?', [record.asset_id]))
      for (const archiveId of archiveIds) {
        if (!firstRow(this.db, `SELECT asset_id FROM compressed_media_assets WHERE archive_id = ${sqlString(archiveId)}`)) {
          this.db.run('DELETE FROM media_compression_archives WHERE id = ?', [archiveId])
        }
      }
      this.db.run('COMMIT')
      this.persist()
    } catch (error) {
      this.db.run('ROLLBACK')
      for (const item of prepared) if (!item.alreadyRestored) fs.rmSync(item.record.original_path, { force: true })
      throw error
    }
    for (const archiveId of archiveIds) {
      const archivePath = all.find(record => record.archive_id === archiveId)?.archive_path
      if (archivePath && !firstRow(this.db, `SELECT id FROM media_compression_archives WHERE id = ${sqlString(archiveId)}`)) {
        fs.rmSync(archivePath, { force: true })
      }
    }
    return { restored: all.length }
  }

}

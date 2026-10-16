import fs from 'node:fs'
import path from 'node:path'
import type { Database } from 'sql.js'

/** Serializes sql.js exports so writes are debounced and always replace the file atomically. */
export class DatabasePersistence {
  private timer: ReturnType<typeof setTimeout> | null = null
  private queued = false

  constructor(
    private readonly db: Database,
    private readonly filePath: string,
    private readonly backupsDirectory: string,
  ) {}

  createBackup(reason: 'before-migration' | 'before-update' | 'manual' = 'manual') {
    this.flush()
    fs.mkdirSync(this.backupsDirectory, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const destination = path.join(this.backupsDirectory, `caballocci-${timestamp}-${reason}.sqlite`)
    fs.copyFileSync(this.filePath, destination, fs.constants.COPYFILE_EXCL)
    return destination
  }

  queue() {
    this.queued = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 1500)
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.queued) return
    this.queued = false
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    fs.writeFileSync(temporaryPath, Buffer.from(this.db.export()))
    fs.renameSync(temporaryPath, this.filePath)
  }
}

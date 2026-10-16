import type { Database } from 'sql.js'
import { firstRow, rows, sqlString } from './sql'
import type { Row } from './types'

/** Persistence for source configuration and imported content records. */
export class SourcesRepository {
  constructor(private readonly db: Database, private readonly persist: () => void) {}

  list() { return rows(this.db, 'SELECT * FROM sources ORDER BY name COLLATE NOCASE ASC') }
  get(id: string) { return firstRow(this.db, 'SELECT * FROM sources WHERE id = ' + sqlString(id)) }

  save(input: Row): Row {
    const now = new Date().toISOString()
    const id = String(input.id || crypto.randomUUID())
    const current = this.get(id)
    this.db.run(`INSERT OR REPLACE INTO sources
      (id,name,base_url,method,format,records_path,headers_ciphertext,body_template,auth_type,auth_ciphertext,max_records,target_project,import_mode,initial_status,created_at,updated_at)
      VALUES ($id,$name,$baseUrl,$method,$format,$recordsPath,$headers,$body,$authType,$auth,$maxRecords,$targetProject,$importMode,$initialStatus,$createdAt,$updatedAt)`, {
      $id: id, $name: String(input.name), $baseUrl: String(input.baseUrl), $method: String(input.method), $format: String(input.format),
      $recordsPath: input.recordsPath ? String(input.recordsPath) : null, $headers: String(input.headersCiphertext || ''),
      $body: input.bodyTemplate ? String(input.bodyTemplate) : null, $authType: String(input.authType || 'none'),
      $auth: input.authCiphertext ? String(input.authCiphertext) : null, $maxRecords: Number(input.maxRecords || 500),
      $targetProject: String(input.targetProject || 'Mi contenido'), $importMode: String(input.importMode || 'post'), $initialStatus: String(input.initialStatus || 'idea'),
      $createdAt: current?.created_at ? String(current.created_at) : now, $updatedAt: now,
    })
    this.persist()
    return this.get(id)!
  }

  remove(id: string) {
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run('DELETE FROM content_records WHERE source_id = ?', [id])
      this.db.run('DELETE FROM source_definitions WHERE source_id = ?', [id])
      this.db.run('DELETE FROM sources WHERE id = ?', [id])
      this.db.run('COMMIT')
      this.persist()
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  listDefinitions(sourceId?: string) {
    return sourceId
      ? rows(this.db, 'SELECT * FROM source_definitions WHERE source_id = ' + sqlString(sourceId) + ' ORDER BY updated_at DESC')
      : rows(this.db, 'SELECT * FROM source_definitions ORDER BY updated_at DESC')
  }
  getDefinition(id: string) { return firstRow(this.db, 'SELECT * FROM source_definitions WHERE id = ' + sqlString(id)) }

  saveDefinition(input: Row): Row {
    const now = new Date().toISOString(); const id = String(input.id || crypto.randomUUID()); const current = this.getDefinition(id)
    this.db.run(`INSERT OR REPLACE INTO source_definitions
      (id,source_id,field_map_json,content_type_map_json,custom_field_defaults_json,created_at,updated_at)
      VALUES ($id,$sourceId,$fieldMap,$typeMap,$defaults,$createdAt,$updatedAt)`, {
      $id: id, $sourceId: String(input.sourceId), $fieldMap: String(input.fieldMapJson || '{}'),
      $typeMap: String(input.contentTypeMapJson || '{}'), $defaults: String(input.customFieldDefaultsJson || '{}'),
      $createdAt: current?.created_at ? String(current.created_at) : now, $updatedAt: now,
    })
    this.persist(); return this.getDefinition(id)!
  }

  listRecords(sourceId?: string) {
    return sourceId
      ? rows(this.db, 'SELECT * FROM content_records WHERE source_id = ' + sqlString(sourceId) + ' ORDER BY updated_at DESC')
      : rows(this.db, 'SELECT * FROM content_records ORDER BY updated_at DESC')
  }
  getRecordForPost(postId: string) { return firstRow(this.db, 'SELECT * FROM content_records WHERE post_id = ' + sqlString(postId) + ' ORDER BY updated_at DESC LIMIT 1') }

  saveEnriched(id: string, enrichedJson: string): Row {
    if (!firstRow(this.db, 'SELECT id FROM content_records WHERE id = ' + sqlString(id))) throw new Error('Registro importado no encontrado')
    this.db.run('UPDATE content_records SET enriched_json = ?, updated_at = ? WHERE id = ?', [enrichedJson, new Date().toISOString(), id])
    this.persist()
    return firstRow(this.db, 'SELECT * FROM content_records WHERE id = ' + sqlString(id))!
  }
}

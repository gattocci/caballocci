import type { Database } from 'sql.js'
import { rows, sqlString } from './sql'
import type { Row } from './types'

export class CatalogRepository {
  constructor(private readonly db: Database, private readonly persist: () => void) {}

  getConfig(scope = ''): Row | undefined {
    return rows(this.db, 'SELECT * FROM catalog_integration_config WHERE scope = ' + sqlString(scope)).at(0)
  }

  saveConfig(input: Row): Row {
    const now = new Date().toISOString()
    const scope = String(input.scope || '')
    const current = this.getConfig(scope)
    const nextId = Number(rows(this.db, 'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM catalog_integration_config').at(0)?.next_id || 1)
    const id = current?.id ? Number(current.id) : nextId
    this.db.run(`INSERT OR REPLACE INTO catalog_integration_config (id,endpoint,created_by,token_ciphertext,default_kind,updated_at,scope)
      VALUES (?,?,?,?,?,?,?)`, [id, String(input.endpoint || ''), String(input.createdBy || ''), String(input.tokenCiphertext || ''), String(input.defaultKind || 'resource'), now, scope] as (string | number | null)[])
    this.persist()
    return this.getConfig(scope)!
  }

  getPostFields(postId: string): Row | undefined {
    return rows(this.db, 'SELECT * FROM catalog_post_fields WHERE post_id = ' + sqlString(postId)).at(0)
  }

  savePostFields(input: Row): Row {
    const postId = String(input.postId)
    this.db.run(`INSERT OR REPLACE INTO catalog_post_fields (post_id,summary,content,use_hashtags,kind,category_id,copy_text,category_slug,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`, [postId, String(input.summary || ''), String(input.content || ''), input.useHashtags ? 1 : 0, String(input.kind || 'resource'), input.categoryId == null ? null : Number(input.categoryId), '', String(input.categorySlug || ''), new Date().toISOString()])
    this.persist()
    return this.getPostFields(postId)!
  }

  getSync(postId: string): Row | undefined {
    return rows(this.db, 'SELECT * FROM catalog_syncs WHERE post_id = ' + sqlString(postId)).at(0)
  }

  saveSync(input: Row): Row {
    const postId = String(input.postId)
    this.db.run(`INSERT OR REPLACE INTO catalog_syncs (post_id,source,external_id,kind,remote_id,public_url,action,error_json,request_url,response_status,response_headers_json,response_body,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [postId, String(input.source || 'caballocci'), String(input.externalId), String(input.kind), input.remoteId ? String(input.remoteId) : null, input.publicUrl ? String(input.publicUrl) : null, String(input.action), input.errorJson ? String(input.errorJson) : null, String(input.requestUrl || ''), input.responseStatus == null ? null : Number(input.responseStatus), String(input.responseHeadersJson || '{}'), String(input.responseBody || ''), new Date().toISOString()])
    this.persist()
    return this.getSync(postId)!
  }
}

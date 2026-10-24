import type { Database } from 'sql.js'
import { firstRow, rows, sqlString } from './sql'
import type { Row } from './types'

export class WorkGroupsRepository {
  private readonly db: Database
  private readonly persist: () => void

  constructor(db: Database, persist: () => void) {
    this.db = db
    this.persist = persist
  }

  list(): Row[] {
    const members = new Map<string, string[]>()
    rows(this.db, 'SELECT group_id,post_id FROM work_group_posts ORDER BY added_at,post_id').forEach(row => {
      const id = String(row.group_id)
      members.set(id, [...(members.get(id) || []), String(row.post_id)])
    })
    return rows(this.db, 'SELECT * FROM work_groups ORDER BY archived_at IS NOT NULL,created_at DESC,id DESC')
      .map(group => ({ ...group, post_ids: members.get(String(group.id)) || [] }))
  }

  save(input: Row): Row {
    const now = new Date().toISOString()
    const id = String(input.id || crypto.randomUUID())
    const existing = firstRow(this.db, 'SELECT * FROM work_groups WHERE id = ' + sqlString(id))
    const archivedAt = typeof existing?.archived_at === 'string' ? existing.archived_at : null
    const createdAt = typeof existing?.created_at === 'string' ? existing.created_at : now
    this.db.run(
      `INSERT INTO work_groups (id,name,description,archived_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name,description = excluded.description,updated_at = excluded.updated_at`,
      [id, String(input.name).trim(), String(input.description || '').trim(), archivedAt, createdAt, now],
    )
    this.persist()
    return this.get(id)!
  }

  setPosts(id: string, postIds: string[]): Row {
    if (!firstRow(this.db, 'SELECT id FROM work_groups WHERE id = ' + sqlString(id))) throw new Error('No se encontró el grupo.')
    const validPosts = new Set(rows(this.db, 'SELECT id FROM posts').map(post => String(post.id)))
    const missing = postIds.find(postId => !validPosts.has(postId))
    if (missing) throw new Error('No se encontró una de las publicaciones del grupo.')
    const now = new Date().toISOString()
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run('DELETE FROM work_group_posts WHERE group_id = ?', [id])
      postIds.forEach(postId => this.db.run(
        'INSERT INTO work_group_posts (group_id,post_id,added_at) VALUES (?,?,?)',
        [id, postId, now],
      ))
      this.db.run('COMMIT')
      this.persist()
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
    return this.get(id)!
  }

  setArchived(id: string, archived: boolean): Row {
    const now = archived ? new Date().toISOString() : null
    this.db.run('UPDATE work_groups SET archived_at = ?,updated_at = ? WHERE id = ?', [now, new Date().toISOString(), id])
    if (!this.get(id)) throw new Error('No se encontró el grupo.')
    this.persist()
    return this.get(id)!
  }

  remove(id: string) {
    if (!firstRow(this.db, 'SELECT id FROM work_groups WHERE id = ' + sqlString(id))) throw new Error('No se encontró la colección.')
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run('DELETE FROM work_group_posts WHERE group_id = ?', [id])
      this.db.run('DELETE FROM work_groups WHERE id = ?', [id])
      this.db.run('COMMIT')
      this.persist()
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  private get(id: string): Row | undefined {
    const group = firstRow(this.db, 'SELECT * FROM work_groups WHERE id = ' + sqlString(id))
    if (!group) return undefined
    return {
      ...group,
      post_ids:       rows(this.db, 'SELECT post_id FROM work_group_posts WHERE group_id = ' + sqlString(id) + ' ORDER BY added_at,post_id')
        .map(row => String(row.post_id)),
    }
  }
}

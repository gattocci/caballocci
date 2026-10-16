import type { Database } from 'sql.js'
import { rows, sqlString } from './sql'

export function repairIdeaHashes(db: Database, ideaHash: (title: string, body: string) => string, persist: () => void) {
  const ideas = rows(db, 'SELECT id,title,body,content_hash FROM ideas')
  if (!ideas.length) return
  db.run('BEGIN TRANSACTION')
  try {
    let changed = false
    for (const idea of ideas) {
      const hash = ideaHash(String(idea.title || ''), String(idea.body || ''))
      if (String(idea.content_hash || '') !== hash) {
        db.run('UPDATE ideas SET content_hash = ? WHERE id = ?', [hash, String(idea.id)])
        changed = true
      }
    }
    db.run('COMMIT')
    if (changed) persist()
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}

export function repairPostIdeaLinks(db: Database, ideaExists: (id: string) => boolean, persist: () => void) {
  const posts = rows(db, 'SELECT id,idea_blocks FROM posts')
  if (!posts.length) return
  const now = new Date().toISOString()
  db.run('BEGIN TRANSACTION')
  try {
    let changed = false
    for (const post of posts) {
      const postId = String(post.id)
      if (rows(db, `SELECT 1 FROM post_ideas WHERE post_id = ${sqlString(postId)} LIMIT 1`).length) continue
      let blocks: unknown[] = []
      try {
        const parsed = JSON.parse(String(post.idea_blocks || '[]')) as unknown
        if (Array.isArray(parsed)) blocks = parsed
      } catch { blocks = [] }
      blocks.forEach((block, position) => {
        if (typeof block !== 'object' || block === null) return
        const ideaId = String((block as Record<string, unknown>).id || '')
        if (!ideaId || !ideaExists(ideaId)) return
        db.run('INSERT OR IGNORE INTO post_ideas (post_id,idea_id,relation,position,created_at) VALUES (?,?,?,?,?)', [postId, ideaId, 'combined', position, now])
        db.run('UPDATE ideas SET combined_post_id = COALESCE(combined_post_id, ?), updated_at = ? WHERE id = ?', [postId, now, ideaId])
        changed = true
      })
    }
    db.run('COMMIT')
    if (changed) persist()
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}

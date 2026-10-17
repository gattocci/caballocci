import type { Database } from 'sql.js'
import { rows, sqlString } from './sql'
import type { Row } from './types'

type EntityReader = (id: string) => Row | undefined
type EventWriter = (type: string, entity: string, entityId: string, payload: Record<string, unknown>, at: string) => void

export class IdeaPostWorkflowRepository {
  constructor(private readonly db: Database, private readonly persist: () => void, private readonly post: EntityReader, private readonly idea: EntityReader, private readonly event: EventWriter) {}

  convertIdea(id: string): { idea: Row; post: Row } {
    const idea = this.idea(id)
    if (!idea) throw new Error('Idea no encontrada')
    if (idea.post_id) {
      const existingPost = this.post(String(idea.post_id))
      if (existingPost) {
        let blocks: unknown[] = []
        try { const parsed = JSON.parse(String(existingPost.idea_blocks || '[]')) as unknown; if (Array.isArray(parsed)) blocks = parsed } catch { /* Treat malformed blocks as a normal post link. */ }
        const isCombined = blocks.length > 1 && blocks.some(block => typeof block === 'object' && block !== null && String((block as Row).id || '') === id)
        if (!isCombined) return { idea, post: existingPost }
        const tags = Array.from(new Set([...this.parseTags(idea.tags), 'combinada']))
        this.db.run("UPDATE ideas SET post_id = NULL, combined_post_id = ?, status = 'ready', tags = ?, updated_at = ? WHERE id = ?", [String(existingPost.id), JSON.stringify(tags), new Date().toISOString(), id])
      }
    }
    const now = new Date().toISOString()
    const postId = crypto.randomUUID()
    const hashtags = this.publicationHashtags(idea)
    const ideaBlocks = JSON.stringify([{ id: String(idea.id), title: String(idea.title), text: String(idea.body) }])
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run(`INSERT INTO posts (id,title,caption,notes,hashtags,mentions,platforms,content_type,status,scheduled_at,duration_minutes,project,color,media,idea_blocks,source_idea_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [postId, String(idea.title || 'Nueva publicación'), String(idea.body || ''), '', JSON.stringify(hashtags), '[]', '["instagram"]', 'post', 'idea', idea.due_at ? String(idea.due_at) : null, 60, String(idea.space || 'Mi contenido'), '#e76042', String(idea.media || '[]'), ideaBlocks, String(idea.id), now, now])
      this.db.run('INSERT INTO status_history (post_id,from_status,to_status,changed_at) VALUES (?,?,?,?)', [postId, null, 'idea', now])
      this.db.run("UPDATE ideas SET post_id = ?, status = 'converted', updated_at = ? WHERE id = ?", [postId, now, id])
      this.db.run('INSERT OR REPLACE INTO post_ideas (post_id,idea_id,relation,position,created_at) VALUES (?,?,?,?,?)', [postId, id, 'individual', 0, now])
      this.event('converted', 'idea', id, { postId }, now)
      this.db.run('COMMIT')
      this.persist()
      return { idea: this.idea(id)!, post: this.post(postId)! }
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  combineIdeas(ids: string[]): { ideas: Row[]; post: Row } {
    const ideas = ids.map(id => this.idea(id))
    if (ideas.some(idea => !idea)) throw new Error('Una de las ideas seleccionadas no existe')
    const selected = ideas as Row[]
    if (selected.some(idea => idea.post_id)) throw new Error('Las ideas seleccionadas ya tienen una publicación')
    const first = selected[0]
    const now = new Date().toISOString()
    const postId = crypto.randomUUID()
    const blocks = selected.map(idea => ({ id: String(idea.id), title: String(idea.title || ''), text: String(idea.body || '') }))
    const hashtags = Array.from(new Set(selected.flatMap(idea => this.publicationHashtags(idea))))
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run(`INSERT INTO posts (id,title,caption,notes,hashtags,mentions,platforms,distribution_json,content_type,status,scheduled_at,duration_minutes,project,color,media,idea_blocks,source_idea_id,title_manually_edited,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [postId, String(first.title || 'Nueva publicación'), '', '', JSON.stringify(hashtags), '[]', '["instagram"]', JSON.stringify([{ id: 'instagram', name: 'instagram', status: 'pending' }]), 'carousel', 'idea', null, 60, String(first.space || 'Mi contenido'), '#e76042', '[]', JSON.stringify(blocks), String(first.id), 0, now, now])
      this.db.run('INSERT INTO status_history (post_id,from_status,to_status,changed_at) VALUES (?,?,?,?)', [postId, null, 'idea', now])
      selected.forEach((idea, position) => {
        this.db.run("UPDATE ideas SET post_id = NULL, combined_post_id = COALESCE(combined_post_id, ?), status = 'ready', tags = ?, updated_at = ? WHERE id = ?", [postId, JSON.stringify(Array.from(new Set([...this.parseTags(idea.tags), 'combinada']))), now, String(idea.id)])
        this.db.run('INSERT INTO post_ideas (post_id,idea_id,relation,position,created_at) VALUES (?,?,?,?,?)', [postId, String(idea.id), 'combined', position, now])
      })
      this.event('combined', 'post', postId, { ideaIds: ids }, now)
      this.db.run('COMMIT')
      this.persist()
      return { ideas: ids.map(id => this.idea(id)!), post: this.post(postId)! }
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  uncombinePost(postId: string): { ideas: Row[]; post: Row } {
    const post = this.post(postId)
    if (!post) throw new Error('Publicación no encontrada')
    let links = rows(this.db, `SELECT idea_id FROM post_ideas WHERE post_id = ${sqlString(postId)} AND relation = 'combined' ORDER BY position ASC`)
    if (!links.length) {
      try {
        const blocks = JSON.parse(String(post.idea_blocks || '[]')) as unknown
        if (Array.isArray(blocks)) links = blocks.filter(block => typeof block === 'object' && block !== null).map(block => ({ idea_id: (block as Row).id })).filter(link => typeof link.idea_id === 'string' && Boolean(this.idea(String(link.idea_id))))
      } catch { links = [] }
    }
    const now = new Date().toISOString()
    this.db.run('BEGIN TRANSACTION')
    try {
      for (const link of links) {
        const idea = this.idea(String(link.idea_id))
        if (!idea) continue
        const remaining = rows(this.db, `SELECT post_id FROM post_ideas WHERE idea_id = ${sqlString(String(link.idea_id))} AND relation = 'combined' AND post_id <> ${sqlString(postId)} ORDER BY created_at DESC`).at(0)
        const tags = this.parseTags(idea.tags).filter(tag => tag.toLocaleLowerCase() !== 'combinada')
        if (remaining) tags.push('combinada')
        this.db.run('UPDATE ideas SET combined_post_id = ?, tags = ?, updated_at = ? WHERE id = ?', [remaining?.post_id ? String(remaining.post_id) : null, JSON.stringify(tags), now, String(link.idea_id)])
      }
      this.db.run("DELETE FROM post_ideas WHERE post_id = ? AND relation = 'combined'", [postId])
      this.event('uncombined', 'post', postId, { ideaIds: links.map(link => String(link.idea_id)) }, now)
      this.db.run('COMMIT')
      this.persist()
      return { ideas: links.map(link => this.idea(String(link.idea_id))).filter(Boolean) as Row[], post: this.post(postId)! }
    } catch (error) { this.db.run('ROLLBACK'); throw error }
  }

  private publicationHashtags(idea: Row): string[] {
    const sourceName = String(idea.source_name || '').trim().toLocaleLowerCase()
    return this.parseTags(idea.tags)
      .filter(tag => {
        const normalized = tag.replace(/^#/, '').trim().toLocaleLowerCase()
        return normalized !== 'combinada'
          && normalized !== sourceName
          && !/\.(?:md|markdown|txt|json|csv)$/i.test(normalized)
          && !/\bbatch\s*\d+\b/i.test(normalized)
      })
      .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
  }

  private parseTags(value: unknown): string[] {
    try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [] } catch { return [] }
  }
}

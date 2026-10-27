import fs from 'node:fs'
import path from 'node:path'
import type { PlannerDatabase } from './database'
import { validateArgumentCount, validateId, validatePostInput, validateProject, validateWorkGroupInput, validateWorkGroupPostIds } from './ipc-validation'

type PostsIpcDependencies = {
  database: PlannerDatabase
  dataDirectory: string
  handle(channel: string, callback: (args: unknown[]) => unknown): void
  withoutArguments(callback: () => unknown): (args: unknown[]) => unknown
  mapPost(row: Record<string, unknown>): any
  mapIdea(row: Record<string, unknown>): any
  mapWorkGroup(row: Record<string, unknown>): any
  restoreTargetMedia(targetType: 'group' | 'post', targetId: string): unknown
  ensurePostMediaFolder(project: string, postId: string): string
}

export function registerPostsIpcHandlers({ database, dataDirectory, handle, withoutArguments, mapPost, mapIdea, mapWorkGroup, restoreTargetMedia, ensurePostMediaFolder }: PostsIpcDependencies) {
  handle('posts:list', withoutArguments(() => database.list().map(mapPost)))
  handle('posts:save', args => {
    validateArgumentCount(args, 1)
    const post = mapPost(database.save(validatePostInput(args[0])))
    ensurePostMediaFolder(String(post.project || ''), String(post.id))
    return post
  })
  handle('posts:remove', args => {
    validateArgumentCount(args, 1)
    const id = validateId(args[0], 'post.id')
    restoreTargetMedia('post', id)
    return database.remove(id)
  })
  handle('posts:reassign-project', args => {
    validateArgumentCount(args, 2)
    return database.reassignProject(validateProject(args[0], 'fromProject'), validateProject(args[1], 'toProject'))
  })
  handle('posts:uncombine', args => {
    validateArgumentCount(args, 1)
    const result = database.uncombinePost(validateId(args[0], 'post.id'))
    return { ideas: result.ideas.map(mapIdea), post: mapPost(result.post) }
  })
  handle('work-groups:list', withoutArguments(() => database.listWorkGroups().map(mapWorkGroup)))
  handle('work-groups:save', args => {
    validateArgumentCount(args, 1)
    return mapWorkGroup(database.saveWorkGroup(validateWorkGroupInput(args[0])))
  })
  handle('work-groups:set-posts', args => {
    validateArgumentCount(args, 2)
    const id = validateId(args[0], 'workGroup.id')
    return mapWorkGroup(database.setWorkGroupPosts(id, validateWorkGroupPostIds(args[1])))
  })
  handle('work-groups:set-archived', args => {
    validateArgumentCount(args, 2)
    const id = validateId(args[0], 'workGroup.id')
    if (typeof args[1] !== 'boolean') throw new TypeError('Argumento IPC no valido: workGroup.archived')
    return mapWorkGroup(database.setWorkGroupArchived(id, args[1]))
  })
  handle('work-groups:remove', args => {
    validateArgumentCount(args, 1)
    const id = validateId(args[0], 'workGroup.id')
    restoreTargetMedia('group', id)
    return database.removeWorkGroup(id)
  })
  const compressTargetMedia = (targetType: 'group' | 'post', targetId: string) => {
    const allPosts = database.list().map(mapPost)
    let targetPosts: typeof allPosts
    if (targetType === 'group') {
      const group = database.listWorkGroups().find(item => String(item.id) === targetId)
      if (!group) throw new Error('No se encontró la colección.')
      if (!group.archived_at) throw new Error('Archiva la colección antes de comprimir sus medios.')
      const postIds = new Set(Array.isArray(group.post_ids) ? group.post_ids.map(String) : [])
      targetPosts = allPosts.filter(post => postIds.has(String(post.id)))
    } else {
      const row = database.getPost(targetId)
      if (!row) throw new Error('No se encontró la publicación.')
      if (String(row.status) !== 'archived') throw new Error('Archiva la publicación antes de comprimir sus medios.')
      targetPosts = allPosts.filter(post => String(post.id) === targetId)
    }
    const includedPostIds = new Set(targetPosts.map(post => String(post.id)))
    const references = new Map<string, Set<string>>()
    for (const post of allPosts) {
      for (const asset of post.media) {
        const assetId = String(asset.id || '')
        if (!assetId) continue
        references.set(assetId, new Set([...(references.get(assetId) || []), String(post.id)]))
      }
    }
    const candidates = new Map<string, { id: string; name: string; kind: string; path: string; size: number; mode: string }>()
    for (const post of targetPosts) {
      for (const asset of post.media) {
        const assetId = String(asset.id || '')
        if (!assetId) continue
        const file = database.getMediaFile(assetId)
        if (!file) continue
        candidates.set(assetId, {
          id: assetId,
          name: String(asset.name || 'archivo'),
          kind: file.kind,
          path: file.path,
          size: fs.existsSync(file.path) ? fs.statSync(file.path).size : Number(asset.size || 0),
          mode: file.mode,
        })
      }
    }
    return database.compressMedia(
      targetType,
      targetId,
      [...candidates.values()],
      references,
      includedPostIds,
      path.join(dataDirectory, 'Media', 'Archives'),
      dataDirectory,
    )
  }
  handle('work-groups:compress-media', args => {
    validateArgumentCount(args, 1)
    const id = validateId(args[0], 'workGroup.id')
    return compressTargetMedia('group', id)
  })
  handle('work-groups:restore-media', args => {
    validateArgumentCount(args, 1)
    return restoreTargetMedia('group', validateId(args[0], 'workGroup.id'))
  })
  handle('posts:compress-media', args => {
    validateArgumentCount(args, 1)
    return compressTargetMedia('post', validateId(args[0], 'post.id'))
  })
  handle('posts:restore-media', args => {
    validateArgumentCount(args, 1)
    return restoreTargetMedia('post', validateId(args[0], 'post.id'))
  })
}
import { create } from 'zustand'
import type { Idea, IdeaAnalysisOptions, IdeaAnalysisProgress, IdeaCluster, IdeaInput, IdeaNeighbor, Post, PostInput, PostStatus, WorkGroup, WorkGroupInput } from '../shared/types'

export type PlannerView = 'timeline' | 'calendar' | 'board' | 'concept-map' | 'ideas' | 'library' | 'sources' | 'about'

type WorkspaceUndoLeaf =
  | { kind: 'post'; id: string; before: Post | null; after: Post | null; label: string }
  | { kind: 'idea'; id: string; before: Idea | null; after: Idea | null; label: string }
  | { kind: 'group'; id: string; before: WorkGroup | null; after: WorkGroup | null; label: string }
type WorkspaceUndoAction = WorkspaceUndoLeaf | { kind: 'batch'; actions: WorkspaceUndoLeaf[]; label: string }

export function postMatchesQuery(post: Post, query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return true
  return [post.title, post.caption, post.notes, post.project, ...post.hashtags, ...post.mentions]
    .join(' ')
    .toLocaleLowerCase()
    .includes(normalized)
}

export function ideaMatchesQuery(idea: Idea, query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return true
  if (!normalized) return true
  return [idea.title, idea.body, idea.space, ...idea.tags].join(' ').toLocaleLowerCase().includes(normalized)
}

interface PlannerState {
  posts: Post[]
  ideas: Idea[]
  workGroups: WorkGroup[]
  undoHistory: WorkspaceUndoAction[]
  redoHistory: WorkspaceUndoAction[]
  undoNotice: string | null
  loading: boolean
  loadError: string | null
  view: PlannerView
  selectedId: string | null
  selectedIdeaId: string | null
  query: string
  activeSpace: string | null
  customSpaces: string[]
  hiddenSpaces: string[]
  load(): Promise<void>
  save(post: PostInput, options?: { recordHistory?: boolean }): Promise<Post>
  saveWorkGroup(group: WorkGroupInput, options?: { recordHistory?: boolean }): Promise<WorkGroup>
  setWorkGroupPosts(id: string, postIds: string[], options?: { recordHistory?: boolean }): Promise<WorkGroup>
  setWorkGroupArchived(id: string, archived: boolean, options?: { recordHistory?: boolean }): Promise<WorkGroup>
  removeWorkGroup(id: string, options?: { recordHistory?: boolean }): Promise<void>
  remove(id: string, options?: { recordHistory?: boolean }): Promise<void>
  move(id: string, status: PostStatus): Promise<void>
  saveIdea(idea: IdeaInput, options?: { recordHistory?: boolean }): Promise<Idea>
  saveIdeasMany(ideas: IdeaInput[]): Promise<{ created: Idea[]; skipped: number; duplicates: Array<{ title: string; sourceName: string; existingId: string; existingTitle: string; existingSourceName: string }> }>
  removeIdea(id: string, options?: { recordHistory?: boolean }): Promise<void>
  convertIdea(id: string): Promise<Post>
  combineIdeas(ids: string[]): Promise<{ ideas: Idea[]; post: Post }>
  uncombinePost(id: string): Promise<{ ideas: Idea[]; post: Post }>
  undoSavedChange(): Promise<void>
  redoSavedChange(): Promise<void>
  groupRecentUndoActions(count: number, label: string): void
  clearUndoNotice(): void
  ideaNeighbors(id: string, limit?: number, ignoredTerms?: string[], options?: IdeaAnalysisOptions): Promise<IdeaNeighbor[]>
  refreshEmbeddings(ids?: string[], ignoredTerms?: string[], options?: IdeaAnalysisOptions): Promise<{ updated: number; model: string; modelVersion: string }>
  proposeClusters(threshold?: number, ignoredTerms?: string[], options?: IdeaAnalysisOptions, onProgress?: (progress: IdeaAnalysisProgress) => void): Promise<IdeaCluster[]>
  previewIdeaAnalysis(ignoredTerms?: string[], options?: IdeaAnalysisOptions): Promise<{ automaticTerms: string[] }>
  listIdeaClusters(): Promise<IdeaCluster[]>
  setView(view: PlannerView): void
  select(id: string | null): void
  selectIdea(id: string | null): void
  setQuery(query: string): void
  setActiveSpace(space: string | null): void
  addSpace(space: string): void
  renameSpace(space: string, nextName: string): Promise<void>
  removeSpace(space: string, movePosts: boolean): Promise<void>
  spaceNotes: Record<string, string>
  spaceKeys: Record<string, string>
  spaceKey(space: string): string
  saveSpaceNotes(space: string, notes: string): void
}

function readStoredSpaces() {
  try { return JSON.parse(localStorage.getItem('caballocci.spaces') || '[]') as string[] }
  catch { return [] }
}

function postChangeLabel(before: Post, after: Post) {
  if (before.status !== after.status) return 'Cambiar estado de publicación'
  if (before.scheduledAt !== after.scheduledAt) return 'Cambiar fecha de publicación'
  if (before.color !== after.color) return 'Cambiar color de publicación'
  if (before.title !== after.title) return 'Editar título de publicación'
  if (before.caption !== after.caption) return 'Editar texto de publicación'
  if (before.notes !== after.notes) return 'Editar notas de publicación'
  if (JSON.stringify(before.hashtags) !== JSON.stringify(after.hashtags)) return 'Editar hashtags'
  if (JSON.stringify(before.mentions) !== JSON.stringify(after.mentions)) return 'Editar menciones'
  if (JSON.stringify(before.platforms) !== JSON.stringify(after.platforms)) return 'Cambiar destinos de publicación'
  if (JSON.stringify(before.distribution) !== JSON.stringify(after.distribution)) return 'Cambiar estados por destino'
  if (JSON.stringify(before.media) !== JSON.stringify(after.media)) return 'Cambiar medios de publicación'
  if (before.project !== after.project) return 'Cambiar proyecto de publicación'
  if (JSON.stringify(before.ideaBlocks) !== JSON.stringify(after.ideaBlocks)) return 'Editar diapositivas'
  return 'Editar publicación'
}

function ideaChangeLabel(before: Idea, after: Idea) {
  if (before.status !== after.status) return 'Cambiar estado de idea'
  if (before.priority !== after.priority) return 'Cambiar prioridad de idea'
  if (before.space !== after.space) return 'Cambiar espacio de idea'
  if (before.title !== after.title) return 'Editar título de idea'
  if (before.body !== after.body) return 'Editar texto de idea'
  if (JSON.stringify(before.tags) !== JSON.stringify(after.tags)) return 'Editar etiquetas de idea'
  if (JSON.stringify(before.media) !== JSON.stringify(after.media)) return 'Cambiar medios de idea'
  return 'Editar idea'
}

function pushUndo(history: WorkspaceUndoAction[], action: WorkspaceUndoAction) {
  return [...history.slice(-99), action]
}

function actionReferencesPost(action: WorkspaceUndoAction, id: string): boolean {
  if (action.kind === 'batch') return action.actions.some(item => actionReferencesPost(item, id))
  if (action.kind === 'post') return action.id === id
  if (action.kind === 'idea') return false
  return Boolean(action.before?.postIds.includes(id) || action.after?.postIds.includes(id))
}

function actionReferencesIdea(action: WorkspaceUndoAction, id: string): boolean {
  if (action.kind === 'batch') return action.actions.some(item => actionReferencesIdea(item, id))
  if (action.kind === 'idea') return action.id === id
  return action.kind === 'post' && (action.before?.sourceIdeaId === id || action.after?.sourceIdeaId === id)
}

export const usePlanner = create<PlannerState>((set, get) => ({
  posts: [],
  ideas: [],
  workGroups: [],
  undoHistory: [],
  redoHistory: [],
  undoNotice: null,
  loading: true,
  loadError: null,
  view: 'timeline',
  selectedId: null,
  selectedIdeaId: null,
  query: '',
  activeSpace: null,
  customSpaces: readStoredSpaces(),
  hiddenSpaces: (() => {
    try { return JSON.parse(localStorage.getItem('caballocci.hidden-spaces') || '[]') as string[] }
    catch { return [] }
  })(),
  spaceNotes: (() => { try { return JSON.parse(localStorage.getItem('caballocci.space-notes') || '{}') as Record<string, string> } catch { return {} } })(),
  spaceKeys: (() => { try { return JSON.parse(localStorage.getItem('caballocci.space-keys') || '{}') as Record<string, string> } catch { return {} } })(),
  spaceKey: (space) => get().spaceKeys[space] || space,
  load: async () => {
    try {
      if (!window.planner) throw new Error('La API de Electron no esta disponible. Inicia la aplicacion con npm.cmd run dev.')
      const [posts, ideas, workGroups] = await Promise.all([window.planner.posts.list(), window.planner.ideas.list(), window.planner.workGroups.list()])
      set(state => ({
        posts,
        ideas,
        workGroups,
        loading: false,
        loadError: null,
        selectedId: state.selectedId && posts.some(post => post.id === state.selectedId) ? state.selectedId : null,
        selectedIdeaId: state.selectedIdeaId && ideas.some(idea => idea.id === state.selectedIdeaId) ? state.selectedIdeaId : null,
      }))
    } catch (error) {
      set({ loading: false, loadError: error instanceof Error ? error.message : 'No se pudo cargar el workspace local.' })
    }
  },
  save: async (post, options) => {
    const before = get().posts.find(item => item.id === post.id) || null
    const saved = await window.planner.posts.save(post)
    set(state => {
      const changed = JSON.stringify(before) !== JSON.stringify(saved)
      return {
        posts: state.posts.some(item => item.id === saved.id) ? state.posts.map(item => item.id === saved.id ? saved : item) : [...state.posts, saved],
        undoHistory: options?.recordHistory === false || !changed ? state.undoHistory : pushUndo(state.undoHistory, { kind: 'post', id: saved.id, before, after: saved, label: before ? postChangeLabel(before, saved) : 'Crear publicación' }),
        redoHistory: options?.recordHistory === false || !changed ? state.redoHistory : [],
        undoNotice: null,
      }
    })
    return saved
  },
  saveWorkGroup: async (group, options) => {
    const before = get().workGroups.find(item => item.id === group.id) || null
    const saved = await window.planner.workGroups.save(group)
    set(state => {
      const top = state.undoHistory.at(-1)
      const history = options?.recordHistory === false && top?.kind === 'group' && top.id === saved.id
        ? [...state.undoHistory.slice(0, -1), { ...top, after: saved }]
        : options?.recordHistory === false || JSON.stringify(before) === JSON.stringify(saved) ? state.undoHistory : pushUndo(state.undoHistory, { kind: 'group', id: saved.id, before, after: saved, label: before ? 'Editar colección' : 'Crear colección' })
      return {
      workGroups: [...state.workGroups.filter(item => item.id !== saved.id), saved],
      undoHistory: history,
      redoHistory: options?.recordHistory === false || JSON.stringify(before) === JSON.stringify(saved) ? state.redoHistory : [],
      undoNotice: null,
      }
    })
    return saved
  },
  setWorkGroupPosts: async (id, postIds, options) => {
    const before = get().workGroups.find(item => item.id === id) || null
    const saved = await window.planner.workGroups.setPosts(id, postIds)
    set(state => {
      const top = state.undoHistory.at(-1)
      const history = options?.recordHistory === false && top?.kind === 'group' && top.id === saved.id
        ? [...state.undoHistory.slice(0, -1), { ...top, after: saved }]
        : options?.recordHistory === false || JSON.stringify(before) === JSON.stringify(saved) ? state.undoHistory : pushUndo(state.undoHistory, { kind: 'group', id: saved.id, before, after: saved, label: 'Cambiar publicaciones de la colección' })
      return {
      workGroups: [...state.workGroups.filter(item => item.id !== saved.id), saved],
      undoHistory: history,
      redoHistory: options?.recordHistory === false || JSON.stringify(before) === JSON.stringify(saved) ? state.redoHistory : [],
      undoNotice: null,
      }
    })
    return saved
  },
  setWorkGroupArchived: async (id, archived, options) => {
    const before = get().workGroups.find(item => item.id === id) || null
    const saved = await window.planner.workGroups.setArchived(id, archived)
    set(state => ({
      workGroups: [...state.workGroups.filter(item => item.id !== saved.id), saved],
      undoHistory: options?.recordHistory === false || JSON.stringify(before) === JSON.stringify(saved) ? state.undoHistory : pushUndo(state.undoHistory, { kind: 'group', id: saved.id, before, after: saved, label: archived ? 'Archivar colección' : 'Restaurar colección' }),
      redoHistory: options?.recordHistory === false || JSON.stringify(before) === JSON.stringify(saved) ? state.redoHistory : [],
      undoNotice: null,
    }))
    return saved
  },
  removeWorkGroup: async (id, options) => {
    const before = get().workGroups.find(item => item.id === id) || null
    await window.planner.workGroups.remove(id)
    set(state => ({
      workGroups: state.workGroups.filter(group => group.id !== id),
      undoHistory: options?.recordHistory === false || !before ? state.undoHistory : pushUndo(state.undoHistory, { kind: 'group', id, before, after: null, label: 'Eliminar colección' }),
      redoHistory: options?.recordHistory === false || !before ? state.redoHistory : [],
      undoNotice: null,
    }))
  },
  remove: async (id, options) => {
    const before = get().posts.find(post => post.id === id) || null
    await window.planner.posts.remove(id)
    set(state => {
      const workGroups = state.workGroups.map(group => ({ ...group, postIds: group.postIds.filter(postId => postId !== id) }))
      const ideas = state.ideas.map(idea => {
        if (idea.postId === id) return { ...idea, postId: null, status: 'ready' as const }
        if (idea.combinedPostIds.includes(id) || idea.combinedPostId === id) {
          const combinedPostIds = idea.combinedPostIds.filter(postId => postId !== id)
          return { ...idea, combinedPostId: combinedPostIds[0] || null, combinedPostIds, tags: combinedPostIds.length ? idea.tags : idea.tags.filter(tag => tag.toLocaleLowerCase() !== 'combinada') }
        }
        return idea
      })
      return {
        posts: state.posts.filter(post => post.id !== id), workGroups, ideas, selectedId: null,
        undoHistory: options?.recordHistory === false ? state.undoHistory : state.undoHistory.filter(action => !actionReferencesPost(action, id)),
        redoHistory: options?.recordHistory === false ? state.redoHistory : state.redoHistory.filter(action => !actionReferencesPost(action, id)),
        undoNotice: null,
      }
    })
  },
  move: async (id, status) => {
    const post = get().posts.find((item) => item.id === id)
    if (post) await get().save({ ...post, status })
  },
  saveIdea: async (idea, options) => {
    const before = get().ideas.find(item => item.id === idea.id) || null
    const saved = await window.planner.ideas.save(idea)
    set(state => ({
      ideas: [...state.ideas.filter(item => item.id !== saved.id), saved],
      undoHistory: options?.recordHistory === false || JSON.stringify(before) === JSON.stringify(saved) ? state.undoHistory : pushUndo(state.undoHistory, { kind: 'idea', id: saved.id, before, after: saved, label: before ? ideaChangeLabel(before, saved) : 'Crear idea' }),
      redoHistory: options?.recordHistory === false || JSON.stringify(before) === JSON.stringify(saved) ? state.redoHistory : [],
      undoNotice: null,
    }))
    return saved
  },
  saveIdeasMany: async (ideas) => {
    const result = await window.planner.ideas.saveMany(ideas)
    set(state => {
      const actions: WorkspaceUndoLeaf[] = result.created.map(idea => ({ kind: 'idea', id: idea.id, before: null, after: idea, label: 'Importar ideas' }))
      const importAction: WorkspaceUndoAction | null = !actions.length ? null : actions.length === 1
        ? { ...actions[0], label: 'Importar idea' }
        : { kind: 'batch', actions, label: `Importar ${actions.length} ideas` }
      return {
        ideas: [...state.ideas, ...result.created],
        undoHistory: importAction ? pushUndo(state.undoHistory, importAction) : state.undoHistory,
        redoHistory: importAction ? [] : state.redoHistory,
        undoNotice: null,
      }
    })
    return result
  },
  removeIdea: async (id, options) => {
    await window.planner.ideas.remove(id)
    set(state => ({
      ideas: state.ideas.filter(idea => idea.id !== id),
      posts: state.posts.map(post => post.sourceIdeaId === id ? { ...post, sourceIdeaId: null } : post),
      selectedIdeaId: null,
      undoHistory: options?.recordHistory === false ? state.undoHistory : state.undoHistory.filter(action => !actionReferencesIdea(action, id)),
      redoHistory: options?.recordHistory === false ? state.redoHistory : state.redoHistory.filter(action => !actionReferencesIdea(action, id)),
      undoNotice: null,
    }))
  },
  convertIdea: async (id) => {
    const converted = await window.planner.ideas.convert(id)
    set({
      ideas: [...get().ideas.filter(idea => idea.id !== id), converted.idea],
      posts: [...get().posts.filter(post => post.id !== converted.post.id), converted.post],
      undoHistory: get().undoHistory.filter(action => !actionReferencesIdea(action, id) && !actionReferencesPost(action, converted.post.id)),
      redoHistory: get().redoHistory.filter(action => !actionReferencesIdea(action, id) && !actionReferencesPost(action, converted.post.id)),
      undoNotice: null,
    })
    return converted.post
  },
  combineIdeas: async (ids) => {
    const combined = await window.planner.ideas.combine(ids)
    set({
      ideas: [...get().ideas.filter(idea => !ids.includes(idea.id)), ...combined.ideas],
      posts: [...get().posts.filter(post => post.id !== combined.post.id), combined.post],
      undoHistory: get().undoHistory.filter(action => !ids.some(id => actionReferencesIdea(action, id)) && !actionReferencesPost(action, combined.post.id)),
      redoHistory: get().redoHistory.filter(action => !ids.some(id => actionReferencesIdea(action, id)) && !actionReferencesPost(action, combined.post.id)),
      undoNotice: null,
    })
    return combined
  },
  uncombinePost: async (id) => {
    const result = await window.planner.posts.uncombine(id)
    set({
      ideas: [...get().ideas.filter(idea => !result.ideas.some(item => item.id === idea.id)), ...result.ideas],
      posts: [...get().posts.filter(post => post.id !== result.post.id), result.post],
      undoHistory: get().undoHistory.filter(action => !actionReferencesPost(action, id) && !result.ideas.some(idea => actionReferencesIdea(action, idea.id))),
      redoHistory: get().redoHistory.filter(action => !actionReferencesPost(action, id) && !result.ideas.some(idea => actionReferencesIdea(action, idea.id))),
      undoNotice: null,
    })
    return result
  },
  undoSavedChange: async () => {
    const action = get().undoHistory.at(-1)
    if (!action) return
    const actions = action.kind === 'batch' ? [...action.actions].reverse() : [action]
    for (const item of actions) {
      if (item.kind === 'post') {
        if (item.before) await get().save(item.before, { recordHistory: false })
        else await get().remove(item.id, { recordHistory: false })
      } else if (item.kind === 'idea') {
        if (item.before) await get().saveIdea(item.before, { recordHistory: false })
        else await get().removeIdea(item.id, { recordHistory: false })
      } else {
        if (item.before) {
          await get().saveWorkGroup(item.before, { recordHistory: false })
          await get().setWorkGroupPosts(item.id, item.before.postIds, { recordHistory: false })
          await get().setWorkGroupArchived(item.id, Boolean(item.before.archivedAt), { recordHistory: false })
        } else await get().removeWorkGroup(item.id, { recordHistory: false })
      }
    }
    set(state => ({ undoHistory: state.undoHistory.slice(0, -1), redoHistory: [...state.redoHistory, action], undoNotice: `Deshecho y guardado: ${action.label}` }))
  },
  redoSavedChange: async () => {
    const action = get().redoHistory.at(-1)
    if (!action) return
    const actions = action.kind === 'batch' ? action.actions : [action]
    for (const item of actions) {
      if (item.kind === 'post') {
        if (item.after) await get().save(item.after, { recordHistory: false })
        else await get().remove(item.id, { recordHistory: false })
      } else if (item.kind === 'idea') {
        if (item.after) await get().saveIdea(item.after, { recordHistory: false })
        else await get().removeIdea(item.id, { recordHistory: false })
      } else {
        if (item.after) {
          await get().saveWorkGroup(item.after, { recordHistory: false })
          await get().setWorkGroupPosts(item.id, item.after.postIds, { recordHistory: false })
          await get().setWorkGroupArchived(item.id, Boolean(item.after.archivedAt), { recordHistory: false })
        } else await get().removeWorkGroup(item.id, { recordHistory: false })
      }
    }
    set(state => ({ redoHistory: state.redoHistory.slice(0, -1), undoHistory: pushUndo(state.undoHistory, action), undoNotice: `Rehecho y guardado: ${action.label}` }))
  },
  groupRecentUndoActions: (count, label) => {
    if (count < 1) return
    set(state => {
      const recent = state.undoHistory.slice(-count)
      if (!recent.length || recent.some(action => action.kind === 'batch')) return state
      const start = state.undoHistory.length - recent.length
      const actions = recent as WorkspaceUndoLeaf[]
      const grouped: WorkspaceUndoAction = actions.length === 1 ? { ...actions[0], label } : { kind: 'batch', actions, label }
      return { undoHistory: [...state.undoHistory.slice(0, start), grouped] }
    })
  },
  clearUndoNotice: () => set({ undoNotice: null }),
  ideaNeighbors: (id, limit, ignoredTerms, options) => window.planner.ideas.neighbors(id, limit, ignoredTerms, options),
  refreshEmbeddings: (ids, ignoredTerms, options) => window.planner.ideas.refreshEmbeddings(ids, ignoredTerms, options),
  proposeClusters: async (threshold, ignoredTerms, options, onProgress) => window.planner.ideas.clusters(threshold, ignoredTerms, options, onProgress),
  previewIdeaAnalysis: (ignoredTerms, options) => window.planner.ideas.analysisPreview(ignoredTerms, options),
  listIdeaClusters: () => window.planner.ideas.clustersList(),
  setView: (view) => set({ view }),
  select: (selectedId) => set({ selectedId }),
  selectIdea: (selectedIdeaId) => set({ selectedIdeaId }),
  setQuery: (query) => set({ query }),
  setActiveSpace: (activeSpace) => set({ activeSpace }),
  addSpace: (space) => {
    const name = space.trim()
    if (!name) return
    const customSpaces = Array.from(new Set([...get().customSpaces, name]))
    localStorage.setItem('caballocci.spaces', JSON.stringify(customSpaces))
    const hiddenSpaces = get().hiddenSpaces.filter(item => item !== name)
    localStorage.setItem('caballocci.hidden-spaces', JSON.stringify(hiddenSpaces))
    set({ customSpaces, hiddenSpaces, activeSpace: name })
  },
  renameSpace: async (space, nextName) => {
    const name = nextName.trim()
    if (!name || name === space) return
    await window.planner.posts.reassignProject(space, name)
    const customSpaces = Array.from(new Set([...get().customSpaces.filter(item => item !== space), name]))
    const oldKey = get().spaceKey(space)
    const newKey = get().spaceKeys[space] || crypto.randomUUID()
    const spaceKeys = { ...get().spaceKeys, [name]: newKey }
    delete spaceKeys[space]
    const spaceNotes = { ...get().spaceNotes }
    if (spaceNotes[oldKey] !== undefined) spaceNotes[newKey] = spaceNotes[oldKey]
    if (oldKey !== newKey) delete spaceNotes[oldKey]
    const hiddenSpaces = Array.from(new Set([...get().hiddenSpaces.filter(item => item !== name), space]))
    localStorage.setItem('caballocci.spaces', JSON.stringify(customSpaces))
    localStorage.setItem('caballocci.hidden-spaces', JSON.stringify(hiddenSpaces))
    localStorage.setItem('caballocci.space-keys', JSON.stringify(spaceKeys))
    localStorage.setItem('caballocci.space-notes', JSON.stringify(spaceNotes))
    set({
      posts: get().posts.map(post => post.project === space ? { ...post, project: name } : post),
      ideas: get().ideas.map(idea => idea.space === space ? { ...idea, space: name } : idea),
      customSpaces, hiddenSpaces, spaceKeys, spaceNotes, activeSpace: get().activeSpace === space ? name : get().activeSpace,
    })
  },
  removeSpace: async (space, movePosts) => {
    if (movePosts) {
      await window.planner.posts.reassignProject(space, 'Mi contenido')
      set({
        posts: get().posts.map(post => post.project === space ? { ...post, project: 'Mi contenido' } : post),
        ideas: get().ideas.map(idea => idea.space === space ? { ...idea, space: 'Mi contenido' } : idea),
      })
    }
    const customSpaces = get().customSpaces.filter(item => item !== space)
    const hiddenSpaces = Array.from(new Set([...get().hiddenSpaces, space]))
    localStorage.setItem('caballocci.spaces', JSON.stringify(customSpaces))
    localStorage.setItem('caballocci.hidden-spaces', JSON.stringify(hiddenSpaces))
    set({ customSpaces, hiddenSpaces, activeSpace: get().activeSpace === space ? null : get().activeSpace })
  },
  saveSpaceNotes: (space, notes) => {
    const existingKey = get().spaceKeys[space]
    const stableKey = existingKey || crypto.randomUUID()
    const spaceKeys = existingKey ? get().spaceKeys : { ...get().spaceKeys, [space]: stableKey }
    if (!existingKey) { localStorage.setItem('caballocci.space-keys', JSON.stringify(spaceKeys)); set({ spaceKeys }) }
    const spaceNotes = { ...get().spaceNotes, [stableKey]: notes }
    localStorage.setItem('caballocci.space-notes', JSON.stringify(spaceNotes))
    set({ spaceNotes })
  },
}))

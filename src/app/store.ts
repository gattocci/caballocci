import { create } from 'zustand'
import type { Idea, IdeaInput, Post, PostInput, PostStatus } from '../shared/types'

export type PlannerView = 'timeline' | 'calendar' | 'board' | 'concept-map' | 'ideas' | 'library' | 'about'

interface PlannerState {
  posts: Post[]
  ideas: Idea[]
  loading: boolean
  view: PlannerView
  selectedId: string | null
  selectedIdeaId: string | null
  query: string
  activeSpace: string | null
  customSpaces: string[]
  hiddenSpaces: string[]
  load(): Promise<void>
  save(post: PostInput): Promise<Post>
  remove(id: string): Promise<void>
  move(id: string, status: PostStatus): Promise<void>
  saveIdea(idea: IdeaInput): Promise<Idea>
  removeIdea(id: string): Promise<void>
  convertIdea(id: string): Promise<Post>
  setView(view: PlannerView): void
  select(id: string | null): void
  selectIdea(id: string | null): void
  setQuery(query: string): void
  setActiveSpace(space: string | null): void
  addSpace(space: string): void
  renameSpace(space: string, nextName: string): Promise<void>
  removeSpace(space: string, movePosts: boolean): Promise<void>
}

function readStoredSpaces() {
  try { return JSON.parse(localStorage.getItem('caballocci.spaces') || '[]') as string[] }
  catch { return [] }
}

export const usePlanner = create<PlannerState>((set, get) => ({
  posts: [],
  ideas: [],
  loading: true,
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
  load: async () => {
    const [posts, ideas] = await Promise.all([window.planner.posts.list(), window.planner.ideas.list()])
    set({ posts, ideas, loading: false })
  },
  save: async (post) => {
    const saved = await window.planner.posts.save(post)
    set({ posts: [...get().posts.filter((item) => item.id !== saved.id), saved] })
    return saved
  },
  remove: async (id) => {
    await window.planner.posts.remove(id)
    set({
      posts: get().posts.filter((post) => post.id !== id),
      ideas: get().ideas.map(idea => idea.postId === id ? { ...idea, postId: null, status: 'ready' } : idea),
      selectedId: null,
    })
  },
  move: async (id, status) => {
    const post = get().posts.find((item) => item.id === id)
    if (post) await get().save({ ...post, status })
  },
  saveIdea: async (idea) => {
    const saved = await window.planner.ideas.save(idea)
    set({ ideas: [...get().ideas.filter(item => item.id !== saved.id), saved] })
    return saved
  },
  removeIdea: async (id) => {
    await window.planner.ideas.remove(id)
    set({
      ideas: get().ideas.filter(idea => idea.id !== id),
      posts: get().posts.map(post => post.sourceIdeaId === id ? { ...post, sourceIdeaId: null } : post),
      selectedIdeaId: null,
    })
  },
  convertIdea: async (id) => {
    const converted = await window.planner.ideas.convert(id)
    set({
      ideas: [...get().ideas.filter(idea => idea.id !== id), converted.idea],
      posts: [...get().posts.filter(post => post.id !== converted.post.id), converted.post],
    })
    return converted.post
  },
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
    const hiddenSpaces = Array.from(new Set([...get().hiddenSpaces.filter(item => item !== name), space]))
    localStorage.setItem('caballocci.spaces', JSON.stringify(customSpaces))
    localStorage.setItem('caballocci.hidden-spaces', JSON.stringify(hiddenSpaces))
    set({
      posts: get().posts.map(post => post.project === space ? { ...post, project: name } : post),
      ideas: get().ideas.map(idea => idea.space === space ? { ...idea, space: name } : idea),
      customSpaces, hiddenSpaces, activeSpace: get().activeSpace === space ? name : get().activeSpace,
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
}))

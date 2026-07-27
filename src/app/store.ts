import { create } from 'zustand'
import type { Post, PostInput, PostStatus } from '../shared/types'

export type PlannerView = 'timeline' | 'calendar' | 'board' | 'library' | 'about'

interface PlannerState {
  posts: Post[]
  loading: boolean
  view: PlannerView
  selectedId: string | null
  query: string
  activeSpace: string | null
  customSpaces: string[]
  hiddenSpaces: string[]
  load(): Promise<void>
  save(post: PostInput): Promise<Post>
  remove(id: string): Promise<void>
  move(id: string, status: PostStatus): Promise<void>
  setView(view: PlannerView): void
  select(id: string | null): void
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
  loading: true,
  view: 'timeline',
  selectedId: null,
  query: '',
  activeSpace: null,
  customSpaces: readStoredSpaces(),
  hiddenSpaces: (() => {
    try { return JSON.parse(localStorage.getItem('caballocci.hidden-spaces') || '[]') as string[] }
    catch { return [] }
  })(),
  load: async () => set({ posts: await window.planner.posts.list(), loading: false }),
  save: async (post) => {
    const saved = await window.planner.posts.save(post)
    set({ posts: [...get().posts.filter((item) => item.id !== saved.id), saved] })
    return saved
  },
  remove: async (id) => {
    await window.planner.posts.remove(id)
    set({ posts: get().posts.filter((post) => post.id !== id), selectedId: null })
  },
  move: async (id, status) => {
    const post = get().posts.find((item) => item.id === id)
    if (post) await get().save({ ...post, status })
  },
  setView: (view) => set({ view }),
  select: (selectedId) => set({ selectedId }),
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
    set({ posts: get().posts.map(post => post.project === space ? { ...post, project: name } : post), customSpaces, hiddenSpaces, activeSpace: get().activeSpace === space ? name : get().activeSpace })
  },
  removeSpace: async (space, movePosts) => {
    if (movePosts) {
      await window.planner.posts.reassignProject(space, 'Mi contenido')
      set({ posts: get().posts.map(post => post.project === space ? { ...post, project: 'Mi contenido' } : post) })
    }
    const customSpaces = get().customSpaces.filter(item => item !== space)
    const hiddenSpaces = Array.from(new Set([...get().hiddenSpaces, space]))
    localStorage.setItem('caballocci.spaces', JSON.stringify(customSpaces))
    localStorage.setItem('caballocci.hidden-spaces', JSON.stringify(hiddenSpaces))
    set({ customSpaces, hiddenSpaces, activeSpace: get().activeSpace === space ? null : get().activeSpace })
  },
}))

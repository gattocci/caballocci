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
  load(): Promise<void>
  save(post: PostInput): Promise<Post>
  remove(id: string): Promise<void>
  move(id: string, status: PostStatus): Promise<void>
  setView(view: PlannerView): void
  select(id: string | null): void
  setQuery(query: string): void
  setActiveSpace(space: string | null): void
  addSpace(space: string): void
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
    set({ customSpaces, activeSpace: name })
  },
}))

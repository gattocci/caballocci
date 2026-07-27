import { create } from 'zustand'
import type { Post, PostInput, PostStatus } from '../shared/types'

export type PlannerView = 'timeline' | 'calendar' | 'board' | 'library'

interface PlannerState {
  posts: Post[]
  loading: boolean
  view: PlannerView
  selectedId: string | null
  query: string
  load(): Promise<void>
  save(post: PostInput): Promise<Post>
  remove(id: string): Promise<void>
  move(id: string, status: PostStatus): Promise<void>
  setView(view: PlannerView): void
  select(id: string | null): void
  setQuery(query: string): void
}

export const usePlanner = create<PlannerState>((set, get) => ({
  posts: [],
  loading: true,
  view: 'timeline',
  selectedId: null,
  query: '',
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
}))

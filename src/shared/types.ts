export type Platform = 'instagram' | 'facebook' | 'x'
export type PostStatus = 'idea' | 'draft' | 'review' | 'approved' | 'scheduled' | 'published' | 'archived'
export type ContentType = 'reel' | 'carousel' | 'story' | 'post' | 'thread'

export interface Post {
  id: string
  title: string
  caption: string
  notes: string
  hashtags: string[]
  mentions: string[]
  platforms: Platform[]
  contentType: ContentType
  status: PostStatus
  scheduledAt: string | null
  durationMinutes: number
  project: string
  color: string
  media: MediaAsset[]
  createdAt: string
  updatedAt: string
}

export interface MediaAsset {
  id: string
  name: string
  path: string
  kind: 'image' | 'video' | 'document'
  size: number
  mode: 'copy' | 'reference'
}

export type PostInput = Omit<Post, 'id' | 'createdAt' | 'updatedAt' | 'media'> & { id?: string; media?: MediaAsset[] }

export interface DashboardStats { total: number; scheduled: number; drafts: number; published: number }

export interface ElectronAPI {
  posts: { list(): Promise<Post[]>; save(post: PostInput): Promise<Post>; remove(id: string): Promise<void> }
  media: { list(): Promise<MediaAsset[]>; choose(mode: 'copy' | 'reference'): Promise<MediaAsset[]>; reveal(path: string): Promise<void> }
  clipboard: { write(text: string): Promise<void> }
}

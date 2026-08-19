export type Platform = 'instagram' | 'facebook' | 'x'
export type PostStatus = 'idea' | 'draft' | 'review' | 'approved' | 'scheduled' | 'published' | 'archived'
export type ContentType = 'reel' | 'carousel' | 'story' | 'post' | 'thread'
export type IdeaStatus = 'inbox' | 'developing' | 'ready' | 'converted' | 'archived'
export type IdeaPriority = 'low' | 'normal' | 'high'
export type ConceptNodeKind = 'idea' | 'post' | 'resource'
export type ConceptRelation = 'references' | 'depends_on' | 'related'

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
  ideaBlocks: IdeaBlock[]
  sourceIdeaId: string | null
  createdAt: string
  updatedAt: string
}

export interface MediaAsset {
  id: string
  name: string
  kind: 'image' | 'video' | 'document'
  size: number
  mode: 'copy' | 'reference'
}

export interface IdeaBlock {
  id: string
  title: string
  text: string
}

export interface Idea {
  id: string
  space: string
  title: string
  body: string
  tags: string[]
  media: MediaAsset[]
  status: IdeaStatus
  priority: IdeaPriority
  dueDate: string | null
  postId: string | null
  createdAt: string
  updatedAt: string
}

export type IdeaInput = Omit<Idea, 'id' | 'createdAt' | 'updatedAt' | 'postId'> & { id?: string; postId?: string | null }

export type PostInput = Omit<Post, 'id' | 'createdAt' | 'updatedAt' | 'media' | 'ideaBlocks' | 'sourceIdeaId'> & { id?: string; media?: MediaAsset[]; ideaBlocks?: IdeaBlock[]; sourceIdeaId?: string | null }

export interface ConceptMapNode {
  id: string
  folderId: string | null
  kind: ConceptNodeKind
  sourceId: string | null
  title: string
  body: string
  x: number
  y: number
  createdAt: string
  updatedAt: string
}

export interface ConceptMapLink {
  id: string
  fromNodeId: string
  toNodeId: string
  relation: ConceptRelation
  createdAt: string
}

export interface ConceptMapFolder {
  id: string
  parentId: string | null
  name: string
  createdAt: string
  updatedAt: string
}

export type ConceptMapNodeInput = Omit<ConceptMapNode, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
export type ConceptMapLinkInput = Omit<ConceptMapLink, 'id' | 'createdAt'> & { id?: string }
export type ConceptMapFolderInput = Omit<ConceptMapFolder, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }

export interface DashboardStats { total: number; scheduled: number; drafts: number; published: number }

export type UpdateStatus = 'unavailable' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

export interface UpdateState {
  status: UpdateStatus
  message: string
  installedVersion: string
  availableVersion: string | null
  percent: number | null
  transferred: number | null
  total: number | null
}

export interface SystemInfo {
  version: string
  workspacePath: string
  backupsPath: string
  packaged: boolean
}

export interface Source {
  id: string
  name: string
  baseUrl: string
  method: 'GET' | 'POST'
  format: 'json' | 'ndjson' | 'csv'
  recordsPath: string | null
  bodyTemplate: string | null
  authType: 'none' | 'apiKey' | 'bearer' | 'basic'
  maxRecords: number
  targetProject: string
  importMode: 'post' | 'idea' | 'both'
  initialStatus: PostStatus
  createdAt: string
  updatedAt: string
  hasStoredCredentials: boolean
  hasStoredHeaders: boolean
  hasStoredAuth: boolean
}

export interface SourceDefinition {
  id: string
  sourceId: string
  fieldMap: { externalRef: string; title: string; sourceKindField: string; hashFields?: string[] }
  contentTypeMap: Record<string, string>
  customFieldDefaults: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ImportReport {
  new: number
  updated: number
  unchanged: number
  invalid: number
  total: number
}

export interface ContentRecord {
  id: string
  postId: string | null
  ideaId: string | null
  sourceId: string
  externalRef: string
  sourceKind: string
  contentHash: string
  raw: Record<string, unknown>
  normalized: Record<string, unknown>
  enriched: Record<string, unknown>
  suggestedTitle: string | null
  titleManuallyEdited: boolean
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
  lastSeenAt: string
}

export interface EnrichmentField { key: string; label: string; type: 'text' | 'textarea' }
export interface ContentTypeTemplate { id: string; contentType: string; fields: EnrichmentField[]; createdAt: string; updatedAt: string }
export interface ExportColumn { header: string; source: string; order: number }
export interface ExportProfile { id: string; name: string; appliesToContentType: string; columns: ExportColumn[]; createdAt: string; updatedAt: string }

export interface ElectronAPI {
  posts: {
    list(): Promise<Post[]>
    save(post: PostInput): Promise<Post>
    remove(id: string): Promise<void>
    reassignProject(fromProject: string, toProject: string): Promise<void>
  }
  sources: {
    list(): Promise<Source[]>
    save(source: unknown): Promise<Source>
    remove(id: string): Promise<void>
    applyDestination(id: string): Promise<{ total: number; postsMoved: number; ideasMoved: number; postsCreated: number; ideasCreated: number }>
    test(source: unknown): Promise<{ ok: boolean; bytes: number; status: number; statusText: string; contentType: string; sample: string; requestDetails: string; recordCount: number; fields: string[]; suggestion: { externalRef: string; title: string; sourceKindField: string; hashFields: string[]; contentTypeMap: Record<string, string> } | null; parseWarning: string }>
  }
  sourceDefinitions: {
    list(sourceId?: string): Promise<SourceDefinition[]>
    save(definition: unknown): Promise<SourceDefinition>
  }
  imports: {
    preview(sourceId: string, definitionId: string): Promise<{ previewId: string; truncated: boolean; records: Record<string, unknown>[]; report: { summary: ImportReport } }>
    confirm(previewId: string): Promise<ImportReport>
  }
  contentRecords: {
    list(sourceId?: string): Promise<ContentRecord[]>
    byPost(postId: string): Promise<ContentRecord | null>
    saveEnriched(record: { id: string; enriched: Record<string, unknown> }): Promise<ContentRecord>
  }
  contentTypeTemplates: {
    list(): Promise<ContentTypeTemplate[]>
    save(template: { id?: string; contentType: string; fields: EnrichmentField[] }): Promise<ContentTypeTemplate>
  }
  exportProfiles: {
    list(): Promise<ExportProfile[]>
    save(profile: { id?: string; name: string; appliesToContentType: string; columns: ExportColumn[] }): Promise<ExportProfile>
  }
  exports: {
    csv(sourceId: string | null, profileId: string, deltaOnly?: boolean, project?: string, status?: PostStatus): Promise<{ filename: string; csv: string; count: number; total: number; delta: boolean }>
  }
  ideas: {
    list(): Promise<Idea[]>
    save(idea: IdeaInput): Promise<Idea>
    remove(id: string): Promise<void>
    convert(id: string): Promise<{ idea: Idea; post: Post }>
  }
  conceptMap: {
    list(): Promise<{ nodes: ConceptMapNode[]; links: ConceptMapLink[]; folders: ConceptMapFolder[] }>
    saveNode(node: ConceptMapNodeInput): Promise<ConceptMapNode>
    removeNode(id: string): Promise<void>
    saveLink(link: ConceptMapLinkInput): Promise<ConceptMapLink>
    removeLink(id: string): Promise<void>
    saveFolder(folder: ConceptMapFolderInput): Promise<ConceptMapFolder>
    removeFolder(id: string): Promise<{ parentId: string | null }>
  }
  media: { list(): Promise<MediaAsset[]>; choose(mode: 'copy' | 'reference'): Promise<MediaAsset[]>; reveal(id: string): Promise<void>; imageUrl(id: string): string }
  clipboard: { write(text: string): Promise<void> }
  system: {
    info(): Promise<SystemInfo>
    openWorkspace(): Promise<string>
    openBackups(): Promise<string>
    createBackup(): Promise<string>
  }
  updates: {
    getState(): Promise<UpdateState>
    check(): Promise<UpdateState>
    download(): Promise<UpdateState>
    install(): Promise<boolean>
    onStateChange(listener: (state: UpdateState) => void): () => void
  }
}

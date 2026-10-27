import { contextBridge, ipcRenderer } from 'electron'
import type { IdeaAnalysisProgress } from './database/types'

let clusterRequestSequence = 0

contextBridge.exposeInMainWorld('planner', {
  mobileSync: {
    folder: () => ipcRenderer.invoke('mobile-sync:folder'),
    chooseFolder: () => ipcRenderer.invoke('mobile-sync:choose-folder'),
    exportCatalog: () => ipcRenderer.invoke('mobile-sync:export'),
    exportSelected: (postIds: string[]) => ipcRenderer.invoke('mobile-sync:export-selected', postIds),
    importEvents: () => ipcRenderer.invoke('mobile-sync:import'),
    history: () => ipcRenderer.invoke('mobile-sync:history'),
    status: () => ipcRenderer.invoke('mobile-sync:status'),
    publicationState: () => ipcRenderer.invoke('mobile-sync:publication-state'),
    reconcile: () => ipcRenderer.invoke('mobile-sync:reconcile'),
    openCatalogHistory: () => ipcRenderer.invoke('mobile-sync:open-catalog-history'),
    listCatalogBackups: () => ipcRenderer.invoke('mobile-sync:list-catalog-backups'),
    readCatalog: () => ipcRenderer.invoke('mobile-sync:read-catalog'),
    previewReconcile: () => ipcRenderer.invoke('mobile-sync:preview-reconcile'),
  },
  posts: {
    list: () => ipcRenderer.invoke('posts:list'),
    save: (post: unknown) => ipcRenderer.invoke('posts:save', post),
    remove: (id: string) => ipcRenderer.invoke('posts:remove', id),
    reassignProject: (fromProject: string, toProject: string) => ipcRenderer.invoke('posts:reassign-project', fromProject, toProject),
    uncombine: (id: string) => ipcRenderer.invoke('posts:uncombine', id),
  },
  workGroups: {
    list: () => ipcRenderer.invoke('work-groups:list'),
    save: (group: unknown) => ipcRenderer.invoke('work-groups:save', group),
    setPosts: (id: string, postIds: string[]) => ipcRenderer.invoke('work-groups:set-posts', id, postIds),
    setArchived: (id: string, archived: boolean) => ipcRenderer.invoke('work-groups:set-archived', id, archived),
    remove: (id: string) => ipcRenderer.invoke('work-groups:remove', id),
    compressMedia: (id: string) => ipcRenderer.invoke('work-groups:compress-media', id),
    restoreMedia: (id: string) => ipcRenderer.invoke('work-groups:restore-media', id),
    compressPostMedia: (id: string) => ipcRenderer.invoke('posts:compress-media', id),
    restorePostMedia: (id: string) => ipcRenderer.invoke('posts:restore-media', id),
  },
  catalog: {
    config: (scope?: string) => ipcRenderer.invoke('catalog:config', scope),
    saveConfig: (config: unknown) => ipcRenderer.invoke('catalog:save-config', config),
    sync: (postId: string, kind: 'resource' | 'resource_lite', dryRun?: boolean, publish?: boolean) => ipcRenderer.invoke('catalog:sync', postId, kind, dryRun, publish),
    syncState: (postId: string) => ipcRenderer.invoke('catalog:sync-state', postId),
    postFields: (postId: string) => ipcRenderer.invoke('catalog:post-fields', postId),
    savePostFields: (fields: unknown) => ipcRenderer.invoke('catalog:save-post-fields', fields),
  },
  sources: {
    list: () => ipcRenderer.invoke('sources:list'),
    save: (source: unknown) => ipcRenderer.invoke('sources:save', source),
    remove: (id: string) => ipcRenderer.invoke('sources:remove', id),
    applyDestination: (id: string) => ipcRenderer.invoke('sources:apply-destination', id),
    test: (source: unknown) => ipcRenderer.invoke('sources:test', source),
  },
  sourceDefinitions: {
    list: (sourceId?: string) => sourceId ? ipcRenderer.invoke('source-definitions:list', sourceId) : ipcRenderer.invoke('source-definitions:list'),
    save: (definition: unknown) => ipcRenderer.invoke('source-definitions:save', definition),
  },
  imports: {
    preview: (sourceId: string, definitionId: string) => ipcRenderer.invoke('imports:preview', sourceId, definitionId),
    confirm: (previewId: string) => ipcRenderer.invoke('imports:confirm', previewId),
  },
  contentRecords: {
    list: (sourceId?: string) => sourceId ? ipcRenderer.invoke('content-records:list', sourceId) : ipcRenderer.invoke('content-records:list'),
    byPost: (postId: string) => ipcRenderer.invoke('content-records:by-post', postId),
    saveEnriched: (record: unknown) => ipcRenderer.invoke('content-records:save-enriched', record),
  },
  contentTypeTemplates: {
    list: () => ipcRenderer.invoke('content-type-templates:list'),
    save: (template: unknown) => ipcRenderer.invoke('content-type-templates:save', template),
  },
  exportProfiles: {
    list: () => ipcRenderer.invoke('export-profiles:list'),
    save: (profile: unknown) => ipcRenderer.invoke('export-profiles:save', profile),
  },
  exports: {
    csv: (sourceId: string | null, profileId: string, deltaOnly?: boolean, project?: string, status?: string) => ipcRenderer.invoke('exports:csv', sourceId, profileId, deltaOnly, project, status),
  },
  ideas: {
    list: () => ipcRenderer.invoke('ideas:list'),
    save: (idea: unknown) => ipcRenderer.invoke('ideas:save', idea),
    saveMany: (ideas: unknown[]) => ipcRenderer.invoke('ideas:save-many', ideas),
    importHistory: () => ipcRenderer.invoke('ideas:import-history'),
    remove: (id: string) => ipcRenderer.invoke('ideas:remove', id),
    convert: (id: string) => ipcRenderer.invoke('ideas:convert', id),
    combine: (ids: string[]) => ipcRenderer.invoke('ideas:combine', ids),
    neighbors: (id: string, limit?: number, ignoredTerms?: string[], options?: unknown) => ipcRenderer.invoke('ideas:neighbors', id, limit, ignoredTerms, options),
    refreshEmbeddings: (ids?: string[], ignoredTerms?: string[], options?: unknown) => ipcRenderer.invoke('ideas:embeddings-refresh', ids, ignoredTerms, options),
    clusters: async (threshold?: number, ignoredTerms?: string[], options?: unknown, onProgress?: (progress: IdeaAnalysisProgress) => void) => {
      const requestId = `${Date.now()}-${++clusterRequestSequence}-${Math.random().toString(36).slice(2)}`
      const listener = (_event: Electron.IpcRendererEvent, update: IdeaAnalysisProgress & { requestId: string }) => {
        if (update.requestId === requestId) onProgress?.(update)
      }
      ipcRenderer.on('ideas:clusters:progress', listener)
      try {
        return await ipcRenderer.invoke('ideas:clusters', threshold, ignoredTerms, options, requestId)
      } finally {
        ipcRenderer.removeListener('ideas:clusters:progress', listener)
      }
    },
    analysisPreview: (ignoredTerms?: string[], options?: unknown) => ipcRenderer.invoke('ideas:analysis-preview', ignoredTerms, options),
    clustersList: () => ipcRenderer.invoke('ideas:clusters-list'),
  },
  conceptMap: {
    list: () => ipcRenderer.invoke('concept-map:list'),
    saveNode: (node: unknown) => ipcRenderer.invoke('concept-map:save-node', node),
    removeNode: (id: string) => ipcRenderer.invoke('concept-map:remove-node', id),
    saveLink: (link: unknown) => ipcRenderer.invoke('concept-map:save-link', link),
    removeLink: (id: string) => ipcRenderer.invoke('concept-map:remove-link', id),
    saveFolder: (folder: unknown) => ipcRenderer.invoke('concept-map:save-folder', folder),
    removeFolder: (id: string) => ipcRenderer.invoke('concept-map:remove-folder', id),
  },
  media: {
    list: () => ipcRenderer.invoke('media:list'),
    choose: (mode: 'copy' | 'reference', postId?: string, project?: string) => ipcRenderer.invoke('media:choose', mode, postId, project),
    scanPostFolder: (postId: string, project?: string) => ipcRenderer.invoke('media:scan-post-folder', postId, project),
    organizePost: (postId: string, project: string, assetIds: string[], groupName: string, renameFrom?: string) => ipcRenderer.invoke('media:organize-post', postId, project, assetIds, groupName, renameFrom),
    reveal: (id: string) => ipcRenderer.invoke('media:reveal', id),
    openFolder: (postId?: string, project?: string) => ipcRenderer.invoke('media:open-folder', postId, project),
    phoneExportFolder: () => ipcRenderer.invoke('media:phone-export-folder'),
    exportToPhone: (postId: string, options?: { chooseFolder?: boolean }) => ipcRenderer.invoke('media:export-to-phone', postId, options),
    imageUrl: (id: string) => `caballocci-media://asset/${encodeURIComponent(id)}`,
  },
  files: { readText: () => ipcRenderer.invoke('files:read-text') },
  clipboard: { write: (text: string) => ipcRenderer.invoke('clipboard:write', text) },
  preferences: { sync: (entries: Record<string, string>) => ipcRenderer.invoke('preferences:sync', entries), remove: (key: string) => ipcRenderer.invoke('preferences:remove', key) },
  system: {
    info: () => ipcRenderer.invoke('system:info'),
    openWorkspace: () => ipcRenderer.invoke('system:open-workspace'),
    openSpaceFolder: (space: string) => ipcRenderer.invoke('system:open-space-folder', space),
    openBackups: () => ipcRenderer.invoke('system:open-backups'),
    openSyncthingDownloads: () => ipcRenderer.invoke('system:open-syncthing-downloads'),
    openSyncthingUi: (url: string) => ipcRenderer.invoke('system:open-syncthing-ui', url),
    openMobileAppDownload: () => ipcRenderer.invoke('system:open-mobile-app-download'),
    createBackup: () => ipcRenderer.invoke('system:create-backup'),
  },
  updates: {
    getState: () => ipcRenderer.invoke('updates:get-state'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    openReleaseNotes: () => ipcRenderer.invoke('updates:open-release-notes'),
    onStateChange: (listener: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state)
      ipcRenderer.on('updates:state', handler)
      return () => ipcRenderer.removeListener('updates:state', handler)
    },
  },
})

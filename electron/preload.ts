import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('planner', {
  posts: {
    list: () => ipcRenderer.invoke('posts:list'),
    save: (post: unknown) => ipcRenderer.invoke('posts:save', post),
    remove: (id: string) => ipcRenderer.invoke('posts:remove', id),
    reassignProject: (fromProject: string, toProject: string) => ipcRenderer.invoke('posts:reassign-project', fromProject, toProject),
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
    remove: (id: string) => ipcRenderer.invoke('ideas:remove', id),
    convert: (id: string) => ipcRenderer.invoke('ideas:convert', id),
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
    choose: (mode: 'copy' | 'reference') => ipcRenderer.invoke('media:choose', mode),
    reveal: (id: string) => ipcRenderer.invoke('media:reveal', id),
    imageUrl: (id: string) => `caballocci-media://asset/${encodeURIComponent(id)}`,
  },
  clipboard: { write: (text: string) => ipcRenderer.invoke('clipboard:write', text) },
  system: {
    info: () => ipcRenderer.invoke('system:info'),
    openWorkspace: () => ipcRenderer.invoke('system:open-workspace'),
    openBackups: () => ipcRenderer.invoke('system:open-backups'),
    createBackup: () => ipcRenderer.invoke('system:create-backup'),
  },
  updates: {
    getState: () => ipcRenderer.invoke('updates:get-state'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStateChange: (listener: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state)
      ipcRenderer.on('updates:state', handler)
      return () => ipcRenderer.removeListener('updates:state', handler)
    },
  },
})

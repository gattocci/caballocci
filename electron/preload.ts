import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('planner', {
  posts: {
    list: () => ipcRenderer.invoke('posts:list'),
    save: (post: unknown) => ipcRenderer.invoke('posts:save', post),
    remove: (id: string) => ipcRenderer.invoke('posts:remove', id),
  },
  media: {
    list: () => ipcRenderer.invoke('media:list'),
    choose: (mode: 'copy' | 'reference') => ipcRenderer.invoke('media:choose', mode),
    reveal: (path: string) => ipcRenderer.invoke('media:reveal', path),
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

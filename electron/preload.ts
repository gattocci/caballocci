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
})

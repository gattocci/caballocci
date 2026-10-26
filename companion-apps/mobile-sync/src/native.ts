import { registerPlugin } from '@capacitor/core'

export interface SyncFolderPlugin {
  chooseFolder(): Promise<{ uri: string }>
  hasFolder(): Promise<{ selected: boolean }>
  getDeviceId(): Promise<{ deviceId: string }>
  readText(options: { path: string }): Promise<{ text: string }>
  readMedia(options: { path: string }): Promise<{ data: string; mimeType: string }>
  exists(options: { path: string }): Promise<{ exists: boolean }>
  storeEvent(options: { deviceId: string; eventId: string; content: string }): Promise<void>
  listLocalEvents(): Promise<{ events: string[] }>
  writeEvent(options: { deviceId: string; eventId: string; content: string }): Promise<{ path: string; alreadyExists: boolean }>
  deleteAlbum(options: { path: string }): Promise<{ deleted: boolean }>
}

export const SyncFolder = registerPlugin<SyncFolderPlugin>('SyncFolder')

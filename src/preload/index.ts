import { contextBridge, ipcRenderer } from 'electron'

export interface RendererApi {
  version: () => string
  createSession: () => Promise<string>
  chat: (sessionId: string, message: string) => Promise<string>
  getSettings: () => Promise<Record<string, unknown>>
  saveSettings: (settings: Record<string, unknown>) => Promise<{ ok: boolean }>
}

const api: RendererApi = {
  version: () => process.env['npm_package_version'] ?? '0.1.0',
  createSession: () => ipcRenderer.invoke('chat:create-session'),
  chat: (sessionId, message) => ipcRenderer.invoke('chat:message', sessionId, message),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings)
}

contextBridge.exposeInMainWorld('api', api)

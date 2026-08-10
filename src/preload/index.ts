import { contextBridge, ipcRenderer } from 'electron'

export interface ChatOptions {
  thinking?: 'enabled' | 'disabled'
  reasoningEffort?: 'low' | 'high' | 'max'
}

export interface FimInput {
  prompt: string
  suffix?: string
  maxTokens?: number
}

export interface RendererApi {
  version: () => string
  createSession: () => Promise<string>
  chat: (sessionId: string, message: string, options?: ChatOptions) => Promise<string>
  fim: (input: FimInput) => Promise<string>
  getSettings: () => Promise<Record<string, unknown>>
  saveSettings: (settings: Record<string, unknown>) => Promise<{ ok: boolean }>
}

const api: RendererApi = {
  version: () => process.env['npm_package_version'] ?? '0.1.0',
  createSession: () => ipcRenderer.invoke('chat:create-session'),
  chat: (sessionId, message, options) => ipcRenderer.invoke('chat:message', sessionId, message, options),
  fim: (input) => ipcRenderer.invoke('chat:fim', input),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings)
}

contextBridge.exposeInMainWorld('api', api)

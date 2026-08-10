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

export type StreamEvent =
  | { streamId: string; type: 'reasoning'; text: string }
  | { streamId: string; type: 'content'; text: string }
  | { streamId: string; type: 'done'; content: string; reasoningContent?: string }
  | { streamId: string; type: 'error'; message: string }

export interface RendererApi {
  version: () => string
  createSession: () => Promise<string>
  chat: (sessionId: string, message: string, options?: ChatOptions) => Promise<string>
  streamChat: (
    sessionId: string,
    message: string,
    options: ChatOptions | undefined,
    onEvent: (event: StreamEvent) => void
  ) => Promise<void>
  fim: (input: FimInput) => Promise<string>
  getSettings: () => Promise<Record<string, unknown>>
  saveSettings: (settings: Record<string, unknown>) => Promise<{ ok: boolean }>
}

const api: RendererApi = {
  version: () => process.env['npm_package_version'] ?? '0.1.0',
  createSession: () => ipcRenderer.invoke('chat:create-session'),
  chat: (sessionId, message, options) => ipcRenderer.invoke('chat:message', sessionId, message, options),
  streamChat: (sessionId, message, options, onEvent) => {
    const streamId = crypto.randomUUID()
    const channel = 'chat:stream'
    const listener = (_event: Electron.IpcRendererEvent, payload: StreamEvent): void => {
      if (payload.streamId !== streamId) return
      onEvent(payload)
      if (payload.type === 'done' || payload.type === 'error') {
        ipcRenderer.removeListener(channel, listener)
      }
    }
    ipcRenderer.on(channel, listener)
    return ipcRenderer.invoke('chat:stream:start', streamId, sessionId, message, options)
  },
  fim: (input) => ipcRenderer.invoke('chat:fim', input),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings)
}

contextBridge.exposeInMainWorld('api', api)

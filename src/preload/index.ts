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
  | { streamId: string; type: 'stopped'; content?: string; reasoningContent?: string }
  | { streamId: string; type: 'error'; message: string }

export interface StreamChatController {
  done: Promise<void>
  cancel: () => void
}

export interface ConversationMessage {
  role: string
  content: string
  reasoningContent?: string
}

export interface ConversationSummary {
  id: string
  workspaceId: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface Conversation extends ConversationSummary {
  messages: ConversationMessage[]
}

export interface RendererApi {
  version: () => string
  createSession: () => Promise<string>
  listConversations: () => Promise<ConversationSummary[]>
  loadConversation: (id: string) => Promise<Conversation | null>
  deleteConversation: (id: string) => Promise<{ ok: boolean }>
  deleteConversations: (ids: string[]) => Promise<{ ok: boolean }>
  chat: (sessionId: string, message: string, options?: ChatOptions) => Promise<string>
  streamChat: (
    sessionId: string,
    message: string,
    options: ChatOptions | undefined,
    onEvent: (event: StreamEvent) => void
  ) => StreamChatController
  fim: (input: FimInput) => Promise<string>
  getSettings: () => Promise<Record<string, unknown>>
  saveSettings: (settings: Record<string, unknown>) => Promise<{ ok: boolean }>
}

const api: RendererApi = {
  version: () => process.env['npm_package_version'] ?? '0.1.0',
  createSession: () => ipcRenderer.invoke('chat:create-session'),
  listConversations: () => ipcRenderer.invoke('chat:list-conversations'),
  loadConversation: (id) => ipcRenderer.invoke('chat:load-conversation', id),
  deleteConversation: (id) => ipcRenderer.invoke('chat:delete-conversation', id),
  deleteConversations: (ids) => ipcRenderer.invoke('chat:delete-conversations', ids),
  chat: (sessionId, message, options) => ipcRenderer.invoke('chat:message', sessionId, message, options),
  streamChat: (sessionId, message, options, onEvent) => {
    const streamId = crypto.randomUUID()
    const channel = 'chat:stream'
    const listener = (_event: Electron.IpcRendererEvent, payload: StreamEvent): void => {
      if (payload.streamId !== streamId) return
      onEvent(payload)
      if (payload.type === 'done' || payload.type === 'stopped' || payload.type === 'error') {
        ipcRenderer.removeListener(channel, listener)
      }
    }
    ipcRenderer.on(channel, listener)
    const done = ipcRenderer.invoke('chat:stream:start', streamId, sessionId, message, options)
    return {
      done,
      cancel: () => ipcRenderer.send('chat:stream:cancel', streamId)
    }
  },
  fim: (input) => ipcRenderer.invoke('chat:fim', input),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings)
}

contextBridge.exposeInMainWorld('api', api)

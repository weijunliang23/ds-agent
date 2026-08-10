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

declare global {
  interface Window {
    api: RendererApi
  }
}

export {}

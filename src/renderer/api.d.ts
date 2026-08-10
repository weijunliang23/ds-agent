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

declare global {
  interface Window {
    api: RendererApi
  }
}

export {}

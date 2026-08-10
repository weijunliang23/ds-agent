export interface RendererApi {
  version: () => string
  createSession: () => Promise<string>
  chat: (sessionId: string, message: string) => Promise<string>
  getSettings: () => Promise<Record<string, unknown>>
  saveSettings: (settings: Record<string, unknown>) => Promise<{ ok: boolean }>
}

declare global {
  interface Window {
    api: RendererApi
  }
}

export {}

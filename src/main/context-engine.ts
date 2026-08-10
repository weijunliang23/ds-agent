import type { ChatMessage } from './model-router'

export interface Session {
  id: string
  messages: ChatMessage[]
  createdAt: number
}

export interface ContextEngine {
  createSession(): Session
  appendMessage(sessionId: string, message: ChatMessage): void
  getHistory(sessionId: string): ChatMessage[]
}

export class MemoryContextEngine implements ContextEngine {
  private readonly sessions = new Map<string, Session>()

  createSession(): Session {
    const session: Session = {
      id: crypto.randomUUID(),
      messages: [],
      createdAt: Date.now()
    }
    this.sessions.set(session.id, session)
    return session
  }

  appendMessage(sessionId: string, message: ChatMessage): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`会话不存在：${sessionId}`)
    }
    session.messages.push({ ...message })
  }

  getHistory(sessionId: string): ChatMessage[] {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return []
    }
    return session.messages.map((m) => ({ ...m }))
  }
}

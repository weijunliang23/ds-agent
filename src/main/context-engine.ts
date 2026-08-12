import type { ChatMessage } from './model-router'
import { DEFAULT_CONTEXT_SETTINGS } from '../shared/config'

export interface Session {
  id: string
  messages: ChatMessage[]
  createdAt: number
}

// A retrievable snippet of historical context. Long messages are split into
// multiple chunks so retrieval can target the relevant paragraph only.
export interface ContextChunk {
  id: string // unique per session: `${sessionId}:${messageIndex}:${partIndex}`
  sessionId: string
  role: ChatMessage['role']
  text: string
  messageIndex: number
  partIndex: number
  createdAt: number
}

// Pluggable retrieval backend. Phase 3 ships the keyword strategy; an
// embedding-based strategy can be added later without touching the engine.
export interface RetrievalStrategy {
  index(chunk: ContextChunk): void
  search(query: string, topK: number, sessionId?: string): ContextChunk[]
  remove(sessionId: string): void
  clear(): void
}

export interface ContextEngine {
  createSession(): Session
  restoreSession(id: string, messages: ChatMessage[], createdAt: number): Session
  getSession(sessionId: string): Session | null
  removeSession(sessionId: string): void
  appendMessage(sessionId: string, message: ChatMessage): void
  getHistory(sessionId: string): ChatMessage[]
  retrieve(sessionId: string, query: string, topK: number): ContextChunk[]
  setRetrievalStrategy(strategy: RetrievalStrategy): void
  setChunkSize(size: number): void
}

// Split long text into ~chunkSize pieces, preferring a newline boundary so a
// chunk never splits a sentence if a nearby line break exists.
export function splitText(text: string, chunkSize: number): string[] {
  const parts: string[] = []
  let rest = text.trim()
  while (rest.length > chunkSize) {
    const window = rest.slice(0, chunkSize + 1)
    const newline = window.lastIndexOf('\n')
    const cutAt = newline > Math.floor(chunkSize / 2) ? newline + 1 : chunkSize
    const part = rest.slice(0, cutAt).trim()
    if (part !== '') parts.push(part)
    rest = rest.slice(cutAt).trim()
  }
  if (rest !== '') parts.push(rest)
  return parts
}

// BM25 tuning constants.
const BM25_K1 = 1.5
const BM25_B = 0.75

function isCjk(ch: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch)
}

// Tokenize text into searchable terms. Latin words are lowercased; Chinese
// has no whitespace separation, so runs of CJK characters are expanded into
// character bigrams, which works reasonably without an external tokenizer.
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (isCjk(ch)) {
      let j = i
      while (j < text.length && isCjk(text[j])) j++
      pushCjkTokens(tokens, text.slice(i, j))
      i = j
    } else if (/[a-zA-Z0-9_]/.test(ch)) {
      let j = i
      while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) j++
      tokens.push(text.slice(i, j).toLowerCase())
      i = j
    } else {
      i++
    }
  }
  return tokens
}

function pushCjkTokens(tokens: string[], run: string): void {
  if (run.length === 1) {
    tokens.push(run)
    return
  }
  for (let i = 0; i < run.length - 1; i++) {
    tokens.push(run.slice(i, i + 2))
  }
}

export class KeywordRetrievalStrategy implements RetrievalStrategy {
  private readonly chunks: ContextChunk[] = []
  private readonly lengths: number[] = []
  private readonly postings = new Map<string, Map<number, number>>()
  private readonly docFreq = new Map<string, number>()
  private totalLength = 0

  index(chunk: ContextChunk): void {
    const tf = new Map<string, number>()
    for (const token of tokenize(chunk.text)) {
      tf.set(token, (tf.get(token) ?? 0) + 1)
    }
    if (tf.size === 0) return

    const idx = this.chunks.length
    this.chunks.push(chunk)
    let len = 0
    for (const [token, count] of tf) {
      len += count
      this.docFreq.set(token, (this.docFreq.get(token) ?? 0) + 1)
      let posting = this.postings.get(token)
      if (!posting) {
        posting = new Map()
        this.postings.set(token, posting)
      }
      posting.set(idx, count)
    }
    this.lengths.push(len)
    this.totalLength += len
  }

  // Score chunks with BM25: idf * tf / (tf + k1*(1 - b + b*dl/avgdl)).
  search(query: string, topK: number, sessionId?: string): ContextChunk[] {
    if (this.chunks.length === 0) return []
    const queryTokens = [...new Set(tokenize(query))]
    if (queryTokens.length === 0) return []
    const n = this.chunks.length
    const avgdl = this.totalLength / n
    const scores = new Map<number, number>()

    for (const token of queryTokens) {
      const df = this.docFreq.get(token)
      if (df === undefined) continue
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
      const posting = this.postings.get(token)
      if (!posting) continue
      for (const [idx, tf] of posting) {
        const dl = this.lengths[idx]
        const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl))
        scores.set(idx, (scores.get(idx) ?? 0) + (idf * tf) / denom)
      }
    }

    return [...scores.entries()]
      .filter(([idx]) => sessionId === undefined || this.chunks[idx].sessionId === sessionId)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, topK)
      .map(([idx]) => this.chunks[idx])
  }

  remove(sessionId: string): void {
    const remaining = this.chunks.filter((c) => c.sessionId !== sessionId)
    this.clear()
    for (const chunk of remaining) {
      this.index(chunk)
    }
  }

  clear(): void {
    this.chunks.length = 0
    this.lengths.length = 0
    this.totalLength = 0
    this.postings.clear()
    this.docFreq.clear()
  }
}

export class MemoryContextEngine implements ContextEngine {
  private readonly sessions = new Map<string, Session>()
  private strategy: RetrievalStrategy = new KeywordRetrievalStrategy()
  private chunkSize: number

  constructor(chunkSize: number = DEFAULT_CONTEXT_SETTINGS.chunkSize) {
    this.chunkSize = chunkSize
  }

  setRetrievalStrategy(strategy: RetrievalStrategy): void {
    this.strategy = strategy
  }

  setChunkSize(size: number): void {
    this.chunkSize = size
  }

  createSession(): Session {
    const session: Session = {
      id: crypto.randomUUID(),
      messages: [],
      createdAt: Date.now()
    }
    this.sessions.set(session.id, session)
    return session
  }

  restoreSession(id: string, messages: ChatMessage[], createdAt: number): Session {
    const session: Session = {
      id,
      messages: messages.map((m) => ({ ...m })),
      createdAt
    }
    this.sessions.set(session.id, session)
    this.indexSession(session)
    return session
  }

  getSession(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.strategy.remove(sessionId)
  }

  appendMessage(sessionId: string, message: ChatMessage): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`会话不存在：${sessionId}`)
    }
    session.messages.push({ ...message })
    this.indexMessage(session, session.messages.length - 1)
  }

  getHistory(sessionId: string): ChatMessage[] {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return []
    }
    return session.messages.map((m) => ({ ...m }))
  }

  retrieve(sessionId: string, query: string, topK: number): ContextChunk[] {
    return this.strategy.search(query, topK, sessionId)
  }

  private indexSession(session: Session): void {
    session.messages.forEach((_message, messageIndex) => {
      this.indexMessage(session, messageIndex)
    })
  }

  private indexMessage(session: Session, messageIndex: number): void {
    const message = session.messages[messageIndex]
    if (typeof message.content !== 'string' || message.content === '') return
    const parts = splitText(message.content, this.chunkSize)
    parts.forEach((text, partIndex) => {
      this.strategy.index({
        id: `${session.id}:${messageIndex}:${partIndex}`,
        sessionId: session.id,
        role: message.role,
        text,
        messageIndex,
        partIndex,
        createdAt: session.createdAt
      })
    })
  }
}

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatMessage } from './model-router'

export const DEFAULT_WORKSPACE_ID = 'default'

export interface Conversation {
  id: string
  workspaceId: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export interface ConversationSummary {
  id: string
  workspaceId: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface ConversationStore {
  list(): Promise<ConversationSummary[]>
  get(id: string): Promise<Conversation | null>
  save(conversation: Conversation): Promise<void>
  delete(id: string): Promise<void>
  deleteMany(ids: string[]): Promise<void>
}

export function createConversation(
  id: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Conversation {
  const now = Date.now()
  return { id, workspaceId, title: '新对话', createdAt: now, updatedAt: now, messages: [] }
}

function toSummary(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    workspaceId: conversation.workspaceId,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length
  }
}

export class FileConversationStore implements ConversationStore {
  constructor(private readonly dir: string) {}

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`)
  }

  private async readById(id: string): Promise<Conversation | null> {
    try {
      const raw = await readFile(this.filePath(id), 'utf-8')
      const parsed = JSON.parse(raw) as Conversation
      if (typeof parsed?.id !== 'string' || !Array.isArray(parsed.messages)) {
        return null
      }
      return parsed
    } catch {
      return null
    }
  }

  async list(): Promise<ConversationSummary[]> {
    let files: string[]
    try {
      files = (await readdir(this.dir)).filter((name) => name.endsWith('.json'))
    } catch {
      return []
    }

    const summaries: ConversationSummary[] = []
    for (const file of files) {
      const conversation = await this.readById(file.slice(0, -'.json'.length))
      if (conversation) {
        summaries.push(toSummary(conversation))
      }
    }
    summaries.sort((a, b) => b.updatedAt - a.updatedAt)
    return summaries
  }

  async get(id: string): Promise<Conversation | null> {
    return this.readById(id)
  }

  async save(conversation: Conversation): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const tmpPath = join(this.dir, `${conversation.id}.${Date.now()}.tmp`)
    await writeFile(tmpPath, JSON.stringify(conversation, null, 2), 'utf-8')
    await rename(tmpPath, this.filePath(conversation.id))
  }

  async delete(id: string): Promise<void> {
    await rm(this.filePath(id), { force: true })
  }

  async deleteMany(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.delete(id)))
  }
}

export function createConversationStore(dir: string): ConversationStore {
  return new FileConversationStore(dir)
}

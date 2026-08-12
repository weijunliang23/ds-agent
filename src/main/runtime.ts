import { isConfigured, loadConfig, type AppConfig, type EnvLike } from '../shared/config'
import type { SettingsStore } from '../shared/settings'
import type { ContextEngine } from './context-engine'
import type { ChatMessage, ChatOptions, FimInput, ModelRouter } from './model-router'
import type { ToolExecutor } from './tools/executor'
import {
  createConversation,
  DEFAULT_WORKSPACE_ID,
  type Conversation,
  type ConversationStore,
  type ConversationSummary
} from './conversation-store'

// Prefix for the synthetic system block that carries retrieved historical
// snippets; kept separate from real system prompts so tests can assert on it.
const RETRIEVAL_CONTEXT_PREFIX = '以下是历史对话中与当前问题相关的片段：'

export type StreamMessageEvent =
  | { type: 'reasoning'; text: string }
  | { type: 'content'; text: string }
  | { type: 'done'; content: string; reasoningContent?: string }
  | { type: 'stopped'; content?: string; reasoningContent?: string }
  | { type: 'error'; message: string }
  | { type: 'tool:start'; name: string; arguments?: string }
  | { type: 'tool:done'; name: string; ok: boolean; content: string }

export interface Runtime {
  start(): Promise<void>
  stop(): Promise<void>
  createSession(): Promise<string>
  getConfig(): AppConfig
  reloadConfig(): Promise<void>
  listConversations(): Promise<ConversationSummary[]>
  loadConversation(id: string): Promise<Conversation | null>
  deleteConversation(id: string): Promise<void>
  deleteConversations(ids: string[]): Promise<void>
  handleMessage(sessionId: string, text: string, options?: ChatOptions): Promise<string>
  streamMessage(
    sessionId: string,
    text: string,
    options: ChatOptions | undefined,
    onEvent: (event: StreamMessageEvent) => void,
    signal?: AbortSignal
  ): Promise<void>
  fim(input: FimInput): Promise<string>
}

export class RuntimeImpl implements Runtime {
  private config: AppConfig | null = null
  private running = false

  constructor(
    private readonly router: ModelRouter,
    private readonly context: ContextEngine,
    private readonly store: SettingsStore,
    private readonly conversations: ConversationStore,
    private readonly env: EnvLike = process.env,
    private readonly tools: ToolExecutor | null = null
  ) {}

  async start(): Promise<void> {
    await this.reloadConfig()
    this.running = true
  }

  stop(): Promise<void> {
    this.running = false
    return Promise.resolve()
  }

  async createSession(): Promise<string> {
    const id = crypto.randomUUID()
    const conversation = createConversation(id, DEFAULT_WORKSPACE_ID)
    await this.conversations.save(conversation)
    this.context.restoreSession(id, [], conversation.createdAt)
    return id
  }

  getConfig(): AppConfig {
    if (!this.config) {
      throw new Error('Runtime 尚未启动')
    }
    return this.config
  }

  async reloadConfig(): Promise<void> {
    const settings = await this.store.load()
    this.config = loadConfig({ settings, env: this.env })
    this.context.setChunkSize(this.config.context.chunkSize)
  }

  async listConversations(): Promise<ConversationSummary[]> {
    return this.conversations.list()
  }

  async loadConversation(id: string): Promise<Conversation | null> {
    const conversation = await this.conversations.get(id)
    if (!conversation) {
      return null
    }
    this.context.restoreSession(conversation.id, conversation.messages, conversation.createdAt)
    return conversation
  }

  async deleteConversation(id: string): Promise<void> {
    await this.conversations.delete(id)
    this.context.removeSession(id)
  }

  async deleteConversations(ids: string[]): Promise<void> {
    await this.conversations.deleteMany(ids)
    for (const id of ids) {
      this.context.removeSession(id)
    }
  }

  async handleMessage(sessionId: string, text: string, options?: ChatOptions): Promise<string> {
    let content = ''
    await this.streamMessage(sessionId, text, options, (event) => {
      if (event.type === 'content') {
        content += event.text
      } else if (event.type === 'done') {
        content = event.content
      }
    })
    return content
  }

  async streamMessage(
    sessionId: string,
    text: string,
    options: ChatOptions | undefined,
    onEvent: (event: StreamMessageEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.running) {
      throw new Error('Runtime 尚未启动')
    }
    const config = this.getConfig()
    if (!isConfigured(config)) {
      throw new Error('未配置模型：请先在设置中填写 AppKey 与 API 地址')
    }

    this.context.appendMessage(sessionId, { role: 'user', content: text })

    const tools = this.tools?.listToolDefinitions() ?? []
    if (tools.length > 0) {
      await this.streamWithTools(sessionId, text, config, options, tools, onEvent, signal)
      return
    }

    const history = this.buildContextualMessages(sessionId, this.context.getHistory(sessionId), text, config)
    let partialContent = ''
    let partialReasoning = ''

    try {
      const result = await this.router.streamChat(history, config.llm.providers, options, {
        onReasoning: (delta) => {
          partialReasoning += delta
          onEvent({ type: 'reasoning', text: delta })
        },
        onContent: (delta) => {
          partialContent += delta
          onEvent({ type: 'content', text: delta })
        }
      }, signal)

      this.context.appendMessage(sessionId, {
        role: 'assistant',
        content: result.content,
        ...(result.reasoningContent ? { reasoningContent: result.reasoningContent } : {})
      })
      await this.persistConversation(sessionId, text)
      onEvent({
        type: 'done',
        content: result.content,
        ...(result.reasoningContent ? { reasoningContent: result.reasoningContent } : {})
      })
    } catch (err) {
      if (signal?.aborted) {
        if (partialContent !== '' || partialReasoning !== '') {
          this.context.appendMessage(sessionId, {
            role: 'assistant',
            content: partialContent,
            ...(partialReasoning !== '' ? { reasoningContent: partialReasoning } : {})
          })
          await this.persistConversation(sessionId, text)
        }
        onEvent({
          type: 'stopped',
          content: partialContent,
          ...(partialReasoning !== '' ? { reasoningContent: partialReasoning } : {})
        })
        return
      }
      throw err
    }
  }

  private async streamWithTools(
    sessionId: string,
    firstUserText: string,
    config: AppConfig,
    options: ChatOptions | undefined,
    definitions: ReturnType<NonNullable<ToolExecutor>['listToolDefinitions']>,
    onEvent: (event: StreamMessageEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const maxIterations = config.tools.maxIterations
    let history = this.buildContextualMessages(
      sessionId,
      this.context.getHistory(sessionId),
      firstUserText,
      config
    )

    try {
      for (let i = 0; i < maxIterations; i++) {
        if (signal?.aborted) {
          await this.persistConversation(sessionId, firstUserText)
          onEvent({ type: 'stopped' })
          return
        }

        const result = await this.router.chat(history, config.llm.providers, options, definitions, signal)

        if (result.toolCalls && result.toolCalls.length > 0) {
          this.context.appendMessage(sessionId, {
            role: 'assistant',
            content: result.content,
            ...(result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {}),
            ...(result.reasoningContent ? { reasoningContent: result.reasoningContent } : {})
          })
          for (const call of result.toolCalls) {
            onEvent({ type: 'tool:start', name: call.name, arguments: call.arguments })
            const executed = await this.tools!.execute(call.name, parseToolArguments(call.arguments))
            onEvent({
              type: 'tool:done',
              name: call.name,
              ok: executed.ok,
              content: executed.content
            })
            this.context.appendMessage(sessionId, {
              role: 'tool',
              content: executed.content,
              toolCallId: call.id
            })
          }
          history = this.buildContextualMessages(
            sessionId,
            this.context.getHistory(sessionId),
            firstUserText,
            config
          )
          continue
        }

        this.context.appendMessage(sessionId, {
          role: 'assistant',
          content: result.content,
          ...(result.reasoningContent ? { reasoningContent: result.reasoningContent } : {})
        })
        await this.persistConversation(sessionId, firstUserText)
        onEvent({
          type: 'done',
          content: result.content,
          ...(result.reasoningContent ? { reasoningContent: result.reasoningContent } : {})
        })
        return
      }

      onEvent({ type: 'error', message: `工具调用超过最大迭代次数（${maxIterations}），已停止` })
    } catch (err) {
      if (signal?.aborted) {
        await this.persistConversation(sessionId, firstUserText)
        onEvent({ type: 'stopped' })
        return
      }
      throw err
    }
  }

  // Build the model input: keep the recent window verbatim for coherence and
  // inject retrieved snippets from older history as a synthetic system block.
  private buildContextualMessages(
    sessionId: string,
    history: ChatMessage[],
    userText: string,
    config: AppConfig
  ): ChatMessage[] {
    const { retrievalEnabled, topK, recentWindow } = config.context
    const windowStart = Math.max(0, history.length - recentWindow)
    const recent = history.slice(windowStart)

    if (!retrievalEnabled || userText.trim() === '') {
      return recent
    }

    const chunks = this.context
      .retrieve(sessionId, userText, topK)
      .filter((c) => c.messageIndex < windowStart)

    if (chunks.length === 0) {
      return recent
    }

    const contextBlock = `${RETRIEVAL_CONTEXT_PREFIX}\n${chunks.map((c) => c.text).join('\n')}`
    return [{ role: 'system', content: contextBlock }, ...recent]
  }

  private async persistConversation(sessionId: string, firstUserText: string): Promise<void> {
    const session = this.context.getSession(sessionId)
    if (!session) {
      return
    }
    const existing = await this.conversations.get(sessionId)
    const fallbackTitle = firstUserText.trim() !== '' ? firstUserText.trim().slice(0, 20) : '新对话'
    const conversation: Conversation = {
      id: session.id,
      workspaceId: existing?.workspaceId ?? DEFAULT_WORKSPACE_ID,
      title: existing?.title && existing.title !== '新对话' ? existing.title : fallbackTitle,
      createdAt: existing?.createdAt ?? session.createdAt,
      updatedAt: Date.now(),
      messages: session.messages
    }
    await this.conversations.save(conversation)
  }

  async fim(input: FimInput): Promise<string> {
    if (!this.running) {
      throw new Error('Runtime 尚未启动')
    }
    const config = this.getConfig()
    if (!isConfigured(config)) {
      throw new Error('未配置模型：请先在设置中填写 AppKey 与 API 地址')
    }

    const result = await this.router.fim(input, config.llm.providers)
    return result.content
  }
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

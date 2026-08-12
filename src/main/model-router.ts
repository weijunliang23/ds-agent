import type { LlmProviderConfig, LlmSettings } from '../shared/config'

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  reasoningContent?: string
  toolCalls?: ToolCall[]
  toolCallId?: string
}

export interface ChatCompletionResult {
  content: string
  reasoningContent?: string
  toolCalls?: ToolCall[]
  // id of the provider that actually served the request (after fallback).
  usedProviderId?: string
}

export type ThinkingMode = 'enabled' | 'disabled'
export type ReasoningEffort = 'low' | 'high' | 'max'

export interface ChatOptions {
  thinking?: ThinkingMode
  reasoningEffort?: ReasoningEffort
}

export interface FimInput {
  prompt: string
  suffix?: string
  maxTokens?: number
}

export interface ChatFetcher {
  (url: string, init: RequestInit): Promise<Response>
}

export interface StreamHandlers {
  onReasoning(delta: string): void
  onContent(delta: string): void
}

const defaultFetch: ChatFetcher = (url, init) => fetch(url, init)

// Providers that are configured enough to attempt (apiKey + baseUrl present).
function usableProviders(providers: LlmProviderConfig[]): LlmProviderConfig[] {
  return providers.filter((p) => p.apiKey !== '' && p.baseUrl !== '')
}

function buildAggregateError(failures: string[], usable: LlmProviderConfig[]): Error {
  if (usable.length === 0) {
    return new Error('未配置模型：缺少 AppKey 或 API 地址')
  }
  return new Error(`模型请求全部失败：${failures.join('; ')}`)
}

export interface ModelRouter {
  chat(
    messages: ChatMessage[],
    providers: LlmProviderConfig[],
    options?: ChatOptions,
    tools?: ToolDefinition[],
    signal?: AbortSignal
  ): Promise<ChatCompletionResult>
  streamChat(
    messages: ChatMessage[],
    providers: LlmProviderConfig[],
    options: ChatOptions | undefined,
    handlers: StreamHandlers,
    signal?: AbortSignal
  ): Promise<ChatCompletionResult>
  fim(input: FimInput, providers: LlmProviderConfig[]): Promise<ChatCompletionResult>
}

function toApiMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    const out: Record<string, unknown> = {
      role: message.role,
      content: message.content
    }
    if (message.reasoningContent && message.reasoningContent !== '') {
      out['reasoning_content'] = message.reasoningContent
    }
    if (message.toolCalls && message.toolCalls.length > 0) {
      out['tool_calls'] = message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments }
      }))
    }
    if (message.toolCallId) {
      out['tool_call_id'] = message.toolCallId
    }
    return out
  })
}

function parseToolCalls(value: unknown): ToolCall[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const calls: ToolCall[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const call = item as Record<string, unknown>
    const fn = (call.function ?? {}) as Record<string, unknown>
    const name = typeof fn.name === 'string' ? fn.name : ''
    const args = typeof fn.arguments === 'string' ? fn.arguments : ''
    if (name === '') continue
    calls.push({ id: typeof call.id === 'string' ? call.id : '', name, arguments: args })
  }
  return calls.length > 0 ? calls : undefined
}

export class OpenAIModelRouter implements ModelRouter {
  constructor(private readonly fetchImpl: ChatFetcher = defaultFetch) {}

  private buildUrl(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, '')}${path}`
  }

  private async request(
    url: string,
    settings: LlmSettings,
    body: Record<string, unknown>,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    let res: Response
    try {
      const timeoutSignal = AbortSignal.timeout(settings.timeoutMs)
      const signal = externalSignal
        ? AbortSignal.any([externalSignal, timeoutSignal])
        : timeoutSignal
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify(body),
        signal
      })
    } catch (err) {
      const wrapped = new Error(
        `模型请求失败：${err instanceof Error ? err.message : String(err)}`
      )
      if (err instanceof Error) {
        wrapped.cause = err
      }
      throw wrapped
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      throw new Error(`模型请求失败：HTTP ${res.status} ${bodyText}`)
    }
    return res
  }

  // Try providers in order; each failed attempt is recorded and the next
  // provider is tried. Only when every provider fails is the aggregate error
  // thrown. Errors during the setup/parse phase count as an attempt failure,
  // so a malformed response also triggers fallback.
  async chat(
    messages: ChatMessage[],
    providers: LlmProviderConfig[],
    options?: ChatOptions,
    tools?: ToolDefinition[],
    signal?: AbortSignal
  ): Promise<ChatCompletionResult> {
    const usable = usableProviders(providers)
    const failures: string[] = []
    for (const provider of usable) {
      try {
        return await this.chatOnce(messages, provider, options, tools, signal)
      } catch (err) {
        failures.push(`${provider.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    throw buildAggregateError(failures, usable)
  }

  private async chatOnce(
    messages: ChatMessage[],
    settings: LlmProviderConfig,
    options: ChatOptions | undefined,
    tools: ToolDefinition[] | undefined,
    signal: AbortSignal | undefined
  ): Promise<ChatCompletionResult> {
    const body: Record<string, unknown> = {
      model: settings.model,
      messages: toApiMessages(messages)
    }
    if (tools && tools.length > 0) {
      body['tools'] = tools
    }
    if (options?.thinking) {
      body['thinking'] = { type: options.thinking }
      if (options.thinking === 'enabled') {
        body['reasoning_effort'] = options.reasoningEffort ?? 'high'
      }
    }

    const res = await this.request(
      this.buildUrl(settings.baseUrl, '/chat/completions'),
      settings,
      body,
      signal
    )
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown } }>
    }
    const message = data.choices?.[0]?.message
    const content = typeof message?.content === 'string' ? message.content : ''
    const toolCalls = parseToolCalls(message?.tool_calls)
    if (content === '' && !toolCalls) {
      throw new Error('模型返回格式异常：缺少 choices[0].message.content')
    }
    const reasoningContent = message?.reasoning_content
    return {
      content,
      ...(typeof reasoningContent === 'string' && reasoningContent !== ''
        ? { reasoningContent }
        : {}),
      ...(toolCalls ? { toolCalls } : {}),
      usedProviderId: settings.id
    }
  }

  // Streaming fallback only applies during the request setup phase (connect /
  // HTTP error / missing body). Once the stream starts, mid-stream errors are
  // not retried because partial output cannot be replayed on another provider.
  async streamChat(
    messages: ChatMessage[],
    providers: LlmProviderConfig[],
    options: ChatOptions | undefined,
    handlers: StreamHandlers,
    signal?: AbortSignal
  ): Promise<ChatCompletionResult> {
    const usable = usableProviders(providers)
    const failures: string[] = []
    for (const provider of usable) {
      let res: Response
      try {
        res = await this.requestStream(messages, provider, options, signal)
      } catch (err) {
        failures.push(`${provider.id}: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }
      return await this.parseStream(res, provider, handlers)
    }
    throw buildAggregateError(failures, usable)
  }

  private async requestStream(
    messages: ChatMessage[],
    settings: LlmProviderConfig,
    options: ChatOptions | undefined,
    signal: AbortSignal | undefined
  ): Promise<Response> {
    const body: Record<string, unknown> = {
      model: settings.model,
      messages: toApiMessages(messages),
      stream: true
    }
    if (options?.thinking) {
      body['thinking'] = { type: options.thinking }
      if (options.thinking === 'enabled') {
        body['reasoning_effort'] = options.reasoningEffort ?? 'high'
      }
    }

    const res = await this.request(
      this.buildUrl(settings.baseUrl, '/chat/completions'),
      settings,
      body,
      signal
    )
    if (!res.body) {
      throw new Error('模型返回格式异常：响应不支持流式读取')
    }
    return res
  }

  private async parseStream(
    res: Response,
    settings: LlmProviderConfig,
    handlers: StreamHandlers
  ): Promise<ChatCompletionResult> {
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let reasoningContent = ''
    let done = false

    try {
      while (!done) {
        const { done: readerDone, value } = await reader.read()
        if (readerDone) break
        buffer += decoder.decode(value, { stream: true })

        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          newlineIndex = buffer.indexOf('\n')

          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '') continue
          if (payload === '[DONE]') {
            done = true
            break
          }

          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { reasoning_content?: unknown; content?: unknown } }>
          }
          const delta = parsed.choices?.[0]?.delta
          if (delta && typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '') {
            reasoningContent += delta.reasoning_content
            handlers.onReasoning(delta.reasoning_content)
          }
          if (delta && typeof delta.content === 'string' && delta.content !== '') {
            content += delta.content
            handlers.onContent(delta.content)
          }
        }
      }
    } catch (err) {
      const wrapped = new Error(
        `模型请求失败：${err instanceof Error ? err.message : String(err)}`
      )
      if (err instanceof Error) {
        wrapped.cause = err
      }
      throw wrapped
    } finally {
      reader.releaseLock()
    }

    return {
      content,
      ...(reasoningContent !== '' ? { reasoningContent } : {}),
      usedProviderId: settings.id
    }
  }

  async fim(input: FimInput, providers: LlmProviderConfig[]): Promise<ChatCompletionResult> {
    const usable = usableProviders(providers)
    const failures: string[] = []
    for (const provider of usable) {
      try {
        return await this.fimOnce(input, provider)
      } catch (err) {
        failures.push(`${provider.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    throw buildAggregateError(failures, usable)
  }

  private async fimOnce(input: FimInput, settings: LlmProviderConfig): Promise<ChatCompletionResult> {
    const body: Record<string, unknown> = {
      model: settings.model,
      prompt: input.prompt
    }
    if (input.suffix !== undefined) {
      body['suffix'] = input.suffix
    }
    if (input.maxTokens !== undefined) {
      body['max_tokens'] = input.maxTokens
    }

    const res = await this.request(
      this.buildUrl(settings.baseUrl, '/beta/completions'),
      settings,
      body
    )
    const data = (await res.json()) as {
      choices?: Array<{ text?: unknown }>
    }
    const text = data.choices?.[0]?.text
    if (typeof text !== 'string') {
      throw new Error('FIM 返回格式异常：缺少 choices[0].text')
    }
    return { content: text, usedProviderId: settings.id }
  }
}

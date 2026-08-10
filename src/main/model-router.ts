import type { LlmSettings } from '../shared/config'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoningContent?: string
}

export interface ChatCompletionResult {
  content: string
  reasoningContent?: string
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

export interface ModelRouter {
  chat(
    messages: ChatMessage[],
    settings: LlmSettings,
    options?: ChatOptions
  ): Promise<ChatCompletionResult>
  streamChat(
    messages: ChatMessage[],
    settings: LlmSettings,
    options: ChatOptions | undefined,
    handlers: StreamHandlers
  ): Promise<ChatCompletionResult>
  fim(input: FimInput, settings: LlmSettings): Promise<ChatCompletionResult>
}

export class OpenAIModelRouter implements ModelRouter {
  constructor(private readonly fetchImpl: ChatFetcher = defaultFetch) {}

  private buildUrl(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, '')}${path}`
  }

  private assertConfigured(settings: LlmSettings): void {
    if (settings.apiKey === '') {
      throw new Error('未配置模型：缺少 AppKey')
    }
    if (settings.baseUrl === '') {
      throw new Error('未配置模型：缺少 API 地址')
    }
  }

  private async request(
    url: string,
    settings: LlmSettings,
    body: Record<string, unknown>
  ): Promise<Response> {
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(settings.timeoutMs)
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

  async chat(
    messages: ChatMessage[],
    settings: LlmSettings,
    options?: ChatOptions
  ): Promise<ChatCompletionResult> {
    this.assertConfigured(settings)

    const body: Record<string, unknown> = {
      model: settings.model,
      messages
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
      body
    )
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>
    }
    const message = data.choices?.[0]?.message
    const content = message?.content
    if (typeof content !== 'string') {
      throw new Error('模型返回格式异常：缺少 choices[0].message.content')
    }
    const reasoningContent = message?.reasoning_content
    return {
      content,
      ...(typeof reasoningContent === 'string' && reasoningContent !== ''
        ? { reasoningContent }
        : {})
    }
  }

  async streamChat(
    messages: ChatMessage[],
    settings: LlmSettings,
    options: ChatOptions | undefined,
    handlers: StreamHandlers
  ): Promise<ChatCompletionResult> {
    this.assertConfigured(settings)

    const body: Record<string, unknown> = {
      model: settings.model,
      messages,
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
      body
    )
    if (!res.body) {
      throw new Error('模型返回格式异常：响应不支持流式读取')
    }

    const reader = res.body.getReader()
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
      ...(reasoningContent !== '' ? { reasoningContent } : {})
    }
  }

  async fim(input: FimInput, settings: LlmSettings): Promise<ChatCompletionResult> {
    this.assertConfigured(settings)

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
    return { content: text }
  }
}

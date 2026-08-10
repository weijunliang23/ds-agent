import type { LlmSettings } from '../shared/config'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatCompletionResult {
  content: string
}

export interface ChatFetcher {
  (url: string, init: RequestInit): Promise<Response>
}

const defaultFetch: ChatFetcher = (url, init) => fetch(url, init)

export interface ModelRouter {
  chat(messages: ChatMessage[], settings: LlmSettings): Promise<ChatCompletionResult>
}

export class OpenAIModelRouter implements ModelRouter {
  constructor(private readonly fetchImpl: ChatFetcher = defaultFetch) {}

  async chat(messages: ChatMessage[], settings: LlmSettings): Promise<ChatCompletionResult> {
    if (settings.apiKey === '') {
      throw new Error('未配置模型：缺少 AppKey')
    }
    if (settings.baseUrl === '') {
      throw new Error('未配置模型：缺少 API 地址')
    }

    const base = settings.baseUrl.replace(/\/+$/, '')
    const url = `${base}/chat/completions`

    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.model,
          messages
        }),
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
      const body = await res.text().catch(() => '')
      throw new Error(`模型请求失败：HTTP ${res.status} ${body}`)
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error('模型返回格式异常：缺少 choices[0].message.content')
    }
    return { content }
  }
}

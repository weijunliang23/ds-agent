import { describe, expect, it, vi } from 'vitest'
import type { LlmSettings } from '../src/shared/config'
import { OpenAIModelRouter, type ChatFetcher, type ChatMessage } from '../src/main/model-router'

const settings: LlmSettings = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.com/v1/',
  model: 'deepseek-chat',
  timeoutMs: 1000
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(ok ? '' : JSON.stringify(body)),
    json: () => Promise.resolve(body)
  } as unknown as Response
}

function makeRouter(response: Response): { router: OpenAIModelRouter; fetchMock: ReturnType<typeof vi.fn<ChatFetcher>> } {
  const fetchMock = vi.fn<ChatFetcher>(() => Promise.resolve(response))
  return { router: new OpenAIModelRouter(fetchMock), fetchMock }
}

describe('OpenAIModelRouter', () => {
  it('拼接 baseUrl/chat/completions 并携带鉴权与消息', async () => {
    const { router, fetchMock } = makeRouter(
      jsonResponse({ choices: [{ message: { content: '你好' } }] })
    )
    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }]

    const result = await router.chat(messages, settings)

    expect(result.content).toBe('你好')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'deepseek-chat',
      messages
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('去掉 baseUrl 末尾斜杠', async () => {
    const { router, fetchMock } = makeRouter(jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    await router.chat([], { ...settings, baseUrl: 'https://api.example.com/v1/' })
    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toBe('https://api.example.com/v1/chat/completions')
  })

  it('HTTP 非 2xx 抛出可读错误', async () => {
    const { router } = makeRouter(jsonResponse({ error: { message: 'invalid key' } }, false, 401))
    await expect(router.chat([], settings)).rejects.toThrow(/HTTP 401/)
  })

  it('返回缺少 content 时抛出格式错误', async () => {
    const { router } = makeRouter(jsonResponse({ choices: [] }))
    await expect(router.chat([], settings)).rejects.toThrow(/格式异常/)
  })

  it('网络异常包装为中文错误', async () => {
    const fetchMock = vi.fn<ChatFetcher>(() => Promise.reject(new Error('ECONNRESET')))
    const router = new OpenAIModelRouter(fetchMock)
    await expect(router.chat([], settings)).rejects.toThrow(/模型请求失败：ECONNRESET/)
  })

  it('缺少 AppKey 或 baseUrl 时提前报错', async () => {
    const fetchMock = vi.fn<ChatFetcher>()
    const router = new OpenAIModelRouter(fetchMock)
    await expect(router.chat([], { ...settings, apiKey: '' })).rejects.toThrow(/AppKey/)
    await expect(router.chat([], { ...settings, baseUrl: '' })).rejects.toThrow(/API 地址/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('思考模式开启时发送 thinking 与 reasoning_effort 并解析 reasoning_content', async () => {
    const { router, fetchMock } = makeRouter(
      jsonResponse({ choices: [{ message: { content: '最终答案', reasoning_content: '思维链' } }] })
    )
    const result = await router.chat([{ role: 'user', content: 'hi' }], settings, {
      thinking: 'enabled',
      reasoningEffort: 'high'
    })

    expect(result.content).toBe('最终答案')
    expect(result.reasoningContent).toBe('思维链')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
      thinking: { type: 'enabled' },
      reasoning_effort: 'high'
    })
  })

  it('思考模式关闭时仅发送 thinking disabled', async () => {
    const { router, fetchMock } = makeRouter(
      jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    )
    await router.chat([], settings, { thinking: 'disabled' })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'deepseek-chat',
      messages: [],
      thinking: { type: 'disabled' }
    })
  })

  it('FIM 请求 /beta/completions 并读取 choices[0].text', async () => {
    const { router, fetchMock } = makeRouter(
      jsonResponse({ choices: [{ text: 'def fib(b):\n  return fib(b-1) + fib(b-2)' }] })
    )
    const result = await router.fim(
      { prompt: 'def fib(a):', suffix: '  return fib(a-1) + fib(a-2)', maxTokens: 128 },
      settings
    )

    expect(result.content).toBe('def fib(b):\n  return fib(b-1) + fib(b-2)')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/beta/completions')
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'deepseek-chat',
      prompt: 'def fib(a):',
      suffix: '  return fib(a-1) + fib(a-2)',
      max_tokens: 128
    })
  })

  it('FIM 不带后缀时省略 suffix 字段', async () => {
    const { router, fetchMock } = makeRouter(jsonResponse({ choices: [{ text: 'mid' }] }))
    await router.fim({ prompt: 'p' }, settings)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ model: 'deepseek-chat', prompt: 'p' })
  })

  it('FIM 缺少 text 时抛出格式错误', async () => {
    const { router } = makeRouter(jsonResponse({ choices: [] }))
    await expect(router.fim({ prompt: 'x' }, settings)).rejects.toThrow(/格式异常/)
  })

  it('FIM 未配置时提前报错', async () => {
    const fetchMock = vi.fn<ChatFetcher>()
    const router = new OpenAIModelRouter(fetchMock)
    await expect(router.fim({ prompt: 'x' }, { ...settings, apiKey: '' })).rejects.toThrow(/AppKey/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

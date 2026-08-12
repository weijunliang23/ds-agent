import { describe, expect, it, vi } from 'vitest'
import type { LlmProviderConfig } from '../src/shared/config'
import { OpenAIModelRouter, type ChatFetcher, type ChatMessage } from '../src/main/model-router'

const settings: LlmProviderConfig = {
  id: 'p1',
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

function streamResponse(lines: string[], ok = true, status = 200): Response {
  const encoder = new TextEncoder()
  return {
    ok,
    status,
    text: () => Promise.resolve(ok ? '' : 'err'),
    json: () => Promise.resolve({}),
    body: new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line))
        controller.close()
      }
    })
  } as unknown as Response
}

const noopHandlers = { onReasoning: () => {}, onContent: () => {} }

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

    const result = await router.chat(messages, [settings])

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
    await router.chat([], [{ ...settings, baseUrl: 'https://api.example.com/v1/' }])
    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toBe('https://api.example.com/v1/chat/completions')
  })

  it('HTTP 非 2xx 抛出可读错误', async () => {
    const { router } = makeRouter(jsonResponse({ error: { message: 'invalid key' } }, false, 401))
    await expect(router.chat([], [settings])).rejects.toThrow(/HTTP 401/)
  })

  it('返回缺少 content 时抛出格式错误', async () => {
    const { router } = makeRouter(jsonResponse({ choices: [] }))
    await expect(router.chat([], [settings])).rejects.toThrow(/格式异常/)
  })

  it('网络异常包装为中文错误', async () => {
    const fetchMock = vi.fn<ChatFetcher>(() => Promise.reject(new Error('ECONNRESET')))
    const router = new OpenAIModelRouter(fetchMock)
    await expect(router.chat([], [settings])).rejects.toThrow(/模型请求失败：ECONNRESET/)
  })

  it('缺少 AppKey 或 baseUrl 时提前报错', async () => {
    const fetchMock = vi.fn<ChatFetcher>()
    const router = new OpenAIModelRouter(fetchMock)
    await expect(router.chat([], [{ ...settings, apiKey: '' }])).rejects.toThrow(/AppKey/)
    await expect(router.chat([], [{ ...settings, baseUrl: '' }])).rejects.toThrow(/API 地址/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('思考模式开启时发送 thinking 与 reasoning_effort 并解析 reasoning_content', async () => {
    const { router, fetchMock } = makeRouter(
      jsonResponse({ choices: [{ message: { content: '最终答案', reasoning_content: '思维链' } }] })
    )
    const result = await router.chat([{ role: 'user', content: 'hi' }], [settings], {
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
    await router.chat([], [settings], { thinking: 'disabled' })
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
      [settings]
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
    await router.fim({ prompt: 'p' }, [settings])
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ model: 'deepseek-chat', prompt: 'p' })
  })

  it('FIM 缺少 text 时抛出格式错误', async () => {
    const { router } = makeRouter(jsonResponse({ choices: [] }))
    await expect(router.fim({ prompt: 'x' }, [settings])).rejects.toThrow(/格式异常/)
  })

  it('FIM 未配置时提前报错', async () => {
    const fetchMock = vi.fn<ChatFetcher>()
    const router = new OpenAIModelRouter(fetchMock)
    await expect(router.fim({ prompt: 'x' }, [{ ...settings, apiKey: '' }])).rejects.toThrow(/AppKey/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('streamChat 解析 SSE 增量并透传 reasoning/content', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"reasoning_content":"首先"}}]}\n',
      '\n',
      'data: {"choices":[{"delta":{"reasoning_content":"推理"}}]}\n',
      '\n',
      'data: {"choices":[{"delta":{"content":"最终"}}]}\n',
      '\n',
      'data: {"choices":[{"delta":{"content":"答案"}}]}\n',
      '\n',
      'data: [DONE]\n',
      '\n'
    ]
    const { router, fetchMock } = makeRouter(streamResponse(lines))
    const reasoningChunks: string[] = []
    const contentChunks: string[] = []

    const result = await router.streamChat([{ role: 'user', content: 'hi' }], [settings], undefined, {
      onReasoning: (delta) => reasoningChunks.push(delta),
      onContent: (delta) => contentChunks.push(delta)
    })

    expect(reasoningChunks).toEqual(['首先', '推理'])
    expect(contentChunks).toEqual(['最终', '答案'])
    expect(result.content).toBe('最终答案')
    expect(result.reasoningContent).toBe('首先推理')

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true
    })
  })

  it('streamChat 思考模式携带 thinking 与 reasoning_effort', async () => {
    const { router, fetchMock } = makeRouter(streamResponse(['data: [DONE]\n']))
    await router.streamChat([], [settings], { thinking: 'enabled', reasoningEffort: 'max' }, noopHandlers)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'deepseek-chat',
      messages: [],
      stream: true,
      thinking: { type: 'enabled' },
      reasoning_effort: 'max'
    })
  })

  it('streamChat 跨 chunk 切割时仍能完整解析', async () => {
    const first = 'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"del'
    const second = 'ta":{"content":"好"}}]}\n\ndata: [DONE]\n'
    const { router } = makeRouter(streamResponse([first, second]))
    const chunks: string[] = []
    await router.streamChat([], [settings], undefined, { onReasoning: () => {}, onContent: (d) => chunks.push(d) })
    expect(chunks).toEqual(['你', '好'])
  })

  it('streamChat HTTP 非 2xx 抛错', async () => {
    const { router } = makeRouter(streamResponse([''], false, 401))
    await expect(router.streamChat([], [settings], undefined, noopHandlers)).rejects.toThrow(/HTTP 401/)
  })

  it('streamChat 无 body 时抛格式错误', async () => {
    const fake = {
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({})
    } as unknown as Response
    const fetchMock = vi.fn<ChatFetcher>(() => Promise.resolve(fake))
    const router = new OpenAIModelRouter(fetchMock)
    await expect(router.streamChat([], [settings], undefined, noopHandlers)).rejects.toThrow(/格式异常/)
  })

  it('streamChat 外部 signal 中止时抛错', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn<ChatFetcher>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )
    const router = new OpenAIModelRouter(fetchMock)

    const promise = router.streamChat([], [settings], undefined, noopHandlers, controller.signal)
    controller.abort()
    await expect(promise).rejects.toThrow(/abort/i)
  })
})

const providerA = { id: 'primary', apiKey: 'k1', baseUrl: 'https://a.example.com/v1', model: 'm1', timeoutMs: 1000 }
const providerB = { id: 'backup', apiKey: 'k2', baseUrl: 'https://b.example.com/v1', model: 'm2', timeoutMs: 1000 }

describe('OpenAIModelRouter 多 provider 回退', () => {
  it('chat 第一个 provider 失败时回退到下一个并返回 usedProviderId', async () => {
    const fetchMock = vi
      .fn<ChatFetcher>()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'boom' } }, false, 500))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '备用回复' } }] }))
    const router = new OpenAIModelRouter(fetchMock)

    const result = await router.chat([{ role: 'user', content: 'hi' }], [providerA, providerB])
    expect(result.content).toBe('备用回复')
    expect(result.usedProviderId).toBe('backup')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map((c) => c[0] as string)
    expect(urls).toEqual([
      'https://a.example.com/v1/chat/completions',
      'https://b.example.com/v1/chat/completions'
    ])
  })

  it('chat 第一个成功时不触碰第二个 provider', async () => {
    const fetchMock = vi.fn<ChatFetcher>().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    const router = new OpenAIModelRouter(fetchMock)

    const result = await router.chat([], [providerA, providerB])
    expect(result.usedProviderId).toBe('primary')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('chat 全部 provider 失败时抛聚合错误', async () => {
    const fetchMock = vi.fn<ChatFetcher>().mockRejectedValue(new Error('ECONNRESET'))
    const router = new OpenAIModelRouter(fetchMock)

    await expect(router.chat([], [providerA, providerB])).rejects.toThrow(
      /模型请求全部失败：primary: .*; backup: .*/
    )
  })

  it('chat 跳过未配置的 provider（缺 baseUrl 不参与回退）', async () => {
    const fetchMock = vi.fn<ChatFetcher>().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }))
    const router = new OpenAIModelRouter(fetchMock)

    const result = await router.chat([], [
      { id: 'empty', apiKey: '', baseUrl: '', model: '', timeoutMs: 1000 },
      providerB
    ])
    expect(result.usedProviderId).toBe('backup')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('格式异常也会触发回退', async () => {
    const fetchMock = vi
      .fn<ChatFetcher>()
      .mockResolvedValueOnce(jsonResponse({ choices: [] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '正常' } }] }))
    const router = new OpenAIModelRouter(fetchMock)

    const result = await router.chat([], [providerA, providerB])
    expect(result.content).toBe('正常')
    expect(result.usedProviderId).toBe('backup')
  })

  it('streamChat 发起阶段失败回退到下一个 provider', async () => {
    const lines = ['data: {"choices":[{"delta":{"content":"备用"}}]}\n', '\n', 'data: [DONE]\n', '\n']
    const fetchMock = vi
      .fn<ChatFetcher>()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'down' } }, false, 503))
      .mockResolvedValueOnce(streamResponse(lines))
    const router = new OpenAIModelRouter(fetchMock)

    const chunks: string[] = []
    const result = await router.streamChat([], [providerA, providerB], undefined, {
      onReasoning: () => {},
      onContent: (d) => chunks.push(d)
    })
    expect(result.content).toBe('备用')
    expect(result.usedProviderId).toBe('backup')
    expect(chunks).toEqual(['备用'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('streamChat 流中途失败不回退（第二个 provider 不被调用）', async () => {
    const failingStream = {
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"choices":[{"delta":{"content":"部分"}}]}\n\n')
          )
          controller.error(new Error('stream broke'))
        }
      })
    } as unknown as Response
    const fetchMock = vi.fn<ChatFetcher>().mockResolvedValue(failingStream)
    const router = new OpenAIModelRouter(fetchMock)

    await expect(
      router.streamChat([], [providerA, providerB], undefined, noopHandlers)
    ).rejects.toThrow(/模型请求失败：stream broke/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fim 失败时回退到下一个 provider', async () => {
    const fetchMock = vi
      .fn<ChatFetcher>()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'x' } }, false, 500))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ text: '补全' }] }))
    const router = new OpenAIModelRouter(fetchMock)

    const result = await router.fim({ prompt: 'p' }, [providerA, providerB])
    expect(result.content).toBe('补全')
    expect(result.usedProviderId).toBe('backup')
  })
})

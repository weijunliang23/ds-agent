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

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: '读取文件',
      parameters: { type: 'object', properties: { path: { type: 'string' } } }
    }
  }
]

describe('OpenAIModelRouter chat with tools', () => {
  it('传入 tools 时请求体携带 tools 字段', async () => {
    const { router, fetchMock } = makeRouter(
      jsonResponse({ choices: [{ message: { content: '好' } }] })
    )
    await router.chat([{ role: 'user', content: 'hi' }], settings, undefined, tools)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.tools).toEqual(tools)
  })

  it('不传 tools 时请求体无 tools 字段', async () => {
    const { router, fetchMock } = makeRouter(
      jsonResponse({ choices: [{ message: { content: '好' } }] })
    )
    await router.chat([{ role: 'user', content: 'hi' }], settings)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.tools).toBeUndefined()
  })

  it('解析 tool_calls 响应', async () => {
    const { router } = makeRouter(
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"/a.txt"}' }
                }
              ]
            }
          }
        ]
      })
    )
    const result = await router.chat([{ role: 'user', content: 'hi' }], settings)
    expect(result.content).toBe('')
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'read_file', arguments: '{"path":"/a.txt"}' }
    ])
  })

  it('content 与 tool_calls 同时存在时都返回', async () => {
    const { router } = makeRouter(
      jsonResponse({
        choices: [
          {
            message: {
              content: '先做一步',
              tool_calls: [
                { id: 'c', type: 'function', function: { name: 'read_file', arguments: '{}' } }
              ]
            }
          }
        ]
      })
    )
    const result = await router.chat([], settings)
    expect(result.content).toBe('先做一步')
    expect(result.toolCalls).toHaveLength(1)
  })

  it('非法 tool_calls 项被忽略', async () => {
    const { router } = makeRouter(
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } },
                { id: 'b', type: 'function', function: { name: '', arguments: '{}' } },
                'garbage'
              ]
            }
          }
        ]
      })
    )
    const result = await router.chat([], settings)
    expect(result.toolCalls).toEqual([{ id: 'a', name: 'x', arguments: '{}' }])
  })

  it('既无 content 也无 tool_calls 时抛格式错误', async () => {
    const { router } = makeRouter(jsonResponse({ choices: [{ message: {} }] }))
    await expect(router.chat([], settings)).rejects.toThrow(/格式异常/)
  })

  it('消息按 API 形状序列化（tool_calls / tool_call_id / reasoning_content）', async () => {
    const { router, fetchMock } = makeRouter(
      jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    )
    const messages: ChatMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{}' }] },
      { role: 'tool', content: '结果', toolCallId: 'c1' },
      { role: 'assistant', content: '答', reasoningContent: '思' }
    ]
    await router.chat(messages, settings)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(init.body)) as { messages: Record<string, unknown>[] }
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }
        ]
      },
      { role: 'tool', content: '结果', tool_call_id: 'c1' },
      { role: 'assistant', content: '答', reasoning_content: '思' }
    ])
  })
})

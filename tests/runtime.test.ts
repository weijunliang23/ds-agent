import { describe, expect, it, vi } from 'vitest'
import { MemoryContextEngine } from '../src/main/context-engine'
import { RuntimeImpl } from '../src/main/runtime'
import type { ModelRouter } from '../src/main/model-router'
import { MemorySettingsStore } from '../src/shared/settings'
import {
  createConversation,
  type Conversation,
  type ConversationStore
} from '../src/main/conversation-store'

function makeConversationStore() {
  const data = new Map<string, Conversation>()
  const store: ConversationStore = {
    list: async () =>
      [...data.values()]
        .map((c) => ({
          id: c.id,
          workspaceId: c.workspaceId,
          title: c.title,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          messageCount: c.messages.length
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    get: async (id) => data.get(id) ?? null,
    save: async (c) => {
      data.set(c.id, { ...c, messages: [...c.messages] })
    },
    delete: async (id) => {
      data.delete(id)
    },
    deleteMany: async (ids) => {
      ids.forEach((id) => data.delete(id))
    }
  }
  return { store, data }
}

function makeRuntime(overrides?: {
  settings?: {
    llm?: Record<string, unknown>
    context?: Record<string, unknown>
    tools?: Record<string, unknown>
  }
  env?: Record<string, string>
}) {
  const store = new MemorySettingsStore(overrides?.settings ?? {})
  const router: ModelRouter = {
    chat: vi.fn().mockResolvedValue({ content: '助手回复' }),
    streamChat: vi.fn((_m, _s, _o, handlers) => {
      handlers.onContent('助手回复')
      return Promise.resolve({ content: '助手回复' })
    }),
    fim: vi.fn().mockResolvedValue({ content: '补全结果' })
  }
  const conversations = makeConversationStore()
  const runtime = new RuntimeImpl(
    router,
    new MemoryContextEngine(),
    store,
    conversations.store,
    overrides?.env ?? {}
  )
  return { runtime, store, router, conversations }
}

describe('RuntimeImpl', () => {
  it('start 后 createSession 返回会话 id 并持久化空对话', async () => {
    const { runtime, conversations } = makeRuntime({ settings: { llm: { apiKey: 'k', baseUrl: 'u' } } })
    await runtime.start()
    const id = await runtime.createSession()
    expect(id).toBeTypeOf('string')
    const conv = await conversations.store.get(id)
    expect(conv?.messages).toEqual([])
    expect(conv?.title).toBe('新对话')
  })

  it('未启动时 handleMessage 抛错', async () => {
    const { runtime } = makeRuntime()
    await expect(runtime.handleMessage('sid', 'hi')).rejects.toThrow(/未启动/)
  })

  it('未配置模型时抛出可读错误且不调用模型', async () => {
    const { runtime, router } = makeRuntime({ settings: {} })
    await runtime.start()
    const sid = await runtime.createSession()
    await expect(runtime.handleMessage(sid, 'hi')).rejects.toThrow(/未配置模型/)
    expect(router.streamChat).not.toHaveBeenCalled()
  })

  it('配置齐全时完整走通一轮对话并保存上下文', async () => {
    const { runtime, router } = makeRuntime({
      settings: { llm: { apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm' } }
    })
    await runtime.start()
    const sid = await runtime.createSession()

    const reply = await runtime.handleMessage(sid, '你好')
    expect(reply).toBe('助手回复')
    expect(router.streamChat).toHaveBeenCalledTimes(1)

    const args = vi.mocked(router.streamChat).mock.calls[0] as unknown[]
    expect((args[1] as Array<{ apiKey: string; baseUrl: string }>)[0]).toMatchObject({
      apiKey: 'k',
      baseUrl: 'https://api.example.com/v1'
    })
    expect((args[0] as Array<{ role: string; content: string }>).map((m) => m.content)).toEqual(['你好'])

    const reply2 = await runtime.handleMessage(sid, '还记得刚才吗')
    const secondCall = vi.mocked(router.streamChat).mock.calls[1] as unknown[]
    expect(
      (secondCall[0] as Array<{ role: string; content: string }>).map((m) => m.content)
    ).toEqual(['你好', '助手回复', '还记得刚才吗'])
    expect(reply2).toBe('助手回复')
  })

  it('streamMessage 结束后持久化对话并自动生成标题', async () => {
    const { runtime, conversations } = makeRuntime({ settings: { llm: { apiKey: 'k', baseUrl: 'u' } } })
    await runtime.start()
    const sid = await runtime.createSession()

    await runtime.streamMessage(sid, '你好世界', undefined, () => {})
    const conv = await conversations.store.get(sid)
    expect(conv?.title).toBe('你好世界')
    expect(conv?.messages.map((m) => m.content)).toEqual(['你好世界', '助手回复'])
  })

  it('loadConversation 读取历史并作为后续上下文', async () => {
    const { runtime, router, conversations } = makeRuntime({
      settings: { llm: { apiKey: 'k', baseUrl: 'u' } }
    })
    await runtime.start()

    const old = createConversation('old')
    old.messages = [{ role: 'user', content: '旧消息' }]
    await conversations.store.save(old)

    const loaded = await runtime.loadConversation('old')
    expect(loaded?.messages.map((m) => m.content)).toEqual(['旧消息'])

    await runtime.streamMessage('old', '新问题', undefined, () => {})
    const args = vi.mocked(router.streamChat).mock.calls[0] as unknown[]
    expect(
      (args[0] as Array<{ role: string; content: string }>).map((m) => m.content)
    ).toEqual(['旧消息', '新问题'])
  })

  it('loadConversation 不存在的 id 返回 null', async () => {
    const { runtime } = makeRuntime({ settings: { llm: { apiKey: 'k', baseUrl: 'u' } } })
    await runtime.start()
    expect(await runtime.loadConversation('missing')).toBeNull()
  })

  it('deleteConversation / deleteConversations 从存储移除', async () => {
    const { runtime, conversations } = makeRuntime({ settings: { llm: { apiKey: 'k', baseUrl: 'u' } } })
    await runtime.start()
    const a = await runtime.createSession()
    const b = await runtime.createSession()

    await runtime.deleteConversation(a)
    expect(await conversations.store.get(a)).toBeNull()
    expect(await conversations.store.get(b)).not.toBeNull()

    await runtime.deleteConversations([b, 'ghost'])
    expect(await conversations.store.get(b)).toBeNull()
  })

  it('settings 与 env 合并，设置值优先', async () => {
    const { runtime } = makeRuntime({
      settings: { llm: { apiKey: 'ui-key', baseUrl: 'ui-url' } },
      env: { LLM_API_KEY: 'env-key' }
    })
    await runtime.start()
    const config = runtime.getConfig()
    expect(config.llm.providers[0]?.apiKey).toBe('ui-key')
    expect(config.llm.providers[0]?.baseUrl).toBe('ui-url')
  })

  it('handleMessage 透传思考模式 options', async () => {
    const { runtime, router } = makeRuntime({
      settings: { llm: { apiKey: 'k', baseUrl: 'u' } }
    })
    await runtime.start()
    const sid = await runtime.createSession()

    await runtime.handleMessage(sid, 'hi', { thinking: 'enabled', reasoningEffort: 'max' })
    const args = vi.mocked(router.streamChat).mock.calls[0] as unknown[]
    expect(args[2]).toEqual({ thinking: 'enabled', reasoningEffort: 'max' })
  })

  it('streamMessage 透传 reasoning/content 事件并保存上下文', async () => {
    const { runtime, router } = makeRuntime({
      settings: { llm: { apiKey: 'k', baseUrl: 'u' } }
    })
    await runtime.start()
    const sid = await runtime.createSession()

    vi.mocked(router.streamChat).mockImplementation((_m, _s, _o, handlers) => {
      handlers.onReasoning('先想')
      handlers.onContent('答案')
      return Promise.resolve({ content: '答案', reasoningContent: '先想' })
    })

    const events: string[] = []
    await runtime.streamMessage(sid, '问', undefined, (event) => {
      events.push(event.type)
    })

    expect(events).toEqual(['reasoning', 'content', 'done'])

    await runtime.streamMessage(sid, '再问', undefined, () => {})
    const secondCall = vi.mocked(router.streamChat).mock.calls[1] as unknown[]
    expect(
      (secondCall[0] as Array<{ role: string; content: string }>).map((m) => m.content)
    ).toEqual(['问', '答案', '再问'])
  })

  it('streamMessage 被中止时发出 stopped 并持久化部分内容', async () => {
    const { runtime, router, conversations } = makeRuntime({
      settings: { llm: { apiKey: 'k', baseUrl: 'u' } }
    })
    await runtime.start()
    const sid = await runtime.createSession()

    const controller = new AbortController()
    vi.mocked(router.streamChat).mockImplementation(
      (_m, _s, _o, handlers, signal) =>
        new Promise((_resolve, reject) => {
          handlers.onContent('部分回答')
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )

    const events: string[] = []
    const promise = runtime.streamMessage(sid, '问', undefined, (event) => {
      events.push(event.type)
    }, controller.signal)
    controller.abort()
    await promise

    expect(events).toEqual(['content', 'stopped'])
    const conv = await conversations.store.get(sid)
    expect(conv?.messages.map((m) => m.content)).toEqual(['问', '部分回答'])
  })

  it('fim 调用模型补全并返回内容', async () => {
    const { runtime, router } = makeRuntime({
      settings: { llm: { apiKey: 'k', baseUrl: 'u' } }
    })
    await runtime.start()

    const reply = await runtime.fim({ prompt: 'def fib(a):', suffix: '  return', maxTokens: 128 })
    expect(reply).toBe('补全结果')
    const fimArgs = vi.mocked(router.fim).mock.calls[0] as unknown[]
    expect(fimArgs[0]).toEqual({ prompt: 'def fib(a):', suffix: '  return', maxTokens: 128 })
    expect((fimArgs[1] as Array<{ apiKey: string; baseUrl: string }>)[0]).toMatchObject({
      apiKey: 'k',
      baseUrl: 'u'
    })
  })

  it('未启动时 fim 抛错', async () => {
    const { runtime } = makeRuntime()
    await expect(runtime.fim({ prompt: 'x' })).rejects.toThrow(/未启动/)
  })

  it('reloadConfig 后新设置生效', async () => {
    const { runtime, store } = makeRuntime({       settings: { llm: { apiKey: 'old', baseUrl: 'old-url' } } })
    await runtime.start()
    expect(runtime.getConfig().llm.providers[0]?.apiKey).toBe('old')

    await store.save({ llm: { apiKey: 'new', baseUrl: 'new-url' } })
    await runtime.reloadConfig()
    expect(runtime.getConfig().llm.providers[0]?.apiKey).toBe('new')
  })
})

describe('RuntimeImpl 上下文检索注入', () => {
  function tenOldMessages(): Array<{ role: string; content: string }> {
    return [
      { role: 'user', content: '我们讨论过苹果的价格策略' },
      { role: 'assistant', content: '好的，记录下来了。' },
      { role: 'user', content: '再看看天气' },
      { role: 'assistant', content: '今天是晴天。' },
      { role: 'user', content: '明天的会议几点' },
      { role: 'assistant', content: '上午十点。' },
      { role: 'user', content: '帮我记一下会议事项' },
      { role: 'assistant', content: '已记录。' },
      { role: 'user', content: '还有什么要补充的' },
      { role: 'assistant', content: '暂时没有。' }
    ]
  }

  async function loadOldConversation(conversations: ReturnType<typeof makeConversationStore>) {
    const old = createConversation('old')
    old.messages = tenOldMessages()
    await conversations.store.save(old)
    return old.id
  }

  it('超过窗口时注入检索到的历史片段为 system 上下文块，窗口内原样保留', async () => {
    const { runtime, router, conversations } = makeRuntime({
      settings: { llm: { apiKey: 'k', baseUrl: 'u' } }
    })
    await runtime.start()
    await loadOldConversation(conversations)
    await runtime.loadConversation('old')

    await runtime.streamMessage('old', '现在聊聊苹果', undefined, () => {})
    const args = vi.mocked(router.streamChat).mock.calls[0] as unknown[]
    const messages = args[0] as Array<{ role: string; content: string }>

    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('苹果的价格策略')
    expect(messages[0].content).toContain('以下是历史对话中与当前问题相关的片段')
    expect(messages.length).toBe(1 + 8)
    expect(messages.slice(1).map((m) => m.content)).toEqual([
      '今天是晴天。',
      '明天的会议几点',
      '上午十点。',
      '帮我记一下会议事项',
      '已记录。',
      '还有什么要补充的',
      '暂时没有。',
      '现在聊聊苹果'
    ])
  })

  it('retrievalEnabled=false 时不注入 system 上下文块', async () => {
    const { runtime, router, conversations } = makeRuntime({
      settings: { llm: { apiKey: 'k', baseUrl: 'u' }, context: { retrievalEnabled: false } }
    })
    await runtime.start()
    await loadOldConversation(conversations)
    await runtime.loadConversation('old')

    await runtime.streamMessage('old', '现在聊聊苹果', undefined, () => {})
    const args = vi.mocked(router.streamChat).mock.calls[0] as unknown[]
    const messages = args[0] as Array<{ role: string; content: string }>
    expect(messages.every((m) => m.role !== 'system')).toBe(true)
  })

  it('检索无命中时不注入 system 块', async () => {
    const { runtime, router, conversations } = makeRuntime({
      settings: { llm: { apiKey: 'k', baseUrl: 'u' } }
    })
    await runtime.start()
    await loadOldConversation(conversations)
    await runtime.loadConversation('old')

    await runtime.streamMessage('old', '量子物理是什么', undefined, () => {})
    const args = vi.mocked(router.streamChat).mock.calls[0] as unknown[]
    const messages = args[0] as Array<{ role: string; content: string }>
    expect(messages.every((m) => m.role !== 'system')).toBe(true)
  })
})

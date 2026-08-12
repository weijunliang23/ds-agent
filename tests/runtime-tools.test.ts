import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { MemoryContextEngine } from '../src/main/context-engine'
import { RuntimeImpl } from '../src/main/runtime'
import type { ModelRouter } from '../src/main/model-router'
import { MemorySettingsStore } from '../src/shared/settings'
import { ToolRegistry } from '../src/main/tools/registry'
import { createFileTools } from '../src/main/tools/file-tools'
import { Permissions, type PermissionRequester } from '../src/main/tools/permissions'
import { ToolExecutor } from '../src/main/tools/executor'
import type { Conversation, ConversationStore } from '../src/main/conversation-store'
import { createConversation } from '../src/main/conversation-store'

const createdDirs: string[] = []

afterAll(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'my-agent-runtime-tools-'))
  createdDirs.push(dir)
  return dir
}

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

function makeToolRuntime(options: {
  workspace?: string
  writePolicy?: 'allow' | 'ask' | 'deny'
  maxIterations?: number
  requester?: PermissionRequester | null
}) {
  const workspace = options.workspace ?? ''
  const store = new MemorySettingsStore({
    llm: { apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm' },
    tools: {
      workspace,
      readPolicy: 'allow',
      writePolicy: options.writePolicy ?? 'ask',
      maxIterations: options.maxIterations ?? 8
    }
  })
  const router: ModelRouter = {
    chat: vi.fn(),
    streamChat: vi.fn(),
    fim: vi.fn()
  }
  const conversations = makeConversationStore()
  const registry = new ToolRegistry()
  registry.registerAll(createFileTools())
  const permissions = new Permissions(
    () => ({ workspace, readPolicy: 'allow', writePolicy: options.writePolicy ?? 'ask' }),
    options.requester ?? null
  )
  const executor = new ToolExecutor(registry, permissions, () => workspace)
  const runtime = new RuntimeImpl(
    router,
    new MemoryContextEngine(),
    store,
    conversations.store,
    {},
    executor
  )
  return { runtime, router, conversations }
}

describe('RuntimeImpl 工具调用循环', () => {
  it('模型调用 read_file 后把结果回喂并在最终答复返回', async () => {
    const dir = await makeTempDir()
    const file = join(dir, 'data.txt')
    await writeFile(file, 'HELLO内容', 'utf-8')

    const { runtime, router } = makeToolRuntime({ workspace: dir })
    await runtime.start()
    const sid = await runtime.createSession()

    vi.mocked(router.chat)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { id: 't1', name: 'read_file', arguments: JSON.stringify({ path: file }) }
        ]
      })
      .mockResolvedValueOnce({ content: '文件内容是 HELLO内容' })

    const reply = await runtime.handleMessage(sid, '读一下文件')
    expect(reply).toBe('文件内容是 HELLO内容')
    expect(vi.mocked(router.chat)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(router.streamChat)).not.toHaveBeenCalled()
  })

  it('工具调用事件透传且工具结果进入下一轮模型请求', async () => {
    const dir = await makeTempDir()
    const file = join(dir, 'data.txt')
    await writeFile(file, 'HELLO内容', 'utf-8')

    const { runtime, router } = makeToolRuntime({ workspace: dir })
    await runtime.start()
    const sid = await runtime.createSession()

    vi.mocked(router.chat)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { id: 't1', name: 'read_file', arguments: JSON.stringify({ path: file }) }
        ]
      })
      .mockResolvedValueOnce({ content: '文件内容是 HELLO内容' })

    const events: string[] = []
    await runtime.streamMessage(sid, '读一下文件', undefined, (event) => {
      events.push(event.type)
    })

    expect(events).toEqual(['tool:start', 'tool:done', 'done'])
    expect(vi.mocked(router.chat)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(router.streamChat)).not.toHaveBeenCalled()

    const secondCall = vi.mocked(router.chat).mock.calls[1] as unknown[]
    const toolMessages = (
      secondCall[0] as Array<{ role: string; toolCallId?: string; content: string }>
    ).filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0].toolCallId).toBe('t1')
    expect(toolMessages[0].content).toContain('HELLO内容')
  })

  it('写文件默认 ask，用户拒绝后模型收到无权限错误', async () => {
    const dir = await makeTempDir()
    const requester: PermissionRequester = { request: vi.fn().mockResolvedValue('deny') }
    const { runtime, router } = makeToolRuntime({ workspace: dir, writePolicy: 'ask', requester })
    await runtime.start()
    const sid = await runtime.createSession()

    vi.mocked(router.chat)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'w1',
            name: 'write_file',
            arguments: JSON.stringify({ path: join(dir, 'out.txt'), content: '秘密' })
          }
        ]
      })
      .mockResolvedValueOnce({ content: '好的，我不写入' })

    const toolDone: Array<{ ok: boolean; content: string }> = []
    await runtime.streamMessage(sid, '写个文件', undefined, (event) => {
      if (event.type === 'tool:done') {
        toolDone.push({ ok: event.ok, content: event.content })
      }
    })

    expect(toolDone[0].ok).toBe(false)
    expect(toolDone[0].content).toContain('无权限')

    const secondCall = vi.mocked(router.chat).mock.calls[1] as unknown[]
    const toolMessages = (secondCall[0] as Array<{ role: string; content: string }>).filter(
      (m) => m.role === 'tool'
    )
    expect(toolMessages[0].content).toContain('无权限')
  })

  it('写文件 ask + 允许后真正写入', async () => {
    const dir = await makeTempDir()
    const requester: PermissionRequester = { request: vi.fn().mockResolvedValue('allow') }
    const { runtime, router } = makeToolRuntime({ workspace: dir, writePolicy: 'ask', requester })
    await runtime.start()
    const sid = await runtime.createSession()

    vi.mocked(router.chat)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'w2',
            name: 'write_file',
            arguments: JSON.stringify({ path: join(dir, 'out.txt'), content: '落地内容' })
          }
        ]
      })
      .mockResolvedValueOnce({ content: '写入成功' })

    await runtime.streamMessage(sid, '写文件', undefined, () => {})

    expect(await readFile(join(dir, 'out.txt'), 'utf-8')).toBe('落地内容')
  })

  it('超过最大迭代次数发 error 事件', async () => {
    const dir = await makeTempDir()
    const { runtime, router } = makeToolRuntime({ workspace: dir, maxIterations: 2 })
    await runtime.start()
    const sid = await runtime.createSession()

    vi.mocked(router.chat).mockResolvedValue({
      content: '',
      toolCalls: [
        { id: 't', name: 'read_file', arguments: JSON.stringify({ path: join(dir, 'x.txt') }) }
      ]
    })

    const events: string[] = []
    await runtime.streamMessage(sid, '循环', undefined, (event) => {
      events.push(event.type)
    })

    expect(events).toContain('error')
    expect(events.filter((e) => e === 'tool:start')).toHaveLength(2)
  })

  it('工具循环超过最大迭代次数后会话被持久化', async () => {
    const dir = await makeTempDir()
    const { runtime, router, conversations } = makeToolRuntime({ workspace: dir, maxIterations: 2 })
    await runtime.start()
    const sid = await runtime.createSession()

    vi.mocked(router.chat).mockResolvedValue({
      content: '',
      toolCalls: [
        { id: 't', name: 'read_file', arguments: JSON.stringify({ path: join(dir, 'x.txt') }) }
      ]
    })

    await runtime.streamMessage(sid, '循环', undefined, () => {})
    const conv = await conversations.store.get(sid)
    expect(conv).not.toBeNull()
    expect(conv!.messages.map((m) => m.role)).toContain('tool')
    expect(conv!.messages.length).toBeGreaterThanOrEqual(5)
  })

  it('工具调用期间中止发出 stopped', async () => {
    const dir = await makeTempDir()
    const { runtime, router } = makeToolRuntime({ workspace: dir })
    await runtime.start()
    const sid = await runtime.createSession()

    vi.mocked(router.chat).mockImplementation(
      (_m, _s, _o, _t, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )

    const controller = new AbortController()
    const events: string[] = []
    const promise = runtime.streamMessage(sid, '问', undefined, (event) => {
      events.push(event.type)
    }, controller.signal)
    controller.abort()
    await promise

    expect(events).toEqual(['stopped'])
  })

  it('会话工具调用结果持久化后可读回', async () => {
    const dir = await makeTempDir()
    const file = join(dir, 'data.txt')
    await writeFile(file, '内容X', 'utf-8')

    const { runtime, router, conversations } = makeToolRuntime({ workspace: dir })
    await runtime.start()
    const sid = await runtime.createSession()

    vi.mocked(router.chat)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { id: 't1', name: 'read_file', arguments: JSON.stringify({ path: file }) }
        ]
      })
      .mockResolvedValueOnce({ content: '最终回复' })

    await runtime.handleMessage(sid, '读文件')

    const conv = await conversations.store.get(sid)
    expect(conv?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
  })

  it('工具调用循环首轮同样注入检索上下文', async () => {
    const dir = await makeTempDir()
    const file = join(dir, 'data.txt')
    await writeFile(file, 'HELLO内容', 'utf-8')

    const { runtime, router, conversations } = makeToolRuntime({ workspace: dir })
    await runtime.start()

    const old = createConversation('old')
    old.messages = [
      { role: 'user', content: '早前我们聊过项目计划' },
      { role: 'assistant', content: '是的，第一期已完成。' },
      { role: 'user', content: '记录下第二期目标' },
      { role: 'assistant', content: '已记录。' },
      { role: 'user', content: '还有别的吗' },
      { role: 'assistant', content: '暂时没有。' },
      { role: 'user', content: '测试环境就绪了吗' },
      { role: 'assistant', content: '已就绪。' },
      { role: 'user', content: '好' },
      { role: 'assistant', content: '好的。' }
    ]
    await conversations.store.save(old)
    await runtime.loadConversation('old')

    vi.mocked(router.chat)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 't1', name: 'read_file', arguments: JSON.stringify({ path: file }) }]
      })
      .mockResolvedValueOnce({ content: '完成' })

    await runtime.handleMessage('old', '聊聊项目，顺便读文件')

    const firstCall = vi.mocked(router.chat).mock.calls[0] as unknown[]
    const messages = firstCall[0] as Array<{ role: string; content: string }>
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('直接回答')
    expect(messages[1].role).toBe('system')
    expect(messages[1].content).toContain('项目计划')
  })

  it('未配置模型时工具路径同样拦截', async () => {
    const dir = await makeTempDir()
    const store = new MemorySettingsStore({})
    const router: ModelRouter = { chat: vi.fn(), streamChat: vi.fn(), fim: vi.fn() }
    const conversations = makeConversationStore()
    const registry = new ToolRegistry()
    registry.registerAll(createFileTools())
    const executor = new ToolExecutor(
      registry,
      new Permissions(() => ({ workspace: dir, readPolicy: 'allow', writePolicy: 'ask' }), null),
      () => dir
    )
    const runtime = new RuntimeImpl(
      router,
      new MemoryContextEngine(),
      store,
      conversations.store,
      {},
      executor
    )
    await runtime.start()
    const sid = await runtime.createSession()
    await expect(runtime.handleMessage(sid, 'hi')).rejects.toThrow(/未配置模型/)
    expect(vi.mocked(router.chat)).not.toHaveBeenCalled()
  })
})

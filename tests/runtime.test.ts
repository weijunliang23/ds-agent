import { describe, expect, it, vi } from 'vitest'
import { MemoryContextEngine } from '../src/main/context-engine'
import { RuntimeImpl } from '../src/main/runtime'
import type { ModelRouter } from '../src/main/model-router'
import { MemorySettingsStore } from '../src/shared/settings'

function makeRuntime(overrides?: {
  settings?: Record<string, unknown>
  env?: Record<string, string>
}) {
  const store = new MemorySettingsStore(overrides?.settings ?? {})
  const router: ModelRouter = {
    chat: vi.fn().mockResolvedValue({ content: '助手回复' }),
    fim: vi.fn().mockResolvedValue({ content: '补全结果' })
  }
  const runtime = new RuntimeImpl(router, new MemoryContextEngine(), store, overrides?.env ?? {})
  return { runtime, store, router }
}

describe('RuntimeImpl', () => {
  it('start 后 createSession 返回会话 id', async () => {
    const { runtime } = makeRuntime({ settings: { apiKey: 'k', baseUrl: 'u' } })
    await runtime.start()
    expect(runtime.createSession()).toBeTypeOf('string')
  })

  it('未启动时 handleMessage 抛错', async () => {
    const { runtime } = makeRuntime()
    await expect(runtime.handleMessage('sid', 'hi')).rejects.toThrow(/未启动/)
  })

  it('未配置模型时抛出可读错误且不调用模型', async () => {
    const { runtime, router } = makeRuntime({ settings: {} })
    await runtime.start()
    const sid = runtime.createSession()
    await expect(runtime.handleMessage(sid, 'hi')).rejects.toThrow(/未配置模型/)
    expect(router.chat).not.toHaveBeenCalled()
  })

  it('配置齐全时完整走通一轮对话并保存上下文', async () => {
    const { runtime, router } = makeRuntime({
      settings: { apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm' }
    })
    await runtime.start()
    const sid = runtime.createSession()

    const reply = await runtime.handleMessage(sid, '你好')
    expect(reply).toBe('助手回复')
    expect(router.chat).toHaveBeenCalledTimes(1)

    const args = vi.mocked(router.chat).mock.calls[0] as unknown[]
    expect(args[1]).toMatchObject({ apiKey: 'k', baseUrl: 'https://api.example.com/v1' })
    expect((args[0] as Array<{ role: string; content: string }>).map((m) => m.content)).toEqual(['你好'])

    const reply2 = await runtime.handleMessage(sid, '还记得刚才吗')
    const secondCall = vi.mocked(router.chat).mock.calls[1] as unknown[]
    expect(
      (secondCall[0] as Array<{ role: string; content: string }>).map((m) => m.content)
    ).toEqual(['你好', '助手回复', '还记得刚才吗'])
    expect(reply2).toBe('助手回复')
  })

  it('settings 与 env 合并，设置值优先', async () => {
    const { runtime } = makeRuntime({
      settings: { apiKey: 'ui-key', baseUrl: 'ui-url' },
      env: { LLM_API_KEY: 'env-key' }
    })
    await runtime.start()
    const config = runtime.getConfig()
    expect(config.llm.apiKey).toBe('ui-key')
    expect(config.llm.baseUrl).toBe('ui-url')
  })

  it('handleMessage 透传思考模式 options', async () => {
    const { runtime, router } = makeRuntime({
      settings: { apiKey: 'k', baseUrl: 'u' }
    })
    await runtime.start()
    const sid = runtime.createSession()

    await runtime.handleMessage(sid, 'hi', { thinking: 'enabled', reasoningEffort: 'max' })
    const args = vi.mocked(router.chat).mock.calls[0] as unknown[]
    expect(args[2]).toEqual({ thinking: 'enabled', reasoningEffort: 'max' })
  })

  it('fim 调用模型补全并返回内容', async () => {
    const { runtime, router } = makeRuntime({
      settings: { apiKey: 'k', baseUrl: 'u' }
    })
    await runtime.start()

    const reply = await runtime.fim({ prompt: 'def fib(a):', suffix: '  return', maxTokens: 128 })
    expect(reply).toBe('补全结果')
    expect(vi.mocked(router.fim).mock.calls[0]).toEqual([
      { prompt: 'def fib(a):', suffix: '  return', maxTokens: 128 },
      expect.objectContaining({ apiKey: 'k', baseUrl: 'u' })
    ])
  })

  it('未启动时 fim 抛错', async () => {
    const { runtime } = makeRuntime()
    await expect(runtime.fim({ prompt: 'x' })).rejects.toThrow(/未启动/)
  })

  it('reloadConfig 后新设置生效', async () => {
    const { runtime, store } = makeRuntime({ settings: { apiKey: 'old', baseUrl: 'old-url' } })
    await runtime.start()
    expect(runtime.getConfig().llm.apiKey).toBe('old')

    await store.save({ apiKey: 'new', baseUrl: 'new-url' })
    await runtime.reloadConfig()
    expect(runtime.getConfig().llm.apiKey).toBe('new')
  })
})

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMEOUT_MS,
  isConfigured,
  loadConfig,
  type StoredSettings
} from '../src/shared/config'

const env = {
  LLM_API_KEY: 'env-key',
  LLM_BASE_URL: 'https://env.example.com/v1',
  LLM_MODEL: 'env-model',
  LLM_TIMEOUT_MS: '30000'
}

describe('loadConfig providers', () => {
  it('providers 数组按序加载', () => {
    const settings: StoredSettings = {
      llm: {
        providers: [
          { id: 'a', apiKey: 'ka', baseUrl: 'https://a.example.com/v1', model: 'm-a', timeoutMs: 5000 },
          { id: 'b', apiKey: 'kb', baseUrl: 'https://b.example.com/v1' }
        ]
      }
    }
    const config = loadConfig({ settings, env })
    expect(config.llm.providers).toHaveLength(2)
    expect(config.llm.providers[0]).toMatchObject({
      id: 'a',
      apiKey: 'ka',
      baseUrl: 'https://a.example.com/v1',
      model: 'm-a',
      timeoutMs: 5000
    })
    expect(config.llm.providers[1]).toMatchObject({ id: 'b', apiKey: 'kb' })
  })

  it('缺少 id 的 provider 自动补默认 id', () => {
    const config = loadConfig({
      settings: { llm: { providers: [{ apiKey: 'k', baseUrl: 'u' }] } },
      env: {}
    })
    expect(config.llm.providers[0].id).toBe('provider-1')
  })

  it('环境变量仅兜底主 provider（第一个）的空字段', () => {
    const config = loadConfig({
      settings: {
        llm: {
          providers: [
            { id: 'a', apiKey: 'ka' },
            { id: 'b', apiKey: 'kb', baseUrl: 'https://b.example.com/v1' }
          ]
        }
      },
      env
    })
    expect(config.llm.providers[0].baseUrl).toBe('https://env.example.com/v1')
    expect(config.llm.providers[0].model).toBe('env-model')
    expect(config.llm.providers[0].timeoutMs).toBe(30000)
    expect(config.llm.providers[1].baseUrl).toBe('https://b.example.com/v1')
    expect(config.llm.providers[1].model).toBe('')
  })

  it('设置值优先于环境变量，不覆盖已填字段', () => {
    const config = loadConfig({
      settings: { llm: { providers: [{ id: 'a', apiKey: 'ui-key', baseUrl: 'https://ui.example.com/v1' }] } },
      env
    })
    expect(config.llm.providers[0].apiKey).toBe('ui-key')
    expect(config.llm.providers[0].baseUrl).toBe('https://ui.example.com/v1')
    expect(config.llm.providers[0].model).toBe('env-model')
  })

  it('旧单 provider 字段迁移为 default provider', () => {
    const settings: StoredSettings = {
      llm: { apiKey: 'old-key', baseUrl: 'https://old.example.com/v1' }
    }
    const config = loadConfig({ settings, env })
    expect(config.llm.providers).toHaveLength(1)
    expect(config.llm.providers[0]).toMatchObject({
      id: 'default',
      apiKey: 'old-key',
      baseUrl: 'https://old.example.com/v1',
      model: 'env-model'
    })
  })

  it('无设置时用环境变量构建 provider', () => {
    const config = loadConfig({ settings: {}, env })
    expect(config.llm.providers[0]).toMatchObject({
      id: 'default',
      apiKey: 'env-key',
      baseUrl: 'https://env.example.com/v1',
      model: 'env-model',
      timeoutMs: 30000
    })
  })

  it('全部缺失时 providers 为空，用默认超时', () => {
    const config = loadConfig({ settings: {}, env: {} })
    expect(config.llm.providers).toEqual([])
  })

  it('非法超时回退默认值', () => {
    const bad = loadConfig({ settings: { llm: { providers: [{ apiKey: 'k', timeoutMs: -1 }] } }, env: {} })
    expect(bad.llm.providers[0].timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    const nan = loadConfig({ settings: {}, env: { LLM_API_KEY: 'k', LLM_BASE_URL: 'u', LLM_TIMEOUT_MS: 'abc' } })
    expect(nan.llm.providers[0].timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('isConfigured 判定至少一个 provider 可调用', () => {
    expect(isConfigured(loadConfig({ settings: { llm: { providers: [{ apiKey: 'k', baseUrl: 'u' }] } }, env: {} }))).toBe(true)
    expect(isConfigured(loadConfig({ settings: { llm: { providers: [{ apiKey: 'k' }] } }, env: {} }))).toBe(false)
    expect(isConfigured(loadConfig({ settings: {}, env }))).toBe(true)
    expect(isConfigured(loadConfig({ settings: {}, env: {} }))).toBe(false)
  })
})

describe('loadConfig context', () => {
  it('context 默认值为开关开/topK3/窗口8/切分500', () => {
    const config = loadConfig({ settings: {}, env: {} })
    expect(config.context).toEqual({
      retrievalEnabled: true,
      topK: 3,
      recentWindow: 8,
      chunkSize: 500
    })
  })

  it('context 设置值优先于环境变量', () => {
    const config = loadConfig({
      settings: { context: { retrievalEnabled: false, topK: 5, recentWindow: 16, chunkSize: 800 } },
      env: { CONTEXT_TOP_K: '10', CONTEXT_RECENT_WINDOW: '20' }
    })
    expect(config.context.retrievalEnabled).toBe(false)
    expect(config.context.topK).toBe(5)
    expect(config.context.recentWindow).toBe(16)
    expect(config.context.chunkSize).toBe(800)
  })

  it('context 缺失时回退环境变量', () => {
    const config = loadConfig({
      settings: {},
      env: { CONTEXT_RETRIEVAL_ENABLED: 'false', CONTEXT_TOP_K: '6', CONTEXT_RECENT_WINDOW: '12' }
    })
    expect(config.context.retrievalEnabled).toBe(false)
    expect(config.context.topK).toBe(6)
    expect(config.context.recentWindow).toBe(12)
  })

  it('越界的 topK/窗口回退默认值', () => {
    const config = loadConfig({ settings: { context: { topK: 99, recentWindow: -1, chunkSize: 1 } }, env: {} })
    expect(config.context.topK).toBe(3)
    expect(config.context.recentWindow).toBe(8)
    expect(config.context.chunkSize).toBe(500)
  })
})

describe('loadConfig tools', () => {
  it('tools 默认值为 ask/ask/空工作区/8 次', () => {
    const config = loadConfig({ settings: {}, env: {} })
    expect(config.tools).toEqual({
      workspace: '',
      readPolicy: 'ask',
      writePolicy: 'ask',
      maxIterations: 8
    })
  })

  it('tools 设置值优先于环境变量', () => {
    const config = loadConfig({
      settings: {
        tools: { workspace: 'D:/work', readPolicy: 'allow', writePolicy: 'deny', maxIterations: 12 }
      },
      env: { TOOLS_WORKSPACE: 'E:/env' }
    })
    expect(config.tools.workspace).toBe('D:/work')
    expect(config.tools.readPolicy).toBe('allow')
    expect(config.tools.writePolicy).toBe('deny')
    expect(config.tools.maxIterations).toBe(12)
  })

  it('tools 缺失时回退环境变量', () => {
    const config = loadConfig({
      settings: {},
      env: { TOOLS_WORKSPACE: 'D:/work', TOOLS_WRITE_POLICY: 'deny', TOOLS_MAX_ITERATIONS: '20' }
    })
    expect(config.tools.workspace).toBe('D:/work')
    expect(config.tools.writePolicy).toBe('deny')
    expect(config.tools.maxIterations).toBe(20)
  })

  it('非法策略与迭代次数回退默认值', () => {
    const config = loadConfig({
      settings: { tools: { readPolicy: 'bogus' as never, writePolicy: 'allow', maxIterations: 99 } },
      env: {}
    })
    expect(config.tools.readPolicy).toBe('ask')
    expect(config.tools.writePolicy).toBe('allow')
    expect(config.tools.maxIterations).toBe(8)
  })
})

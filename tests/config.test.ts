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

describe('loadConfig', () => {
  it('设置值优先于环境变量', () => {
    const settings: StoredSettings = {
      llm: { apiKey: 'ui-key', baseUrl: 'https://ui.example.com/v1' }
    }
    const config = loadConfig({ settings, env })
    expect(config.llm.apiKey).toBe('ui-key')
    expect(config.llm.baseUrl).toBe('https://ui.example.com/v1')
    expect(config.llm.model).toBe('env-model')
  })

  it('设置缺失时回退环境变量', () => {
    const config = loadConfig({ settings: {}, env })
    expect(config.llm.apiKey).toBe('env-key')
    expect(config.llm.baseUrl).toBe('https://env.example.com/v1')
    expect(config.llm.model).toBe('env-model')
    expect(config.llm.timeoutMs).toBe(30000)
  })

  it('全部缺失时用内置默认值', () => {
    const config = loadConfig({ settings: {}, env: {} })
    expect(config.llm.apiKey).toBe('')
    expect(config.llm.baseUrl).toBe('')
    expect(config.llm.model).toBe('')
    expect(config.llm.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('设置里的数字超时优先', () => {
    const config = loadConfig({ settings: { llm: { timeoutMs: 15000 } }, env })
    expect(config.llm.timeoutMs).toBe(15000)
  })

  it('非法超时回退默认值', () => {
    const bad = loadConfig({ settings: { llm: { timeoutMs: -1 } }, env: {} })
    expect(bad.llm.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    const nan = loadConfig({ settings: {}, env: { LLM_TIMEOUT_MS: 'abc' } })
    expect(nan.llm.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('isConfigured 判定是否可调用', () => {
    expect(isConfigured(loadConfig({ settings: { llm: { apiKey: 'k', baseUrl: 'u' } }, env: {} }))).toBe(true)
    expect(isConfigured(loadConfig({ settings: { llm: { apiKey: 'k' } }, env: {} }))).toBe(false)
    expect(isConfigured(loadConfig({ settings: {}, env }))).toBe(true)
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

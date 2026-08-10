import { describe, expect, it } from 'vitest'
import { DEFAULT_TIMEOUT_MS, isConfigured, loadConfig } from '../src/shared/config'

const env = {
  LLM_API_KEY: 'env-key',
  LLM_BASE_URL: 'https://env.example.com/v1',
  LLM_MODEL: 'env-model',
  LLM_TIMEOUT_MS: '30000'
}

describe('loadConfig', () => {
  it('设置值优先于环境变量', () => {
    const config = loadConfig({
      settings: { apiKey: 'ui-key', baseUrl: 'https://ui.example.com/v1' },
      env
    })
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
    const config = loadConfig({ settings: { timeoutMs: 15000 }, env })
    expect(config.llm.timeoutMs).toBe(15000)
  })

  it('非法超时回退默认值', () => {
    const bad = loadConfig({ settings: { timeoutMs: -1 }, env: {} })
    expect(bad.llm.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    const nan = loadConfig({ settings: {}, env: { LLM_TIMEOUT_MS: 'abc' } })
    expect(nan.llm.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('isConfigured 判定是否可调用', () => {
    expect(isConfigured(loadConfig({ settings: { apiKey: 'k', baseUrl: 'u' }, env: {} }))).toBe(true)
    expect(isConfigured(loadConfig({ settings: { apiKey: 'k' }, env: {} }))).toBe(false)
    expect(isConfigured(loadConfig({ settings: {}, env }))).toBe(true)
  })
})

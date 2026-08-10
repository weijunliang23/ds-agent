import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import { MemorySettingsStore } from '../src/shared/settings'
import { FileSettingsStore } from '../src/main/settings-store'

describe('MemorySettingsStore', () => {
  it('保存后可读取', async () => {
    const store = new MemorySettingsStore()
    await store.save({ apiKey: 'k', baseUrl: 'u', model: 'm', timeoutMs: 1000 })
    const loaded = await store.load()
    expect(loaded).toEqual({ apiKey: 'k', baseUrl: 'u', model: 'm', timeoutMs: 1000 })
  })

  it('初始值可读且不被污染', async () => {
    const store = new MemorySettingsStore({ apiKey: 'init' })
    await store.save({ model: 'm' })
    const loaded = await store.load()
    expect(loaded.apiKey).toBeUndefined()
    expect(loaded.model).toBe('m')
  })
})

describe('FileSettingsStore', () => {
  const dir = join(tmpdir(), `my-agent-settings-test-${Date.now()}`)
  const store = new FileSettingsStore(dir)

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('文件不存在时返回空配置', async () => {
    const loaded = await store.load()
    expect(loaded).toEqual({})
  })

  it('保存后写入 settings.json 且可读回', async () => {
    await store.save({ apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1', model: 'deepseek-chat' })
    const loaded = await store.load()
    expect(loaded).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com/v1',
      model: 'deepseek-chat'
    })

    const raw = await readFile(join(dir, 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { llm?: Record<string, unknown> }
    expect(parsed.llm?.apiKey).toBe('sk-test')
  })

  it('覆盖写入不会残留旧值', async () => {
    await store.save({ apiKey: 'a' })
    await store.save({ apiKey: 'b', model: 'm' })
    const loaded = await store.load()
    expect(loaded.apiKey).toBe('b')
    expect(loaded.model).toBe('m')
  })

  it('损坏的 JSON 返回空配置而非抛错', async () => {
    const tmp = join(tmpdir(), `my-agent-bad-${Date.now()}`)
    const bad = new FileSettingsStore(tmp)
    await mkdir(tmp, { recursive: true })
    await writeFile(join(tmp, 'settings.json'), 'not-json{', 'utf-8')
    const loaded = await bad.load()
    expect(loaded).toEqual({})
    await rm(tmp, { recursive: true, force: true })
  })
})

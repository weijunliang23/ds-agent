import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import { MemorySettingsStore } from '../src/shared/settings'
import { FileSettingsStore } from '../src/main/settings-store'

describe('MemorySettingsStore', () => {
  it('保存后可读取', async () => {
    const store = new MemorySettingsStore()
    await store.save({
      llm: { apiKey: 'k', baseUrl: 'u', model: 'm', timeoutMs: 1000 },
      tools: { workspace: 'D:/work', readPolicy: 'allow', writePolicy: 'deny', maxIterations: 12 }
    })
    const loaded = await store.load()
    expect(loaded.llm).toEqual({ apiKey: 'k', baseUrl: 'u', model: 'm', timeoutMs: 1000 })
    expect(loaded.tools).toEqual({
      workspace: 'D:/work',
      readPolicy: 'allow',
      writePolicy: 'deny',
      maxIterations: 12
    })
  })

  it('初始值可读且不被污染', async () => {
    const store = new MemorySettingsStore({ llm: { apiKey: 'init' } })
    await store.save({ llm: { model: 'm' } })
    const loaded = await store.load()
    expect(loaded.llm?.apiKey).toBeUndefined()
    expect(loaded.llm?.model).toBe('m')
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
    await store.save({
      llm: { apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1', model: 'deepseek-chat' },
      tools: { workspace: 'D:/work', writePolicy: 'deny' }
    })
    const loaded = await store.load()
    expect(loaded.llm).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com/v1',
      model: 'deepseek-chat'
    })
    expect(loaded.tools).toEqual({ workspace: 'D:/work', writePolicy: 'deny' })

    const raw = await readFile(join(dir, 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { llm?: Record<string, unknown> }
    expect(parsed.llm?.apiKey).toBe('sk-test')
  })

  it('覆盖写入不会残留旧值', async () => {
    await store.save({ llm: { apiKey: 'a' } })
    await store.save({ llm: { apiKey: 'b', model: 'm' } })
    const loaded = await store.load()
    expect(loaded.llm?.apiKey).toBe('b')
    expect(loaded.llm?.model).toBe('m')
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

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createConversation,
  createConversationStore,
  FileConversationStore
} from '../src/main/conversation-store'

describe('FileConversationStore', () => {
  const dir = join(tmpdir(), `my-agent-conversation-test-${Date.now()}`)
  const store = createConversationStore(dir)

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('初始 list 为空', async () => {
    expect(await store.list()).toEqual([])
  })

  it('createConversation 生成空对话', () => {
    const conv = createConversation('c1')
    expect(conv.id).toBe('c1')
    expect(conv.workspaceId).toBe('default')
    expect(conv.title).toBe('新对话')
    expect(conv.messages).toEqual([])
    expect(conv.updatedAt).toBe(conv.createdAt)
  })

  it('save 后可 get 读回，且跨实例持久', async () => {
    await store.save({
      id: 'c1',
      workspaceId: 'default',
      title: '第一问',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [{ role: 'user', content: '你好' }]
    })

    const other = new FileConversationStore(dir)
    const loaded = await other.get('c1')
    expect(loaded).toMatchObject({ id: 'c1', title: '第一问', updatedAt: 2000 })
    expect(loaded?.messages).toEqual([{ role: 'user', content: '你好' }])
  })

  it('list 按 updatedAt 降序返回摘要', async () => {
    await store.delete('c1')
    await store.save({
      id: 'c2',
      workspaceId: 'default',
      title: '旧',
      createdAt: 100,
      updatedAt: 100,
      messages: []
    })
    await store.save({
      id: 'c3',
      workspaceId: 'default',
      title: '新',
      createdAt: 500,
      updatedAt: 500,
      messages: [{ role: 'user', content: 'x' }]
    })

    const list = await store.list()
    expect(list[0].id).toBe('c3')
    expect(list[1].id).toBe('c2')
    expect(list[0].messageCount).toBe(1)
  })

  it('get 不存在的 id 返回 null', async () => {
    expect(await store.get('missing')).toBeNull()
  })

  it('delete 删除单个', async () => {
    await store.delete('c2')
    expect(await store.get('c2')).toBeNull()
  })

  it('deleteMany 批量删除', async () => {
    await store.deleteMany(['c1', 'c3'])
    expect(await store.list()).toEqual([])
  })

  it('损坏的 JSON 文件被忽略', async () => {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'bad.json'), 'not-json{', 'utf-8')
    expect(await store.list()).toEqual([])
  })
})

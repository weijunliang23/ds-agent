import { describe, expect, it } from 'vitest'
import { MemoryContextEngine } from '../src/main/context-engine'

describe('MemoryContextEngine', () => {
  it('createSession 生成唯一 id 且历史为空', () => {
    const engine = new MemoryContextEngine()
    const a = engine.createSession()
    const b = engine.createSession()
    expect(a.id).not.toBe(b.id)
    expect(engine.getHistory(a.id)).toEqual([])
  })

  it('appendMessage 后 getHistory 返回按序消息', () => {
    const engine = new MemoryContextEngine()
    const { id } = engine.createSession()
    engine.appendMessage(id, { role: 'user', content: '第一问' })
    engine.appendMessage(id, { role: 'assistant', content: '第一答' })
    engine.appendMessage(id, { role: 'user', content: '第二问' })

    const history = engine.getHistory(id)
    expect(history.map((m) => m.content)).toEqual(['第一问', '第一答', '第二问'])
    expect(engine.getHistory(id)[0]).not.toBe(history[0])
  })

  it('返回的历史是拷贝，外部修改不影响引擎', () => {
    const engine = new MemoryContextEngine()
    const { id } = engine.createSession()
    engine.appendMessage(id, { role: 'user', content: 'hi' })

    const history = engine.getHistory(id)
    history[0].content = 'hacked'
    expect(engine.getHistory(id)[0].content).toBe('hi')
  })

  it('向不存在会话追加时抛错', () => {
    const engine = new MemoryContextEngine()
    expect(() => engine.appendMessage('nope', { role: 'user', content: 'x' })).toThrow(/会话不存在/)
  })

  it('不存在的会话 getHistory 返回空数组', () => {
    const engine = new MemoryContextEngine()
    expect(engine.getHistory('nope')).toEqual([])
  })

  it('不同会话历史相互隔离', () => {
    const engine = new MemoryContextEngine()
    const a = engine.createSession()
    const b = engine.createSession()
    engine.appendMessage(a.id, { role: 'user', content: 'A 的消息' })
    expect(engine.getHistory(b.id)).toEqual([])
  })
})

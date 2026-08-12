import { describe, expect, it } from 'vitest'
import {
  KeywordRetrievalStrategy,
  MemoryContextEngine,
  splitText,
  tokenize
} from '../src/main/context-engine'

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

describe('tokenize / splitText', () => {
  it('中文按字符 bigram 分词，英文按单词小写', () => {
    expect(tokenize('这是一个苹果')).toEqual(['这是', '是一', '一个', '个苹', '苹果'])
    expect(tokenize('Hello World hello')).toEqual(['hello', 'world', 'hello'])
    expect(tokenize('价格 128 元')).toEqual(['价格', '128', '元'])
    expect(tokenize('单字')).toEqual(['单字'])
    expect(tokenize('啊')).toEqual(['啊'])
  })

  it('splitText 短文本不切分', () => {
    expect(splitText('短文本', 500)).toEqual(['短文本'])
  })

  it('splitText 长文本按 chunkSize 切分且不产生空段', () => {
    const text = '段落一。\n'.repeat(20)
    const parts = splitText(text, 16)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((p) => p.length <= 16)).toBe(true)
    expect(parts.every((p) => p !== '')).toBe(true)
  })
})

describe('KeywordRetrievalStrategy', () => {
  function makeChunk(sessionId: string, text: string, messageIndex: number, partIndex = 0): ReturnType<MemoryContextEngine['retrieve']>[number] {
    return {
      id: `${sessionId}:${messageIndex}:${partIndex}`,
      sessionId,
      role: 'assistant' as const,
      text,
      messageIndex,
      partIndex,
      createdAt: 0
    }
  }

  it('空索引返回空', () => {
    const s = new KeywordRetrievalStrategy()
    expect(s.search('苹果', 3)).toEqual([])
  })

  it('中文 bigram 命中并按相关度排序', () => {
    const s = new KeywordRetrievalStrategy()
    s.index(makeChunk('a', '这是关于苹果种植的技术讨论', 0))
    s.index(makeChunk('a', '今天天气很好适合跑步', 1))
    s.index(makeChunk('a', '苹果的营养价值很高', 2))

    const results = s.search('苹果', 3, 'a')
    expect(results.map((c) => c.messageIndex)).toEqual([2, 0])
    expect(results[0].text).toBe('苹果的营养价值很高')
  })

  it('英文单词命中', () => {
    const s = new KeywordRetrievalStrategy()
    s.index(makeChunk('a', 'the quick brown fox jumps', 0))
    s.index(makeChunk('a', 'a lazy dog sleeps', 1))

    const results = s.search('FOX', 3, 'a')
    expect(results.map((c) => c.messageIndex)).toEqual([0])
  })

  it('topK 截断结果数量', () => {
    const s = new KeywordRetrievalStrategy()
    for (let i = 0; i < 5; i++) {
      s.index(makeChunk('a', `苹果数据 ${i} 号`, i))
    }
    expect(s.search('苹果', 2, 'a')).toHaveLength(2)
  })

  it('无命中返回空', () => {
    const s = new KeywordRetrievalStrategy()
    s.index(makeChunk('a', '只谈跑步', 0))
    expect(s.search('游泳', 3, 'a')).toEqual([])
  })

  it('按 sessionId 过滤，互不串扰', () => {
    const s = new KeywordRetrievalStrategy()
    s.index(makeChunk('a', '苹果讨论', 0))
    s.index(makeChunk('b', '苹果讨论', 0))
    expect(s.search('苹果', 3, 'a')).toHaveLength(1)
    expect(s.search('苹果', 3, 'b')).toHaveLength(1)
    expect(s.search('苹果', 3)).toHaveLength(2)
  })

  it('remove 清除指定会话的索引', () => {
    const s = new KeywordRetrievalStrategy()
    s.index(makeChunk('a', '苹果讨论', 0))
    s.index(makeChunk('b', '苹果讨论', 0))
    s.remove('a')
    expect(s.search('苹果', 3, 'a')).toEqual([])
    expect(s.search('苹果', 3, 'b')).toHaveLength(1)
  })

  it('clear 清空全部索引', () => {
    const s = new KeywordRetrievalStrategy()
    s.index(makeChunk('a', '苹果讨论', 0))
    s.clear()
    expect(s.search('苹果', 3)).toEqual([])
  })
})

describe('MemoryContextEngine.retrieve', () => {
  it('appendMessage 后按相关度检索到历史片段', () => {
    const engine = new MemoryContextEngine()
    const { id } = engine.createSession()
    engine.appendMessage(id, { role: 'user', content: '帮我看看昨天讨论的部署方案' })
    engine.appendMessage(id, { role: 'assistant', content: '我们用了 Docker 容器部署' })
    engine.appendMessage(id, { role: 'user', content: '今天吃什么' })

    const hits = engine.retrieve(id, 'Docker 部署', 3)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].text).toContain('Docker')
  })

  it('不相关查询返回空', () => {
    const engine = new MemoryContextEngine()
    const { id } = engine.createSession()
    engine.appendMessage(id, { role: 'user', content: '只谈天气' })
    expect(engine.retrieve(id, '量子计算', 3)).toEqual([])
  })

  it('restoreSession 会为已有历史建立索引', () => {
    const engine = new MemoryContextEngine()
    engine.restoreSession('old', [
      { role: 'user', content: '早前聊过苹果价格' }
    ], 1000)
    const hits = engine.retrieve('old', '苹果', 3)
    expect(hits).toHaveLength(1)
  })

  it('长消息按 chunkSize 切分后可检索到后段', () => {
    const engine = new MemoryContextEngine(10)
    const { id } = engine.createSession()
    engine.appendMessage(id, {
      role: 'user',
      content: '第一段讲天气。\n第二段讲苹果价格。'
    })
    const hits = engine.retrieve(id, '苹果', 3)
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toContain('苹果')
    expect(hits[0].text).not.toContain('天气')
  })

  it('removeSession 后检索不再命中该会话', () => {
    const engine = new MemoryContextEngine()
    const a = engine.createSession()
    engine.appendMessage(a.id, { role: 'user', content: '苹果讨论' })
    engine.removeSession(a.id)
    expect(engine.retrieve(a.id, '苹果', 3)).toEqual([])
  })

  it('空内容消息不建立索引', () => {
    const engine = new MemoryContextEngine()
    const { id } = engine.createSession()
    engine.appendMessage(id, { role: 'assistant', content: '' })
    expect(engine.retrieve(id, '苹果', 3)).toEqual([])
  })
})

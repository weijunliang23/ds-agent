import { describe, expect, it, vi } from 'vitest'
import { buildContextualMessages } from '../src/main/runtime'
import type { AppConfig } from '../src/shared/config'
import type { ChatMessage } from '../src/main/model-router'
import type { ContextChunk } from '../src/main/context-engine'

const config: AppConfig = {
  llm: { providers: [] },
  context: { retrievalEnabled: true, topK: 3, recentWindow: 8, chunkSize: 500 },
  tools: { workspace: '', readPolicy: 'ask', writePolicy: 'ask', maxIterations: 8 }
}

function chunk(messageIndex: number, text: string): ContextChunk {
  return { id: `s:${messageIndex}:0`, sessionId: 's', role: 'assistant', text, messageIndex, partIndex: 0, createdAt: 0 }
}

const noRetrieve = () => []

describe('buildContextualMessages', () => {
  it('无工具时不注入引导 system，仅返回窗口内消息', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ]
    const msgs = buildContextualMessages(noRetrieve, 's', history, 'hi', config, false)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('有工具时在开头注入引导 system 消息', () => {
    const history: ChatMessage[] = [{ role: 'user', content: 'hi' }]
    const msgs = buildContextualMessages(noRetrieve, 's', history, 'hi', config, true)
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('直接回答')
    expect(msgs.slice(1).map((m) => m.role)).toEqual(['user'])
  })

  it('检索命中时注入检索 system 块，排在引导之后', () => {
    const history: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`
    }))
    const retrieve = vi.fn(() => [chunk(0, '早前聊过苹果')])
    const msgs = buildContextualMessages(retrieve, 's', history, '苹果', config, true)

    expect(retrieve).toHaveBeenCalledWith('s', '苹果', 3)
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].content).toBe('以下是历史对话中与当前问题相关的片段：\n早前聊过苹果')
    expect(msgs.slice(2)).toHaveLength(8)
    expect(msgs.slice(2).map((m) => m.content)).toEqual(['m2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'])
  })

  it('retrievalEnabled=false 时不注入检索块', () => {
    const history: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`
    }))
    const disabled = { ...config, context: { ...config.context, retrievalEnabled: false } }
    const msgs = buildContextualMessages(noRetrieve, 's', history, '苹果', disabled, true)
    expect(msgs).toHaveLength(1 + 8)
    expect(msgs.filter((m) => m.content.includes('片段'))).toHaveLength(0)
  })

  it('检索无命中时不注入检索块', () => {
    const history: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`
    }))
    const msgs = buildContextualMessages(noRetrieve, 's', history, '苹果', config, true)
    expect(msgs.filter((m) => m.content.includes('片段'))).toHaveLength(0)
  })

  it('窗口切分不拆散工具对：tool 消息带动它的 assistant toolCalls', () => {
    // windowStart would land on index 2 (a tool message) without the guard.
    const history: ChatMessage[] = [
      { role: 'user', content: 'u0' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{}' }] },
      { role: 'tool', content: 'result', toolCallId: 'c1' },
      { role: 'user', content: 'u3' },
      { role: 'assistant', content: 'a4' },
      { role: 'user', content: 'u5' },
      { role: 'assistant', content: 'a6' },
      { role: 'user', content: 'u7' },
      { role: 'assistant', content: 'a8' },
      { role: 'user', content: 'u9' }
    ]
    const msgs = buildContextualMessages(noRetrieve, 's', history, 'hi', config, true)
    const recent = msgs.slice(1)
    expect(recent[0].role).toBe('assistant')
    expect(recent[0].toolCalls?.[0].id).toBe('c1')
    expect(recent[1].role).toBe('tool')
    expect(recent[1].toolCallId).toBe('c1')
  })
})

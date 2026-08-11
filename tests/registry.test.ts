import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '../src/main/tools/registry'
import type { Tool } from '../src/shared/tools'

function makeTool(name: string): Tool {
  return {
    name,
    description: `工具 ${name}`,
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      return { ok: true, content: 'ok' }
    }
  }
}

describe('ToolRegistry', () => {
  it('register 后可 get / has / list', () => {
    const registry = new ToolRegistry()
    const tool = makeTool('read_file')
    registry.register(tool)
    expect(registry.get('read_file')).toBe(tool)
    expect(registry.has('read_file')).toBe(true)
    expect(registry.list()).toEqual([tool])
  })

  it('重复注册抛错', () => {
    const registry = new ToolRegistry()
    registry.register(makeTool('read_file'))
    expect(() => registry.register(makeTool('read_file'))).toThrow(/工具已注册/)
  })

  it('registerAll 批量注册', () => {
    const registry = new ToolRegistry()
    registry.registerAll([makeTool('a'), makeTool('b')])
    expect(registry.list()).toHaveLength(2)
  })

  it('未注册的工具返回 undefined', () => {
    const registry = new ToolRegistry()
    expect(registry.get('missing')).toBeUndefined()
    expect(registry.has('missing')).toBe(false)
  })
})

import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ToolExecutor } from '../src/main/tools/executor'
import { Permissions } from '../src/main/tools/permissions'
import { ToolRegistry } from '../src/main/tools/registry'
import type { Tool } from '../src/shared/tools'

const workspace = resolve('/data/work')

function makeExecutor(overrides?: {
  requester?: { request: (req: unknown) => Promise<'allow' | 'deny'> } | null
  readPolicy?: 'allow' | 'ask' | 'deny'
  writePolicy?: 'allow' | 'ask' | 'deny'
}) {
  const registry = new ToolRegistry()
  const spy = vi.fn<(args: Record<string, unknown>, ctx: unknown) => Promise<{ ok: boolean; content: string }>>()
  const tool: Tool = {
    name: 'echo_file',
    description: '写一个文件并返回内容',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['path', 'content']
    },
    permission: { action: 'write', pathArg: 'path' },
    execute: async (args, ctx) => {
      spy(args, ctx)
      const p = (ctx as { resolvePath(p: string): string }).resolvePath(String(args.path))
      return { ok: true, content: `wrote ${p}: ${String(args.content)}` }
    }
  }
  registry.register(tool)

  const permissions = new Permissions(
    () => ({
      workspace,
      readPolicy: overrides?.readPolicy ?? 'ask',
      writePolicy: overrides?.writePolicy ?? 'ask'
    }),
    overrides?.requester ?? null
  )
  const executor = new ToolExecutor(registry, permissions, () => workspace)
  return { executor, spy, tool }
}

const allowRequester = {
  request: vi.fn().mockResolvedValue('allow' as const)
}

describe('ToolExecutor.execute', () => {
  it('未知工具返回可读失败', async () => {
    const { executor } = makeExecutor({ writePolicy: 'allow' })
    const result = await executor.execute('nope', {})
    expect(result.ok).toBe(false)
    expect(result.content).toContain('未知工具')
  })

  it('参数校验失败不执行工具', async () => {
    const { executor, spy } = makeExecutor({ writePolicy: 'allow' })
    const result = await executor.execute('echo_file', { path: '/a' })
    expect(result.ok).toBe(false)
    expect(result.content).toContain('缺少必填参数')
    expect(spy).not.toHaveBeenCalled()
  })

  it('deny 策略下直接拒绝且不执行工具', async () => {
    const { executor, spy } = makeExecutor({ writePolicy: 'deny' })
    const result = await executor.execute('echo_file', { path: 'x.txt', content: 'hi' })
    expect(result.ok).toBe(false)
    expect(result.content).toContain('无权限执行 write')
    expect(spy).not.toHaveBeenCalled()
  })

  it('ask + 用户允许后执行，并解析出绝对路径', async () => {
    const { executor, spy } = makeExecutor({ writePolicy: 'ask', requester: allowRequester })
    const result = await executor.execute('echo_file', { path: 'sub/x.txt', content: 'hi' })
    expect(result.ok).toBe(true)
    expect(result.content).toContain(resolve(workspace, 'sub/x.txt'))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('工具内部抛错被包装为可读失败', async () => {
    const registry = new ToolRegistry()
    registry.register({
      name: 'boom',
      description: '抛错',
      parameters: { type: 'object', properties: {} },
      async execute() {
        throw new Error('内部爆炸')
      }
    })
    const executor = new ToolExecutor(
      registry,
      new Permissions(() => ({ workspace, readPolicy: 'ask', writePolicy: 'ask' }), null),
      () => workspace
    )
    const result = await executor.execute('boom', {})
    expect(result.ok).toBe(false)
    expect(result.content).toContain('工具执行失败：内部爆炸')
  })
})

describe('ToolExecutor.listToolDefinitions', () => {
  it('映射为 OpenAI function 定义', () => {
    const { executor, tool } = makeExecutor()
    const definitions = executor.listToolDefinitions()
    expect(definitions).toEqual([
      {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      }
    ])
  })
})

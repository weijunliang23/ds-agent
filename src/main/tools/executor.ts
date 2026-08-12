import { resolve } from 'node:path'
import { validateArgs, type ToolContext } from '../../shared/tools'
import type { ToolDefinition } from '../model-router'
import type { Permissions } from './permissions'
import type { ToolRegistry } from './registry'

export interface ToolExecutionResult {
  name: string
  ok: boolean
  content: string
}

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly permissions: Permissions,
    private readonly getWorkspace: () => string
  ) {}

  listToolDefinitions(): ToolDefinition[] {
    return this.registry.list().map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as unknown as Record<string, unknown>
      }
    }))
  }

  async execute(name: string, args: unknown): Promise<ToolExecutionResult> {
    const tool = this.registry.get(name)
    if (!tool) {
      return { name, ok: false, content: `未知工具：${name}` }
    }

    const validated = validateArgs(tool.parameters, args)
    if (!validated.ok) {
      return { name, ok: false, content: `参数校验失败：${validated.error}` }
    }

    const workspace = this.getWorkspace()
    const ctx: ToolContext = {
      workspace,
      resolvePath: (input) => resolve(workspace === '' ? process.cwd() : workspace, input)
    }

    if (tool.permission) {
      const raw = validated.value[tool.permission.pathArg]
      // A missing/empty pathArg falls back to the workspace root. read_file and
      // write_file never reach here because their path is required by the
      // schema; only optional-path tools (e.g. list_dir) hit this branch.
      const path = typeof raw === 'string' && raw !== '' ? ctx.resolvePath(raw) : workspace
      const decision = await this.permissions.authorize({
        action: tool.permission.action,
        path
      })
      if (decision === 'deny') {
        return { name, ok: false, content: `无权限执行 ${tool.permission.action} 操作：${path}` }
      }
    }

    try {
      const result = await tool.execute(validated.value, ctx)
      return { name, ok: result.ok, content: result.content }
    } catch (err) {
      return {
        name,
        ok: false,
        content: `工具执行失败：${err instanceof Error ? err.message : String(err)}`
      }
    }
  }
}

export type JsonSchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null'

export interface JsonSchema {
  type: JsonSchemaType
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
}

export type ToolParameterSchema = JsonSchema

export interface ToolResult {
  ok: boolean
  content: string
}

export interface ToolContext {
  workspace: string
  resolvePath(input: string): string
}

export type PermissionAction = 'read' | 'write'
export type PermissionPolicy = 'allow' | 'ask' | 'deny'

export interface PermissionRequest {
  action: PermissionAction
  path: string
}

export interface ToolPermission {
  action: PermissionAction
  pathArg: string
}

export interface Tool {
  name: string
  description: string
  parameters: ToolParameterSchema
  permission?: ToolPermission
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
}

export type ValidateResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

function typeName(value: unknown): JsonSchemaType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value as JsonSchemaType
}

function isValidType(value: unknown, type: JsonSchemaType): boolean {
  if (type === 'integer') {
    return typeof value === 'number' && Number.isInteger(value)
  }
  if (type === 'array') {
    return Array.isArray(value)
  }
  return typeName(value) === type
}

export function validateArgs(schema: ToolParameterSchema, args: unknown): ValidateResult {
  if (schema.type !== 'object') {
    return { ok: false, error: '工具参数 schema 必须是 object' }
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, error: '参数必须是对象' }
  }
  const input = args as Record<string, unknown>
  const props = schema.properties ?? {}

  for (const name of schema.required ?? []) {
    if (input[name] === undefined) {
      return { ok: false, error: `缺少必填参数：${name}` }
    }
  }

  for (const [name, prop] of Object.entries(props)) {
    const value = input[name]
    if (value === undefined) continue
    if (prop.type === 'array' && prop.items) {
      if (!Array.isArray(value)) {
        return { ok: false, error: `参数 ${name} 必须是数组` }
      }
      for (const item of value) {
        if (!isValidType(item, prop.items.type)) {
          return { ok: false, error: `参数 ${name} 的元素必须是 ${prop.items.type}` }
        }
      }
      continue
    }
    if (!isValidType(value, prop.type)) {
      return { ok: false, error: `参数 ${name} 必须是 ${prop.type}` }
    }
  }

  const value: Record<string, unknown> = {}
  for (const name of Object.keys(props)) {
    if (input[name] !== undefined) {
      value[name] = input[name]
    }
  }
  return { ok: true, value }
}

import type { PermissionPolicy } from './tools'

export interface LlmSettings {
  apiKey: string
  baseUrl: string
  model: string
  timeoutMs: number
}

export interface ToolSettings {
  workspace: string
  readPolicy: PermissionPolicy
  writePolicy: PermissionPolicy
  maxIterations: number
}

export interface AppConfig {
  llm: LlmSettings
  tools: ToolSettings
}

export interface StoredSettings {
  llm?: Partial<LlmSettings>
  tools?: Partial<ToolSettings>
}

export type EnvLike = Record<string, string | undefined>

export interface ConfigSources {
  settings: StoredSettings
  env: EnvLike
}

export const DEFAULT_TIMEOUT_MS = 60000

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  apiKey: '',
  baseUrl: '',
  model: '',
  timeoutMs: DEFAULT_TIMEOUT_MS
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  workspace: '',
  readPolicy: 'ask',
  writePolicy: 'ask',
  maxIterations: 8
}

function parseTimeout(value: number | string | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) {
      return n
    }
  }
  return DEFAULT_TIMEOUT_MS
}

function parsePolicy(value: unknown): PermissionPolicy {
  return value === 'allow' || value === 'deny' ? value : 'ask'
}

function parseMaxIterations(value: number | string | undefined): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (Number.isFinite(n) && n >= 1 && n <= 32) {
    return Math.trunc(n)
  }
  return DEFAULT_TOOL_SETTINGS.maxIterations
}

export function loadConfig(sources: ConfigSources): AppConfig {
  const { settings, env } = sources
  return {
    llm: {
      apiKey:
        settings.llm?.apiKey || env['LLM_API_KEY'] || DEFAULT_LLM_SETTINGS.apiKey,
      baseUrl:
        settings.llm?.baseUrl || env['LLM_BASE_URL'] || DEFAULT_LLM_SETTINGS.baseUrl,
      model: settings.llm?.model || env['LLM_MODEL'] || DEFAULT_LLM_SETTINGS.model,
      timeoutMs: parseTimeout(
        settings.llm?.timeoutMs ?? env['LLM_TIMEOUT_MS'] ?? DEFAULT_TIMEOUT_MS
      )
    },
    tools: {
      workspace:
        settings.tools?.workspace ||
        env['TOOLS_WORKSPACE'] ||
        DEFAULT_TOOL_SETTINGS.workspace,
      readPolicy: parsePolicy(
        settings.tools?.readPolicy ??
          env['TOOLS_READ_POLICY'] ??
          DEFAULT_TOOL_SETTINGS.readPolicy
      ),
      writePolicy: parsePolicy(
        settings.tools?.writePolicy ??
          env['TOOLS_WRITE_POLICY'] ??
          DEFAULT_TOOL_SETTINGS.writePolicy
      ),
      maxIterations: parseMaxIterations(
        settings.tools?.maxIterations ??
          env['TOOLS_MAX_ITERATIONS'] ??
          DEFAULT_TOOL_SETTINGS.maxIterations
      )
    }
  }
}

export function isConfigured(config: AppConfig): boolean {
  return config.llm.apiKey !== '' && config.llm.baseUrl !== ''
}

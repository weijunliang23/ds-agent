import type { PermissionPolicy } from './tools'

// Per-provider model settings (OpenAI-compatible endpoint).
export interface LlmSettings {
  apiKey: string
  baseUrl: string
  model: string
  timeoutMs: number
}

// A named provider entry. `id` uniquely identifies it so the router can report
// which provider actually served a request via `usedProviderId`.
export interface LlmProviderConfig extends LlmSettings {
  id: string
  label?: string
}

// Routing settings: providers are tried in array order with fallback to the next.
export interface LlmRoutingSettings {
  providers: LlmProviderConfig[]
}

// Context retrieval knobs used to inject relevant historical snippets.
export interface ContextSettings {
  retrievalEnabled: boolean
  topK: number
  recentWindow: number
  chunkSize: number
}

export interface ToolSettings {
  workspace: string
  readPolicy: PermissionPolicy
  writePolicy: PermissionPolicy
  maxIterations: number
}

export interface AppConfig {
  llm: LlmRoutingSettings
  context: ContextSettings
  tools: ToolSettings
}

// Stored shape. `llm` may still carry legacy single-provider fields
// (apiKey/baseUrl/model/timeoutMs) from Phase 1; loadConfig migrates them.
export interface StoredLlmSettings {
  providers?: Array<Partial<LlmProviderConfig>>
  apiKey?: string
  baseUrl?: string
  model?: string
  timeoutMs?: number
}

export interface StoredSettings {
  llm?: StoredLlmSettings
  context?: Partial<ContextSettings>
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

export const DEFAULT_CONTEXT_SETTINGS: ContextSettings = {
  retrievalEnabled: true,
  topK: 3,
  recentWindow: 8,
  chunkSize: 500
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

// Clamp an integer setting into [min, max]; invalid values fall back.
function parseRange(value: number | string | undefined, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (Number.isFinite(n) && n >= min && n <= max) {
    return Math.trunc(n)
  }
  return fallback
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Normalize one raw stored provider entry. Fields that are present win over
// env; absent fields fall back to env when `useEnvFallback` is true (primary).
function sanitizeProvider(raw: unknown, fallbackId: string): Partial<LlmProviderConfig> {
  const v = isRecord(raw) ? raw : {}
  const out: Partial<LlmProviderConfig> = {
    id: typeof v.id === 'string' && v.id !== '' ? v.id : fallbackId
  }
  if (typeof v.label === 'string' && v.label !== '') {
    out.label = v.label
  }
  if (typeof v.apiKey === 'string') out.apiKey = v.apiKey
  if (typeof v.baseUrl === 'string') out.baseUrl = v.baseUrl
  if (typeof v.model === 'string') out.model = v.model
  if (typeof v.timeoutMs === 'number' || typeof v.timeoutMs === 'string') {
    out.timeoutMs = parseTimeout(v.timeoutMs)
  }
  return out
}

function completeProvider(
  p: Partial<LlmProviderConfig>,
  env: EnvLike,
  useEnvFallback: boolean
): LlmProviderConfig {
  return {
    id: p.id ?? 'default',
    ...(p.label !== undefined ? { label: p.label } : {}),
    apiKey: p.apiKey !== undefined ? p.apiKey : useEnvFallback ? (env['LLM_API_KEY'] ?? '') : '',
    baseUrl:
      p.baseUrl !== undefined ? p.baseUrl : useEnvFallback ? (env['LLM_BASE_URL'] ?? '') : '',
    model: p.model !== undefined ? p.model : useEnvFallback ? (env['LLM_MODEL'] ?? '') : '',
    timeoutMs:
      p.timeoutMs !== undefined
        ? p.timeoutMs
        : useEnvFallback
          ? parseTimeout(env['LLM_TIMEOUT_MS'])
          : DEFAULT_TIMEOUT_MS
  }
}

// Build the provider list. Precedence: stored `providers` array > legacy
// single-provider fields > environment variables > empty.
function loadProviders(llm: StoredLlmSettings | undefined, env: EnvLike): LlmProviderConfig[] {
  if (Array.isArray(llm?.providers) && llm!.providers.length > 0) {
    return llm!.providers.map((p, i) =>
      completeProvider(sanitizeProvider(p, `provider-${i + 1}`), env, i === 0)
    )
  }

  const legacy = completeProvider(
    {
      ...(typeof llm?.apiKey === 'string' ? { apiKey: llm.apiKey } : {}),
      ...(typeof llm?.baseUrl === 'string' ? { baseUrl: llm.baseUrl } : {}),
      ...(typeof llm?.model === 'string' ? { model: llm.model } : {}),
      ...(llm?.timeoutMs !== undefined ? { timeoutMs: parseTimeout(llm.timeoutMs) } : {}),
      id: 'default'
    },
    env,
    true
  )
  if (legacy.apiKey !== '' || legacy.baseUrl !== '' || legacy.model !== '') {
    return [legacy]
  }
  return []
}

export function loadConfig(sources: ConfigSources): AppConfig {
  const { settings, env } = sources
  return {
    llm: { providers: loadProviders(settings.llm, env) },
    context: {
      retrievalEnabled: parseBool(
        settings.context?.retrievalEnabled ?? env['CONTEXT_RETRIEVAL_ENABLED'],
        DEFAULT_CONTEXT_SETTINGS.retrievalEnabled
      ),
      topK: parseRange(
        settings.context?.topK ?? env['CONTEXT_TOP_K'],
        1,
        20,
        DEFAULT_CONTEXT_SETTINGS.topK
      ),
      recentWindow: parseRange(
        settings.context?.recentWindow ?? env['CONTEXT_RECENT_WINDOW'],
        0,
        200,
        DEFAULT_CONTEXT_SETTINGS.recentWindow
      ),
      chunkSize: parseRange(
        settings.context?.chunkSize,
        100,
        4000,
        DEFAULT_CONTEXT_SETTINGS.chunkSize
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

// At least one usable provider must exist to call the model.
export function isConfigured(config: AppConfig): boolean {
  return config.llm.providers.some((p) => p.apiKey !== '' && p.baseUrl !== '')
}

export interface LlmSettings {
  apiKey: string
  baseUrl: string
  model: string
  timeoutMs: number
}

export interface AppConfig {
  llm: LlmSettings
}

export type EnvLike = Record<string, string | undefined>

export interface ConfigSources {
  settings: Partial<LlmSettings>
  env: EnvLike
}

export const DEFAULT_TIMEOUT_MS = 60000

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  apiKey: '',
  baseUrl: '',
  model: '',
  timeoutMs: DEFAULT_TIMEOUT_MS
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

export function loadConfig(sources: ConfigSources): AppConfig {
  const { settings, env } = sources
  return {
    llm: {
      apiKey: settings.apiKey || env['LLM_API_KEY'] || DEFAULT_LLM_SETTINGS.apiKey,
      baseUrl: settings.baseUrl || env['LLM_BASE_URL'] || DEFAULT_LLM_SETTINGS.baseUrl,
      model: settings.model || env['LLM_MODEL'] || DEFAULT_LLM_SETTINGS.model,
      timeoutMs: parseTimeout(settings.timeoutMs ?? env['LLM_TIMEOUT_MS'] ?? DEFAULT_TIMEOUT_MS)
    }
  }
}

export function isConfigured(config: AppConfig): boolean {
  return config.llm.apiKey !== '' && config.llm.baseUrl !== ''
}

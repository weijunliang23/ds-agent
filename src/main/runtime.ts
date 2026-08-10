import { isConfigured, loadConfig, type AppConfig, type EnvLike } from '../shared/config'
import type { SettingsStore } from '../shared/settings'
import type { ContextEngine } from './context-engine'
import type { ChatOptions, FimInput, ModelRouter } from './model-router'

export interface Runtime {
  start(): Promise<void>
  stop(): Promise<void>
  createSession(): string
  getConfig(): AppConfig
  reloadConfig(): Promise<void>
  handleMessage(sessionId: string, text: string, options?: ChatOptions): Promise<string>
  fim(input: FimInput): Promise<string>
}

export class RuntimeImpl implements Runtime {
  private config: AppConfig | null = null
  private running = false

  constructor(
    private readonly router: ModelRouter,
    private readonly context: ContextEngine,
    private readonly store: SettingsStore,
    private readonly env: EnvLike = process.env
  ) {}

  async start(): Promise<void> {
    await this.reloadConfig()
    this.running = true
  }

  stop(): Promise<void> {
    this.running = false
    return Promise.resolve()
  }

  createSession(): string {
    return this.context.createSession().id
  }

  getConfig(): AppConfig {
    if (!this.config) {
      throw new Error('Runtime 尚未启动')
    }
    return this.config
  }

  async reloadConfig(): Promise<void> {
    const settings = await this.store.load()
    this.config = loadConfig({ settings, env: this.env })
  }

  async handleMessage(sessionId: string, text: string, options?: ChatOptions): Promise<string> {
    if (!this.running) {
      throw new Error('Runtime 尚未启动')
    }
    const config = this.getConfig()
    if (!isConfigured(config)) {
      throw new Error('未配置模型：请先在设置中填写 AppKey 与 API 地址')
    }

    this.context.appendMessage(sessionId, { role: 'user', content: text })

    const history = this.context.getHistory(sessionId)
    const result = await this.router.chat(history, config.llm, options)

    this.context.appendMessage(sessionId, {
      role: 'assistant',
      content: result.content,
      ...(result.reasoningContent ? { reasoningContent: result.reasoningContent } : {})
    })
    return result.content
  }

  async fim(input: FimInput): Promise<string> {
    if (!this.running) {
      throw new Error('Runtime 尚未启动')
    }
    const config = this.getConfig()
    if (!isConfigured(config)) {
      throw new Error('未配置模型：请先在设置中填写 AppKey 与 API 地址')
    }

    const result = await this.router.fim(input, config.llm)
    return result.content
  }
}

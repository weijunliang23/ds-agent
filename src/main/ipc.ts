import { ipcMain, type BrowserWindow } from 'electron'
import type {
  ContextSettings,
  LlmProviderConfig,
  StoredLlmSettings,
  StoredSettings,
  ToolSettings
} from '../shared/config'
import type { Runtime } from './runtime'
import type { ChatOptions, FimInput } from './model-router'
import type { SettingsStore } from '../shared/settings'
import type { PermissionRequest } from '../shared/tools'
import type { PermissionRequester } from './tools/permissions'

export interface IpcHandler {
  (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown): void
}

const pendingPermissions = new Map<string, (answer: 'allow' | 'deny') => void>()

export function registerIpc(runtime: Runtime, store: SettingsStore): void {
  const activeStreams = new Map<string, AbortController>()

  ipcMain.handle('chat:create-session', () => {
    return runtime.createSession()
  })

  ipcMain.handle('chat:list-conversations', () => {
    return runtime.listConversations()
  })

  ipcMain.handle('chat:load-conversation', (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('参数错误：id 必须为字符串')
    }
    return runtime.loadConversation(id)
  })

  ipcMain.handle('chat:delete-conversation', async (_event, id: unknown) => {
    if (typeof id !== 'string') {
      throw new Error('参数错误：id 必须为字符串')
    }
    await runtime.deleteConversation(id)
    return { ok: true }
  })

  ipcMain.handle('chat:delete-conversations', async (_event, ids: unknown) => {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      throw new Error('参数错误：ids 必须为字符串数组')
    }
    await runtime.deleteConversations(ids as string[])
    return { ok: true }
  })

  ipcMain.handle('chat:message', (_event, sessionId: unknown, text: unknown, options: unknown) => {
    if (typeof sessionId !== 'string' || typeof text !== 'string') {
      throw new Error('参数错误：sessionId 与 text 必须为字符串')
    }
    return runtime.handleMessage(sessionId, text, sanitizeChatOptions(options))
  })

  ipcMain.handle('chat:stream:start', async (event, streamId: unknown, sessionId: unknown, text: unknown, options: unknown) => {
    const sender = event.sender
    const controller = new AbortController()
    if (typeof streamId === 'string') {
      activeStreams.set(streamId, controller)
    }
    try {
      if (typeof streamId !== 'string' || typeof sessionId !== 'string' || typeof text !== 'string') {
        throw new Error('参数错误：streamId、sessionId 与 text 必须为字符串')
      }
      await runtime.streamMessage(sessionId, text, sanitizeChatOptions(options), (ev) => {
        sender.send('chat:stream', { streamId, ...ev })
      }, controller.signal)
    } catch (err) {
      if (controller.signal.aborted) {
        sender.send('chat:stream', { streamId, type: 'stopped' })
      } else {
        const message = err instanceof Error ? err.message : String(err)
        sender.send('chat:stream', { streamId, type: 'error', message })
      }
    } finally {
      if (typeof streamId === 'string') {
        activeStreams.delete(streamId)
      }
    }
  })

  ipcMain.on('chat:stream:cancel', (_event, streamId: unknown) => {
    if (typeof streamId === 'string') {
      activeStreams.get(streamId)?.abort()
    }
  })

  ipcMain.handle('chat:fim', (_event, input: unknown) => {
    return runtime.fim(sanitizeFimInput(input))
  })

  ipcMain.handle('settings:get', () => {
    return store.load()
  })

  ipcMain.handle('settings:save', async (_event, settings: unknown) => {
    const partial = sanitizeSettings(settings)
    await store.save(partial)
    await runtime.reloadConfig()
    return { ok: true }
  })
}

export function registerPermissionResponder(): void {
  ipcMain.handle('tool:permission-respond', (_event, id: unknown, answer: unknown) => {
    const key = typeof id === 'string' ? id : ''
    const resolver = pendingPermissions.get(key)
    if (resolver) {
      pendingPermissions.delete(key)
      resolver(answer === 'allow' ? 'allow' : 'deny')
    }
    return { ok: true }
  })
}

export class IpcPermissionRequester implements PermissionRequester {
  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  request(req: PermissionRequest): Promise<'allow' | 'deny'> {
    return new Promise<'allow' | 'deny'>((resolve) => {
      const win = this.getWindow()
      if (!win || win.isDestroyed()) {
        resolve('deny')
        return
      }
      const id = crypto.randomUUID()
      const timer = setTimeout(() => {
        pendingPermissions.delete(id)
        resolve('deny')
      }, 30000)
      pendingPermissions.set(id, (answer) => {
        clearTimeout(timer)
        resolve(answer)
      })
      win.webContents.send('tool:permission-request', {
        permissionId: id,
        action: req.action,
        path: req.path
      })
    })
  }
}

function sanitizeChatOptions(value: unknown): ChatOptions | undefined {
  const v = (value ?? {}) as Record<string, unknown>
  const out: ChatOptions = {}
  if (v.thinking === 'enabled' || v.thinking === 'disabled') {
    out.thinking = v.thinking
  }
  if (v.reasoningEffort === 'low' || v.reasoningEffort === 'high' || v.reasoningEffort === 'max') {
    out.reasoningEffort = v.reasoningEffort
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function sanitizeFimInput(value: unknown): FimInput {
  const v = (value ?? {}) as Record<string, unknown>
  const out: FimInput = { prompt: '' }
  if (typeof v.prompt === 'string') out.prompt = v.prompt
  if (typeof v.suffix === 'string') out.suffix = v.suffix
  if (typeof v.maxTokens === 'number' && Number.isFinite(v.maxTokens) && v.maxTokens > 0) {
    out.maxTokens = v.maxTokens
  }
  return out
}

function sanitizeSettings(value: unknown): StoredSettings {
  const v = (value ?? {}) as Record<string, unknown>
  const llmRaw = (v.llm ?? {}) as Record<string, unknown>
  const contextRaw = (v.context ?? {}) as Record<string, unknown>
  const toolsRaw = (v.tools ?? {}) as Record<string, unknown>

  const llm: StoredLlmSettings = {}
  if (typeof llmRaw.apiKey === 'string') llm.apiKey = llmRaw.apiKey
  if (typeof llmRaw.baseUrl === 'string') llm.baseUrl = llmRaw.baseUrl
  if (typeof llmRaw.model === 'string') llm.model = llmRaw.model
  if (typeof llmRaw.timeoutMs === 'number' && Number.isFinite(llmRaw.timeoutMs) && llmRaw.timeoutMs > 0) {
    llm.timeoutMs = llmRaw.timeoutMs
  }
  if (Array.isArray(llmRaw.providers)) {
    const providers: Array<Partial<LlmProviderConfig>> = []
    for (const item of llmRaw.providers) {
      if (!isRecord(item)) continue
      const p: Partial<LlmProviderConfig> = {}
      if (typeof item.id === 'string' && item.id !== '') p.id = item.id
      if (typeof item.label === 'string' && item.label !== '') p.label = item.label
      if (typeof item.apiKey === 'string') p.apiKey = item.apiKey
      if (typeof item.baseUrl === 'string') p.baseUrl = item.baseUrl
      if (typeof item.model === 'string') p.model = item.model
      if (typeof item.timeoutMs === 'number' && Number.isFinite(item.timeoutMs) && item.timeoutMs > 0) {
        p.timeoutMs = item.timeoutMs
      }
      providers.push(p)
    }
    if (providers.length > 0) llm.providers = providers
  }

  const context: Partial<ContextSettings> = {}
  if (typeof contextRaw.retrievalEnabled === 'boolean') context.retrievalEnabled = contextRaw.retrievalEnabled
  if (typeof contextRaw.topK === 'number' && Number.isFinite(contextRaw.topK) && contextRaw.topK >= 1) {
    context.topK = Math.trunc(contextRaw.topK)
  }
  if (
    typeof contextRaw.recentWindow === 'number' &&
    Number.isFinite(contextRaw.recentWindow) &&
    contextRaw.recentWindow >= 0
  ) {
    context.recentWindow = Math.trunc(contextRaw.recentWindow)
  }
  if (typeof contextRaw.chunkSize === 'number' && Number.isFinite(contextRaw.chunkSize) && contextRaw.chunkSize >= 100) {
    context.chunkSize = Math.trunc(contextRaw.chunkSize)
  }

  const tools: Partial<ToolSettings> = {}
  if (typeof toolsRaw.workspace === 'string') tools.workspace = toolsRaw.workspace
  if (toolsRaw.readPolicy === 'allow' || toolsRaw.readPolicy === 'deny' || toolsRaw.readPolicy === 'ask') {
    tools.readPolicy = toolsRaw.readPolicy
  }
  if (toolsRaw.writePolicy === 'allow' || toolsRaw.writePolicy === 'deny' || toolsRaw.writePolicy === 'ask') {
    tools.writePolicy = toolsRaw.writePolicy
  }
  if (typeof toolsRaw.maxIterations === 'number' && Number.isFinite(toolsRaw.maxIterations) && toolsRaw.maxIterations >= 1) {
    tools.maxIterations = toolsRaw.maxIterations
  }

  const out: StoredSettings = {}
  if (Object.keys(llm).length > 0) out.llm = llm
  if (Object.keys(context).length > 0) out.context = context
  if (Object.keys(tools).length > 0) out.tools = tools
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

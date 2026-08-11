import { ipcMain } from 'electron'
import type { LlmSettings } from '../shared/config'
import type { Runtime } from './runtime'
import type { ChatOptions, FimInput } from './model-router'
import type { SettingsStore } from '../shared/settings'

export interface IpcHandler {
  (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown): void
}

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

function sanitizeSettings(value: unknown): Partial<LlmSettings> {
  const v = (value ?? {}) as Record<string, unknown>
  const out: Partial<LlmSettings> = {}
  if (typeof v.apiKey === 'string') out.apiKey = v.apiKey
  if (typeof v.baseUrl === 'string') out.baseUrl = v.baseUrl
  if (typeof v.model === 'string') out.model = v.model
  if (typeof v.timeoutMs === 'number' && Number.isFinite(v.timeoutMs) && v.timeoutMs > 0) {
    out.timeoutMs = v.timeoutMs
  }
  return out
}

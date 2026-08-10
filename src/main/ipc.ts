import { ipcMain } from 'electron'
import type { LlmSettings } from '../shared/config'
import type { Runtime } from './runtime'
import type { SettingsStore } from '../shared/settings'

export interface IpcHandler {
  (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown): void
}

export function registerIpc(runtime: Runtime, store: SettingsStore): void {
  ipcMain.handle('chat:create-session', () => {
    return runtime.createSession()
  })

  ipcMain.handle('chat:message', (_event, sessionId: unknown, text: unknown) => {
    if (typeof sessionId !== 'string' || typeof text !== 'string') {
      throw new Error('参数错误：sessionId 与 text 必须为字符串')
    }
    return runtime.handleMessage(sessionId, text)
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

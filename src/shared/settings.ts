import type { LlmSettings } from './config'

export interface SettingsStore {
  load(): Promise<Partial<LlmSettings>>
  save(settings: Partial<LlmSettings>): Promise<void>
}

export class MemorySettingsStore implements SettingsStore {
  private data: Partial<LlmSettings>

  constructor(initial: Partial<LlmSettings> = {}) {
    this.data = { ...initial }
  }

  async load(): Promise<Partial<LlmSettings>> {
    return { ...this.data }
  }

  async save(settings: Partial<LlmSettings>): Promise<void> {
    this.data = { ...settings }
  }
}

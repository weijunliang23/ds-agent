import type { StoredSettings } from './config'

export interface SettingsStore {
  load(): Promise<StoredSettings>
  save(settings: StoredSettings): Promise<void>
}

export class MemorySettingsStore implements SettingsStore {
  private data: StoredSettings

  constructor(initial: StoredSettings = {}) {
    this.data = {
      llm: { ...(initial.llm ?? {}) },
      tools: { ...(initial.tools ?? {}) }
    }
  }

  async load(): Promise<StoredSettings> {
    return {
      llm: { ...this.data.llm },
      tools: { ...this.data.tools }
    }
  }

  async save(settings: StoredSettings): Promise<void> {
    this.data = {
      llm: { ...(settings.llm ?? {}) },
      tools: { ...(settings.tools ?? {}) }
    }
  }
}

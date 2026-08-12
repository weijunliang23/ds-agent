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
      context: { ...(initial.context ?? {}) },
      tools: { ...(initial.tools ?? {}) }
    }
  }

  async load(): Promise<StoredSettings> {
    return {
      llm: { ...this.data.llm },
      context: { ...this.data.context },
      tools: { ...this.data.tools }
    }
  }

  async save(settings: StoredSettings): Promise<void> {
    this.data = {
      llm: { ...(settings.llm ?? {}) },
      context: { ...(settings.context ?? {}) },
      tools: { ...(settings.tools ?? {}) }
    }
  }
}

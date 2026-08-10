import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LlmSettings } from '../shared/config'
import type { SettingsStore } from '../shared/settings'

export class FileSettingsStore implements SettingsStore {
  constructor(private readonly dir: string) {}

  private filePath(): string {
    return join(this.dir, 'settings.json')
  }

  async load(): Promise<Partial<LlmSettings>> {
    try {
      const raw = await readFile(this.filePath(), 'utf-8')
      const parsed = JSON.parse(raw) as { llm?: Partial<LlmSettings> }
      return parsed.llm ?? {}
    } catch {
      return {}
    }
  }

  async save(settings: Partial<LlmSettings>): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const tmpPath = join(this.dir, `settings.${Date.now()}.tmp`)
    await writeFile(tmpPath, JSON.stringify({ llm: settings }, null, 2), 'utf-8')
    await rename(tmpPath, this.filePath())
  }
}

export function createSettingsStore(dir: string): SettingsStore {
  return new FileSettingsStore(dir)
}

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { StoredSettings } from '../shared/config'
import type { SettingsStore } from '../shared/settings'

export class FileSettingsStore implements SettingsStore {
  constructor(private readonly dir: string) {}

  private filePath(): string {
    return join(this.dir, 'settings.json')
  }

  async load(): Promise<StoredSettings> {
    try {
      const raw = await readFile(this.filePath(), 'utf-8')
      const parsed = JSON.parse(raw) as { llm?: unknown; context?: unknown; tools?: unknown }
      return {
        llm: isRecord(parsed.llm) ? parsed.llm : {},
        context: isRecord(parsed.context) ? parsed.context : {},
        tools: isRecord(parsed.tools) ? parsed.tools : {}
      }
    } catch {
      return {}
    }
  }

  async save(settings: StoredSettings): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const tmpPath = join(this.dir, `settings.${Date.now()}.tmp`)
    await writeFile(
      tmpPath,
      JSON.stringify(
        { llm: settings.llm ?? {}, context: settings.context ?? {}, tools: settings.tools ?? {} },
        null,
        2
      ),
      'utf-8'
    )
    await rename(tmpPath, this.filePath())
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function createSettingsStore(dir: string): SettingsStore {
  return new FileSettingsStore(dir)
}

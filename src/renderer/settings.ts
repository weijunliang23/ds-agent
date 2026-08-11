interface SettingsOptions {
  onBack: () => void
}

interface StoredSettingsLike {
  llm?: Record<string, unknown>
  tools?: Record<string, unknown>
}

export function initSettings(options: SettingsOptions): void {
  const formEl = document.getElementById('settings-form')
  const apiKeyEl = document.getElementById('set-api-key') as HTMLInputElement | null
  const baseUrlEl = document.getElementById('set-base-url') as HTMLInputElement | null
  const modelEl = document.getElementById('set-model') as HTMLInputElement | null
  const timeoutEl = document.getElementById('set-timeout') as HTMLInputElement | null
  const workspaceEl = document.getElementById('set-workspace') as HTMLInputElement | null
  const readPolicyEl = document.getElementById('set-read-policy') as HTMLSelectElement | null
  const writePolicyEl = document.getElementById('set-write-policy') as HTMLSelectElement | null
  const statusEl = document.getElementById('settings-status')
  const saveBtn = document.getElementById('btn-save-settings') as HTMLButtonElement | null
  const backBtn = document.getElementById('btn-close-settings')

  backBtn?.addEventListener('click', () => {
    options.onBack()
  })

  async function load(): Promise<void> {
    try {
      const settings = (await window.api.getSettings()) as StoredSettingsLike
      const llm = settings.llm ?? {}
      if (apiKeyEl) apiKeyEl.value = typeof llm.apiKey === 'string' ? llm.apiKey : ''
      if (baseUrlEl) baseUrlEl.value = typeof llm.baseUrl === 'string' ? llm.baseUrl : ''
      if (modelEl) modelEl.value = typeof llm.model === 'string' ? llm.model : ''
      if (timeoutEl) {
        timeoutEl.value = typeof llm.timeoutMs === 'number' ? String(llm.timeoutMs) : ''
      }
      const tools = settings.tools ?? {}
      if (workspaceEl) workspaceEl.value = typeof tools.workspace === 'string' ? tools.workspace : ''
      if (readPolicyEl) readPolicyEl.value = normalizePolicy(tools.readPolicy as string | undefined)
      if (writePolicyEl) writePolicyEl.value = normalizePolicy(tools.writePolicy as string | undefined)
    } catch {
      setStatus('读取设置失败', true)
    }
  }

  function setStatus(message: string, isError = false): void {
    if (!statusEl) return
    statusEl.textContent = message
    statusEl.classList.toggle('error', isError)
  }

  formEl?.addEventListener('submit', (event) => {
    event.preventDefault()
    void save()
  })

  async function save(): Promise<void> {
    if (saveBtn) saveBtn.disabled = true
    try {
      const timeoutRaw = timeoutEl?.value ?? ''
      const timeoutMs = timeoutRaw === '' ? 60000 : Number(timeoutRaw)
      await window.api.saveSettings({
        llm: {
          apiKey: apiKeyEl?.value ?? '',
          baseUrl: baseUrlEl?.value ?? '',
          model: modelEl?.value ?? '',
          timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000
        },
        tools: {
          workspace: workspaceEl?.value.trim() ?? '',
          readPolicy: normalizePolicy(readPolicyEl?.value),
          writePolicy: normalizePolicy(writePolicyEl?.value)
        }
      })
      setStatus('已保存，即时生效')
    } catch {
      setStatus('保存失败', true)
    } finally {
      if (saveBtn) saveBtn.disabled = false
    }
  }

  void load()
}

function normalizePolicy(value: string | undefined): 'allow' | 'ask' | 'deny' {
  return value === 'allow' || value === 'deny' ? value : 'ask'
}

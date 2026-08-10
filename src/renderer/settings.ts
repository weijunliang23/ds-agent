interface SettingsOptions {
  onBack: () => void
}

export function initSettings(options: SettingsOptions): void {
  const formEl = document.getElementById('settings-form')
  const apiKeyEl = document.getElementById('set-api-key') as HTMLInputElement | null
  const baseUrlEl = document.getElementById('set-base-url') as HTMLInputElement | null
  const modelEl = document.getElementById('set-model') as HTMLInputElement | null
  const timeoutEl = document.getElementById('set-timeout') as HTMLInputElement | null
  const statusEl = document.getElementById('settings-status')
  const saveBtn = document.getElementById('btn-save-settings')
  const backBtn = document.getElementById('btn-close-settings')

  backBtn?.addEventListener('click', () => {
    options.onBack()
  })

  async function load(): Promise<void> {
    try {
      const settings = await window.api.getSettings()
      if (apiKeyEl) apiKeyEl.value = typeof settings.apiKey === 'string' ? settings.apiKey : ''
      if (baseUrlEl) baseUrlEl.value = typeof settings.baseUrl === 'string' ? settings.baseUrl : ''
      if (modelEl) modelEl.value = typeof settings.model === 'string' ? settings.model : ''
      if (timeoutEl) {
        timeoutEl.value = typeof settings.timeoutMs === 'number' ? String(settings.timeoutMs) : ''
      }
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
        apiKey: apiKeyEl?.value ?? '',
        baseUrl: baseUrlEl?.value ?? '',
        model: modelEl?.value ?? '',
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000
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

interface SettingsOptions {
  onBack: () => void
}

interface ProviderLike {
  label?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  timeoutMs?: number
}

interface StoredSettingsLike {
  llm?: {
    providers?: ProviderLike[]
    apiKey?: string
    baseUrl?: string
    model?: string
    timeoutMs?: number
  }
  context?: Record<string, unknown>
  tools?: Record<string, unknown>
}

interface ProviderEditor {
  card: HTMLDivElement
  labelEl: HTMLInputElement
  apiKeyEl: HTMLInputElement
  baseUrlEl: HTMLInputElement
  modelEl: HTMLInputElement
  timeoutEl: HTMLInputElement
  destroy: () => void
}

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function initSettings(options: SettingsOptions): void {
  const formEl = document.getElementById('settings-form')
  const providerListEl = document.getElementById('provider-list')
  const addBtn = document.getElementById('btn-add-provider')
  const retrievalEnabledEl = document.getElementById('set-retrieval-enabled') as HTMLInputElement | null
  const contextTopKEl = document.getElementById('set-context-top-k') as HTMLInputElement | null
  const contextRecentEl = document.getElementById('set-context-recent-window') as HTMLInputElement | null
  const contextChunkEl = document.getElementById('set-context-chunk-size') as HTMLInputElement | null
  const workspaceEl = document.getElementById('set-workspace') as HTMLInputElement | null
  const readPolicyEl = document.getElementById('set-read-policy') as HTMLSelectElement | null
  const writePolicyEl = document.getElementById('set-write-policy') as HTMLSelectElement | null
  const statusEl = document.getElementById('settings-status')
  const saveBtn = document.getElementById('btn-save-settings') as HTMLButtonElement | null
  const backBtn = document.getElementById('btn-close-settings')

  const editors: ProviderEditor[] = []

  backBtn?.addEventListener('click', () => {
    options.onBack()
  })

  function renumber(): void {
    editors.forEach((editor, i) => {
      const title = editor.card.querySelector<HTMLElement>('[data-provider-title]')
      if (title) title.textContent = `Provider ${i + 1}`
    })
  }

  // Create a single provider editor card; provider values are optional.
  function addProviderEditor(provider: ProviderLike | undefined, index: number): void {
    if (!providerListEl) return
    const card = document.createElement('div')
    card.className = 'provider-card'
    card.innerHTML = `
      <div class="provider-card-header">
        <span class="provider-card-title" data-provider-title>Provider ${index + 1}</span>
        <button class="btn-ghost" type="button" data-remove>移除</button>
      </div>
      <label class="field">
        <span>名称（可选）</span>
        <input type="text" data-label autocomplete="off" placeholder="如 DeepSeek" value="${escapeAttr(provider?.label ?? '')}" />
      </label>
      <label class="field">
        <span>AppKey（模型密钥）</span>
        <input type="password" data-api-key autocomplete="off" placeholder="sk-xxx" value="${escapeAttr(provider?.apiKey ?? '')}" />
      </label>
      <label class="field">
        <span>API 地址</span>
        <input type="url" data-base-url autocomplete="off" placeholder="https://api.example.com/v1" value="${escapeAttr(provider?.baseUrl ?? '')}" />
      </label>
      <label class="field">
        <span>模型名</span>
        <input type="text" data-model autocomplete="off" placeholder="deepseek-chat" value="${escapeAttr(provider?.model ?? '')}" />
      </label>
      <label class="field">
        <span>超时（毫秒）</span>
        <input type="number" data-timeout min="1000" value="${provider?.timeoutMs ? String(provider.timeoutMs) : ''}" />
      </label>
    `

    const labelEl = card.querySelector<HTMLInputElement>('[data-label]')!
    const apiKeyEl = card.querySelector<HTMLInputElement>('[data-api-key]')!
    const baseUrlEl = card.querySelector<HTMLInputElement>('[data-base-url]')!
    const modelEl = card.querySelector<HTMLInputElement>('[data-model]')!
    const timeoutEl = card.querySelector<HTMLInputElement>('[data-timeout]')!
    const removeBtn = card.querySelector<HTMLButtonElement>('[data-remove]')

    const destroy = (): void => {
      const idx = editors.indexOf(editor)
      if (idx !== -1) editors.splice(idx, 1)
      card.remove()
      renumber()
    }

    const editor: ProviderEditor = { card, labelEl, apiKeyEl, baseUrlEl, modelEl, timeoutEl, destroy }
    removeBtn?.addEventListener('click', () => {
      // Keep at least one provider editor on screen.
      if (editors.length <= 1) return
      editor.destroy()
    })

    editors.push(editor)
    providerListEl.appendChild(card)
  }

  addBtn?.addEventListener('click', () => {
    addProviderEditor(undefined, editors.length)
  })

  async function load(): Promise<void> {
    try {
      const settings = (await window.api.getSettings()) as StoredSettingsLike
      const llm = settings.llm ?? {}
      const providers =
        Array.isArray(llm.providers) && llm.providers.length > 0
          ? llm.providers
          : [
              {
                apiKey: llm.apiKey,
                baseUrl: llm.baseUrl,
                model: llm.model,
                timeoutMs: llm.timeoutMs
              }
            ]
      providers.forEach((p, i) => addProviderEditor(p, i))

      const context = settings.context ?? {}
      if (retrievalEnabledEl) retrievalEnabledEl.checked = context.retrievalEnabled !== false
      if (contextTopKEl) contextTopKEl.value = typeof context.topK === 'number' ? String(context.topK) : ''
      if (contextRecentEl) contextRecentEl.value = typeof context.recentWindow === 'number' ? String(context.recentWindow) : ''
      if (contextChunkEl) contextChunkEl.value = typeof context.chunkSize === 'number' ? String(context.chunkSize) : ''

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
      const providers: ProviderLike[] = editors.map((editor) => {
        const p: ProviderLike = {}
        const label = editor.labelEl.value.trim()
        const apiKey = editor.apiKeyEl.value.trim()
        const baseUrl = editor.baseUrlEl.value.trim()
        const model = editor.modelEl.value.trim()
        if (label !== '') p.label = label
        if (apiKey !== '') p.apiKey = apiKey
        if (baseUrl !== '') p.baseUrl = baseUrl
        if (model !== '') p.model = model
        const t = Number(editor.timeoutEl.value)
        if (Number.isFinite(t) && t > 0) p.timeoutMs = t
        return p
      })

      await window.api.saveSettings({
        llm: { providers },
        context: {
          retrievalEnabled: retrievalEnabledEl?.checked ?? true,
          topK: numberOr(contextTopKEl?.value, 3, 1, 20),
          recentWindow: numberOr(contextRecentEl?.value, 8, 0, 200),
          chunkSize: numberOr(contextChunkEl?.value, 500, 100, 4000)
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

function numberOr(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined ? NaN : Number(raw)
  if (Number.isFinite(n) && n >= min && n <= max) {
    return Math.trunc(n)
  }
  return fallback
}

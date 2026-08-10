export interface ChatController {
  bootstrap(): Promise<void>
}

interface ChatOptions {
  onOpenSettings: () => void
}

export function initChat(options: ChatOptions): ChatController {
  const messagesEl = document.getElementById('messages')
  const formEl = document.getElementById('chat-form') as HTMLFormElement | null
  const inputEl = document.getElementById('input-message') as HTMLTextAreaElement | null
  const sendBtn = document.getElementById('btn-send') as HTMLButtonElement | null
  const settingsBtn = document.getElementById('btn-open-settings')
  const thinkingToggle = document.getElementById('thinking-toggle') as HTMLInputElement | null
  const effortSelect = document.getElementById('reasoning-effort') as HTMLSelectElement | null
  const fimToggle = document.getElementById('fim-toggle') as HTMLInputElement | null
  const fimForm = document.getElementById('fim-form') as HTMLFormElement | null
  const prefixEl = document.getElementById('input-prefix') as HTMLTextAreaElement | null
  const suffixEl = document.getElementById('input-suffix') as HTMLTextAreaElement | null

  let sessionId = ''
  let busy = false

  settingsBtn?.addEventListener('click', () => {
    if (!busy) {
      options.onOpenSettings()
    }
  })

  formEl?.addEventListener('submit', (event) => {
    event.preventDefault()
    void send()
  })

  fimForm?.addEventListener('submit', (event) => {
    event.preventDefault()
    void sendFim()
  })

  inputEl?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  })

  inputEl?.addEventListener('input', () => {
    resizeInput()
    updateSendState()
  })

  fimToggle?.addEventListener('change', () => {
    const on = fimToggle.checked
    if (formEl) formEl.hidden = on
    if (fimForm) fimForm.hidden = !on
  })

  function resizeInput(): void {
    if (!inputEl) return
    inputEl.style.height = 'auto'
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 140)}px`
  }

  function updateSendState(): void {
    if (!sendBtn) return
    const hasText = (inputEl?.value.trim() ?? '') !== ''
    sendBtn.disabled = busy || !hasText
  }

  function chatOptions(): { thinking: 'enabled' | 'disabled'; reasoningEffort?: 'low' | 'high' | 'max' } {
    if (!thinkingToggle?.checked) {
      return { thinking: 'disabled' }
    }
    return {
      thinking: 'enabled',
      reasoningEffort: (effortSelect?.value as 'low' | 'high' | 'max') ?? 'high'
    }
  }

  function appendMessage(role: 'user' | 'assistant' | 'system' | 'error', content: string): void {
    if (!messagesEl) return
    const el = document.createElement('div')
    el.className = `msg ${role}`
    el.textContent = content
    messagesEl.appendChild(el)
    messagesEl.scrollTop = messagesEl.scrollHeight
  }

  function setBusy(value: boolean): void {
    busy = value
    if (inputEl) inputEl.disabled = value
    updateSendState()
  }

  async function send(): Promise<void> {
    const text = inputEl?.value.trim() ?? ''
    if (!text || busy) return
    if (inputEl) inputEl.value = ''

    appendMessage('user', text)
    setBusy(true)
    try {
      const reply = await window.api.chat(sessionId, text, chatOptions())
      appendMessage('assistant', reply)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      appendMessage('error', message)
      appendMessage('system', '可在设置中检查模型配置后重试')
    } finally {
      setBusy(false)
      resizeInput()
      inputEl?.focus()
    }
  }

  async function sendFim(): Promise<void> {
    const prompt = prefixEl?.value.trim() ?? ''
    if (!prompt || busy) return
    const suffix = suffixEl?.value.trim() ?? ''

    setBusy(true)
    try {
      const reply = await window.api.fim({ prompt, ...(suffix ? { suffix } : {}) })
      appendMessage('assistant', reply)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      appendMessage('error', message)
      appendMessage('system', '可在设置中检查模型配置后重试')
    } finally {
      setBusy(false)
    }
  }

  async function bootstrap(): Promise<void> {
    sessionId = await window.api.createSession()
    appendMessage('system', '会话已就绪')
    inputEl?.focus()
  }

  return { bootstrap }
}

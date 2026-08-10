export interface ChatController {
  bootstrap(): Promise<void>
}

interface ChatOptions {
  onOpenSettings: () => void
}

export function initChat(options: ChatOptions): ChatController {
  const messagesEl = document.getElementById('messages')
  const formEl = document.getElementById('chat-form')
  const inputEl = document.getElementById('input-message') as HTMLTextAreaElement | null
  const sendBtn = document.getElementById('btn-send') as HTMLButtonElement | null
  const settingsBtn = document.getElementById('btn-open-settings')

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

  inputEl?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  })

  inputEl?.addEventListener('input', () => {
    resizeInput()
  })

  function resizeInput(): void {
    if (!inputEl) return
    inputEl.style.height = 'auto'
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 140)}px`
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
    if (sendBtn) sendBtn.disabled = value
    if (inputEl) inputEl.disabled = value
  }

  async function send(): Promise<void> {
    const text = inputEl?.value.trim() ?? ''
    if (!text || busy) return
    if (inputEl) inputEl.value = ''

    appendMessage('user', text)
    setBusy(true)
    try {
      const reply = await window.api.chat(sessionId, text)
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

  async function bootstrap(): Promise<void> {
    sessionId = await window.api.createSession()
    appendMessage('system', '会话已就绪')
    inputEl?.focus()
  }

  return { bootstrap }
}

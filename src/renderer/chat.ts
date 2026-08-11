import { renderMarkdown } from './markdown'
import { initSidebar, type SidebarController } from './sidebar'

export interface ChatController {
  bootstrap(): Promise<void>
}

interface ChatOptions {
  onOpenSettings: () => void
}

interface StoredMessage {
  role: string
  content: string
  reasoningContent?: string
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

  let currentId = ''
  let busy = false

  const sidebar: SidebarController = initSidebar({
    onSwitch: (id) => switchTo(id),
    onNew: () => createNew(),
    onDeleted: (ids) => handleDeleted(ids)
  })

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

  function clearMessages(): void {
    if (!messagesEl) return
    messagesEl.textContent = ''
  }

  function scrollToBottom(): void {
    if (!messagesEl) return
    messagesEl.scrollTop = messagesEl.scrollHeight
  }

  function appendStoredAssistant(message: StoredMessage): void {
    if (!messagesEl) return
    const el = document.createElement('div')
    el.className = 'msg assistant'

    const contentEl = document.createElement('div')
    contentEl.className = 'msg-content'
    contentEl.innerHTML = renderMarkdown(message.content)
    el.appendChild(contentEl)

    if (message.reasoningContent) {
      const header = document.createElement('div')
      header.className = 'reasoning-header'
      const chevron = document.createElement('span')
      chevron.className = 'reasoning-chevron'
      chevron.textContent = '▸'
      const label = document.createElement('span')
      label.className = 'reasoning-label'
      label.textContent = '思考过程'
      header.append(chevron, label)

      const body = document.createElement('div')
      body.className = 'reasoning-body'
      body.hidden = true
      body.textContent = message.reasoningContent

      el.insertBefore(header, contentEl)
      el.insertBefore(body, contentEl)

      let expanded = false
      header.addEventListener('click', () => {
        expanded = !expanded
        body.hidden = !expanded
        chevron.textContent = expanded ? '▾' : '▸'
      })
    }

    messagesEl.appendChild(el)
    scrollToBottom()
  }

  function renderHistory(messages: StoredMessage[]): void {
    clearMessages()
    for (const message of messages) {
      if (message.role === 'user') {
        appendMessage('user', message.content)
      } else if (message.role === 'assistant') {
        appendStoredAssistant(message)
      }
    }
  }

  async function createNew(): Promise<void> {
    if (busy) return
    currentId = await window.api.createSession()
    renderHistory([])
    sidebar.setActive(currentId)
    await sidebar.refresh(currentId)
    appendMessage('system', '新对话已创建')
    inputEl?.focus()
  }

  async function switchTo(id: string): Promise<void> {
    if (busy || id === currentId) return
    const conversation = await window.api.loadConversation(id)
    if (!conversation) return
    currentId = conversation.id
    renderHistory(conversation.messages)
    sidebar.setActive(currentId)
    await sidebar.refresh(currentId)
    inputEl?.focus()
  }

  async function handleDeleted(ids: string[]): Promise<void> {
    await sidebar.refresh(null)
    if (!ids.includes(currentId)) return
    const list = await window.api.listConversations()
    if (list.length > 0) {
      await switchTo(list[0].id)
    } else {
      await createNew()
    }
  }

  function setBusy(value: boolean): void {
    busy = value
    if (inputEl) inputEl.disabled = value
    updateSendState()
  }

  interface AssistantStreamView {
    reasoning(delta: string): void
    content(delta: string): void
    error(message: string): void
    finish(): void
  }

  function createAssistantStream(isThinking: boolean): AssistantStreamView | null {
    if (!messagesEl) return null

    const el = document.createElement('div')
    el.className = 'msg assistant'
    messagesEl.appendChild(el)

    const contentEl = document.createElement('div')
    contentEl.className = 'msg-content'
    el.appendChild(contentEl)

    let headerEl: HTMLDivElement | null = null
    let reasoningBody: HTMLDivElement | null = null
    let spinnerEl: HTMLSpanElement | null = null
    let reasoningActive = false
    let reasoningExpanded = true
    let contentStarted = false

    if (isThinking) {
      headerEl = document.createElement('div')
      headerEl.className = 'reasoning-header'
      const chevron = document.createElement('span')
      chevron.className = 'reasoning-chevron'
      const spinner = document.createElement('span')
      spinner.className = 'spinner'
      spinnerEl = spinner
      const label = document.createElement('span')
      label.className = 'reasoning-label'
      label.textContent = '思考中…'
      headerEl.append(chevron, spinner, label)
      el.insertBefore(headerEl, contentEl)

      reasoningBody = document.createElement('div')
      reasoningBody.className = 'reasoning-body'
      el.insertBefore(reasoningBody, contentEl)

      const renderHeader = (): void => {
        if (!headerEl) return
        const chevronEl = headerEl.querySelector('.reasoning-chevron') as HTMLElement | null
        const labelEl = headerEl.querySelector('.reasoning-label') as HTMLElement | null
        if (chevronEl) chevronEl.textContent = reasoningExpanded ? '▾' : '▸'
        if (labelEl) labelEl.textContent = reasoningActive ? '思考过程' : '思考中…'
      }

      headerEl.addEventListener('click', () => {
        reasoningExpanded = !reasoningExpanded
        if (reasoningBody) reasoningBody.hidden = !reasoningExpanded
        renderHeader()
      })
      renderHeader()
    }

    const finishThinking = (): void => {
      if (spinnerEl) {
        spinnerEl.remove()
        spinnerEl = null
      }
      if (!headerEl) return
      if (reasoningActive) {
        const labelEl = headerEl.querySelector('.reasoning-label') as HTMLElement | null
        if (labelEl) labelEl.textContent = '思考过程'
      } else {
        headerEl.remove()
        if (reasoningBody) reasoningBody.remove()
        headerEl = null
        reasoningBody = null
      }
    }

    let reasoningText = ''
    let contentText = ''

    return {
      reasoning: (delta) => {
        reasoningActive = true
        reasoningText += delta
        if (reasoningBody) {
          reasoningBody.textContent = reasoningText
          reasoningBody.hidden = !reasoningExpanded
        }
        scrollToBottom()
      },
      content: (delta) => {
        if (!contentStarted) {
          contentStarted = true
          finishThinking()
        }
        contentText += delta
        contentEl.innerHTML = renderMarkdown(contentText)
        scrollToBottom()
      },
      error: (message) => {
        if (spinnerEl) {
          spinnerEl.remove()
          spinnerEl = null
        }
        contentEl.classList.add('error')
        contentEl.textContent = message
        scrollToBottom()
      },
      finish: () => {
        finishThinking()
      }
    }
  }

  async function send(): Promise<void> {
    const text = inputEl?.value.trim() ?? ''
    if (!text || busy || currentId === '') return
    if (inputEl) inputEl.value = ''

    appendMessage('user', text)
    setBusy(true)

    const opts = chatOptions()
    const view = createAssistantStream(opts.thinking === 'enabled')

    try {
      await window.api.streamChat(currentId, text, opts, (event) => {
        if (!view) return
        if (event.type === 'reasoning') {
          view.reasoning(event.text)
        } else if (event.type === 'content') {
          view.content(event.text)
        } else if (event.type === 'error') {
          view.error(event.message)
          appendMessage('system', '可在设置中检查模型配置后重试')
        }
      })
      view?.finish()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      view?.error(message)
      appendMessage('system', '可在设置中检查模型配置后重试')
    } finally {
      setBusy(false)
      resizeInput()
      inputEl?.focus()
      void sidebar.refresh(currentId)
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
    const list = await window.api.listConversations()
    if (list.length > 0) {
      await switchTo(list[0].id)
    } else {
      await createNew()
    }
    inputEl?.focus()
  }

  return { bootstrap }
}

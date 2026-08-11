import { showConfirm } from './confirm'

export interface SidebarCallbacks {
  onSwitch(id: string): Promise<void>
  onNew(): Promise<void>
  onDeleted(ids: string[]): Promise<void>
}

export interface SidebarController {
  refresh(activeId: string | null): Promise<void>
  setActive(id: string): void
}

const STORAGE_KEY = 'sidebar.visible'

export function initSidebar(callbacks: SidebarCallbacks): SidebarController {
  const sidebarEl = document.getElementById('sidebar')
  const listEl = document.getElementById('conversation-list')
  const newBtn = document.getElementById('btn-new-chat')
  const batchBtn = document.getElementById('btn-batch-mode')
  const hideBtn = document.getElementById('btn-hide-sidebar')
  const showBtn = document.getElementById('btn-show-sidebar')
  const batchBar = document.getElementById('batch-bar')
  const batchCount = document.getElementById('batch-count')
  const batchDeleteBtn = document.getElementById('btn-batch-delete') as HTMLButtonElement | null
  const batchCancelBtn = document.getElementById('btn-batch-cancel')

  let activeId = ''
  let batchMode = false
  const selected = new Set<string>()
  let visible = localStorage.getItem(STORAGE_KEY) !== 'false'
  let conversations: { id: string; title: string; updatedAt: number }[] = []

  function applyVisibility(): void {
    localStorage.setItem(STORAGE_KEY, String(visible))
    if (sidebarEl) sidebarEl.hidden = !visible
    if (showBtn) showBtn.hidden = visible
  }

  function formatTime(ts: number): string {
    const date = new Date(ts)
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    if (date.toDateString() === now.toDateString()) {
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`
    }
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  function updateBatchBar(): void {
    if (!batchBar || !batchCount || !batchDeleteBtn) return
    batchBar.hidden = !batchMode
    batchCount.textContent = `已选 ${selected.size} 项`
    batchDeleteBtn.disabled = selected.size === 0
  }

  function render(): void {
    if (!listEl) return
    listEl.textContent = ''
    if (batchBtn) batchBtn.classList.toggle('active', batchMode)
    updateBatchBar()

    if (conversations.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'conv-empty'
      empty.textContent = '暂无对话'
      listEl.appendChild(empty)
      return
    }

    for (const conversation of conversations) {
      const item = document.createElement('div')
      item.className = 'conv-item' + (conversation.id === activeId ? ' active' : '')

      let checkbox: HTMLInputElement | null = null
      if (batchMode) {
        checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.className = 'conv-checkbox'
        checkbox.checked = selected.has(conversation.id)
        checkbox.addEventListener('change', () => {
          if (checkbox?.checked) {
            selected.add(conversation.id)
          } else {
            selected.delete(conversation.id)
          }
          updateBatchBar()
        })
        item.appendChild(checkbox)
      }

      const title = document.createElement('span')
      title.className = 'conv-title'
      title.textContent = conversation.title
      title.title = conversation.title
      item.appendChild(title)

      const time = document.createElement('span')
      time.className = 'conv-time'
      time.textContent = formatTime(conversation.updatedAt)
      item.appendChild(time)

      if (!batchMode) {
        const del = document.createElement('button')
        del.className = 'conv-delete'
        del.type = 'button'
        del.title = '删除对话'
        del.textContent = '✕'
        del.addEventListener('click', (event) => {
          event.stopPropagation()
          void (async () => {
            const confirmed = await showConfirm(`确定删除对话「${conversation.title}」？此操作不可恢复。`)
            if (!confirmed) return
            await window.api.deleteConversation(conversation.id)
            callbacks.onDeleted([conversation.id])
          })()
        })
        item.appendChild(del)
      }

      item.addEventListener('click', () => {
        if (batchMode && checkbox) {
          checkbox.checked = !checkbox.checked
          checkbox.dispatchEvent(new Event('change'))
          return
        }
        void callbacks.onSwitch(conversation.id)
      })

      listEl.appendChild(item)
    }
  }

  async function refresh(active: string | null): Promise<void> {
    const list = await window.api.listConversations()
    conversations = list
    if (active) {
      activeId = active
    } else if (!list.some((c) => c.id === activeId)) {
      activeId = ''
    }
    selected.clear()
    render()
  }

  function setActive(id: string): void {
    activeId = id
    render()
  }

  newBtn?.addEventListener('click', () => {
    void callbacks.onNew()
  })

  batchBtn?.addEventListener('click', () => {
    batchMode = !batchMode
    selected.clear()
    render()
  })

  batchDeleteBtn?.addEventListener('click', () => {
    if (selected.size === 0) return
    void (async () => {
      const confirmed = await showConfirm(`确定删除选中的 ${selected.size} 个对话？此操作不可恢复。`)
      if (!confirmed) return
      const ids = [...selected]
      await window.api.deleteConversations(ids)
      callbacks.onDeleted(ids)
    })()
  })

  batchCancelBtn?.addEventListener('click', () => {
    batchMode = false
    selected.clear()
    render()
  })

  hideBtn?.addEventListener('click', () => {
    visible = false
    applyVisibility()
  })

  showBtn?.addEventListener('click', () => {
    visible = true
    applyVisibility()
  })

  applyVisibility()
  void refresh(null)

  return { refresh, setActive }
}

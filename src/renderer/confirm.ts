let modal: HTMLElement | null = null
let messageEl: HTMLElement | null = null
let okBtn: HTMLButtonElement | null = null
let resolveFn: ((confirmed: boolean) => void) | null = null

function init(): void {
  modal = document.getElementById('confirm-modal')
  messageEl = document.getElementById('confirm-message')
  okBtn = document.getElementById('confirm-ok') as HTMLButtonElement | null
  if (!modal || !messageEl || !okBtn) return

  const backdrop = modal.querySelector('.modal-backdrop')
  const cancelBtn = document.getElementById('confirm-cancel')
  backdrop?.addEventListener('click', () => close(false))
  cancelBtn?.addEventListener('click', () => close(false))
  okBtn.addEventListener('click', () => close(true))
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close(false)
    }
  })
}

function close(confirmed: boolean): void {
  if (resolveFn) {
    const resolve = resolveFn
    resolveFn = null
    resolve(confirmed)
  }
  if (modal) modal.hidden = true
}

export function showConfirm(message: string, okText = '确定删除'): Promise<boolean> {
  if (!modal) init()
  if (!modal || !messageEl || !okBtn || resolveFn) {
    return Promise.resolve(false)
  }

  messageEl.textContent = message
  okBtn.textContent = okText
  modal.hidden = false
  okBtn.focus()

  return new Promise<boolean>((resolve) => {
    resolveFn = resolve
  })
}

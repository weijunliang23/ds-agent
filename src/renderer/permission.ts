let modal: HTMLElement | null = null
let messageEl: HTMLElement | null = null
let allowBtn: HTMLButtonElement | null = null
let resolveFn: ((answer: 'allow' | 'deny') => void) | null = null

function init(): void {
  modal = document.getElementById('permission-modal')
  messageEl = document.getElementById('permission-message')
  allowBtn = document.getElementById('permission-allow') as HTMLButtonElement | null
  if (!modal || !messageEl || !allowBtn) return

  const backdrop = modal.querySelector('.modal-backdrop')
  const denyBtn = document.getElementById('permission-deny')
  backdrop?.addEventListener('click', () => close('deny'))
  denyBtn?.addEventListener('click', () => close('deny'))
  allowBtn.addEventListener('click', () => close('allow'))
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close('deny')
    }
  })
}

function close(answer: 'allow' | 'deny'): void {
  if (resolveFn) {
    const resolve = resolveFn
    resolveFn = null
    resolve(answer)
  }
  if (modal) modal.hidden = true
}

export function requestPermission(action: 'read' | 'write', path: string): Promise<'allow' | 'deny'> {
  if (!modal) init()
  if (!modal || !messageEl || !allowBtn || resolveFn) {
    return Promise.resolve('deny')
  }
  const actionLabel = action === 'write' ? '写入' : '读取'
  messageEl.textContent = `模型请求${actionLabel}文件：\n${path}\n\n是否允许？`
  modal.hidden = false
  allowBtn.focus()
  return new Promise<'allow' | 'deny'>((resolve) => {
    resolveFn = resolve
  })
}

export function initPermission(): void {
  window.api.onPermissionRequest((req) => {
    void requestPermission(req.action, req.path).then((answer) => {
      window.api.respondPermission(req.permissionId, answer)
    })
  })
}

let bar: HTMLElement | null = null
let messageEl: HTMLElement | null = null
let allowBtn: HTMLButtonElement | null = null
let resolveFn: ((answer: 'allow' | 'deny') => void) | null = null

function init(): void {
  bar = document.getElementById('permission-bar')
  messageEl = document.getElementById('permission-message')
  allowBtn = document.getElementById('permission-allow') as HTMLButtonElement | null
  if (!bar || !messageEl || !allowBtn) return

  const denyBtn = document.getElementById('permission-deny')
  denyBtn?.addEventListener('click', () => close('deny'))
  allowBtn.addEventListener('click', () => close('allow'))
  bar.addEventListener('keydown', (event) => {
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
  if (bar) bar.hidden = true
}

export function requestPermission(action: 'read' | 'write', path: string): Promise<'allow' | 'deny'> {
  if (!bar) init()
  if (!bar || !messageEl || !allowBtn || resolveFn) {
    return Promise.resolve('deny')
  }
  const actionLabel = action === 'write' ? '写入' : '读取'
  messageEl.textContent = `模型请求${actionLabel}文件：${path}`
  bar.hidden = false
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

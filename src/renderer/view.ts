export type ViewName = 'chat' | 'settings'

export function showView(name: ViewName): void {
  const chatView = document.getElementById('chat-view')
  const settingsView = document.getElementById('settings-view')
  if (chatView) {
    chatView.hidden = name !== 'chat'
  }
  if (settingsView) {
    settingsView.hidden = name !== 'settings'
  }
}

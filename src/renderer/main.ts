import './style.css'
import { initChat } from './chat'
import { initSettings } from './settings'
import { initPermission } from './permission'
import { showView } from './view'

initPermission()

const chat = initChat({ onOpenSettings: () => showView('settings') })
initSettings({ onBack: () => showView('chat') })
showView('chat')

void chat.bootstrap()

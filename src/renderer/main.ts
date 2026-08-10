import './style.css'
import { initChat } from './chat'
import { initSettings } from './settings'
import { showView } from './view'

const chat = initChat({ onOpenSettings: () => showView('settings') })
initSettings({ onBack: () => showView('chat') })
showView('chat')

void chat.bootstrap()

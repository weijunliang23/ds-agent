import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { appTitle } from './app-info'
import { MemoryContextEngine } from './context-engine'
import { registerIpc } from './ipc'
import { OpenAIModelRouter } from './model-router'
import { RuntimeImpl } from './runtime'
import { createSettingsStore } from './settings-store'

let runtime: RuntimeImpl

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    autoHideMenuBar: true,
    title: appTitle('my-agent'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function bootstrap(): Promise<void> {
  const store = createSettingsStore(join(app.getPath('userData'), 'settings'))
  runtime = new RuntimeImpl(new OpenAIModelRouter(), new MemoryContextEngine(), store)
  await runtime.start()
  registerIpc(runtime, store)
  createWindow()
}

app.whenReady().then(() => {
  void bootstrap()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

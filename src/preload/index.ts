import { contextBridge } from 'electron'

const api = {
  version: () => process.env['npm_package_version'] ?? '0.1.0'
}

contextBridge.exposeInMainWorld('api', api)

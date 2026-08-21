import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BridgeApi } from '../shared/types'

const api: BridgeApi = {
  initialFile: () => ipcRenderer.invoke('app:initial-file'),
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  saveDialog: (defaultName) => ipcRenderer.invoke('dialog:save-as', defaultName),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  writeFile: (p, c) => ipcRenderer.invoke('file:write', { path: p, content: c }),
  watchFile: (p) => ipcRenderer.send('file:watch', p),
  listRecents: () => ipcRenderer.invoke('recents:list'),
  addRecent: (p) => ipcRenderer.send('recents:add', p),
  setTitle: (t) => ipcRenderer.send('win:set-title', t),
  setDirty: (d) => ipcRenderer.send('doc:dirty', d),
  forceClose: () => ipcRenderer.send('win:force-close'),
  openExternal: (url) => ipcRenderer.send('shell:external', url),
  resolveAsset: (filePath, src) => ipcRenderer.invoke('asset:resolve', filePath, src),
  getPathForFile: (f) => webUtils.getPathForFile(f),
  onOpenPath: (cb) => ipcRenderer.on('open:path', (_e, p) => cb(p)),
  onFileChanged: (cb) => ipcRenderer.on('file:changed', () => cb()),
  onFileDeleted: (cb) => ipcRenderer.on('file:deleted', () => cb()),
  onRequestSave: (cb) => ipcRenderer.on('app:request-save', () => cb())
}

contextBridge.exposeInMainWorld('api', api)

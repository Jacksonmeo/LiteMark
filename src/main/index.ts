import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { watch, type FSWatcher } from 'chokidar'
import { Recents } from './recents'
import type { SaveFormat } from '../shared/types'

let win: BrowserWindow | null = null
let watcher: FSWatcher | null = null
let dirty = false
let suppressUntil = 0
let initialFile: string | null = null

const recents = new Recents(path.join(app.getPath('userData'), 'recents.json'))

function findMdArg(argv: string[]): string | null {
  for (let i = argv.length - 1; i >= 1; i--) {
    const a = argv[i]
    if (/\.(md|markdown)$/i.test(a) && fs.existsSync(a)) return path.resolve(a)
  }
  return null
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 840,
    minWidth: 680,
    minHeight: 480,
    show: false,
    backgroundColor: '#f7f8fa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win?.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('close', (e) => {
    if (!dirty || !win) return
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning',
      message: '当前文档有未保存的修改',
      buttons: ['保存', '放弃更改', '取消'],
      defaultId: 0,
      cancelId: 2
    })
    if (r === 2) {
      e.preventDefault()
    } else if (r === 0) {
      e.preventDefault()
      win.webContents.send('app:request-save')
    }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function watchFile(p: string): void {
  watcher?.close().catch(() => {})
  watcher = watch(p, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
  })
  watcher.on('change', () => {
    if (Date.now() < suppressUntil) return
    win?.webContents.send('file:changed')
  })
  watcher.on('unlink', () => win?.webContents.send('file:deleted'))
}

function registerIpc(): void {
  ipcMain.handle('app:initial-file', () => initialFile)

  ipcMain.handle('dialog:open', async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  ipcMain.handle('dialog:save-as', async (_e, defaultName: string, format: SaveFormat = 'markdown') => {
    if (!win) return null
    const filters = {
      markdown: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      pdf: [{ name: 'PDF', extensions: ['pdf'] }],
      latex: [{ name: 'LaTeX', extensions: ['tex'] }]
    }
    const r = await dialog.showSaveDialog(win, {
      defaultPath: defaultName || 'untitled.md',
      filters: filters[format]
    })
    return r.canceled || !r.filePath ? null : r.filePath
  })

  ipcMain.handle('file:read', async (_e, p: string) => {
    const [content, stat] = await Promise.all([fsp.readFile(p, 'utf-8'), fsp.stat(p)])
    return { content, mtimeMs: stat.mtimeMs }
  })

  ipcMain.handle('file:write', async (_e, payload: { path: string; content: string }) => {
    suppressUntil = Date.now() + 1200
    await fsp.writeFile(payload.path, payload.content, 'utf-8')
    const stat = await fsp.stat(payload.path)
    return { mtimeMs: stat.mtimeMs }
  })

  ipcMain.handle('file:write-binary', async (_e, payload: { path: string; data: Uint8Array }) => {
    suppressUntil = Date.now() + 1200
    await fsp.writeFile(payload.path, Buffer.from(payload.data))
    const stat = await fsp.stat(payload.path)
    return { mtimeMs: stat.mtimeMs }
  })

  ipcMain.handle('export:pdf', async () => {
    if (!win) return null
    return win.webContents.printToPDF({
      landscape: false,
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
    })
  })

  ipcMain.handle('recents:list', () => ({ items: recents.list() }))
  ipcMain.on('recents:add', (_e, p: string) => recents.add(p))

  ipcMain.on('win:set-title', (_e, t: string) => win?.setTitle(t))
  ipcMain.on('doc:dirty', (_e, d: boolean) => {
    dirty = d
  })
  ipcMain.on('win:force-close', () => {
    dirty = false
    win?.close()
  })
  ipcMain.on('file:watch', (_e, p: string) => watchFile(p))
  ipcMain.on('shell:external', (_e, url: string) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })

  ipcMain.handle('asset:resolve', (_e, filePath: string, src: string) => {
    try {
      if (/^(https?:|data:|file:)/i.test(src)) return src
      const clean = src.split('#')[0].split('?')[0]
      const abs = path.resolve(path.dirname(filePath), decodeURIComponent(clean))
      return fs.existsSync(abs) ? pathToFileURL(abs).toString() : ''
    } catch {
      return ''
    }
  })
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  initialFile = findMdArg(process.argv)
  Menu.setApplicationMenu(null)

  app.on('second-instance', (_e, argv) => {
    const f = findMdArg(argv)
    if (f && win) win.webContents.send('open:path', f)
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })

  app.whenReady().then(() => {
    registerIpc()
    createWindow()
  })

  app.on('window-all-closed', () => app.quit())
}

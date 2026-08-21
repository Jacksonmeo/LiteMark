import './styles/style.css'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'
import {
  applyFixes,
  focusEditor,
  getDocText,
  getEditorScrollDom,
  gotoOffset,
  initEditor,
  setDocText,
  setDiagnosticsListener
} from './editor'
import { renderMarkdown } from './md'
import { initPanel, updatePanel } from './panel'
import { closeModal, isModalOpen, showModal, toast } from './ui'
import type { MdDiag } from './lint/types'

type Mode = 'empty' | 'read' | 'edit'

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id)
  if (!e) throw new Error(`missing #${id}`)
  return e as T
}

const readerEl = el<HTMLElement>('reader')
const workspaceEl = el<HTMLElement>('workspace')
const editorHost = el<HTMLElement>('editor-host')
const previewPane = el<HTMLElement>('preview-pane')
const previewEl = el<HTMLElement>('preview')
const problemsEl = el<HTMLElement>('problems')
const welcomeEl = el<HTMLElement>('welcome')
const topbarEl = el<HTMLElement>('topbar')
const recentsMenuEl = el<HTMLElement>('recents-menu')
const docNameEl = el<HTMLElement>('doc-name')
const btnMode = el<HTMLButtonElement>('btn-mode')
const dropHintEl = el<HTMLElement>('drop-hint')

const state = {
  mode: 'empty' as Mode,
  path: null as string | null,
  crlf: false,
  savedContent: '',
  dirty: false,
  suppressExternalUntil: 0,
  diagnostics: [] as MdDiag[],
  previewTimer: null as ReturnType<typeof setTimeout> | null
}

function fileName(p: string | null): string {
  if (!p) return ''
  return p.replace(/\\/g, '/').split('/').pop() ?? p
}

function refreshTitle(): void {
  const n = fileName(state.path)
  window.api.setTitle(`${state.dirty ? '• ' : ''}${n || 'LiteMark'} - LiteMark`)
  docNameEl.textContent = n
}

function markDirty(d: boolean): void {
  state.dirty = d
  window.api.setDirty(d)
  refreshTitle()
}

function setMode(mode: Mode): void {
  state.mode = mode
  document.body.dataset.mode = mode
  readerEl.classList.toggle('hidden', mode !== 'read')
  workspaceEl.classList.toggle('hidden', mode !== 'edit')
  problemsEl.classList.toggle('hidden', mode !== 'edit')
  welcomeEl.classList.toggle('hidden', mode !== 'empty')
  btnMode.textContent = mode === 'edit' ? '阅读 Esc' : '编辑 F4'
  hideRecentsMenu()
  if (mode === 'edit') {
    requestAnimationFrame(() => focusEditor())
    refreshPreviewSoon()
  }
}

async function loadContentIntoApp(rawContent: string, path: string): Promise<void> {
  state.crlf = rawContent.includes('\r\n')
  const content = state.crlf ? rawContent.replace(/\r\n/g, '\n') : rawContent
  setDocText(content)
  state.savedContent = content
  markDirty(false)
  state.path = path
  window.api.addRecent(path)
  window.api.watchFile(path)
  await renderMarkdown(readerEl, content, path)
  readerEl.scrollTop = 0
  refreshTitle()
  setMode('read')
}

function confirmDiscard(): Promise<boolean> {
  return new Promise((resolve) => {
    showModal(
      '未保存的修改',
      '<p>当前文档有未保存的修改，继续操作将丢弃这些修改。</p>',
      [
        {
          label: '取消',
          onClick: () => {
            closeModal()
            resolve(false)
          }
        },
        {
          label: '放弃并继续',
          primary: true,
          onClick: () => {
            closeModal()
            resolve(true)
          }
        }
      ]
    )
  })
}

async function openPath(p: string): Promise<void> {
  if (state.dirty) {
    const go = await confirmDiscard()
    if (!go) return
  }
  try {
    const r = await window.api.readFile(p)
    await loadContentIntoApp(r.content, p)
  } catch (err) {
    toast(`无法打开文件：${String(err)}`)
  }
}

async function openViaDialog(): Promise<void> {
  const p = await window.api.openDialog()
  if (p) await openPath(p)
}

async function writeToFile(p: string): Promise<void> {
  const text = getDocText()
  const out = state.crlf ? text.replace(/\n/g, '\r\n') : text
  try {
    await window.api.writeFile(p, out)
    state.savedContent = text
    state.suppressExternalUntil = Date.now() + 1500
    markDirty(false)
    toast('已保存')
  } catch (err) {
    toast(`保存失败：${String(err)}`)
  }
}

async function saveFile(): Promise<void> {
  if (!state.path) {
    await saveFileAs()
    return
  }
  await writeToFile(state.path)
}

async function saveFileAs(): Promise<void> {
  const suggested = state.path ? fileName(state.path) : 'untitled.md'
  const p = await window.api.saveDialog(suggested)
  if (!p) return
  state.path = p
  await writeToFile(p)
  refreshTitle()
}

let previewSeq = 0

async function renderPreviewPreservingScroll(): Promise<void> {
  if (state.mode !== 'edit') return
  const fd = previewPane.scrollHeight - previewPane.clientHeight
  const ratio = fd > 0 ? previewPane.scrollTop / fd : 0
  const seq = ++previewSeq
  const ok = await renderMarkdown(previewEl, getDocText(), state.path)
  if (!ok || seq !== previewSeq) return
  const nfd = previewPane.scrollHeight - previewPane.clientHeight
  previewPane.scrollTop = nfd > 0 ? ratio * nfd : 0
}

function refreshPreviewSoon(): void {
  if (state.previewTimer) clearTimeout(state.previewTimer)
  state.previewTimer = setTimeout(() => {
    void renderPreviewPreservingScroll()
  }, 150)
}

function onEditorChange(): void {
  markDirty(getDocText() !== state.savedContent)
  refreshPreviewSoon()
}

function showFixAllModal(diags: MdDiag[]): void {
  const fixes = diags.filter((d) => d.fix).map((d) => d.fix!)
  if (fixes.length === 0) {
    toast('没有可自动修复的问题')
    return
  }
  const doc = getDocText()
  const esc = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  const clip = (s: string): string => (s.length > 40 ? s.slice(0, 37) + '…' : s)
  const rows = fixes
    .map((f) => {
      const line = doc.slice(0, f.from).split('\n').length
      const oldText = clip(doc.slice(f.from, f.to))
      const newText = clip(f.insert)
      return `<div class="fix-row"><span class="loc">行 ${line}</span><code>${esc(oldText)}</code><span class="arrow">→</span><code>${esc(newText)}</code></div>`
    })
    .join('')
  showModal(`修复 ${fixes.length} 处`, `<div class="fix-list">${rows}</div>`, [
    { label: '取消', onClick: closeModal },
    {
      label: '应用修复',
      primary: true,
      onClick: () => {
        applyFixes(fixes)
        closeModal()
        toast('已应用修复')
      }
    }
  ])
}

let syncing = false

function syncRatio(from: HTMLElement, to: HTMLElement): void {
  const fd = from.scrollHeight - from.clientHeight
  const td = to.scrollHeight - to.clientHeight
  if (fd <= 0 || td <= 0) return
  to.scrollTop = (from.scrollTop / fd) * td
}

function bindScrollSync(): void {
  const ed = getEditorScrollDom()
  ed.addEventListener('scroll', () => {
    if (syncing) return
    syncing = true
    syncRatio(ed, previewPane)
    setTimeout(() => {
      syncing = false
    }, 60)
  })
  previewPane.addEventListener('scroll', () => {
    if (syncing) return
    syncing = true
    syncRatio(previewPane, ed)
    setTimeout(() => {
      syncing = false
    }, 60)
  })
}

function bindDivider(): void {
  const divider = el<HTMLElement>('divider')
  const editorPane = el<HTMLElement>('editor-pane')
  const saved = Number(localStorage.getItem('litemark.split'))
  if (saved >= 20 && saved <= 80) editorPane.style.flexBasis = `${saved}%`
  divider.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    divider.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent): void => {
      const rect = workspaceEl.getBoundingClientRect()
      const pct = Math.min(80, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100))
      editorPane.style.flexBasis = `${pct}%`
    }
    const up = (ev: PointerEvent): void => {
      divider.releasePointerCapture(ev.pointerId)
      const rect = workspaceEl.getBoundingClientRect()
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      localStorage.setItem('litemark.split', String(Math.round(pct)))
      divider.removeEventListener('pointermove', move)
      divider.removeEventListener('pointerup', up)
    }
    divider.addEventListener('pointermove', move)
    divider.addEventListener('pointerup', up)
  })
}

async function renderRecentsInto(list: HTMLElement): Promise<void> {
  const r = await window.api.listRecents()
  list.innerHTML = ''
  if (r.items.length === 0) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = '暂无最近打开的文件'
    list.appendChild(li)
    return
  }
  for (const p of r.items) {
    const li = document.createElement('li')
    li.title = p
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = fileName(p)
    const dir = document.createElement('span')
    dir.className = 'dir'
    dir.textContent = p
    li.appendChild(name)
    li.appendChild(dir)
    li.addEventListener('click', () => {
      hideRecentsMenu()
      void openPath(p)
    })
    list.appendChild(li)
  }
}

function hideRecentsMenu(): void {
  recentsMenuEl.classList.add('hidden')
}

async function toggleRecentsMenu(): Promise<void> {
  if (!recentsMenuEl.classList.contains('hidden')) {
    hideRecentsMenu()
    return
  }
  await renderRecentsInto(recentsMenuEl)
  recentsMenuEl.classList.remove('hidden')
}

function bindTopbar(): void {
  el('btn-open').addEventListener('click', () => void openViaDialog())
  el('btn-recents').addEventListener('click', () => void toggleRecentsMenu())
  btnMode.addEventListener('click', () => {
    if (state.mode === 'read') setMode('edit')
    else if (state.mode === 'edit') setMode('read')
  })
  document.addEventListener('mousemove', (e) => {
    topbarEl.classList.toggle('show', e.clientY < 70)
  })
  document.addEventListener('click', (e) => {
    const t = e.target as Node
    if (
      !recentsMenuEl.classList.contains('hidden') &&
      !recentsMenuEl.contains(t) &&
      !el('btn-recents').contains(t)
    ) {
      hideRecentsMenu()
    }
  })
}

function bindKeys(): void {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F4') {
      e.preventDefault()
      if (state.mode === 'read') setMode('edit')
      else if (state.mode === 'edit') setMode('read')
      return
    }
    if (e.key === 'Escape') {
      if (isModalOpen()) {
        closeModal()
        return
      }
      if (state.mode === 'edit') setMode('read')
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (e.shiftKey) void saveFileAs()
      else void saveFile()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      void openViaDialog()
    }
  })
}

function bindDrop(): void {
  let depth = 0
  window.addEventListener('dragenter', (e) => {
    e.preventDefault()
    depth++
    dropHintEl.classList.remove('hidden')
  })
  window.addEventListener('dragleave', () => {
    depth--
    if (depth <= 0) {
      depth = 0
      dropHintEl.classList.add('hidden')
    }
  })
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', (e) => {
    e.preventDefault()
    depth = 0
    dropHintEl.classList.add('hidden')
    const f = e.dataTransfer?.files[0]
    if (!f) return
    const p = window.api.getPathForFile(f)
    if (/\.(md|markdown)$/i.test(p)) void openPath(p)
    else toast('仅支持打开 .md / .markdown 文件')
  })
}

function bindLinks(): void {
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    const href = a.getAttribute('href') ?? ''
    e.preventDefault()
    if (!href) return
    if (href.startsWith('#')) {
      const target = href.slice(1)
      const container = state.mode === 'edit' ? previewEl : readerEl
      const dest =
        container.querySelector(`[id="${CSS.escape(target)}"]`) ??
        Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6')).find(
          (h) => h.id === target || h.textContent?.trim() === decodeURIComponent(target)
        )
      dest?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    if (/^https?:/i.test(href)) window.api.openExternal(href)
  })
}

function bindEvents(): void {
  window.api.onOpenPath((p) => void openPath(p))
  window.api.onRequestSave(() => {
    void saveFile().then(() => window.api.forceClose())
  })
  window.api.onFileChanged(() => {
    void handleExternalChange()
  })
  window.api.onFileDeleted(() => {
    if (state.path) toast('文件已被移动或删除')
  })
}

async function handleExternalChange(): Promise<void> {
  if (!state.path) return
  if (Date.now() < state.suppressExternalUntil) return
  let raw: string
  try {
    const r = await window.api.readFile(state.path)
    raw = r.content
  } catch {
    return
  }
  const norm = state.crlf ? raw.replace(/\r\n/g, '\n') : raw
  if (norm === getDocText() || norm === state.savedContent) return
  showModal(
    '文件已被外部修改',
    `<p>${fileName(state.path)} 在外部被修改，是否重新加载？未保存的修改将丢失。</p>`,
    [
      { label: '忽略', onClick: closeModal },
      {
        label: '重新加载',
        primary: true,
        onClick: () => {
          closeModal()
          if (state.path) void loadContentIntoApp(raw, state.path)
        }
      }
    ]
  )
}

async function boot(): Promise<void> {
  initEditor(editorHost, onEditorChange, () => {
    /* scroll handled in bindScrollSync */
  })
  bindScrollSync()
  bindDivider()
  bindTopbar()
  bindKeys()
  bindDrop()
  bindLinks()
  bindEvents()

  setDiagnosticsListener((diags) => {
    state.diagnostics = diags
    updatePanel(diags)
  })
  initPanel({
    jumpTo: (pos) => {
      if (state.mode !== 'edit') setMode('edit')
      gotoOffset(pos)
    },
    fixOne: (d) => {
      if (d.fix) applyFixes([d.fix])
    },
    requestFixAll: showFixAllModal
  })

  const initial = await window.api.initialFile()
  if (initial) {
    await openPath(initial)
  } else {
    setMode('empty')
    await renderRecentsInto(el<HTMLUListElement>('welcome-recents'))
  }
}

void boot()

import './styles/style.css'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'
import {
  applyEditorSettings,
  applyFixes,
  firstVisibleEditorLine,
  focusEditor,
  getDocText,
  getEditorScrollDom,
  gotoOffset,
  initEditor,
  scrollToDocLine,
  setDocText,
  setDiagnosticsListener
} from './editor'
import { assignHeadingIds, renderMarkdown } from './md'
import { initPanel, updatePanel } from './panel'
import {
  applyFontSizes,
  applyPaper,
  applyTheme,
  getSettings,
  isDarkTheme,
  onSettingsChange,
  resetSettings,
  updateSetting,
  type PaperMode,
  type ThemeMode
} from './settings'
import { bindTocSpy, buildToc } from './toc'
import { collectMarks, lineToTop, scrollToLine, topToLine, type SrcMark } from './syncmap'
import { closeModal, isModalOpen, showModal, toast } from './ui'
import type { MdDiag } from './lint/types'

type Mode = 'empty' | 'read' | 'edit'

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id)
  if (!e) throw new Error(`missing #${id}`)
  return e as T
}

const readerEl = el<HTMLElement>('reader')
const readingEl = el<HTMLElement>('reading')
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
const btnTop = el<HTMLButtonElement>('btn-top')
const dropHintEl = el<HTMLElement>('drop-hint')

const state = {
  mode: 'empty' as Mode,
  path: null as string | null,
  crlf: false,
  savedContent: '',
  dirty: false,
  suppressExternalUntil: 0,
  diagnostics: [] as MdDiag[],
  previewTimer: null as ReturnType<typeof setTimeout> | null,
  mtimeMs: null as number | null,
  tocCount: 0
}

let disposeSpy: (() => void) | null = null
let readerMarks: SrcMark[] = []
let previewMarks: SrcMark[] = []
let pendingRestoreLine: number | null = null

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
  pendingRestoreLine = null
  if (state.mode === 'edit' && mode === 'read' && getEditorScrollDom().scrollTop > 2) {
    pendingRestoreLine = firstVisibleEditorLine()
  } else if (state.mode === 'read' && mode === 'edit' && readerEl.scrollTop > 2) {
    const sl = topToLine(readerEl, readerMarks, readerEl.scrollTop + 16)
    pendingRestoreLine = sl === null ? null : Math.round(sl) + 1
  }
  state.mode = mode
  document.body.dataset.mode = mode
  readingEl.classList.toggle('hidden', mode !== 'read')
  workspaceEl.classList.toggle('hidden', mode !== 'edit')
  problemsEl.classList.toggle('hidden', mode !== 'edit')
  welcomeEl.classList.toggle('hidden', mode !== 'empty')
  btnMode.textContent = mode === 'edit' ? '阅读 Esc' : '编辑 F4'
  hideRecentsMenu()
  updateReadingChrome()
  if (mode === 'edit') {
    if (pendingRestoreLine !== null) restorePreviewOnNextRender = true
    requestAnimationFrame(() => {
      if (pendingRestoreLine !== null) scrollToDocLine(pendingRestoreLine)
      focusEditor()
      if (pendingRestoreLine !== null) scrollToDocLine(pendingRestoreLine)
    })
    refreshPreviewSoon()
  } else if (mode === 'read' && pendingRestoreLine !== null) {
    requestAnimationFrame(() => {
      scrollToLine(readerEl, readerMarks, pendingRestoreLine! - 1)
    })
  }
}

function updateReadingChrome(): void {
  const read = state.mode === 'read'
  const s = getSettings()
  const wide = window.innerWidth > 1080
  const showToc = read && s.showToc && wide && state.tocCount > 0
  el('toc').classList.toggle('hidden', !showToc)
  el('btn-toc').classList.toggle('active', showToc)
  const showInfo = read && s.showInfoBar && wide && !!state.path
  el('info-bar').classList.toggle('hidden', !showInfo)
}

async function loadContentIntoApp(
  rawContent: string,
  path: string,
  mtimeMs?: number
): Promise<void> {
  state.crlf = rawContent.includes('\r\n')
  const content = state.crlf ? rawContent.replace(/\r\n/g, '\n') : rawContent
  setDocText(content)
  state.savedContent = content
  markDirty(false)
  state.path = path
  window.api.addRecent(path)
  window.api.watchFile(path)
  await renderMarkdown(readerEl, content, path)
  rebuildToc()
  refreshDocInfo(mtimeMs)
  readerEl.scrollTop = 0
  btnTop.classList.add('hidden')
  refreshTitle()
  setMode('read')
}

function rebuildToc(): void {
  const entries = assignHeadingIds(readerEl)
  state.tocCount = entries.length
  readerMarks = collectMarks(readerEl)
  if (disposeSpy) disposeSpy()
  disposeSpy = null
  buildToc(readerEl, entries, () => {})
  disposeSpy = bindTocSpy(readerEl, entries)
  updateReadingChrome()
}

function countWords(text: string): number {
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) ?? []).length
  const words = (
    text.replace(/[\u3400-\u4dbf\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_'-]+/g) ?? []
  ).length
  return cjk + words
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function refreshDocInfo(mtimeMs?: number): void {
  if (mtimeMs !== undefined) state.mtimeMs = mtimeMs
  const text = getDocText()
  const words = countWords(text)
  const minutes = Math.max(1, Math.round(words / 400))
  el('if-words').textContent = words.toLocaleString()
  el('if-readtime').textContent = `约 ${minutes} 分钟`
  el('if-media').textContent = `${readerEl.querySelectorAll('img').length} / ${readerEl.querySelectorAll('.katex').length}`
  el('if-mtime').textContent = state.mtimeMs === null ? '-' : fmtTime(state.mtimeMs)
}

function refreshLintCard(): void {
  const errors = state.diagnostics.filter((d) => d.severity === 'error').length
  const warnings = state.diagnostics.length - errors
  el('if-lint').innerHTML =
    state.diagnostics.length === 0
      ? '<span class="ok-text">没有问题</span>'
      : `<span class="dot err"></span>${errors} 个错误<span class="dot warn"></span>${warnings} 个警告`
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
    await loadContentIntoApp(r.content, p, r.mtimeMs)
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
let restorePreviewOnNextRender = false

async function renderPreviewPreservingScroll(): Promise<void> {
  if (state.mode !== 'edit') return
  const fd = previewPane.scrollHeight - previewPane.clientHeight
  const ratio = fd > 0 ? previewPane.scrollTop / fd : 0
  const seq = ++previewSeq
  const ok = await renderMarkdown(previewEl, getDocText(), state.path)
  if (!ok || seq !== previewSeq) return
  assignHeadingIds(previewEl)
  previewMarks = collectMarks(previewEl)
  if (restorePreviewOnNextRender && pendingRestoreLine !== null) {
    restorePreviewOnNextRender = false
    scrollToLine(previewPane, previewMarks, pendingRestoreLine - 1)
    return
  }
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
    if (syncing || !getSettings().syncScroll) return
    syncing = true
    const sl = firstVisibleEditorLine() - 1
    if (!scrollToLine(previewPane, previewMarks, sl)) {
      syncRatio(ed, previewPane)
    }
    setTimeout(() => {
      syncing = false
    }, 60)
  })
  previewPane.addEventListener('scroll', () => {
    if (syncing || !getSettings().syncScroll) return
    syncing = true
    const sl = topToLine(previewPane, previewMarks, previewPane.scrollTop + 16)
    if (sl !== null) scrollToDocLine(Math.round(sl) + 1)
    else syncRatio(previewPane, ed)
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
  el('btn-settings').addEventListener('click', () => openSettingsModal())
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
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault()
      resetHoverFontSize()
    }
  })
}

type ZoomPane = 'preview' | 'editor'

function pickPane(target: EventTarget | null): ZoomPane | null {
  const t = target as HTMLElement | null
  if (!t || !(t instanceof Element)) return null
  if (t.closest('#editor-host')) return 'editor'
  if (t.closest('.md-body')) return 'preview'
  return null
}

function bindZoom(): void {
  window.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const pane = pickPane(e.target)
      if (!pane) return
      const delta = e.deltaY < 0 ? 1 : -1
      if (pane === 'editor') {
        updateSetting('editorFontSize', getSettings().editorFontSize + delta)
      } else {
        updateSetting('previewFontSize', getSettings().previewFontSize + delta)
      }
    },
    { passive: false }
  )
}

function resetHoverFontSize(): void {
  if (lastMouse.x < 0) return
  const t = document.elementFromPoint(lastMouse.x, lastMouse.y)
  const pane = pickPane(t)
  if (pane === 'editor') updateSetting('editorFontSize', 14)
  else if (pane === 'preview') updateSetting('previewFontSize', 16)
}

const lastMouse = { x: -1, y: -1 }

function bindMouseTrack(): void {
  window.addEventListener('mousemove', (e) => {
    lastMouse.x = e.clientX
    lastMouse.y = e.clientY
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
        }      }
    ]
  )
}

function openSettingsModal(): void {
  const s = getSettings()
  const segBtn = (group: 'theme' | 'paper', v: string, label: string, cur: string): string =>
    `<button data-g="${group}" data-v="${v}" class="${cur === v ? 'active' : ''}">${label}</button>`
  const html = `
    <div class="set-row"><span class="set-label">外观主题</span>
      <div class="seg" id="set-theme">${segBtn('theme', 'light', '明亮', s.theme)}${segBtn('theme', 'dark', '暗黑', s.theme)}${segBtn('theme', 'system', '跟随系统', s.theme)}</div>
    </div>
    <div class="set-row"><span class="set-label">阅读底色</span>
      <div class="seg" id="set-paper">${segBtn('paper', 'white', '经典白', s.paper)}${segBtn('paper', 'sepia', '书页米黄', s.paper)}${segBtn('paper', 'green', '护眼绿', s.paper)}${segBtn('paper', 'gray', '晨雾灰', s.paper)}</div>
    </div>
    <div class="set-row"><span class="set-label">预览字号</span><input type="number" id="set-pfs" min="12" max="28" step="1" value="${s.previewFontSize}"><span class="unit">px（Ctrl+滚轮可调）</span></div>
    <div class="set-row"><span class="set-label">编辑器字号</span><input type="number" id="set-efs" min="10" max="24" step="1" value="${s.editorFontSize}"><span class="unit">px（Ctrl+滚轮可调）</span></div>
    <label class="set-row set-check"><input type="checkbox" id="set-sync" ${s.syncScroll ? 'checked' : ''}><span>分屏同步滚动</span></label>
    <label class="set-row set-check"><input type="checkbox" id="set-wrap" ${s.wordWrap ? 'checked' : ''}><span>编辑器自动换行</span></label>
    <label class="set-row set-check"><input type="checkbox" id="set-ln" ${s.lineNumbers ? 'checked' : ''}><span>显示行号</span></label>
    <label class="set-row set-check"><input type="checkbox" id="set-toc" ${s.showToc ? 'checked' : ''}><span>阅读时显示目录</span></label>
    <label class="set-row set-check"><input type="checkbox" id="set-info" ${s.showInfoBar ? 'checked' : ''}><span>阅读时显示信息栏</span></label>
    <button id="set-reset" class="link-btn">恢复默认</button>`

  showModal('设置', html, [{ label: '关闭', onClick: closeModal }])

  for (const segId of ['set-theme', 'set-paper'] as const) {
    const seg = el(segId)
    seg.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('button[data-v]')
      if (!btn) return
      if (btn.dataset.g === 'theme') {
        updateSetting('theme', btn.dataset.v as ThemeMode)
      } else {
        updateSetting('paper', btn.dataset.v as PaperMode)
      }
      for (const b of Array.from(seg.children)) (b as HTMLElement).classList.toggle('active', b === btn)
    })
  }

  const bindNumber = (id: string, key: 'previewFontSize' | 'editorFontSize'): void => {
    const input = el<HTMLInputElement>(id)
    input.addEventListener('change', () => {
      const v = Number(input.value)
      if (!Number.isFinite(v)) return
      updateSetting(key, v)
      input.value = String(getSettings()[key])
    })
  }
  bindNumber('set-pfs', 'previewFontSize')
  bindNumber('set-efs', 'editorFontSize')

  const bindCheck = (
    id: string,
    key: 'syncScroll' | 'wordWrap' | 'lineNumbers' | 'showToc' | 'showInfoBar'
  ): void => {
    el<HTMLInputElement>(id).addEventListener('change', (e) => {
      updateSetting(key, (e.target as HTMLInputElement).checked)
    })
  }
  bindCheck('set-sync', 'syncScroll')
  bindCheck('set-wrap', 'wordWrap')
  bindCheck('set-ln', 'lineNumbers')
  bindCheck('set-toc', 'showToc')
  bindCheck('set-info', 'showInfoBar')

  el('set-reset').addEventListener('click', () => {
    resetSettings()
    closeModal()
    toast('已恢复默认设置')
  })
}

function bindTocResize(): void {
  const d = el<HTMLElement>('toc-divider')
  const toc = el('toc')
  const saved = Number(localStorage.getItem('litemark.tocw'))
  if (saved >= 170 && saved <= 420) toc.style.flexBasis = `${saved}px`
  d.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    d.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent): void => {
      const w = Math.min(420, Math.max(170, ev.clientX))
      toc.style.flexBasis = `${w}px`
    }
    const up = (ev: PointerEvent): void => {
      d.releasePointerCapture(ev.pointerId)
      localStorage.setItem(
        'litemark.tocw',
        String(Math.round(toc.getBoundingClientRect().width))
      )
      d.removeEventListener('pointermove', move)
      d.removeEventListener('pointerup', up)
    }
    d.addEventListener('pointermove', move)
    d.addEventListener('pointerup', up)
  })
}

function bindReading(): void {
  bindTocResize()
  el('btn-toc').addEventListener('click', () => {
    updateSetting('showToc', !getSettings().showToc)
  })
  btnTop.addEventListener('click', () => {
    readerEl.scrollTo({ top: 0, behavior: 'smooth' })
  })
  readerEl.addEventListener(
    'scroll',
    () => {
      if (state.mode === 'read') {
        btnTop.classList.toggle('hidden', readerEl.scrollTop <= 600)
      }
    },
    { passive: true }
  )
  el('if-gofix').addEventListener('click', () => {
    if (state.mode !== 'edit') setMode('edit')
  })
  window.addEventListener('resize', () => updateReadingChrome())
}

async function boot(): Promise<void> {
  applyTheme()
  applyPaper()
  applyFontSizes()
  const s = getSettings()
  initEditor(editorHost, onEditorChange, () => {
    /* scroll handled in bindScrollSync */
  }, { wordWrap: s.wordWrap, lineNumbers: s.lineNumbers, dark: isDarkTheme() })
  bindScrollSync()
  bindDivider()
  bindTopbar()
  bindReading()
  bindKeys()
  bindZoom()
  bindMouseTrack()
  bindDrop()
  bindLinks()
  bindEvents()

  onSettingsChange((next) => {
    applyTheme()
    applyPaper()
    applyFontSizes()
    applyEditorSettings({ wordWrap: next.wordWrap, lineNumbers: next.lineNumbers, dark: isDarkTheme() })
    updateReadingChrome()
  })

  setDiagnosticsListener((diags) => {
    state.diagnostics = diags
    updatePanel(diags)
    refreshLintCard()
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

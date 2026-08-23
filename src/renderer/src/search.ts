import { clearDocSelection, getDocText, selectDocRange } from './editor'

let hooks: (() => HTMLElement) | null = null
let activeKind: 'reader' | 'editor' = 'reader'
let query = ''
let caseSensitive = false
let readerHits: HTMLElement[] = []
let editorMatches: { from: number; to: number }[] = []
let idx = -1

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id)
  if (!e) throw new Error(`missing #${id}`)
  return e as T
}

export function initSearch(getReader: () => HTMLElement): void {
  hooks = getReader
  el('btn-search-close').addEventListener('click', () => closeSearch())
  el('btn-search-prev').addEventListener('click', () => step(-1))
  el('btn-search-next').addEventListener('click', () => step(1))
  el('btn-search-case').addEventListener('click', () => {
    caseSensitive = !caseSensitive
    el('btn-search-case').classList.toggle('active', caseSensitive)
    rerun()
  })
  const input = el<HTMLInputElement>('search-input')
  input.addEventListener('input', () => {
    query = input.value
    rerun()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      step(e.shiftKey ? -1 : 1)
    }
  })
}

export function openSearch(): void {
  activeKind = document.body.dataset.mode === 'edit' ? 'editor' : 'reader'
  el('search-bar').classList.remove('hidden')
  const input = el<HTMLInputElement>('search-input')
  input.focus()
  input.select()
  rerun()
}

export function closeSearch(): void {
  const bar = el('search-bar')
  const wasOpen = !bar.classList.contains('hidden')
  if (wasOpen) {
    bar.classList.add('hidden')
    clearReaderMarks()
    if (activeKind === 'editor') clearDocSelection()
  }
  el<HTMLInputElement>('search-input').value = ''
  readerHits = []
  editorMatches = []
  query = ''
  idx = -1
  updateCount()
}

export function isSearchOpen(): boolean {
  return !el('search-bar').classList.contains('hidden')
}

export function searchStep(dir: 1 | -1): void {
  if (isSearchOpen()) step(dir)
}

function clearReaderMarks(): void {
  const root = hooks?.()
  readerHits = []
  if (!root) return
  for (const m of Array.from(root.querySelectorAll('mark.search-hit'))) {
    m.replaceWith(...m.childNodes)
  }
  root.normalize()
}

function buildReaderHits(): void {
  clearReaderMarks()
  readerHits = []
  const root = hooks?.()
  if (!root || !query) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement
      if (!p) return NodeFilter.FILTER_REJECT
      if (p.closest('.katex, .mermaid-error, mark.search-hit, script, style')) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const nodes: Text[] = []
  let cur: Node | null
  while ((cur = walker.nextNode())) nodes.push(cur as Text)
  const needle = caseSensitive ? query : query.toLowerCase()
  for (const node of nodes) wrapNode(node, needle)
}

function wrapNode(node: Text, needle: string): void {
  const text = node.nodeValue ?? ''
  if (!text) return
  const hay = caseSensitive ? text : text.toLowerCase()
  let pos = hay.indexOf(needle)
  if (pos < 0 || !needle) return
  const frag = document.createDocumentFragment()
  let last = 0
  while (pos >= 0) {
    frag.append(text.slice(last, pos))
    const m = document.createElement('mark')
    m.className = 'search-hit'
    m.textContent = text.slice(pos, pos + needle.length)
    frag.append(m)
    readerHits.push(m)
    last = pos + needle.length
    pos = hay.indexOf(needle, last)
  }
  frag.append(text.slice(last))
  node.replaceWith(frag)
}

function buildEditorMatches(): void {
  editorMatches = []
  if (!query) return
  const doc = getDocText()
  const hay = caseSensitive ? doc : doc.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  let p = hay.indexOf(needle)
  while (p !== -1) {
    editorMatches.push({ from: p, to: p + needle.length })
    p = hay.indexOf(needle, p + needle.length)
  }
}

function updateCount(): void {
  const total = activeKind === 'reader' ? readerHits.length : editorMatches.length
  el('search-count').textContent = !query
    ? ''
    : total === 0
      ? '无结果'
      : `${idx + 1}/${total}`
}

function step(dir: 1 | -1): void {
  const total = activeKind === 'reader' ? readerHits.length : editorMatches.length
  if (!query || total === 0) {
    updateCount()
    return
  }
  idx = (idx + dir + total) % total
  if (activeKind === 'reader') {
    readerHits.forEach((m, i) => m.classList.toggle('current', i === idx))
    readerHits[idx].scrollIntoView({ block: 'center' })
  } else {
    const m = editorMatches[idx]
    selectDocRange(m.from, m.to)
  }
  updateCount()
}

function rerun(): void {
  idx = -1
  if (activeKind === 'reader') buildReaderHits()
  else buildEditorMatches()
  if (
    (activeKind === 'reader' && readerHits.length > 0) ||
    (activeKind === 'editor' && editorMatches.length > 0)
  ) {
    step(1)
  } else {
    updateCount()
  }
}

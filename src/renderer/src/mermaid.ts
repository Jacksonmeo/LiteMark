import { isDarkTheme } from './settings'

let loader: Promise<typeof import('mermaid').default> | null = null
let seq = 0

async function load(): Promise<typeof import('mermaid').default> {
  if (!loader) {
    loader = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isDarkTheme() ? 'dark' : 'default'
      })
      return m.default
    })
  }
  return loader
}

export async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const codes = Array.from(container.querySelectorAll('pre > code.language-mermaid'))
  if (codes.length === 0) return
  let mer: Awaited<ReturnType<typeof load>>
  try {
    mer = await load()
  } catch (err) {
    for (const code of codes) replaceWithError(code, err)
    return
  }
  for (const code of codes) {
    const pre = code.parentElement
    if (!pre) continue
    const holder = document.createElement('div')
    holder.className = 'mermaid-box'
    pre.replaceWith(holder)
    try {
      const { svg } = await mer.render(`litemark-m${seq++}`, code.textContent ?? '')
      holder.innerHTML = svg
    } catch (err) {
      showError(holder, code.textContent ?? '', err)
    }
  }
}

function replaceWithError(code: Element, err: unknown): void {
  const pre = code.parentElement
  if (!pre) return
  const holder = document.createElement('div')
  holder.className = 'mermaid-box'
  pre.replaceWith(holder)
  showError(holder, code.textContent ?? '', err)
}

function showError(holder: HTMLElement, source: string, err: unknown): void {
  holder.innerHTML = ''
  const errBox = document.createElement('div')
  errBox.className = 'mermaid-error'
  errBox.textContent = 'Mermaid 渲染失败：' + String(err)
  const pre = document.createElement('pre')
  pre.textContent = source
  holder.append(errBox, pre)
}

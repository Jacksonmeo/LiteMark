import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/core'
import renderMathInElement from 'katex/contrib/auto-render'
import { renderMermaidBlocks } from './mermaid'

import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dart from 'highlight.js/lib/languages/dart'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import latex from 'highlight.js/lib/languages/latex'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import markdownLang from 'highlight.js/lib/languages/markdown'
import matlab from 'highlight.js/lib/languages/matlab'
import php from 'highlight.js/lib/languages/php'
import plaintext from 'highlight.js/lib/languages/plaintext'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const LANGS: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  latex,
  less,
  lua,
  makefile,
  markdown: markdownLang,
  matlab,
  php,
  plaintext,
  powershell,
  python,
  r,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml
}
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def)
hljs.registerAliases(['html', 'vue', 'svelte'], { languageName: 'xml' })
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
hljs.registerAliases(['js', 'jsx', 'node'], { languageName: 'javascript' })
hljs.registerAliases(['py'], { languageName: 'python' })
hljs.registerAliases(['sh', 'zsh'], { languageName: 'bash' })
hljs.registerAliases(['tex'], { languageName: 'latex' })
hljs.registerAliases(['yml'], { languageName: 'yaml' })
hljs.registerAliases(['toml'], { languageName: 'ini' })
hljs.registerAliases(['text', 'txt'], { languageName: 'plaintext' })

const mdi: InstanceType<typeof MarkdownIt> = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  highlight(str: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre><code class="hljs language-${lang}">${hljs.highlight(str, {
          language: lang,
          ignoreIllegals: true
        }).value}</code></pre>`
      } catch {
        /* fallthrough */
      }
    }
    return `<pre><code class="hljs">${mdi.utils.escapeHtml(str)}</code></pre>`
  }
})

export { mdi }

mdi.core.ruler.push('inject-src-lines', (state) => {
  for (const tok of state.tokens) {
    if (tok.map && (tok.nesting === 1 || tok.type === 'fence' || tok.type === 'code_block' || tok.type === 'hr')) {
      tok.attrSet('data-sl', String(tok.map[0]))
    }
  }
})

export interface TocEntry {
  level: number
  text: string
  id: string
}

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
}

export function assignHeadingIds(el: HTMLElement): TocEntry[] {
  const used = new Map<string, number>()
  const out: TocEntry[] = []
  for (const h of Array.from(el.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
    const text = (h.textContent ?? '').trim()
    let base = slugify(text)
    if (!base) base = 'section'
    const n = used.get(base) ?? 0
    used.set(base, n + 1)
    const id = n === 0 ? base : `${base}-${n}`
    h.id = id
    out.push({ level: Number(h.tagName[1]), text, id })
  }
  return out
}

let renderSeq = 0

export async function renderMarkdown(
  el: HTMLElement,
  src: string,
  filePath: string | null
): Promise<boolean> {
  const seq = ++renderSeq
  el.innerHTML = mdi.render(src)

  if (filePath) {
    for (const img of Array.from(el.querySelectorAll('img'))) {
      const s = img.getAttribute('src') ?? ''
      if (!s || /^(https?:|data:|file:|#|\/)/i.test(s)) continue
      const u = await window.api.resolveAsset(filePath, s)
      if (seq !== renderSeq) return false
      if (u) img.setAttribute('src', u)
      else img.removeAttribute('src')
    }
  }
  if (seq !== renderSeq) return false

  renderMathInElement(el, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false }
    ],
    throwOnError: false,
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
  })
  if (seq !== renderSeq) return false
  await renderMermaidBlocks(el)
  return seq === renderSeq
}

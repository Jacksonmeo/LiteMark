import { mdi } from './md'

type Token = ReturnType<typeof mdi.parse>[number]

function escapeTex(s: string): string {
  return s.replace(/([$\\&%#_{}~^])/g, (ch) => {
    if (ch === '$') return '\\$'
    if (ch === '\\') return '\\textbackslash{}'
    if (ch === '~') return '\\textasciitilde{}'
    if (ch === '^') return '\\textasciicircum{}'
    return '\\' + ch
  })
}

interface Seg {
  math: boolean
  text: string
}

function splitMathSegments(s: string): Seg[] {
  const segs: Seg[] = []
  let buf = ''
  let i = 0
  const n = s.length
  const flush = (math: boolean): void => {
    if (buf) {
      segs.push({ math, text: buf })
      buf = ''
    }
  }
  while (i < n) {
    const ch = s[i]
    if (ch === '\\' && i + 1 < n) {
      buf += s.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === '$') {
      const dd = s[i + 1] === '$'
      const len = dd ? 2 : 1
      const close = s.indexOf(dd ? '$$' : '$', i + len)
      if (close !== -1) {
        flush(false)
        segs.push({ math: true, text: s.slice(i, close + len) })
        i = close + len
        continue
      }
    }
    buf += ch
    i++
  }
  flush(false)
  return segs
}

function textToTex(s: string): string {
  return splitMathSegments(s)
    .map((seg) => (seg.math ? seg.text : escapeTex(seg.text)))
    .join('')
}

function escapeHref(s: string): string {
  return s.replace(/([#$%&_{}])/g, '\\$1')
}

function renderInlineTex(tok?: Token): string {
  if (!tok) return ''
  if (!tok.children) return textToTex(tok.content)
  let out = ''
  for (const c of tok.children) {
    switch (c.type) {
      case 'text':
        out += textToTex(c.content)
        break
      case 'code_inline':
        out += '\\texttt{' + escapeTex(c.content) + '}'
        break
      case 'softbreak':
        out += ' '
        break
      case 'hardbreak':
        out += '\\\\ '
        break
      case 'strong_open':
        out += '\\textbf{'
        break
      case 'em_open':
        out += '\\emph{'
        break
      case 'link_open':
        out += '\\href{' + escapeHref(String(c.attrGet('href') ?? '')) + '}{'
        break
      case 'image': {
        const src = String(c.attrGet('src') ?? '')
        out += '\\includegraphics[width=0.85\\linewidth]{' + src + '} '
        break
      }
      default:
        if (c.type === 'strong_close' || c.type === 'em_close' || c.type === 'link_close') {
          out += '}'
        } else if (c.content) {
          out += textToTex(c.content)
        }
        break
    }
  }
  return out
}

function findPair(tokens: Token[], i: number, closeType: string): number {
  for (let j = i + 1; j < tokens.length; j++) {
    if (tokens[j].type === closeType) return j
  }
  return tokens.length - 1
}

function renderTable(tokens: Token[], open: number, close: number): string {
  const rows: string[][] = []
  let currentRow: string[] | null = null
  for (let j = open + 1; j < close; j++) {
    const t = tokens[j]
    if (t.type === 'tr_open') {
      currentRow = []
    } else if (t.type === 'tr_close') {
      if (currentRow) rows.push(currentRow)
      currentRow = null
    } else if ((t.type === 'th_open' || t.type === 'td_open') && currentRow) {
      const k = findPair(tokens, j, t.type.slice(0, 2) + '_close')
      let body = ''
      for (let m = j + 1; m < k; m++) {
        if (tokens[m].type === 'inline') body += renderInlineTex(tokens[m])
      }
      currentRow.push(body)
      j = k
    }
  }
  const header = rows[0] ?? []
  const bodyRows = rows.slice(1)
  const cols = Math.max(header.length, ...bodyRows.map((r) => r.length), 1)
  const line = (cells: string[]): string =>
    Array.from({ length: cols }, (_, i) => cells[i] ?? '').join(' & ') + ' \\\\ \\hline\n'
  let tex = '\\begin{tabular}{' + '|' + 'l|'.repeat(cols) + '}\n\\hline\n'
  tex += line(header)
  for (const r of bodyRows) tex += line(r)
  tex += '\\end{tabular}'
  return tex
}

function renderBlocks(tokens: Token[]): string {
  let out = ''
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    switch (t.type) {
      case 'heading_open': {
        const level = Number(String(t.tag).slice(1))
        const cmd =
          level === 1
            ? 'section'
            : level === 2
              ? 'subsection'
              : level === 3
                ? 'subsubsection'
                : 'paragraph'
        out += `\\${cmd}{${renderInlineTex(tokens[i + 1])}}\n\n`
        i++
        break
      }
      case 'paragraph_open': {
        out += renderInlineTex(tokens[i + 1]) + '\n\n'
        i++
        break
      }
      case 'fence':
      case 'code_block': {
        const code = t.content.replace(/\\end\{verbatim\}/g, '')
        out += '\\begin{verbatim}\n' + code + (code.endsWith('\n') ? '' : '\n') + '\\end{verbatim}\n\n'
        break
      }
      case 'bullet_list_open':
        out += '\\begin{itemize}\n'
        break
      case 'bullet_list_close':
        out += '\\end{itemize}\n\n'
        break
      case 'ordered_list_open':
        out += '\\begin{enumerate}\n'
        break
      case 'ordered_list_close':
        out += '\\end{enumerate}\n\n'
        break
      case 'list_item_open':
        out += '\\item '
        break
      case 'list_item_close':
        out += '\n'
        break
      case 'blockquote_open':
        out += '\\begin{quote}\n'
        break
      case 'blockquote_close':
        out += '\\end{quote}\n\n'
        break
      case 'table_open': {
        const close = findPair(tokens, i, 'table_close')
        out += renderTable(tokens, i, close) + '\n\n'
        i = close
        break
      }
      case 'hr':
        out += '\\noindent\\rule{\\linewidth}{0.4pt}\n\n'
        break
      default:
        break
    }
  }
  return out
}

export function markdownToTex(src: string): string {
  const tokens = mdi.parse(src, {})
  const body = renderBlocks(tokens)
  return [
    '\\documentclass[12pt]{ctexart}',
    '\\usepackage[a4paper,margin=2.5cm]{geometry}',
    '\\usepackage{graphicx}',
    '\\usepackage[hidelinks]{hyperref}',
    '\\begin{document}',
    '',
    body.trimEnd(),
    '',
    '\\end{document}',
    ''
  ].join('\n')
}

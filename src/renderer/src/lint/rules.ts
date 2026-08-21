import type { Seg } from './regions'
import type { Fix, MdDiag } from './types'

export interface LintCtx {
  text: string
  lines: string[]
  lineStarts: number[]
  segs: Seg[]
  report: (d: MdDiag) => void
}

const OPENERS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '（': '）',
  '【': '】',
  '「': '」'
}
const CLOSERS: Record<string, string> = {}
for (const [o, c] of Object.entries(OPENERS)) CLOSERS[c] = o

export function lineOf(ctx: LintCtx, pos: number): number {
  let lo = 0
  let hi = ctx.lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.lineStarts[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

function lineEndOf(ctx: LintCtx, line: number): number {
  return ctx.lineStarts[line] + ctx.lines[line].length
}

function coveredLine(ctx: LintCtx, li: number): boolean {
  const from = ctx.lineStarts[li]
  const to = from + ctx.lines[li].length
  if (to <= from) return false
  let lo = 0
  let hi = ctx.segs.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const s = ctx.segs[mid]
    if (s.to < from) lo = mid + 1
    else if (s.from > to) hi = mid - 1
    else return s.from <= from && s.to >= to
  }
  return false
}

export function ruleBrackets(ctx: LintCtx): void {
  interface Entry {
    open: string
    close: string
    pos: number
  }
  const stack: Entry[] = []
  for (const seg of ctx.segs) {
    for (let i = seg.from; i < seg.to; i++) {
      const ch = ctx.text[i]
      if (i > seg.from && ctx.text[i - 1] === '\\') continue
      const open = OPENERS[ch]
      if (open !== undefined) {
        stack.push({ open: ch, close: open, pos: i })
        continue
      }
      if (CLOSERS[ch] === undefined) continue
      const top = stack[stack.length - 1]
      if (top && top.close === ch) {
        stack.pop()
        continue
      }
      let deeper = -1
      for (let k = stack.length - 2; k >= 0; k--) {
        if (stack[k].close === ch) {
          deeper = k
          break
        }
      }
      if (deeper >= 0) {
        for (let k = stack.length - 1; k > deeper; k--) {
          const e = stack[k]
          ctx.report({
            from: e.pos,
            to: e.pos + 1,
            severity: 'error',
            rule: 'brackets',
            message: `括号不匹配：${e.open} 未闭合就被 ${ch} 提前闭合`
          })
        }
        stack.length = deeper
      } else {
        ctx.report({
          from: i,
          to: i + 1,
          severity: 'warning',
          rule: 'brackets',
          message: `疑似多余的闭合括号：${ch}`
        })
      }
    }
  }
  const byLine = new Map<number, Entry[]>()
  for (const e of stack) {
    const ln = lineOf(ctx, e.pos)
    const arr = byLine.get(ln)
    if (arr) arr.push(e)
    else byLine.set(ln, [e])
  }
  for (const [ln, entries] of byLine) {
    const unique = entries.length === 1
    for (const e of entries) {
      const le = lineEndOf(ctx, ln)
      ctx.report({
        from: e.pos,
        to: e.pos + 1,
        severity: 'error',
        rule: 'brackets',
        message: `括号未闭合：${e.open}`,
        fix: unique ? { from: le, to: le, insert: e.close } : undefined
      })
    }
  }
}

export function ruleEmphasis(ctx: LintCtx): void {
  for (const seg of ctx.segs) {
    const segText = ctx.text.slice(seg.from, seg.to)
    const marks: number[] = []
    for (let idx = segText.indexOf('**'); idx !== -1; idx = segText.indexOf('**', idx + 2)) {
      if (idx > 0 && segText[idx - 1] === '\\') continue
      marks.push(idx)
    }
    if (marks.length === 0) continue
    if (marks.length % 2 === 1) {
      const p = seg.from + marks[marks.length - 1]
      ctx.report({
        from: p,
        to: p + 2,
        severity: 'warning',
        rule: 'emphasis',
        message: '** 数量为奇数，加粗可能未闭合'
      })
    }
    for (let k = 0; k < marks.length; k++) {
      const abs = seg.from + marks[k]
      const hasEarlier = marks.some((m) => seg.from + m < abs - 2)
      const hasLater = marks.some((m) => seg.from + m > abs + 2)
      if (k % 2 === 0) {
        let j = abs + 2
        while (j < seg.to && /\s/.test(ctx.text[j])) j++
        if (j > abs + 2 && j < seg.to && hasLater) {
          ctx.report({
            from: abs + 2,
            to: j,
            severity: 'error',
            rule: 'emphasis',
            message: '** 内侧有空格，导致加粗不渲染',
            fix: { from: abs + 2, to: j, insert: '' }
          })
        }
      } else {
        let j = abs - 1
        while (j >= seg.from && /\s/.test(ctx.text[j])) j--
        const start = j + 1
        if (abs > start && start > seg.from && hasEarlier) {
          ctx.report({
            from: start,
            to: abs,
            severity: 'error',
            rule: 'emphasis',
            message: '** 内侧有空格，导致加粗不渲染',
            fix: { from: start, to: abs, insert: '' }
          })
        }
      }
    }
  }
}

export interface MathSpan {
  from: number
  to: number
  display: boolean
  raw: string
}

export interface UnclosedMath {
  from: number
  to: number
  display: boolean
  tokenLen: number
}

export function scanMath(
  text: string,
  segs: Seg[]
): { spans: MathSpan[]; unclosed: UnclosedMath[] } {
  const spans: MathSpan[] = []
  const unclosed: UnclosedMath[] = []
  let open: { display: boolean; from: number } | null = null
  for (const seg of segs) {
    let i = seg.from
    while (i < seg.to) {
      const ch = text[i]
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch !== '$') {
        i++
        continue
      }
      const dd = text[i + 1] === '$'
      const len = dd ? 2 : 1
      if (!open) {
        open = { display: dd, from: i }
      } else if (open.display) {
        if (dd) {
          spans.push({
            from: open.from,
            to: i + 2,
            display: true,
            raw: text.slice(open.from + 2, i)
          })
          open = null
        }
      } else {
        spans.push({
          from: open.from,
          to: i + len,
          display: false,
          raw: text.slice(open.from + 1, i)
        })
        open = null
      }
      i += len
    }
  }
  if (open) {
    unclosed.push({
      from: open.from,
      to: open.from + (open.display ? 2 : 1),
      display: open.display,
      tokenLen: open.display ? 2 : 1
    })
  }
  return { spans, unclosed }
}

export function ruleMath(ctx: LintCtx): void {
  const { spans, unclosed } = scanMath(ctx.text, ctx.segs)
  for (const u of unclosed) {
    let restHasDollar = false
    for (const s of ctx.segs) {
      const a = Math.max(s.from, u.to)
      if (a >= s.to) continue
      if (ctx.text.slice(a, s.to).includes('$')) {
        restHasDollar = true
        break
      }
    }
    let fix: Fix | undefined
    if (!restHasDollar) {
      const ln = lineOf(ctx, u.from)
      const le = lineEndOf(ctx, ln)
      fix = { from: le, to: le, insert: u.display ? '$$' : '$' }
    }
    ctx.report({
      from: u.from,
      to: u.to,
      severity: 'error',
      rule: 'math',
      message: u.display ? '$$ 公式块未闭合' : '$ 公式未闭合',
      fix
    })
  }
  for (const sp of spans) {
    let depth = 0
    let excess = false
    for (let i = 0; i < sp.raw.length; i++) {
      const c = sp.raw[i]
      if (c === '\\') {
        i++
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth < 0) {
          excess = true
          break
        }
      }
    }
    if (excess || depth !== 0) {
      ctx.report({
        from: Math.max(sp.from, sp.to - 1),
        to: sp.to,
        severity: 'warning',
        rule: 'math',
        message: excess
          ? '公式内花括号不平衡：有多余的 }'
          : `公式内花括号不平衡：缺少 ${depth} 个 }`
      })
    }
  }
}

export function ruleLatexEnv(ctx: LintCtx): void {
  const re = /\\(begin|end)\{([^{}\n]*)\}/g
  interface OpenEnv {
    name: string
    pos: number
    len: number
  }
  const stack: OpenEnv[] = []
  for (const seg of ctx.segs) {
    const segText = ctx.text.slice(seg.from, seg.to)
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(segText)) !== null) {
      const abs = seg.from + m.index
      const name = m[2]
      const len = m[0].length
      if (m[1] === 'begin') {
        stack.push({ name, pos: abs, len })
      } else {
        const top = stack[stack.length - 1]
        if (top && top.name === name) {
          stack.pop()
          continue
        }
        let deeper = -1
        for (let k = stack.length - 2; k >= 0; k--) {
          if (stack[k].name === name) {
            deeper = k
            break
          }
        }
        if (deeper >= 0) {
          for (let k = stack.length - 1; k > deeper; k--) {
            const e = stack[k]
            ctx.report({
              from: e.pos,
              to: e.pos + e.len,
              severity: 'error',
              rule: 'latex-env',
              message: `\\begin{${e.name}} 未闭合（被 \\end{${name}} 提前闭合）`
            })
          }
          stack.length = deeper
        } else {
          ctx.report({
            from: abs,
            to: abs + len,
            severity: 'error',
            rule: 'latex-env',
            message: `\\end{${name}} 没有对应的 \\begin`
          })
        }
      }
    }
  }
  for (const e of stack) {
    const ln = lineOf(ctx, e.pos)
    let insAt = ctx.text.length
    for (let l = ln + 1; l < ctx.lines.length; l++) {
      if (!ctx.lines[l].trim()) {
        insAt = ctx.lineStarts[l]
        break
      }
    }
    const prefix = insAt > 0 && ctx.text[insAt - 1] !== '\n' ? '\n' : ''
    ctx.report({
      from: e.pos,
      to: e.pos + e.len,
      severity: 'error',
      rule: 'latex-env',
      message: `\\begin{${e.name}} 未闭合`,
      fix: { from: insAt, to: insAt, insert: `${prefix}\\end{${e.name}}` }
    })
  }
}

export function ruleLinks(ctx: LintCtx): void {
  for (const seg of ctx.segs) {
    const segText = ctx.text.slice(seg.from, seg.to)
    let lineStart = 0
    for (const rawLine of segText.split('\n')) {
      const lineLen = rawLine.length
      const base = seg.from + lineStart
      lineStart += lineLen + 1

      const emptyUrl = /\[[^\]\n]*\]\(\s*\)/.exec(rawLine)
      if (emptyUrl) {
        const at = base + emptyUrl.index
        ctx.report({
          from: at,
          to: at + emptyUrl[0].length,
          severity: 'warning',
          rule: 'link',
          message: '链接或图片的 URL 为空'
        })
      }

      const unterminated = /(^|[^\\])\[[^\]\n]*\]\([^)\n]*$/.exec(rawLine)
      if (unterminated) {
        const at = base + unterminated.index + unterminated[1].length
        ctx.report({
          from: at,
          to: base + lineLen,
          severity: 'error',
          rule: 'link',
          message: '链接的 URL 圆括号未闭合'
        })
      }

      const imgNoUrl = /!\[[^\]\n]*\]\s*$/.exec(rawLine)
      if (imgNoUrl) {
        const at = base + imgNoUrl.index
        ctx.report({
          from: at,
          to: base + lineLen,
          severity: 'error',
          rule: 'link',
          message: '图片缺少 (URL)'
        })
      }

      let searchFrom = 0
      for (;;) {
        const idx = rawLine.indexOf('](', searchFrom)
        if (idx === -1) break
        searchFrom = idx + 2
        if (idx > 0 && rawLine[idx - 1] === '\\') continue
        let j = idx - 1
        let broken = false
        while (j >= 0) {
          if (rawLine[j] === '[') break
          if (rawLine[j] === ']') {
            broken = true
            break
          }
          j--
        }
        if (broken) continue
        if (j < 0) {
          const at = base + idx
          ctx.report({
            from: at,
            to: at + 2,
            severity: 'warning',
            rule: 'link',
            message: '疑似残缺的链接语法：]('
          })
        }
      }
    }
  }
}

function pipeCount(line: string): number {
  let n = 0
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') {
      i++
      continue
    }
    if (line[i] === '|') n++
  }
  return n
}

export function ruleTables(ctx: LintCtx): void {
  const lines = ctx.lines
  let i = 0
  while (i < lines.length - 1) {
    const header = lines[i]
    const sep = lines[i + 1]
    i++
    if (!header.includes('|')) continue
    const sepTrim = sep.trim()
    if (!sepTrim.includes('-') || !sepTrim.includes('|')) continue
    if (!/^[|\s:\-]+$/.test(sepTrim)) continue
    if (!coveredLine(ctx, i - 1)) continue

    const target = pipeCount(sep)
    const hp = pipeCount(header)
    if (hp !== target) {
      const at = ctx.lineStarts[i - 1]
      ctx.report({
        from: at,
        to: at + header.length,
        severity: 'warning',
        rule: 'table',
        message: `表头管道符数量（${hp}）与分隔行（${target}）不一致，表格可能错位`
      })
    }
    let r = i + 1
    while (r < lines.length) {
      const row = lines[r]
      if (!row.trim() || !row.includes('|')) break
      if (!coveredLine(ctx, r)) break
      const rp = pipeCount(row)
      if (rp !== target) {
        const at = ctx.lineStarts[r]
        ctx.report({
          from: at,
          to: at + row.length,
          severity: 'warning',
          rule: 'table',
          message: `表格第 ${r - i} 行管道符数量（${rp}）与分隔行（${target}）不一致`
        })
      }
      r++
    }
    i = r
  }
}

export function ruleHeadings(ctx: LintCtx): void {
  let prev = 0
  for (let i = 0; i < ctx.lines.length; i++) {
    const m = /^ {0,3}(#{1,6})(\s|$)/.exec(ctx.lines[i])
    if (!m) continue
    if (!coveredLine(ctx, i)) continue
    const level = m[1].length
    if (prev > 0 && level > prev + 1) {
      const at = ctx.lineStarts[i]
      ctx.report({
        from: at,
        to: at + m[0].length,
        severity: 'warning',
        rule: 'heading',
        message: `标题层级跳跃：h${prev} → h${level}`
      })
    }
    prev = level
  }
}

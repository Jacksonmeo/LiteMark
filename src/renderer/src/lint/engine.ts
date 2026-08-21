import { proseSegments } from './regions'
import {
  ruleBrackets,
  ruleEmphasis,
  ruleHeadings,
  ruleLatexEnv,
  ruleLinks,
  ruleMath,
  ruleTables,
  type LintCtx
} from './rules'
import type { MdDiag } from './types'

const MAX_DIAGNOSTICS = 500

export function runLint(text: string): MdDiag[] {
  const lines = text.split('\n')
  const lineStarts: number[] = []
  let acc = 0
  for (const l of lines) {
    lineStarts.push(acc)
    acc += l.length + 1
  }
  const diags: MdDiag[] = []
  const ctx: LintCtx = {
    text,
    lines,
    lineStarts,
    segs: proseSegments(text),
    report: (d) => diags.push(d)
  }
  ruleBrackets(ctx)
  ruleEmphasis(ctx)
  ruleMath(ctx)
  ruleLatexEnv(ctx)
  ruleLinks(ctx)
  ruleTables(ctx)
  ruleHeadings(ctx)
  for (const d of diags) d.line = lineOfPos(lineStarts, d.from)
  diags.sort((a, b) => a.from - b.from || a.to - b.to)
  return diags.length > MAX_DIAGNOSTICS ? diags.slice(0, MAX_DIAGNOSTICS) : diags
}

function lineOfPos(lineStarts: number[], pos: number): number {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

export interface SrcMark {
  sl: number
  el: HTMLElement
}

export function collectMarks(root: HTMLElement): SrcMark[] {
  const marks: SrcMark[] = []
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-sl]'))) {
    const sl = Number(el.dataset.sl)
    if (Number.isFinite(sl)) marks.push({ sl, el })
  }
  return marks
}

function markTops(container: HTMLElement, marks: SrcMark[]): number[] {
  const base = container.getBoundingClientRect().top
  return marks.map((m) => m.el.getBoundingClientRect().top - base + container.scrollTop)
}

export function lineToTop(
  container: HTMLElement,
  marks: SrcMark[],
  line: number
): number | null {
  if (marks.length === 0) return null
  const ts = markTops(container, marks)
  const last = marks.length - 1
  if (line <= marks[0].sl) return ts[0]
  if (line >= marks[last].sl) {
    const h = marks[last].el.getBoundingClientRect().height
    return ts[last] + (line - marks[last].sl) * Math.max(h, 40)
  }
  let i = 0
  while (i < last && marks[i + 1].sl <= line) i++
  const a = marks[i]
  const b = marks[i + 1]
  const span = b.sl - a.sl
  const t = span > 0 ? (line - a.sl) / span : 0
  return ts[i] + t * (ts[i + 1] - ts[i])
}

export function topToLine(
  container: HTMLElement,
  marks: SrcMark[],
  top: number
): number | null {
  if (marks.length === 0) return null
  const ts = markTops(container, marks)
  const last = marks.length - 1
  if (top <= ts[0]) return marks[0].sl
  if (top >= ts[last]) {
    const h = marks[last].el.getBoundingClientRect().height
    if (h <= 0) return marks[last].sl
    return marks[last].sl + Math.min((top - ts[last]) / h, 500)
  }
  let i = 0
  while (i < last && ts[i + 1] <= top) i++
  const a = marks[i]
  const b = marks[i + 1]
  const spanPx = ts[i + 1] - ts[i]
  const t = spanPx > 0 ? (top - ts[i]) / spanPx : 0
  return a.sl + t * (b.sl - a.sl)
}

export function scrollToLine(
  container: HTMLElement,
  marks: SrcMark[],
  line: number,
  margin = 16
): boolean {
  const top = lineToTop(container, marks, line)
  if (top === null) return false
  container.scrollTop = Math.max(0, top - margin)
  return true
}

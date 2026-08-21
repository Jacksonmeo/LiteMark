export interface Seg {
  from: number
  to: number
}

interface FenceState {
  char: string
  len: number
}

function subtractInline(text: string, from: number, to: number, out: Seg[]): void {
  const re = /(`+)([\s\S]*?)\1/g
  re.lastIndex = from
  let cursor = from
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null && m.index < to) {
    if (m.index >= cursor) out.push({ from: cursor, to: m.index })
    cursor = Math.max(cursor, m.index + m[0].length)
    if (re.lastIndex <= m.index) re.lastIndex = m.index + 1
  }
  if (cursor < to) out.push({ from: cursor, to })
}

export function proseSegments(text: string): Seg[] {
  const segs: Seg[] = []
  const lines = text.split('\n')
  let pos = 0
  let fence: FenceState | null = null
  let blockFrom = -1
  let blockTo = -1

  const flush = (): void => {
    if (blockFrom >= 0) {
      subtractInline(text, blockFrom, blockTo, segs)
      blockFrom = -1
      blockTo = -1
    }
  }

  for (const line of lines) {
    const start = pos
    const end = pos + line.length
    pos = end + 1

    const fm = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (fm && fm[1][0] === fence.char && fm[1].length >= fence.len) fence = null
      continue
    }
    if (fm) {
      flush()
      fence = { char: fm[1][0], len: fm[1].length }
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    if (blockFrom < 0) blockFrom = start
    blockTo = end
  }
  flush()
  return segs
}

export function coveredBy(segs: Seg[], from: number, to: number): boolean {
  let lo = 0
  let hi = segs.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const s = segs[mid]
    if (s.to < from) lo = mid + 1
    else if (s.from > to) hi = mid - 1
    else return s.from <= from && s.to >= to
  }
  return false
}

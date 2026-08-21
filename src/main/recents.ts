import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const MAX_ITEMS = 20

export class Recents {
  private file: string

  constructor(file: string) {
    this.file = file
    try {
      mkdirSync(path.dirname(file), { recursive: true })
    } catch {
      /* ignore */
    }
  }

  private load(): string[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf-8')) as { items?: unknown }
      if (!Array.isArray(raw.items)) return []
      return raw.items.filter((x): x is string => typeof x === 'string')
    } catch {
      return []
    }
  }

  list(): string[] {
    return this.load().filter((p) => existsSync(p))
  }

  add(p: string): void {
    const items = [p, ...this.load().filter((x) => x !== p)].slice(0, MAX_ITEMS)
    try {
      writeFileSync(this.file, JSON.stringify({ items }, null, 2), 'utf-8')
    } catch {
      /* ignore */
    }
  }
}

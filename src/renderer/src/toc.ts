import type { TocEntry } from './md'

let activeId: string | null = null
let rafPending = false

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id)
  if (!e) throw new Error(`missing #${id}`)
  return e as T
}

export function scrollToHeading(container: HTMLElement, id: string): void {
  const t = container.querySelector(`[id="${CSS.escape(id)}"]`)
  if (!t) return
  container.scrollTo({ top: topOf(container, t as HTMLElement) - 16, behavior: 'smooth' })
}

function topOf(container: HTMLElement, t: HTMLElement): number {
  return (
    t.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop
  )
}

export function buildToc(
  container: HTMLElement,
  entries: TocEntry[],
  onEmpty: () => void
): void {
  const nav = el('toc')
  nav.innerHTML = ''
  if (entries.length === 0) {
    onEmpty()
    return
  }
  for (const e of entries) {
    const btn = document.createElement('button')
    btn.className = `toc-item toc-h${e.level}`
    btn.textContent = e.text
    btn.title = e.text
    btn.addEventListener('click', () => scrollToHeading(container, e.id))
    btn.dataset.id = e.id
    nav.appendChild(btn)
  }
}

export function bindTocSpy(
  container: HTMLElement,
  entries: TocEntry[]
): () => void {
  const onScroll = (): void => {
    if (rafPending) return
    rafPending = true
    requestAnimationFrame(() => {
      rafPending = false
      const base = topOf(container, container)
      let current: string | null = null
      for (const e of entries) {
        const t = container.querySelector(`[id="${CSS.escape(e.id)}"]`)
        if (t && topOf(container, t as HTMLElement) - base <= 90) current = e.id
      }
      setActiveTocItem(current)
    })
  }
  container.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
  return () => container.removeEventListener('scroll', onScroll)
}

export function setActiveTocItem(id: string | null): void {
  if (id === activeId) return
  activeId = id
  const nav = el('toc')
  for (const b of Array.from(nav.children)) {
    const btn = b as HTMLElement
    const active = btn.dataset.id === id
    btn.classList.toggle('active', active)
    if (active) {
      const nr = nav.getBoundingClientRect()
      const br = btn.getBoundingClientRect()
      if (br.top < nr.top || br.bottom > nr.bottom) {
        nav.scrollTop += br.top - nr.top - nr.height / 2 + br.height
      }
    }
  }
}

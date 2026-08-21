import type { MdDiag } from './lint/types'

export interface PanelHooks {
  jumpTo: (pos: number) => void
  fixOne: (d: MdDiag) => void
  requestFixAll: (diags: MdDiag[]) => void
}

let hooks: PanelHooks | null = null
let current: MdDiag[] = []
let collapsed = false

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id)
  if (!e) throw new Error(`missing #${id}`)
  return e as T
}

export function initPanel(h: PanelHooks): void {
  hooks = h
  el('btn-panel-toggle').addEventListener('click', () => {
    collapsed = !collapsed
    el('btn-panel-toggle').textContent = collapsed ? '▴' : '▾'
    el('problems-list').classList.toggle('hidden', collapsed)
  })
  el('btn-fixall').addEventListener('click', () => hooks?.requestFixAll(current))
}

export function updatePanel(diags: MdDiag[]): void {
  current = diags
  const errors = diags.filter((d) => d.severity === 'error').length
  const warnings = diags.length - errors
  const summary = el('problems-summary')
  if (diags.length === 0) {
    summary.textContent = '没有问题'
    summary.className = 'ok'
  } else {
    summary.textContent = `${errors} 个错误 · ${warnings} 个警告`
    summary.className = errors > 0 ? 'bad' : 'warn'
  }

  const fixable = diags.filter((d) => d.fix).length
  const fixall = el('btn-fixall')
  fixall.classList.toggle('hidden', fixable === 0)
  if (fixable > 0) fixall.textContent = `一键修复 (${fixable})`

  const list = el('problems-list')
  list.innerHTML = ''
  for (const d of diags) {
    const li = document.createElement('li')
    li.className = d.severity

    const dot = document.createElement('span')
    dot.className = 'dot'
    li.appendChild(dot)

    const loc = document.createElement('span')
    loc.className = 'loc'
    loc.textContent = `行 ${d.line}`
    li.appendChild(loc)

    const msg = document.createElement('span')
    msg.className = 'msg'
    msg.textContent = d.message
    li.appendChild(msg)

    if (d.fix) {
      const btn = document.createElement('button')
      btn.className = 'fix-btn'
      btn.textContent = '修复'
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        hooks?.fixOne(d)
      })
      li.appendChild(btn)
    }

    li.addEventListener('click', () => hooks?.jumpTo(d.from))
    list.appendChild(li)
  }
}

export interface ModalButton {
  label: string
  primary?: boolean
  onClick?: () => void
}

let modalOpenFlag = false
let overlayWired = false

function wireOverlayDismiss(): void {
  if (overlayWired) return
  overlayWired = true
  el('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal()
  })
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id)
  if (!e) throw new Error(`missing #${id}`)
  return e as T
}

export function showModal(title: string, bodyHtml: string, buttons: ModalButton[]): void {
  const overlay = el('modal-overlay')
  const card = el('modal-card')
  card.innerHTML = ''

  const h3 = document.createElement('h3')
  h3.textContent = title
  card.appendChild(h3)

  const body = document.createElement('div')
  body.className = 'modal-body'
  body.innerHTML = bodyHtml
  card.appendChild(body)

  const footer = document.createElement('div')
  footer.className = 'modal-footer'
  for (const b of buttons) {
    const btn = document.createElement('button')
    btn.textContent = b.label
    if (b.primary) btn.className = 'primary'
    btn.addEventListener('click', () => b.onClick?.())
    footer.appendChild(btn)
  }
  card.appendChild(footer)

  overlay.classList.remove('hidden')
  wireOverlayDismiss()
  modalOpenFlag = true
}

export function closeModal(): void {
  el('modal-overlay').classList.add('hidden')
  modalOpenFlag = false
}

export function isModalOpen(): boolean {
  return modalOpenFlag
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export function toast(msg: string): void {
  const t = el('toast')
  t.textContent = msg
  t.classList.remove('hidden')
  t.classList.add('show')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    t.classList.remove('show')
    setTimeout(() => t.classList.add('hidden'), 300)
  }, 1800)
}

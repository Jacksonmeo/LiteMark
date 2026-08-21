export type ThemeMode = 'system' | 'light' | 'dark'

export interface Settings {
  theme: ThemeMode
  previewFontSize: number
  editorFontSize: number
  syncScroll: boolean
  wordWrap: boolean
  lineNumbers: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  previewFontSize: 16,
  editorFontSize: 14,
  syncScroll: true,
  wordWrap: true,
  lineNumbers: true
}

const KEY = 'litemark.settings'

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function sanitize(raw: Partial<Settings>): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, ...raw }
  if (s.theme !== 'system' && s.theme !== 'light' && s.theme !== 'dark') s.theme = 'system'
  s.previewFontSize = clamp(Number(s.previewFontSize) || DEFAULT_SETTINGS.previewFontSize, 12, 28)
  s.editorFontSize = clamp(Number(s.editorFontSize) || DEFAULT_SETTINGS.editorFontSize, 10, 24)
  s.syncScroll = Boolean(s.syncScroll)
  s.wordWrap = Boolean(s.wordWrap)
  s.lineNumbers = Boolean(s.lineNumbers)
  return s
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return sanitize(JSON.parse(raw) as Partial<Settings>)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

let current: Settings = load()
const listeners: ((s: Settings) => void)[] = []

export function getSettings(): Settings {
  return current
}

export function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  current = { ...current, [key]: value }
  if (key === 'previewFontSize') {
    current.previewFontSize = clamp(current.previewFontSize, 12, 28)
  } else if (key === 'editorFontSize') {
    current.editorFontSize = clamp(current.editorFontSize, 10, 24)
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* ignore */
  }
  for (const l of listeners) l(current)
}

export function resetSettings(): void {
  current = { ...DEFAULT_SETTINGS }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* ignore */
  }
  for (const l of listeners) l(current)
}

export function onSettingsChange(cb: (s: Settings) => void): void {
  listeners.push(cb)
}

const mediaDark = window.matchMedia('(prefers-color-scheme: dark)')
mediaDark.addEventListener('change', () => {
  if (current.theme === 'system') applyTheme()
})

export function isDarkTheme(): boolean {
  return current.theme === 'dark' || (current.theme === 'system' && mediaDark.matches)
}

export function applyTheme(): void {
  document.documentElement.dataset.theme = isDarkTheme() ? 'dark' : 'light'
}

export function applyFontSizes(): void {
  const root = document.documentElement.style
  root.setProperty('--preview-font-size', `${current.previewFontSize}px`)
  root.setProperty('--editor-font-size', `${current.editorFontSize}px`)
}

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import { linter } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection
} from '@codemirror/view'
import { runLint } from './lint/engine'
import type { Fix, MdDiag } from './lint/types'

let view: EditorView | null = null
let diagListener: ((d: MdDiag[]) => void) | null = null

export function setDiagnosticsListener(cb: ((d: MdDiag[]) => void) | null): void {
  diagListener = cb
}

export function initEditor(
  parent: HTMLElement,
  onChange: () => void,
  onScroll: () => void
): void {
  const lintExt = linter((v) => {
    const diags = runLint(v.state.doc.toString())
    diagListener?.(diags)
    return diags.map((d) => ({
      from: d.from,
      to: d.to,
      severity: d.severity,
      message: d.message,
      actions: d.fix
        ? [
            {
              name: '修复',
              apply: (av: EditorView) => {
                if (d.fix) av.dispatch({ changes: { from: d.fix.from, to: d.fix.to, insert: d.fix.insert } })
              }
            }
          ]
        : undefined
    }))
  }, { delay: 300 })

  view = new EditorView({
    parent,
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        history(),
        indentOnInput(),
        bracketMatching(),
        EditorView.lineWrapping,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        lintExt,
        EditorView.domEventHandlers({
          scroll: () => {
            onScroll()
            return false
          }
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange()
        })
      ]
    })
  })
}

export function getDocText(): string {
  return view ? view.state.doc.toString() : ''
}

export function setDocText(t: string): void {
  if (!view) return
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } })
}

export function focusEditor(): void {
  view?.focus()
}

export function gotoOffset(pos: number): void {
  if (!view) return
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' })
  })
  view.focus()
}

export function applyFixes(fixes: Fix[]): void {
  if (!view || fixes.length === 0) return
  const docLen = view.state.doc.length
  const sorted = [...fixes].sort((a, b) => a.from - b.from)
  const changes: { from: number; to: number; insert: string }[] = []
  let lastTo = -1
  for (const f of sorted) {
    if (f.from < lastTo || f.from < 0 || f.to > docLen || f.to < f.from) continue
    changes.push({ from: f.from, to: f.to, insert: f.insert })
    lastTo = f.to
  }
  if (changes.length > 0) view.dispatch({ changes })
}

export function getEditorScrollDom(): HTMLElement {
  if (!view) throw new Error('editor not initialized')
  return view.scrollDOM
}

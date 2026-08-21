export interface Fix {
  from: number
  to: number
  insert: string
}

export interface MdDiag {
  from: number
  to: number
  severity: 'error' | 'warning'
  rule: string
  message: string
  line?: number
  fix?: Fix
}

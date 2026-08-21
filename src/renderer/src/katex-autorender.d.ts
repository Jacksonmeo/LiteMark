declare module 'katex/contrib/auto-render' {
  export interface AutoRenderDelimiter {
    left: string
    right: string
    display: boolean
  }
  export interface AutoRenderOptions {
    delimiters?: AutoRenderDelimiter[]
    ignoredTags?: string[]
    ignoredClasses?: string[]
    errorCallback?: (msg: string, err: Error) => void
    throwOnError?: boolean
  }
  export default function renderMathInElement(
    elem: HTMLElement,
    options?: AutoRenderOptions
  ): void
}

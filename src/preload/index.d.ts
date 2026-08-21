import type { BridgeApi } from '../shared/types'

declare global {
  interface Window {
    api: BridgeApi
  }
}

export {}

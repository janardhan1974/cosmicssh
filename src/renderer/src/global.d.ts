// Ambient declaration so the renderer sees `window.api` typed with the surface
// exposed via contextBridge in src/preload/index.ts.

import type { Api } from '../../shared/types'

declare global {
  interface Window {
    api: Api
  }
}

export {}

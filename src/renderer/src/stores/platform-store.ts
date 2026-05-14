// Tiny store that caches the local platform info (path separator, OS family,
// home dir). Fetched once at app start so synchronous reads from any
// component are safe after `load()` resolves.

import { create } from 'zustand'
import type { LocalPlatformInfo } from '../../../shared/types'

// Defaults match Windows so code rendered before load() doesn't crash. The
// store resolves to real values within milliseconds of mount.
const DEFAULTS: LocalPlatformInfo = {
  sep: '\\',
  isWindows: true,
  isMac: false,
  isLinux: false,
  homeDir: '',
}

type State = {
  info: LocalPlatformInfo
  loaded: boolean
  load: () => Promise<void>
}

export const usePlatformStore = create<State>((set) => ({
  info: DEFAULTS,
  loaded: false,
  load: async () => {
    const info = await window.api.local.platform()
    set({ info, loaded: true })
  },
}))

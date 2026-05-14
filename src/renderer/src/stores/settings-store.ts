import { create } from 'zustand'
import {
  DEFAULT_TERMINAL_SETTINGS,
  type TerminalSettings,
} from '../../../shared/types'

type State = {
  terminal: TerminalSettings
  loaded: boolean
  load: () => Promise<void>
  setTerminal: (next: TerminalSettings) => Promise<void>
  bumpFontSize: (delta: number) => void
  resetFontSize: () => void
}

const MIN_SIZE = 6
const MAX_SIZE = 48
const PERSIST_DEBOUNCE_MS = 250

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

let persistTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(next: TerminalSettings) {
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void window.api.settings.set(next)
  }, PERSIST_DEBOUNCE_MS)
}

export const useSettingsStore = create<State>((set, get) => ({
  terminal: DEFAULT_TERMINAL_SETTINGS,
  loaded: false,
  load: async () => {
    const terminal = await window.api.settings.get()
    set({ terminal, loaded: true })
  },
  setTerminal: async (next) => {
    // From the Settings modal — persist synchronously and reflect server result.
    set({ terminal: next })
    const saved = await window.api.settings.set(next)
    set({ terminal: saved })
  },
  bumpFontSize: (delta) => {
    const current = get().terminal
    const fontSize = clamp(current.fontSize + delta, MIN_SIZE, MAX_SIZE)
    if (fontSize === current.fontSize) return
    const next = { ...current, fontSize }
    set({ terminal: next }) // optimistic — UI updates this frame
    schedulePersist(next) // debounced IPC write
  },
  resetFontSize: () => {
    const current = get().terminal
    if (current.fontSize === DEFAULT_TERMINAL_SETTINGS.fontSize) return
    const next = { ...current, fontSize: DEFAULT_TERMINAL_SETTINGS.fontSize }
    set({ terminal: next })
    schedulePersist(next)
  },
}))

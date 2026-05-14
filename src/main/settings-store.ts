// Settings store — terminal preferences (font etc.) persisted via electron-store.

import Store from 'electron-store'
import { DEFAULT_TERMINAL_SETTINGS, type TerminalSettings } from '../shared/types'

type StoreShape = {
  terminal: TerminalSettings
}

export class SettingsStore {
  private readonly store: Store<StoreShape>

  constructor() {
    this.store = new Store<StoreShape>({
      name: 'settings',
      defaults: { terminal: DEFAULT_TERMINAL_SETTINGS },
    })
  }

  getTerminal(): TerminalSettings {
    // Merge with defaults so persisted JSON missing newer fields (e.g. older
    // versions saved before `theme` existed) gets backfilled rather than
    // crashing the renderer on undefined.
    const stored = this.store.get('terminal') as Partial<TerminalSettings>
    return { ...DEFAULT_TERMINAL_SETTINGS, ...stored }
  }

  setTerminal(next: TerminalSettings): TerminalSettings {
    this.store.set('terminal', next)
    return next
  }
}

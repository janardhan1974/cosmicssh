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
    const merged: TerminalSettings = { ...DEFAULT_TERMINAL_SETTINGS, ...stored }
    // First-launch migration to the two-tier text split: chrome used to
    // follow terminal.fontFamily / terminal.textColor automatically. After
    // the split those are terminal-only; copy them over to the new ui*
    // fields when they're missing so existing users don't see their sidebar
    // snap to a different font on upgrade.
    if (stored.uiFontFamily === undefined && stored.fontFamily) {
      merged.uiFontFamily = stored.fontFamily
    }
    if (stored.uiTextColor === undefined && stored.textColor !== undefined) {
      merged.uiTextColor = stored.textColor
    }
    return merged
  }

  setTerminal(next: TerminalSettings): TerminalSettings {
    this.store.set('terminal', next)
    return next
  }
}

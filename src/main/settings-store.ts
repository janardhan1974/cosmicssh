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
    // Migration: uiTextColor used to default to null (follow theme). Copy the
    // terminal textColor on first upgrade so existing chrome color carries over.
    if (stored.uiTextColor === undefined && stored.textColor !== undefined) {
      merged.uiTextColor = stored.textColor
    }
    // Migration: early builds defaulted uiFontFamily to the monospace terminal
    // font (or copied it from fontFamily on upgrade). Reset to the system UI
    // font if the stored value is the old monospace default — a user who
    // intentionally picked a proportional font would have a different value.
    if (merged.uiFontFamily === '"Cascadia Mono", Consolas, "Courier New", monospace') {
      merged.uiFontFamily = DEFAULT_TERMINAL_SETTINGS.uiFontFamily
    }
    return merged
  }

  setTerminal(next: TerminalSettings): TerminalSettings {
    this.store.set('terminal', next)
    return next
  }
}

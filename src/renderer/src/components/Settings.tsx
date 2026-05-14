import { useMemo, useState, type FormEvent } from 'react'
import { useSettingsStore } from '../stores/settings-store'

type Props = {
  onClose: () => void
}

// Curated list of monospace fonts. Bundled-with-Windows fonts come first;
// developer-favorites that users often install separately follow. Each entry
// is the value passed straight to xterm — already wrapped with a fallback
// stack so a missing font degrades to plain monospace.
type FontChoice = { label: string; value: string; note?: string }

const FONT_CHOICES: FontChoice[] = [
  {
    label: 'Cascadia Mono',
    value: '"Cascadia Mono", Consolas, monospace',
    note: 'Default — ships with Windows 11',
  },
  {
    label: 'Cascadia Code',
    value: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
    note: 'Cascadia + ligatures',
  },
  {
    label: 'Consolas',
    value: 'Consolas, monospace',
    note: 'Built into Windows',
  },
  {
    label: 'Courier New',
    value: '"Courier New", monospace',
    note: 'Built into Windows',
  },
  {
    label: 'Lucida Console',
    value: '"Lucida Console", monospace',
    note: 'Built into Windows',
  },
  {
    label: 'JetBrains Mono',
    value: '"JetBrains Mono", Consolas, monospace',
    note: 'Install separately',
  },
  {
    label: 'Fira Code',
    value: '"Fira Code", Consolas, monospace',
    note: 'Install separately',
  },
  {
    label: 'Source Code Pro',
    value: '"Source Code Pro", Consolas, monospace',
    note: 'Install separately',
  },
  {
    label: 'IBM Plex Mono',
    value: '"IBM Plex Mono", Consolas, monospace',
    note: 'Install separately',
  },
  {
    label: 'Hack',
    value: 'Hack, Consolas, monospace',
    note: 'Install separately',
  },
  {
    label: 'Ubuntu Mono',
    value: '"Ubuntu Mono", Consolas, monospace',
    note: 'Install separately',
  },
]

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24]

export function Settings({ onClose }: Props) {
  const current = useSettingsStore((s) => s.terminal)
  const setTerminal = useSettingsStore((s) => s.setTerminal)

  // Match the persisted value to a known choice; if it doesn't match (user
  // had a custom value from before), prepend it as a "Custom" first option so
  // we don't surprise them with a forced reset.
  const choices = useMemo<FontChoice[]>(() => {
    const matched = FONT_CHOICES.find((f) => f.value === current.fontFamily)
    if (matched) return FONT_CHOICES
    return [
      { label: `Custom — ${current.fontFamily}`, value: current.fontFamily, note: 'Saved previously' },
      ...FONT_CHOICES,
    ]
  }, [current.fontFamily])

  const [fontFamily, setFontFamily] = useState(current.fontFamily)
  const [fontSize, setFontSize] = useState(current.fontSize)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await setTerminal({ fontFamily, fontSize })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal settings-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>Terminal settings</h2>
        <p className="muted">
          Applies live to all open and new terminals. Use Ctrl + scroll wheel
          (or Ctrl + = / − / 0) to zoom on a per-terminal basis.
        </p>

        <label>
          <span>Font</span>
          <select
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
            disabled={busy}
          >
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
                {c.note ? `  —  ${c.note}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Size</span>
          <select
            value={fontSize}
            onChange={(e) => setFontSize(Number.parseInt(e.target.value, 10))}
            disabled={busy}
          >
            {FONT_SIZES.map((s) => (
              <option key={s} value={s}>{s}px</option>
            ))}
          </select>
        </label>

        <div
          className="font-preview"
          style={{ fontFamily, fontSize: `${fontSize}px` }}
        >
          {'$ ssh user@host\n[user@host ~]$ vim README.md  # 1234567890'}
        </div>

        {error && <div className="error" role="alert">{error}</div>}

        <div className="actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

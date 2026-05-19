import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSettingsStore } from '../stores/settings-store'
import { APP_THEMES, type AppTheme, type ColorSchemeId } from '../../../shared/types'
import { COLOR_SCHEMES } from '../lib/color-schemes'
import { ModalBackdrop } from './ModalBackdrop'

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
  // Capture the brightness value at modal open so Cancel can revert the
  // live preview. Other settings only apply on Save, so they don't need this.
  const originalBrightnessRef = useRef(current.brightness)
  // Flipped to true inside handleSubmit just before setTerminal is awaited so
  // the unmount cleanup knows not to clobber the freshly-saved value.
  const savedRef = useRef(false)

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
  const [theme, setThemeLocal] = useState<AppTheme>(current.theme)
  const [colorScheme, setColorScheme] = useState<ColorSchemeId>(current.colorScheme)
  const [brightness, setBrightness] = useState<number>(current.brightness)
  const [useThemeText, setUseThemeText] = useState(current.textColor === null)
  const [textColor, setTextColor] = useState<string>(current.textColor ?? '#e8e6e3')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // When a color scheme is selected the scheme provides the full xterm
  // palette, so the textColor override is muted in the UI. Saving anyway
  // preserves the user's prior textColor pick so it comes back if they
  // switch the scheme back to 'default'.
  const schemeOverridesText = colorScheme !== 'default'

  // Live brightness preview: push the value into the store immediately so all
  // open terminals re-skin while the user drags. No IPC write — that only
  // happens on Save. The setState reaches into zustand's API directly so we
  // don't have to add a one-off store action for a UI-only optimistic update.
  const previewBrightness = (n: number) => {
    setBrightness(n)
    useSettingsStore.setState((s) => ({ terminal: { ...s.terminal, brightness: n } }))
  }

  // Revert any in-flight preview when the modal closes without Save. The Save
  // path replaces the store value anyway, so calling this after Save is a
  // harmless no-op (the original value just gets briefly swapped in and back
  // out before the IPC reply lands — invisible to the user).
  const revertPreview = () => {
    useSettingsStore.setState((s) => ({
      terminal: { ...s.terminal, brightness: originalBrightnessRef.current },
    }))
  }

  // Revert any unsaved preview on unmount (Cancel, Escape, click-outside).
  // savedRef flips true when handleSubmit commits, so we don't undo a fresh
  // save here. Empty deps because we only want this on real unmount, not on
  // every brightness change.
  useEffect(() => {
    return () => {
      if (!savedRef.current) revertPreview()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      savedRef.current = true
      await setTerminal({
        fontFamily,
        fontSize,
        theme,
        colorScheme,
        brightness,
        textColor: useThemeText ? null : textColor,
      })
      onClose()
    } catch (err) {
      // Save failed — the preview is still live but unpersisted. Clearing the
      // ref means an unmount after a failed save still reverts.
      savedRef.current = false
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <form
        className="modal settings-modal"
        onSubmit={handleSubmit}
      >
        <h2>Terminal settings</h2>
        <p className="muted">
          Applies live. Use Ctrl + scroll wheel (or Ctrl + = / − / 0) to zoom
          on a per-terminal basis.
        </p>

        <label>
          <span>Color scheme</span>
          <select
            value={colorScheme}
            onChange={(e) => setColorScheme(e.target.value as ColorSchemeId)}
            disabled={busy}
          >
            {COLOR_SCHEMES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>

        {/* Text brightness — lerps the resolved foreground toward white.
            Strictly foreground only: background, cursor, selection, and the
            ANSI palette are unaffected so colored output doesn't wash out
            and the cursor cell doesn't flash bright. Live-previews via the
            store; only Save persists it. Works in both default and scheme
            modes — keep a preset AND brighten its text. */}
        <label>
          <span>Text brightness</span>
          <span className="color-row">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={brightness}
              onChange={(e) => previewBrightness(Number.parseInt(e.target.value, 10))}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <span
              className="muted"
              style={{ minWidth: 44, textAlign: 'right', fontFamily: 'monospace' }}
            >
              {brightness}%
            </span>
          </span>
        </label>

        <label>
          <span>Theme</span>
          <select
            value={theme}
            onChange={(e) => setThemeLocal(e.target.value as AppTheme)}
            disabled={busy}
          >
            {APP_THEMES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>

        {/* Text-color override only meaningful when no scheme is active —
            otherwise the scheme owns the full palette. Hidden (not disabled)
            so the modal stays compact when a preset is selected. */}
        {!schemeOverridesText && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={useThemeText}
              onChange={(e) => setUseThemeText(e.target.checked)}
              disabled={busy}
            />
            <span>Text color follows theme</span>
          </label>
        )}

        {!schemeOverridesText && !useThemeText && (
          <label>
            <span>Text color</span>
            <span className="color-row">
              <input
                type="color"
                value={textColor}
                onChange={(e) => setTextColor(e.target.value)}
                disabled={busy}
                className="color-swatch"
              />
              <input
                type="text"
                value={textColor}
                onChange={(e) => setTextColor(e.target.value)}
                disabled={busy}
                pattern="^#[0-9a-fA-F]{6}$"
                placeholder="#e8e6e3"
                style={{ flex: 1, fontFamily: 'monospace' }}
              />
            </span>
          </label>
        )}

        {schemeOverridesText && (
          <p className="muted" style={{ marginTop: '-4px' }}>
            Color scheme owns the full terminal palette — text color override
            doesn't apply. Switch to "Default" to enable it again.
          </p>
        )}

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
    </ModalBackdrop>
  )
}

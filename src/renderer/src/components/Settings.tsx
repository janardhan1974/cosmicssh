import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSettingsStore } from '../stores/settings-store'
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
  // Capture brightness values at modal open so Cancel can revert the
  // live previews (both terminal and UI brightness preview live).
  const originalBrightnessRef = useRef(current.brightness)
  const originalUiBrightnessRef = useRef(current.uiBrightness)
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
  // Same custom-first treatment for the UI font picker. Note this also
  // catches the post-migration case where uiFontFamily was carried over from
  // an old terminal.fontFamily that isn't in FONT_CHOICES.
  const uiChoices = useMemo<FontChoice[]>(() => {
    const matched = FONT_CHOICES.find((f) => f.value === current.uiFontFamily)
    if (matched) return FONT_CHOICES
    return [
      { label: `Custom — ${current.uiFontFamily}`, value: current.uiFontFamily, note: 'Saved previously' },
      ...FONT_CHOICES,
    ]
  }, [current.uiFontFamily])

  const [fontFamily, setFontFamily] = useState(current.fontFamily)
  const [fontSize, setFontSize] = useState(current.fontSize)
  const [uiFontFamily, setUiFontFamily] = useState(current.uiFontFamily)
  const [uiFontSize, setUiFontSize] = useState(current.uiFontSize)
  const [useThemeUiText, setUseThemeUiText] = useState(current.uiTextColor === null)
  const [uiTextColor, setUiTextColor] = useState<string>(current.uiTextColor ?? '#e8e6e3')
  const [uiBrightness, setUiBrightness] = useState<number>(current.uiBrightness)
  const [brightness, setBrightness] = useState<number>(current.brightness)
  const [textColor, setTextColor] = useState<string>(current.textColor ?? '#e8e6e3')
  const [terminalBackground, setTerminalBackground] = useState<string>(
    current.terminalBackground ?? '#0f0f10',
  )
  // null = sidebar follows terminal bg (the default). The hex input keeps its
  // last value across the checkbox toggle so re-enabling the override doesn't
  // wipe what the user picked.
  const [sidebarFollowsTerminal, setSidebarFollowsTerminal] = useState(
    current.sidebarBackground === null,
  )
  const [sidebarBackground, setSidebarBackground] = useState<string>(
    current.sidebarBackground ?? '#131317',
  )
  const [chromeFollowsTheme, setChromeFollowsTheme] = useState(
    current.chromeBackground === null,
  )
  const [chromeBackground, setChromeBackground] = useState<string>(
    current.chromeBackground ?? '#131317',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Live brightness preview: push the value into the store immediately so all
  // open terminals re-skin while the user drags. No IPC write — that only
  // happens on Save. The setState reaches into zustand's API directly so we
  // don't have to add a one-off store action for a UI-only optimistic update.
  const previewBrightness = (n: number) => {
    setBrightness(n)
    useSettingsStore.setState((s) => ({ terminal: { ...s.terminal, brightness: n } }))
  }
  const previewUiBrightness = (n: number) => {
    setUiBrightness(n)
    useSettingsStore.setState((s) => ({ terminal: { ...s.terminal, uiBrightness: n } }))
  }

  // Revert any in-flight preview when the modal closes without Save. The Save
  // path replaces the store value anyway, so calling this after Save is a
  // harmless no-op (the original value just gets briefly swapped in and back
  // out before the IPC reply lands — invisible to the user).
  const revertPreview = () => {
    useSettingsStore.setState((s) => ({
      terminal: {
        ...s.terminal,
        brightness: originalBrightnessRef.current,
        uiBrightness: originalUiBrightnessRef.current,
      },
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
        theme: current.theme,
        brightness,
        textColor,
        sidebarBackground: sidebarFollowsTerminal ? null : sidebarBackground,
        terminalBackground,
        chromeBackground: chromeFollowsTheme ? null : chromeBackground,
        uiFontFamily,
        uiFontSize,
        uiTextColor: useThemeUiText ? null : uiTextColor,
        uiBrightness,
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

        {/* Terminal & SFTP background. A literal color pushed into xterm's
            theme.background and published as --bg-terminal, so the SFTP pane
            (and the sidebar, by default) repaint in lockstep with it. */}
        <label>
          <span>Terminal &amp; SFTP background</span>
          <span className="color-row">
            <input
              type="color"
              value={terminalBackground}
              onChange={(e) => setTerminalBackground(e.target.value)}
              disabled={busy}
              className="color-swatch"
            />
            <input
              type="text"
              value={terminalBackground}
              onChange={(e) => setTerminalBackground(e.target.value)}
              disabled={busy}
              pattern="^#[0-9a-fA-F]{6}$"
              placeholder="#0f0f10"
              style={{ flex: 1, fontFamily: 'monospace' }}
            />
          </span>
        </label>

        {/* Terminal text color — the xterm foreground (and cursor). */}
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

        {/* Text brightness — lerps the foreground toward white. Strictly
            foreground only: background, cursor, and selection pass through
            untouched so colored output doesn't wash out. Live-previews via
            the store; only Save persists it. */}
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

        {/* Sidebar background. Default ("follow terminal") leaves the sidebar
            tracking whatever color xterm is painting. Toggling it off exposes
            a color picker for a literal override that wins over the terminal
            background. */}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={sidebarFollowsTerminal}
            onChange={(e) => setSidebarFollowsTerminal(e.target.checked)}
            disabled={busy}
          />
          <span>Sidebar background follows terminal</span>
        </label>

        {!sidebarFollowsTerminal && (
          <label>
            <span>Sidebar background</span>
            <span className="color-row">
              <input
                type="color"
                value={sidebarBackground}
                onChange={(e) => setSidebarBackground(e.target.value)}
                disabled={busy}
                className="color-swatch"
              />
              <input
                type="text"
                value={sidebarBackground}
                onChange={(e) => setSidebarBackground(e.target.value)}
                disabled={busy}
                pattern="^#[0-9a-fA-F]{6}$"
                placeholder="#131317"
                style={{ flex: 1, fontFamily: 'monospace' }}
              />
            </span>
          </label>
        )}

        <label className="checkbox">
          <input
            type="checkbox"
            checked={chromeFollowsTheme}
            onChange={(e) => setChromeFollowsTheme(e.target.checked)}
            disabled={busy}
          />
          <span>Menubar &amp; tab bar use theme colors</span>
        </label>

        {!chromeFollowsTheme && (
          <label>
            <span>Menubar &amp; tab bar background</span>
            <span className="color-row">
              <input
                type="color"
                value={chromeBackground}
                onChange={(e) => setChromeBackground(e.target.value)}
                disabled={busy}
                className="color-swatch"
              />
              <input
                type="text"
                value={chromeBackground}
                onChange={(e) => setChromeBackground(e.target.value)}
                disabled={busy}
                pattern="^#[0-9a-fA-F]{6}$"
                placeholder="#131317"
                style={{ flex: 1, fontFamily: 'monospace' }}
              />
            </span>
          </label>
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

        {/* ─── UI text (chrome) ──────────────────────────────────────────
            Independent controls for the non-terminal chrome — menu bar,
            sidebar, tab labels, SFTP panes. Decoupled from the terminal
            tier above so a monospace terminal + proportional UI font is a
            single picker change. */}
        <h3 style={{ marginTop: 18, marginBottom: 4 }}>UI text (chrome)</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Applies to the menu bar, sidebar, tab bar and SFTP panes — not
          the terminal.
        </p>

        <label>
          <span>UI font</span>
          <select
            value={uiFontFamily}
            onChange={(e) => setUiFontFamily(e.target.value)}
            disabled={busy}
          >
            {uiChoices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
                {c.note ? `  —  ${c.note}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>UI size</span>
          <select
            value={uiFontSize}
            onChange={(e) => setUiFontSize(Number.parseInt(e.target.value, 10))}
            disabled={busy}
          >
            {FONT_SIZES.map((s) => (
              <option key={s} value={s}>{s}px</option>
            ))}
          </select>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={useThemeUiText}
            onChange={(e) => setUseThemeUiText(e.target.checked)}
            disabled={busy}
          />
          <span>UI text color follows theme</span>
        </label>

        {!useThemeUiText && (
          <label>
            <span>UI text color</span>
            <span className="color-row">
              <input
                type="color"
                value={uiTextColor}
                onChange={(e) => setUiTextColor(e.target.value)}
                disabled={busy}
                className="color-swatch"
              />
              <input
                type="text"
                value={uiTextColor}
                onChange={(e) => setUiTextColor(e.target.value)}
                disabled={busy}
                pattern="^#[0-9a-fA-F]{6}$"
                placeholder="#e8e6e3"
                style={{ flex: 1, fontFamily: 'monospace' }}
              />
            </span>
          </label>
        )}

        <label>
          <span>UI brightness</span>
          <span className="color-row">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={uiBrightness}
              onChange={(e) => previewUiBrightness(Number.parseInt(e.target.value, 10))}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <span
              className="muted"
              style={{ minWidth: 44, textAlign: 'right', fontFamily: 'monospace' }}
            >
              {uiBrightness}%
            </span>
          </span>
        </label>

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

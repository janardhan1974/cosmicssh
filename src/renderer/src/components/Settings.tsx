import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSettingsStore } from '../stores/settings-store'
import { DEFAULT_TERMINAL_SETTINGS } from '../../../shared/types'
import { ModalBackdrop } from './ModalBackdrop'

type Props = {
  onClose: () => void
}

type FontChoice = { label: string; value: string }
type FontGroup = { group: string; fonts: FontChoice[] }

// Monospace-only font list — proportional fonts break xterm character cell
// width and produce wide uneven spacing in the terminal. Only monospace
// faces are listed. Groups rendered as <optgroup> in the picker.
const FONT_GROUPS: FontGroup[] = [
  {
    group: 'Monospace — Google Fonts (bundled)',
    fonts: [
      { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
      { label: 'Inconsolata', value: "'Inconsolata', monospace" },
      { label: 'Roboto Mono', value: "'Roboto Mono', monospace" },
      { label: 'Fira Code', value: "'Fira Code', monospace" },
      { label: 'Space Mono', value: "'Space Mono', monospace" },
      { label: 'Source Code Pro', value: "'Source Code Pro', monospace" },
    ],
  },
  {
    group: 'Monospace — Windows built-in',
    fonts: [
      { label: 'Cascadia Mono', value: '"Cascadia Mono", Consolas, monospace' },
      { label: 'Cascadia Code (ligatures)', value: '"Cascadia Code", "Cascadia Mono", Consolas, monospace' },
      { label: 'Consolas', value: 'Consolas, monospace' },
      { label: 'Courier New', value: '"Courier New", monospace' },
      { label: 'Lucida Console', value: '"Lucida Console", monospace' },
      { label: 'Lucida Sans Typewriter', value: '"Lucida Sans Typewriter", "Lucida Console", monospace' },
    ],
  },
  {
    group: 'Monospace — install separately',
    fonts: [
      { label: 'Fira Code (system)', value: '"Fira Code", Consolas, monospace' },
      { label: 'Source Code Pro (system)', value: '"Source Code Pro", Consolas, monospace' },
      { label: 'IBM Plex Mono', value: '"IBM Plex Mono", Consolas, monospace' },
      { label: 'Hack', value: 'Hack, Consolas, monospace' },
      { label: 'Ubuntu Mono', value: '"Ubuntu Mono", Consolas, monospace' },
      { label: 'DejaVu Sans Mono', value: '"DejaVu Sans Mono", Consolas, monospace' },
      { label: 'Noto Mono', value: '"Noto Mono", Consolas, monospace' },
    ],
  },
]

const ALL_FONTS = FONT_GROUPS.flatMap((g) => g.fonts)

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24]

export function Settings({ onClose }: Props) {
  const current = useSettingsStore((s) => s.terminal)
  const setTerminal = useSettingsStore((s) => s.setTerminal)
  const originalBrightnessRef = useRef(current.brightness)
  const originalUiBrightnessRef = useRef(current.uiBrightness)
  const savedRef = useRef(false)

  // If the persisted font isn't in the list, surface it as a "Custom" option.
  const customFont = useMemo<FontChoice | null>(() => {
    const known = ALL_FONTS.find((f) => f.value === current.fontFamily)
    return known ? null : { label: `Custom — ${current.fontFamily}`, value: current.fontFamily }
  }, [current.fontFamily])

  // One font for everything — sidebar chrome + terminal/SFTP panes.
  const [fontFamily, setFontFamily] = useState(current.fontFamily)
  const [fontSize, setFontSize] = useState(current.fontSize)
  const [uiFontSize, setUiFontSize] = useState(current.uiFontSize)
  const [useCustomUiBg, setUseCustomUiBg] = useState(current.chromeBackground !== null)
  const [chromeBackground, setChromeBackground] = useState<string>(
    current.chromeBackground ?? '#131317',
  )
  const [useCustomUiText, setUseCustomUiText] = useState(current.uiTextColor !== null)
  const [uiTextColor, setUiTextColor] = useState<string>(current.uiTextColor ?? '#e8e6e3')
  const [uiBrightness, setUiBrightness] = useState<number>(current.uiBrightness)
  const [brightness, setBrightness] = useState<number>(current.brightness)
  const [textColor, setTextColor] = useState<string>(current.textColor ?? '#e8e6e3')
  const [terminalBackground, setTerminalBackground] = useState<string>(
    current.terminalBackground ?? '#0f0f10',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const previewBrightness = (n: number) => {
    setBrightness(n)
    useSettingsStore.setState((s) => ({ terminal: { ...s.terminal, brightness: n } }))
  }
  const previewUiBrightness = (n: number) => {
    setUiBrightness(n)
    useSettingsStore.setState((s) => ({ terminal: { ...s.terminal, uiBrightness: n } }))
  }

  // "Revert to default" — resets the Terminal & SFTP controls (background,
  // text colour, text size, text brightness) to DEFAULT_TERMINAL_SETTINGS.
  // Brightness goes through previewBrightness so the change is visible live.
  const revertToDefault = () => {
    setTerminalBackground(DEFAULT_TERMINAL_SETTINGS.terminalBackground ?? '#080808')
    setTextColor(DEFAULT_TERMINAL_SETTINGS.textColor ?? '#ffffff')
    setFontSize(DEFAULT_TERMINAL_SETTINGS.fontSize)
    previewBrightness(DEFAULT_TERMINAL_SETTINGS.brightness)
  }

  const revertPreview = () => {
    useSettingsStore.setState((s) => ({
      terminal: {
        ...s.terminal,
        brightness: originalBrightnessRef.current,
        uiBrightness: originalUiBrightnessRef.current,
      },
    }))
  }

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
        sidebarBackground: null,
        terminalBackground,
        chromeBackground: useCustomUiBg ? chromeBackground : null,
        uiFontFamily: fontFamily,   // same font for the chrome
        uiFontSize,
        uiTextColor: useCustomUiText ? uiTextColor : null,
        uiBrightness,
      })
      onClose()
    } catch (err) {
      savedRef.current = false
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <form className="modal settings-modal" onSubmit={handleSubmit}>
        <h2>Display settings</h2>

        {/* ── Font (global — applies to sidebar and terminal alike) ─── */}
        <h3>Font</h3>

        <label>
          <span>Typeface</span>
          <select
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
            disabled={busy}
            style={{ fontFamily }}
          >
            {customFont && (
              <optgroup label="Custom">
                <option value={customFont.value}>{customFont.label}</option>
              </optgroup>
            )}
            {FONT_GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.fonts.map((f) => (
                  <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        {/* ── Menubar · Sidebar · Tab bar ───────────────────────────────────── */}
        <h3 style={{ marginTop: 20 }}>Menubar · Sidebar · Tab bar</h3>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={useCustomUiBg}
            onChange={(e) => setUseCustomUiBg(e.target.checked)}
            disabled={busy}
          />
          <span>Background</span>
        </label>
        {useCustomUiBg && (
          <label>
            <span />
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

        <label className="checkbox">
          <input
            type="checkbox"
            checked={useCustomUiText}
            onChange={(e) => setUseCustomUiText(e.target.checked)}
            disabled={busy}
          />
          <span>Text</span>
        </label>
        {useCustomUiText && (
          <label>
            <span />
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
          <span>Text size</span>
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

        <label>
          <span>Text brightness</span>
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
            <span className="muted" style={{ minWidth: 44, textAlign: 'right', fontFamily: 'monospace' }}>
              {uiBrightness}%
            </span>
          </span>
        </label>

        {/* ── Terminal & SFTP ──────────────────────────────────────────────────── */}
        <h3 style={{ marginTop: 20 }}>Terminal &amp; SFTP</h3>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={false}
            onChange={(e) => { if (e.target.checked) revertToDefault() }}
            disabled={busy}
          />
          <span>Revert to default</span>
        </label>

        <label>
          <span>Background</span>
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

        <label>
          <span>Text</span>
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

        <label>
          <span>Text size</span>
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
            <span className="muted" style={{ minWidth: 44, textAlign: 'right', fontFamily: 'monospace' }}>
              {brightness}%
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

import { useState, type FormEvent } from 'react'
import { ModalBackdrop } from './ModalBackdrop'
import type { CustomColorScheme } from '../../../shared/types'

type Props = {
  schemes: CustomColorScheme[]
  // Whole-list updates — SchemeEditor produces the new array; the parent
  // (Settings) writes it into its local form state and persists on Save
  // alongside the rest of the terminal settings.
  onChange: (next: CustomColorScheme[]) => void
  onClose: () => void
}

// Hex regex used in inline validation. Same shape the main-process zod
// schema enforces, so anything that passes here won't bounce on save.
const HEX_RE = /^#[0-9a-fA-F]{6}$/

// Starter palette for "+ New scheme". Dracula in everything but name — a
// complete, balanced 21-color set so the user starts from a working scheme
// to tweak rather than 21 black squares.
const STARTER_PALETTE: CustomColorScheme['theme'] = {
  background: '#282a36',
  foreground: '#f8f8f2',
  cursor: '#f8f8f2',
  cursorAccent: '#282a36',
  selectionBackground: '#44475a',
  black: '#21222c',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f8f8f2',
  brightBlack: '#6272a4',
  brightRed: '#ff6e6e',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
}

// Field groupings drive the editor layout — primary colors on top, then the
// 8 normal + 8 bright ANSI ramps. Keys match CustomColorScheme.theme so the
// field config doubles as the iteration order for `<ColorField>` rendering.
type ThemeKey = keyof CustomColorScheme['theme']
type FieldDef = { key: ThemeKey; label: string }

const PRIMARY_FIELDS: FieldDef[] = [
  { key: 'background', label: 'Background' },
  { key: 'foreground', label: 'Foreground' },
  { key: 'cursor', label: 'Cursor' },
  { key: 'cursorAccent', label: 'Cursor accent' },
  { key: 'selectionBackground', label: 'Selection' },
]

const ANSI_NORMAL_FIELDS: FieldDef[] = [
  { key: 'black', label: 'Black' },
  { key: 'red', label: 'Red' },
  { key: 'green', label: 'Green' },
  { key: 'yellow', label: 'Yellow' },
  { key: 'blue', label: 'Blue' },
  { key: 'magenta', label: 'Magenta' },
  { key: 'cyan', label: 'Cyan' },
  { key: 'white', label: 'White' },
]

const ANSI_BRIGHT_FIELDS: FieldDef[] = [
  { key: 'brightBlack', label: 'Br. Black' },
  { key: 'brightRed', label: 'Br. Red' },
  { key: 'brightGreen', label: 'Br. Green' },
  { key: 'brightYellow', label: 'Br. Yellow' },
  { key: 'brightBlue', label: 'Br. Blue' },
  { key: 'brightMagenta', label: 'Br. Magenta' },
  { key: 'brightCyan', label: 'Br. Cyan' },
  { key: 'brightWhite', label: 'Br. White' },
]

// Random-enough id for a custom scheme. Doesn't need to be cryptographically
// unique — collisions inside a single user's customSchemes list are
// effectively impossible at these volumes.
function newSchemeId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function SchemeEditor({ schemes, onChange, onClose }: Props) {
  type Mode = { kind: 'list' } | { kind: 'edit'; draft: CustomColorScheme; isNew: boolean }
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [error, setError] = useState<string | null>(null)

  const startNew = (): void => {
    setError(null)
    setMode({
      kind: 'edit',
      draft: { id: newSchemeId(), name: 'My scheme', theme: { ...STARTER_PALETTE } },
      isNew: true,
    })
  }

  const startEdit = (scheme: CustomColorScheme): void => {
    setError(null)
    // Deep-copy theme so the form can mutate freely without touching the
    // saved scheme until Save is pressed.
    setMode({ kind: 'edit', draft: { ...scheme, theme: { ...scheme.theme } }, isNew: false })
  }

  const deleteScheme = (id: string): void => {
    onChange(schemes.filter((s) => s.id !== id))
  }

  const commitDraft = (e: FormEvent): void => {
    e.preventDefault()
    if (mode.kind !== 'edit') return
    const { draft, isNew } = mode
    if (!draft.name.trim()) {
      setError('Scheme name cannot be empty.')
      return
    }
    // Validate every color slot before committing — bad hex inputs would
    // be rejected by main's zod on save anyway, but failing here gives the
    // user immediate feedback pointing at the right field.
    for (const field of [...PRIMARY_FIELDS, ...ANSI_NORMAL_FIELDS, ...ANSI_BRIGHT_FIELDS]) {
      if (!HEX_RE.test(draft.theme[field.key])) {
        setError(`Invalid color for ${field.label} (use #RRGGBB).`)
        return
      }
    }
    const next = isNew
      ? [...schemes, draft]
      : schemes.map((s) => (s.id === draft.id ? draft : s))
    onChange(next)
    setMode({ kind: 'list' })
  }

  if (mode.kind === 'edit') {
    const draft = mode.draft
    const updateField = (key: ThemeKey, value: string): void => {
      setMode({
        ...mode,
        draft: { ...draft, theme: { ...draft.theme, [key]: value } },
      })
    }
    return (
      <ModalBackdrop onClose={onClose}>
        <form className="modal settings-modal" onSubmit={commitDraft}>
          <h2>{mode.isNew ? 'New color scheme' : `Edit "${draft.name}"`}</h2>

          <label>
            <span>Name</span>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setMode({ ...mode, draft: { ...draft, name: e.target.value } })}
              maxLength={60}
              autoFocus
            />
          </label>

          <h3 style={{ marginTop: 12, marginBottom: 4 }}>Primary colors</h3>
          {PRIMARY_FIELDS.map((f) => (
            <ColorField
              key={f.key}
              label={f.label}
              value={draft.theme[f.key]}
              onChange={(v) => updateField(f.key, v)}
            />
          ))}

          <h3 style={{ marginTop: 12, marginBottom: 4 }}>ANSI 0–7 (normal)</h3>
          {ANSI_NORMAL_FIELDS.map((f) => (
            <ColorField
              key={f.key}
              label={f.label}
              value={draft.theme[f.key]}
              onChange={(v) => updateField(f.key, v)}
            />
          ))}

          <h3 style={{ marginTop: 12, marginBottom: 4 }}>ANSI 8–15 (bright)</h3>
          {ANSI_BRIGHT_FIELDS.map((f) => (
            <ColorField
              key={f.key}
              label={f.label}
              value={draft.theme[f.key]}
              onChange={(v) => updateField(f.key, v)}
            />
          ))}

          {error && <div className="error" role="alert">{error}</div>}

          <div className="actions">
            <button type="button" onClick={() => setMode({ kind: 'list' })}>
              Back
            </button>
            <button type="submit" className="primary">
              {mode.isNew ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </ModalBackdrop>
    )
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="modal settings-modal">
        <h2>Custom color schemes</h2>
        <p className="muted">
          User-authored palettes that appear in the Color scheme dropdown
          alongside the built-ins.
        </p>

        {schemes.length === 0 ? (
          <p className="muted" style={{ fontStyle: 'italic' }}>
            No custom schemes yet — click "New scheme" to create one.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {schemes.map((s) => (
              <li
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                }}
              >
                {/* Tiny swatch so the user sees at a glance which palette
                    each row is. Background + foreground side by side gives
                    a recognizable preview without rendering all 21 chips. */}
                <span
                  aria-hidden="true"
                  style={{
                    width: 36,
                    height: 18,
                    borderRadius: 3,
                    background: `linear-gradient(to right, ${s.theme.background} 50%, ${s.theme.foreground} 50%)`,
                    border: '1px solid var(--border)',
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, color: 'var(--fg)' }}>{s.name}</span>
                <button type="button" onClick={() => startEdit(s)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (confirm(`Delete "${s.name}"?`)) deleteScheme(s.id)
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="actions">
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" className="primary" onClick={startNew}>
            New scheme
          </button>
        </div>
      </div>
    </ModalBackdrop>
  )
}

// Standalone color input row — `<input type="color">` swatch on the left,
// editable hex text on the right. Both bind to the same controlled value so
// edits in one immediately reflect in the other.
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label>
      <span>{label}</span>
      <span className="color-row">
        <input
          type="color"
          value={HEX_RE.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="color-swatch"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          pattern="^#[0-9a-fA-F]{6}$"
          placeholder="#000000"
          style={{ flex: 1, fontFamily: 'monospace' }}
        />
      </span>
    </label>
  )
}

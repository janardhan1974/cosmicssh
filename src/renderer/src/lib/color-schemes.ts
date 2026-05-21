import type { ITheme } from '@xterm/xterm'
import type { AppTheme, ColorSchemeId, CustomColorScheme } from '../../../shared/types'

// Curated terminal color presets. Each scheme provides a complete xterm
// ITheme — background, foreground, cursor, selection, and the full 16-color
// ANSI palette — so picking one swaps every color in one click. Palettes are
// the canonical ones from each scheme's spec (Schoonover, Zenburn-style etc.).
//
// 'default' is the sentinel that means "fall back to the app theme" — when
// it's selected, TerminalView uses themeForXterm(theme) + textColor override
// (the old behavior). Picking any other scheme makes that scheme authoritative
// and the textColor override is hidden in the Settings UI.

export type { ColorSchemeId }

// Lerp an #rrggbb color toward white by `t` in [0,1]. 0 returns the input
// unchanged; 1 returns #ffffff. Used by both the terminal foreground-brightness
// slider and the UI-brightness slider — anything other than a six-digit hex
// falls through unchanged so an unexpected value (named CSS color from xterm
// defaults, rgba(), …) can't crash the merge.
export function brightenHex(hex: string, t: number): string {
  if (t <= 0) return hex
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1]!, 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const lerp = (v: number) => Math.round(v + (255 - v) * t)
  const hh = (v: number) => v.toString(16).padStart(2, '0')
  return `#${hh(lerp(r))}${hh(lerp(g))}${hh(lerp(b))}`
}

export type ColorSchemeMeta = {
  id: ColorSchemeId
  label: string
  isDark: boolean
}

export const COLOR_SCHEMES: ColorSchemeMeta[] = [
  { id: 'default', label: 'Default (follow app theme)', isDark: true },
  { id: 'solarized-dark', label: 'Solarized Dark', isDark: true },
  { id: 'solarized-light', label: 'Solarized Light', isDark: false },
  { id: 'dracula', label: 'Dracula', isDark: true },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', isDark: true },
  { id: 'gruvbox-light', label: 'Gruvbox Light', isDark: false },
  { id: 'nord', label: 'Nord', isDark: true },
  { id: 'one-dark', label: 'One Dark', isDark: true },
  { id: 'monokai', label: 'Monokai', isDark: true },
  { id: 'tomorrow-night', label: 'Tomorrow Night', isDark: true },
  { id: 'github-light', label: 'GitHub Light', isDark: false },
]

// Lookup of full ITheme objects keyed by scheme id. 'default' is intentionally
// absent — callers gate on id === 'default' before lookup.
const SCHEME_THEMES: Record<Exclude<ColorSchemeId, 'default'>, ITheme> = {
  'solarized-dark': {
    background: '#002b36',
    foreground: '#93a1a1',
    cursor: '#93a1a1',
    cursorAccent: '#002b36',
    selectionBackground: '#073642',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  'solarized-light': {
    background: '#fdf6e3',
    foreground: '#657b83',
    cursor: '#586e75',
    cursorAccent: '#fdf6e3',
    selectionBackground: '#eee8d5',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  dracula: {
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
  },
  'gruvbox-dark': {
    background: '#282828',
    foreground: '#ebdbb2',
    cursor: '#ebdbb2',
    cursorAccent: '#282828',
    selectionBackground: '#504945',
    black: '#282828',
    red: '#cc241d',
    green: '#98971a',
    yellow: '#d79921',
    blue: '#458588',
    magenta: '#b16286',
    cyan: '#689d6a',
    white: '#a89984',
    brightBlack: '#928374',
    brightRed: '#fb4934',
    brightGreen: '#b8bb26',
    brightYellow: '#fabd2f',
    brightBlue: '#83a598',
    brightMagenta: '#d3869b',
    brightCyan: '#8ec07c',
    brightWhite: '#ebdbb2',
  },
  'gruvbox-light': {
    background: '#fbf1c7',
    foreground: '#3c3836',
    cursor: '#3c3836',
    cursorAccent: '#fbf1c7',
    selectionBackground: '#d5c4a1',
    black: '#fbf1c7',
    red: '#cc241d',
    green: '#98971a',
    yellow: '#d79921',
    blue: '#458588',
    magenta: '#b16286',
    cyan: '#689d6a',
    white: '#7c6f64',
    brightBlack: '#928374',
    brightRed: '#9d0006',
    brightGreen: '#79740e',
    brightYellow: '#b57614',
    brightBlue: '#076678',
    brightMagenta: '#8f3f71',
    brightCyan: '#427b58',
    brightWhite: '#3c3836',
  },
  nord: {
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#d8dee9',
    cursorAccent: '#2e3440',
    selectionBackground: '#4c566a',
    black: '#3b4252',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    white: '#e5e9f0',
    brightBlack: '#4c566a',
    brightRed: '#bf616a',
    brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1',
    brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb',
    brightWhite: '#eceff4',
  },
  'one-dark': {
    background: '#282c34',
    foreground: '#abb2bf',
    cursor: '#528bff',
    cursorAccent: '#282c34',
    selectionBackground: '#3e4451',
    black: '#282c34',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#d19a66',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
    brightBlack: '#5c6370',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#d19a66',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff',
  },
  monokai: {
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    cursorAccent: '#272822',
    selectionBackground: '#49483e',
    black: '#272822',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#f8f8f2',
    brightBlack: '#75715e',
    brightRed: '#f92672',
    brightGreen: '#a6e22e',
    brightYellow: '#f4bf75',
    brightBlue: '#66d9ef',
    brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4',
    brightWhite: '#f9f8f5',
  },
  'tomorrow-night': {
    background: '#1d1f21',
    foreground: '#c5c8c6',
    cursor: '#c5c8c6',
    cursorAccent: '#1d1f21',
    selectionBackground: '#373b41',
    black: '#1d1f21',
    red: '#cc6666',
    green: '#b5bd68',
    yellow: '#f0c674',
    blue: '#81a2be',
    magenta: '#b294bb',
    cyan: '#8abeb7',
    white: '#c5c8c6',
    brightBlack: '#969896',
    brightRed: '#cc6666',
    brightGreen: '#b5bd68',
    brightYellow: '#f0c674',
    brightBlue: '#81a2be',
    brightMagenta: '#b294bb',
    brightCyan: '#8abeb7',
    brightWhite: '#ffffff',
  },
  'github-light': {
    background: '#ffffff',
    foreground: '#24292e',
    cursor: '#24292e',
    cursorAccent: '#ffffff',
    selectionBackground: '#c8c8fa',
    black: '#24292e',
    red: '#d73a49',
    green: '#28a745',
    yellow: '#dbab09',
    blue: '#0366d6',
    magenta: '#5a32a3',
    cyan: '#0598bc',
    white: '#6a737d',
    brightBlack: '#959da5',
    brightRed: '#cb2431',
    brightGreen: '#22863a',
    brightYellow: '#b08800',
    brightBlue: '#005cc5',
    brightMagenta: '#5a32a3',
    brightCyan: '#3192aa',
    brightWhite: '#d1d5da',
  },
}

// Returns the ITheme for a scheme, or null when the scheme is 'default'
// (caller should fall back to themeForXterm(appTheme) + textColor override).
export function getSchemeTheme(id: ColorSchemeId): ITheme | null {
  if (id === 'default') return null
  return SCHEME_THEMES[id]
}

// Custom-aware scheme resolver. If a customSchemeId is set and a matching
// entry exists in customSchemes, its full palette is returned (custom
// overrides built-in). Otherwise falls back to the built-in colorScheme
// (which may be 'default' → null). A dangling customSchemeId — pointing at
// a scheme that's since been deleted — is treated as "no custom" rather
// than throwing, so the user sees a graceful fallback to their last
// built-in choice.
export function resolveSchemeTheme(
  colorScheme: ColorSchemeId,
  customSchemeId: string | null,
  customSchemes: CustomColorScheme[],
): ITheme | null {
  if (customSchemeId) {
    const found = customSchemes.find((s) => s.id === customSchemeId)
    if (found) return found.theme
  }
  return getSchemeTheme(colorScheme)
}

// Defensive guard for IPC-loaded settings — if a saved colorScheme references
// a scheme that's since been removed from the catalog, fall back to default.
export function normalizeSchemeId(id: string | undefined | null): ColorSchemeId {
  if (!id) return 'default'
  const found = COLOR_SCHEMES.find((s) => s.id === id)
  return found ? found.id : 'default'
}

// Backgrounds the app theme paints into the terminal when no scheme is active.
// Kept in lock-step with themeForXterm() in TerminalView so the rest of the
// chrome (sidebar, sftp) can match what xterm is actually drawing.
const APP_THEME_BG: Record<AppTheme, string> = {
  dark: '#0f0f10',
  light: '#ffffff',
  blue: '#eef4fa',
}

// Theme default fg in #rrggbb form — mirrors the --fg values in :root rules
// in index.css. Used by App.tsx as the base for the UI brightness lerp when
// no uiTextColor is set, so the slider has something concrete to brighten.
const APP_THEME_FG: Record<AppTheme, string> = {
  dark: '#ffffff',
  light: '#000000',
  blue: '#16263a',
}

// Resolve the effective UI text color for a (theme, override, brightness)
// triple. Returns null when no override is needed (theme default + no
// brightness boost — let the index.css :root rule win). Otherwise returns
// the #rrggbb the renderer should write into --fg.
export function getEffectiveUiFg(
  theme: AppTheme,
  uiTextColor: string | null,
  uiBrightness: number,
): string | null {
  if (!uiTextColor && uiBrightness <= 0) return null
  const base = uiTextColor ?? APP_THEME_FG[theme]
  if (uiBrightness <= 0) return base
  return brightenHex(base, Math.min(100, Math.max(0, uiBrightness)) / 100)
}

// Effective terminal background for a (theme, scheme, override) tuple. The
// override (terminalBackground setting) wins over everything when set; then
// the active color scheme's bg (custom-first via resolveSchemeTheme); falling
// back to the app theme. Used by App.tsx to publish --bg-terminal so the
// sidebar default and the SFTP window can follow whatever the terminal is
// actually painting.
export function getEffectiveTerminalBg(
  theme: AppTheme,
  colorScheme: ColorSchemeId,
  override: string | null = null,
  customSchemeId: string | null = null,
  customSchemes: CustomColorScheme[] = [],
): string {
  if (override) return override
  const scheme = resolveSchemeTheme(colorScheme, customSchemeId, customSchemes)
  if (scheme && typeof scheme.background === 'string') return scheme.background
  return APP_THEME_BG[theme]
}

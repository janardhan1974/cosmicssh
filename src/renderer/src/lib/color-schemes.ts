import type { AppTheme } from '../../../shared/types'

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

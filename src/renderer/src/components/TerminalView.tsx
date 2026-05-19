import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { ITheme } from '@xterm/xterm'
import { getSchemeTheme } from '../lib/color-schemes'
import { registerTerminal, unregisterTerminal } from '../lib/terminal-registry'
import { useSettingsStore } from '../stores/settings-store'
import type { AppTheme, ColorSchemeId } from '../../../shared/types'

// Lerp an #rrggbb color toward white by `t` in [0,1]. 0 returns the input
// unchanged; 1 returns #ffffff. Used by the brightness slider — anything
// other than a six-digit hex falls through unchanged so an unexpected value
// (named CSS color from xterm defaults, rgba(), …) can't crash the merge.
function brightenHex(hex: string, t: number): string {
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

// Resolve the effective xterm theme from the persisted knobs. Order:
//   1. Pick base palette — color scheme (full ITheme) OR theme + textColor.
//   2. Apply brightness slider — lerps ONLY the foreground toward white by
//      brightness/100. 0 = no change; 100 = pure white. Background, cursor,
//      selection, and the 16-color ANSI palette all pass through untouched
//      so the slider truly is "text only": no bright patches on the cursor
//      cell, no washed-out colored output, no background shift.
//
// Brightness runs after the scheme so users can keep a preset they like
// AND brighten the text without abandoning the rest of the palette.
function effectiveTheme(
  theme: AppTheme,
  textColor: string | null,
  colorScheme: ColorSchemeId,
  brightness: number,
): ITheme {
  const schemeTheme = getSchemeTheme(colorScheme)
  const base: ITheme = schemeTheme
    ? schemeTheme
    : textColor
      ? { ...themeForXterm(theme), foreground: textColor, cursor: textColor }
      : themeForXterm(theme)
  if (brightness <= 0) return base
  const t = Math.min(100, Math.max(0, brightness)) / 100
  return {
    ...base,
    foreground: base.foreground ? brightenHex(base.foreground, t) : base.foreground,
  }
}

// xterm theme colors per app theme. Kept tight to a few essential keys —
// background, foreground, cursor, selection. Everything else inherits xterm's
// default ANSI palette.
function themeForXterm(theme: AppTheme): ITheme {
  switch (theme) {
    case 'light':
      return {
        background: '#ffffff',
        foreground: '#000000',
        cursor: '#000000',
        selectionBackground: '#c8d4ec',
      }
    case 'blue':
      return {
        background: '#eef4fa',
        foreground: '#16263a',
        cursor: '#16263a',
        selectionBackground: '#b5c8db',
      }
    case 'dark':
    default:
      return {
        background: '#0f0f10',
        foreground: '#ffffff',
        cursor: '#ffffff',
        selectionBackground: '#3a3a3d',
      }
  }
}

type Props = {
  sessionId: string
  isActive: boolean
}

export function TerminalView({ sessionId, isActive }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const fontFamily = useSettingsStore((s) => s.terminal.fontFamily)
  const fontSize = useSettingsStore((s) => s.terminal.fontSize)
  const theme = useSettingsStore((s) => s.terminal.theme)
  const textColor = useSettingsStore((s) => s.terminal.textColor)
  const colorScheme = useSettingsStore((s) => s.terminal.colorScheme)
  const brightness = useSettingsStore((s) => s.terminal.brightness)

  // Mount xterm once per sessionId. Stays mounted across tab switches so
  // scrollback survives — the parent hides us with display:none when inactive.
  useEffect(() => {
    if (!hostRef.current) return

    const initialSettings = useSettingsStore.getState().terminal
    const initialTheme = effectiveTheme(
      initialSettings.theme,
      initialSettings.textColor,
      initialSettings.colorScheme,
      initialSettings.brightness,
    )
    const term = new Terminal({
      // plan.md M1 note ("windowsMode: false"): xterm v6 removed it. The v6
      // replacement (windowsPty) targets a LOCAL Windows PTY — we never do
      // that. Default unset is the correct equivalent.
      fontFamily: initialSettings.fontFamily,
      fontSize: initialSettings.fontSize,
      cursorBlink: true,
      scrollback: 10_000,
      theme: initialTheme,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(hostRef.current)
    fit.fit()

    // ── xterm.js requestMode workaround ───────────────────────────────────
    // xterm.js 6.0 / 6.1-beta has a bug where its built-in DECRQM ("DEC
    // Request Mode") handler throws `ReferenceError: r is not defined`,
    // corrupting the parser state. vim sends DECRQM at startup to probe
    // terminal capabilities; the resulting crash freezes the terminal —
    // keystrokes still leave the renderer but the parser can't process
    // escape responses any more, so vim hangs waiting for a reply that
    // never comes.
    //
    // We pre-register handlers for both DECRQM variants that return a
    // spec-compliant "mode not recognized" response (Ps=0 in DECRPM).
    // Returning true tells xterm.js we handled it, so its broken default
    // never runs. vim sees "feature not available" and moves on cleanly.
    //   CSI ? Ps $ p  — request private mode  (vim's main probe)
    //   CSI Ps $ p    — request ANSI mode
    // Reply format:
    //   CSI ? Ps ; 0 $ y    /    CSI Ps ; 0 $ y
    const replyNotRecognized = (mode: number, isPrivate: boolean): boolean => {
      const prefix = isPrivate ? '?' : ''
      const reply = `\x1b[${prefix}${mode};0$y`
      void window.api.ssh.write({ sessionId, data: reply })
      return true
    }
    term.parser.registerCsiHandler(
      { prefix: '?', intermediates: '$', final: 'p' },
      (params) => replyNotRecognized(Number(params[0] ?? 0), true),
    )
    term.parser.registerCsiHandler(
      { intermediates: '$', final: 'p' },
      (params) => replyNotRecognized(Number(params[0] ?? 0), false),
    )

    termRef.current = term
    fitRef.current = fit
    // Expose this Terminal to the renderer-side registry so the tab's
    // "Save scrollback to file…" action can grab the buffer by sessionId.
    registerTerminal(sessionId, term)

    // Ctrl + wheel = font zoom; Ctrl + = / Ctrl + - / Ctrl + 0 (reset).
    // Plain wheel keeps its standard scrollback behavior.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? -1 : 1
      useSettingsStore.getState().bumpFontSize(delta)
    }
    hostRef.current.addEventListener('wheel', onWheel, {
      capture: true,
      passive: false,
    })

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey) return true
      if (e.key === '=' || e.key === '+') {
        useSettingsStore.getState().bumpFontSize(+1)
        return false
      }
      if (e.key === '-' || e.key === '_') {
        useSettingsStore.getState().bumpFontSize(-1)
        return false
      }
      if (e.key === '0') {
        useSettingsStore.getState().resetFontSize()
        return false
      }
      return true
    })

    // Auto-copy on selection (MobaXterm/PuTTY convention). Whenever the
    // selection changes and we have non-empty text, push it to the system
    // clipboard.
    const selSub = term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (sel.length > 0) {
        void navigator.clipboard.writeText(sel).catch(() => {
          // Renderer clipboard write occasionally rejects (e.g. window not
          // focused). Swallow — the next selection will retry.
        })
      }
    })

    // Right-click → paste clipboard contents into the terminal. Uses
    // term.paste() so the shell sees bracketed-paste markers if it has
    // them enabled.
    const onContextMenu = async (e: MouseEvent) => {
      e.preventDefault()
      try {
        const text = await navigator.clipboard.readText()
        if (text && termRef.current) {
          termRef.current.paste(text)
        }
      } catch {
        // clipboard read denied or empty — silent
      }
    }
    hostRef.current.addEventListener('contextmenu', onContextMenu)

    const dataSub = term.onData((data) => {
      // Temporary diagnostic: surface every keypress xterm hands to us +
      // confirm the IPC write resolves. If you press a key in vim and see
      // no log line here, xterm never received the key (focus / DOM issue).
      // If you see "[term→ssh]" but vim ignores it, the SSH/PTY side is
      // dropping it. Includes a hex dump so escape sequences are visible.
      const hex = Array.from(data, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ')
      // eslint-disable-next-line no-console
      console.log(`[term→ssh] ${JSON.stringify(data)}  (hex: ${hex})  active=${document.activeElement?.tagName}`)
      window.api.ssh.write({ sessionId, data }).then(
        () => { /* console.log('[term→ssh] write ok') */ },
        (err) => {
          // eslint-disable-next-line no-console
          console.error('[term→ssh] write FAILED', err)
        },
      )
    })
    const resizeSub = term.onResize(({ cols, rows }) => {
      void window.api.ssh.resize({ sessionId, cols, rows })
    })
    void window.api.ssh.resize({
      sessionId,
      cols: term.cols,
      rows: term.rows,
    })

    const unsubData = window.api.ssh.onData((evt) => {
      if (evt.sessionId === sessionId) term.write(evt.data)
    })
    const unsubClose = window.api.ssh.onClose((evt) => {
      if (evt.sessionId !== sessionId) return
      term.write('\r\n\x1b[33m── connection closed ──\x1b[0m\r\n')
    })
    const unsubError = window.api.ssh.onError((evt) => {
      if (evt.sessionId !== sessionId) return
      term.write(`\r\n\x1b[31m── error: ${evt.message} ──\x1b[0m\r\n`)
    })

    // Coalesce fit() calls across a single frame. During a fast drag-resize
    // (FloatingChrome MDI corner, tile-mode divider, window edge), the
    // ResizeObserver and window 'resize' can fire multiple times per frame —
    // batching to one fit() per rAF keeps the grid in lock-step with the
    // container so the bottom row (where the cursor lives) never lags behind
    // a shrinking host and gets visually clipped.
    let pendingFit = 0
    const scheduleFit = () => {
      if (pendingFit !== 0) return
      pendingFit = requestAnimationFrame(() => {
        pendingFit = 0
        // fit() throws inside a transient state (e.g. host briefly
        // display:none during a layout flush). The next observation will
        // catch up, so swallow.
        try { fit.fit() } catch { /* layout in flux — next tick will retry */ }
      })
    }
    window.addEventListener('resize', scheduleFit)

    // Sidebar resize / panel layout changes don't fire window 'resize'; observe
    // the host container directly so xterm refits when the pane width changes.
    const ro = new ResizeObserver(scheduleFit)
    ro.observe(hostRef.current)

    const host = hostRef.current
    return () => {
      window.removeEventListener('resize', scheduleFit)
      if (pendingFit !== 0) cancelAnimationFrame(pendingFit)
      host?.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
      host?.removeEventListener('contextmenu', onContextMenu)
      ro.disconnect()
      dataSub.dispose()
      resizeSub.dispose()
      selSub.dispose()
      unsubData()
      unsubClose()
      unsubError()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      unregisterTerminal(sessionId)
    }
  }, [sessionId])

  // When this tab becomes active, refit + focus. (When inactive its container
  // is display:none, which means xterm's measurements were stale; fit fixes.)
  // Also: while we're the active tab, refocus on every window-regained-focus
  // event. Without this, switching between BrowserWindows tends to leave
  // focus on whatever chrome element the user clicked to re-orient, and the
  // first Space/Enter after the switch gets eaten by that <button>'s
  // activation handler instead of being sent to the SSH stream. Spacebar
  // appears "dead" until something clicks back into the terminal grid.
  useEffect(() => {
    if (!isActive) return
    const fit = fitRef.current
    const term = termRef.current
    if (!fit || !term) return
    // Defer to the next frame so the display:none → display:block layout has
    // settled before we measure.
    const id = requestAnimationFrame(() => {
      fit.fit()
      term.focus()
    })
    const onWindowFocus = () => {
      // queueMicrotask defers past whatever default focus handling fires for
      // the window focus event so we win the focus race.
      queueMicrotask(() => termRef.current?.focus())
    }
    window.addEventListener('focus', onWindowFocus)
    // In-window focus recovery. Without this, focus drifting to a button
    // outside the chrome list covered by App.tsx's mousedown-capture
    // preventDefault (e.g. SFTP toolbar, transfers panel) leaves xterm
    // unfocused until the user ALT+TABs out and back (which fires the
    // window-focus handler above). focusin bubbles, so a single document
    // listener catches all in-window focus moves. We refocus only when
    // focus landed somewhere the user clearly isn't typing into — never
    // fight focus moving to a real <input>, modal control, or context
    // menu item, since those want keyboard.
    const onDocFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      // Real text input/textarea: user wants to type there. Note xterm's
      // own hidden textarea has tagName === 'TEXTAREA', so this early
      // return is also what prevents a refocus loop when WE focus xterm.
      if (target.tagName === 'INPUT') return
      if (target.tagName === 'TEXTAREA') return
      // Modals and context menus need their own focus for Enter/Escape.
      if (target.closest('.modal, .context-menu')) return
      // Already inside the terminal subtree (shouldn't happen given the
      // tagName guard above, but defensive).
      if (target.closest('.terminal-view')) return
      // Focus drifted to a non-typing element — recover.
      queueMicrotask(() => termRef.current?.focus())
    }
    document.addEventListener('focusin', onDocFocusIn)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('focus', onWindowFocus)
      document.removeEventListener('focusin', onDocFocusIn)
    }
  }, [isActive])

  // Apply font changes live to the xterm instance + refit (cell dimensions
  // change so the grid needs to recompute and the SSH side needs the new size).
  useEffect(() => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    term.options.fontFamily = fontFamily
    term.options.fontSize = fontSize
    fit.fit()
  }, [fontFamily, fontSize])

  // Re-skin the xterm instance when any of the theme inputs change. Live so
  // a user dragging the brightness slider or picking a new color scheme in
  // Settings sees every open terminal re-color instantly without reconnect.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = effectiveTheme(theme, textColor, colorScheme, brightness)
  }, [theme, textColor, colorScheme, brightness])

  // Reclaim xterm focus on any mousedown inside the terminal area. xterm.js
  // already focuses its hidden textarea when you click ON its rendered grid,
  // but clicks on the surrounding padding (or anywhere else focus has drifted
  // to — sidebar buttons, modals that just closed, the tab bar) leave the
  // textarea unfocused and silently swallow keystrokes. This is the symptom
  // people hit when "vim opens but keys don't work": vim is fine, the term
  // is fine, the textarea just isn't the active element so keys never reach
  // the SSH stream. mousedown (not click) so a quick tap-and-type works.
  const refocus = () => {
    // queueMicrotask defers past whatever default focus handling fires for
    // the mousedown so we win the focus race against e.g. button focus.
    queueMicrotask(() => termRef.current?.focus())
  }

  return (
    <div
      className="terminal-view"
      style={{ display: isActive ? 'flex' : 'none' }}
      onMouseDown={refocus}
    >
      <div ref={hostRef} className="terminal-host" />
    </div>
  )
}

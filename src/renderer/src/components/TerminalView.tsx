import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { ITheme } from '@xterm/xterm'
import { useSettingsStore } from '../stores/settings-store'
import type { AppTheme } from '../../../shared/types'

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

  // Mount xterm once per sessionId. Stays mounted across tab switches so
  // scrollback survives — the parent hides us with display:none when inactive.
  useEffect(() => {
    if (!hostRef.current) return

    const initialSettings = useSettingsStore.getState().terminal
    const initialThemeBase = themeForXterm(initialSettings.theme)
    const initialTheme = initialSettings.textColor
      ? { ...initialThemeBase, foreground: initialSettings.textColor, cursor: initialSettings.textColor }
      : initialThemeBase
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

    termRef.current = term
    fitRef.current = fit

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
      void window.api.ssh.write({ sessionId, data })
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

    const onWindowResize = () => fit.fit()
    window.addEventListener('resize', onWindowResize)

    // Sidebar resize / panel layout changes don't fire window 'resize'; observe
    // the host container directly so xterm refits when the pane width changes.
    const ro = new ResizeObserver(() => fit.fit())
    ro.observe(hostRef.current)

    const host = hostRef.current
    return () => {
      window.removeEventListener('resize', onWindowResize)
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
    }
  }, [sessionId])

  // When this tab becomes active, refit + focus. (When inactive its container
  // is display:none, which means xterm's measurements were stale; fit fixes.)
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
    return () => cancelAnimationFrame(id)
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

  // Re-skin the xterm instance when the app theme or text color changes
  // so terminal background/foreground match the chrome.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const base = themeForXterm(theme)
    term.options.theme = textColor
      ? { ...base, foreground: textColor, cursor: textColor }
      : base
  }, [theme, textColor])

  return (
    <div
      className="terminal-view"
      style={{ display: isActive ? 'flex' : 'none' }}
    >
      <div ref={hostRef} className="terminal-host" />
    </div>
  )
}

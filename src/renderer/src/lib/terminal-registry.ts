// Module-level registry mapping sessionId → live xterm Terminal instance.
//
// Why this exists: the "Save scrollback to file…" action lives on the tab
// (TabBar context menu), but the xterm Terminal it needs to read from lives
// inside TerminalView. Rather than prop-drilling refs or hoisting xterm
// state into Zustand (xterm objects don't serialize), TerminalView registers
// itself here on mount and deregisters on unmount. The TabBar handler looks
// up the right Terminal by sessionId.
//
// This is renderer-process-local (module scope = per-window). One registry
// per BrowserWindow is exactly right: each window has its own React tree
// and its own set of TerminalView mounts.

import type { Terminal } from '@xterm/xterm'

const registry = new Map<string, Terminal>()

export function registerTerminal(sessionId: string, term: Terminal): void {
  registry.set(sessionId, term)
}

export function unregisterTerminal(sessionId: string): void {
  registry.delete(sessionId)
}

// Serialize the terminal's full scrollback + current viewport to a single
// plain-text string. xterm exposes BufferLines; each line's `translateToString`
// gives us the rendered cells without escape sequences. `trimRight` drops
// trailing spaces from the right edge of each line — purely cosmetic.
export function getScrollbackText(sessionId: string): string | null {
  const term = registry.get(sessionId)
  if (!term) return null
  const buf = term.buffer.active
  const lines: string[] = []
  // baseY = scrollback length; baseY + rows covers the visible viewport too.
  const total = buf.length
  for (let i = 0; i < total; i++) {
    const line = buf.getLine(i)
    if (!line) continue
    lines.push(line.translateToString(true))
  }
  // Drop any fully-blank lines at the very end — xterm pre-allocates the
  // viewport so an idle terminal has many empty rows below the prompt.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

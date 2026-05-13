import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

type Props = {
  sessionId: string
  meta: { host: string; username: string }
  onDisconnect: () => void
}

export function TerminalView({ sessionId, meta, onDisconnect }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<'open' | 'closed'>('open')
  const [statusDetail, setStatusDetail] = useState<string>('')

  useEffect(() => {
    if (!hostRef.current) return

    const term = new Terminal({
      // plan.md M1 note ("windowsMode: false"): xterm v6 removed `windowsMode`.
      // The replacement (`windowsPty`) is for connecting xterm to a LOCAL Windows
      // PTY — we never do that; our PTY is always the remote Linux shell over SSH.
      // Leaving both options unset is the correct equivalent of the plan's intent.
      fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10_000,
      theme: {
        background: '#0f0f10',
        foreground: '#e8e6e3',
        cursor: '#e8e6e3',
        selectionBackground: '#3a3a3d',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(hostRef.current)
    fit.fit()
    term.focus()

    termRef.current = term
    fitRef.current = fit

    // Renderer → main: keystrokes
    const dataSub = term.onData((data) => {
      void window.api.ssh.write({ sessionId, data })
    })
    // Renderer → main: resize
    const resizeSub = term.onResize(({ cols, rows }) => {
      void window.api.ssh.resize({ sessionId, cols, rows })
    })
    // Initial resize sync (xterm fit() may give different cols/rows than ssh2's default 80x24)
    void window.api.ssh.resize({
      sessionId,
      cols: term.cols,
      rows: term.rows,
    })

    // Main → renderer: data/close/error
    const unsubData = window.api.ssh.onData((evt) => {
      if (evt.sessionId === sessionId) term.write(evt.data)
    })
    const unsubClose = window.api.ssh.onClose((evt) => {
      if (evt.sessionId !== sessionId) return
      setStatus('closed')
      setStatusDetail(
        evt.code !== null
          ? `exit code ${evt.code}`
          : evt.signal !== null
            ? `signal ${evt.signal}`
            : 'connection closed',
      )
      term.write('\r\n\x1b[33m── connection closed ──\x1b[0m\r\n')
    })
    const unsubError = window.api.ssh.onError((evt) => {
      if (evt.sessionId !== sessionId) return
      term.write(`\r\n\x1b[31m── error: ${evt.message} ──\x1b[0m\r\n`)
    })

    // Window resize → re-fit
    const onWindowResize = () => fit.fit()
    window.addEventListener('resize', onWindowResize)

    return () => {
      window.removeEventListener('resize', onWindowResize)
      dataSub.dispose()
      resizeSub.dispose()
      unsubData()
      unsubClose()
      unsubError()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [sessionId])

  const handleDisconnect = async () => {
    try {
      await window.api.ssh.disconnect({ sessionId })
    } finally {
      onDisconnect()
    }
  }

  return (
    <div className="terminal-view">
      <header className="terminal-header">
        <span className="terminal-title">
          {meta.username}@{meta.host}
        </span>
        <span className={`terminal-status ${status}`}>
          {status === 'open' ? 'connected' : `closed (${statusDetail})`}
        </span>
        <button type="button" onClick={handleDisconnect}>
          {status === 'open' ? 'Disconnect' : 'Close'}
        </button>
      </header>
      <div ref={hostRef} className="terminal-host" />
    </div>
  )
}

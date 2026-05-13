import { useState, type FormEvent } from 'react'
import type { ConnectResult } from '../../../shared/types'

type Props = {
  onConnected: (result: ConnectResult, meta: { host: string; username: string }) => void
}

export function ConnectForm({ onConnected }: Props) {
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    const portNum = Number.parseInt(port, 10)
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setError('Port must be between 1 and 65535')
      return
    }
    if (host.trim().length === 0) {
      setError('Host is required')
      return
    }
    if (username.trim().length === 0) {
      setError('Username is required')
      return
    }

    setBusy(true)
    try {
      const result = await window.api.ssh.connect({
        host: host.trim(),
        port: portNum,
        username: username.trim(),
        password,
      })
      onConnected(result, { host: host.trim(), username: username.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="connect-screen">
      <form className="connect-form" onSubmit={handleSubmit}>
        <h2>New SSH session</h2>
        <p className="muted">Enter an IP address or hostname.</p>

        <label>
          <span>Host</span>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
            placeholder="192.168.1.42 or example.com"
          />
        </label>

        <label>
          <span>Port</span>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            min={1}
            max={65535}
            disabled={busy}
          />
        </label>

        <label>
          <span>Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
          />
        </label>

        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </label>

        {error && <div className="error" role="alert">{error}</div>}

        <button type="submit" disabled={busy}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </div>
  )
}

import { useState } from 'react'
import { ConnectForm } from './components/ConnectForm'
import { TerminalView } from './components/TerminalView'

type Session = {
  sessionId: string
  host: string
  username: string
}

export function App() {
  const [session, setSession] = useState<Session | null>(null)

  if (!session) {
    return (
      <ConnectForm
        onConnected={(result, meta) =>
          setSession({ sessionId: result.sessionId, ...meta })
        }
      />
    )
  }

  return (
    <TerminalView
      sessionId={session.sessionId}
      meta={{ host: session.host, username: session.username }}
      onDisconnect={() => setSession(null)}
    />
  )
}

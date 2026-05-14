// First-connect host-key prompt. Same role as OpenSSH's "The authenticity of
// host '...' can't be established. RSA key fingerprint is ...: are you sure
// you want to continue connecting?" — but as a modal in the GUI.
//
// Accepting stores the key in known_hosts so we don't bother the user again
// on subsequent connections. Rejecting (or closing) aborts the connection.

import type { HostKeyPromptEvent } from '../../../shared/types'

type Props = {
  prompt: HostKeyPromptEvent
  onRespond: (accept: boolean) => void
}

export function HostKeyPrompt({ prompt, onRespond }: Props) {
  return (
    <div className="modal-backdrop" onClick={() => onRespond(false)}>
      <div
        className="modal hostkey-prompt"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <h2>First connect to {prompt.host}:{prompt.port}</h2>
        <p className="muted">
          The host hasn't been seen before. Verify the fingerprint matches
          what you got out of band (the server admin, the cloud console, etc.)
          before accepting.
        </p>

        <div className="hostkey-details">
          <div>
            <span className="hostkey-label">Host</span>
            <span className="hostkey-value">{prompt.host}:{prompt.port}</span>
          </div>
          <div>
            <span className="hostkey-label">Key type</span>
            <span className="hostkey-value">{prompt.keyType}</span>
          </div>
          <div>
            <span className="hostkey-label">Fingerprint</span>
            <span className="hostkey-value hostkey-fingerprint">{prompt.fingerprint}</span>
          </div>
        </div>

        <p className="muted hint">
          To compare on the server, run on it:
          <br />
          <code>ssh-keygen -lf /etc/ssh/ssh_host_{prompt.keyType.replace(/^ssh-/, '')}_key.pub</code>
        </p>

        <div className="actions">
          <button type="button" onClick={() => onRespond(false)}>
            Reject
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => onRespond(true)}
            autoFocus={false}
          >
            Accept and remember
          </button>
        </div>
      </div>
    </div>
  )
}

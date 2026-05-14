import { useState, type FormEvent } from 'react'
import type { SessionProfile } from '../../../shared/types'

type Props = {
  profile: SessionProfile
  onCancel: () => void
  onSubmit: (password: string, savePassword: boolean) => void
}

export function PasswordPrompt({ profile, onCancel, onSubmit }: Props) {
  const [password, setPassword] = useState('')
  const [save, setSave] = useState(profile.savePassword)

  const handle = (e: FormEvent) => {
    e.preventDefault()
    onSubmit(password, save)
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal password-prompt"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handle}
      >
        <h2>Password for {profile.name}</h2>
        <p className="muted">
          {profile.username}@{profile.host}:{profile.port}
        </p>

        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="off"
          />
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={save}
            onChange={(e) => setSave(e.target.checked)}
          />
          <span>Remember password (encrypted)</span>
        </label>

        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary">Connect</button>
        </div>
      </form>
    </div>
  )
}

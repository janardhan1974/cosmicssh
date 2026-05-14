import { useState, type FormEvent } from 'react'
import type { ProfileDraft, SessionProfile } from '../../../shared/types'
import { useProfilesStore } from '../stores/profiles-store'

type Props = {
  mode: 'create' | 'edit'
  initial?: SessionProfile
  onCancel: () => void
  onSave: (saved: SessionProfile, password: string | null) => void
  // If provided, the editor offers a "Save & Connect" button.
  onSaveAndConnect?: (saved: SessionProfile, password: string | null) => void
}

export function ProfileEditor({
  mode,
  initial,
  onCancel,
  onSave,
  onSaveAndConnect,
}: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [group, setGroup] = useState(initial?.group ?? '')
  const [host, setHost] = useState(initial?.host ?? '')
  const [port, setPort] = useState(String(initial?.port ?? 22))
  const [username, setUsername] = useState(initial?.username ?? '')
  const [password, setPassword] = useState('')
  const [savePassword, setSavePassword] = useState(initial?.savePassword ?? false)
  const [jumpHost, setJumpHost] = useState<string>(initial?.jumpHost ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Available jump-host candidates: every other profile (excluding self when
  // editing). Cycle prevention is enforced server-side at connect time; the
  // editor lets you pick anything but yourself.
  const allProfiles = useProfilesStore((s) => s.profiles)
  const jumpCandidates = allProfiles.filter((p) => p.id !== initial?.id)

  // Track which submit button was clicked so the same handler can branch.
  const [submitIntent, setSubmitIntent] = useState<'save' | 'connect'>('save')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    const portNum = Number.parseInt(port, 10)
    if (!name.trim()) return setError('Name is required')
    if (!host.trim()) return setError('Host is required')
    if (!username.trim()) return setError('Username is required')
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return setError('Port must be between 1 and 65535')
    }
    if (savePassword && password.length === 0 && mode === 'create') {
      return setError('Save Password is on but no password was entered')
    }

    // If user clicked "Save & Connect" with no password typed, make sure we
    // have something to authenticate with. For new profiles that means a
    // password is required; for existing profiles we accept a stored credential.
    if (submitIntent === 'connect' && password.length === 0) {
      if (mode === 'create') {
        return setError('Password is required to connect')
      }
      const hasStored = initial
        ? await window.api.credentials.has({ profileId: initial.id })
        : false
      if (!hasStored) {
        return setError(
          'No saved password for this profile — type one to connect',
        )
      }
    }

    setBusy(true)
    try {
      const draft: ProfileDraft = {
        name: name.trim(),
        host: host.trim(),
        port: portNum,
        username: username.trim(),
        authMethod: 'password', // M2 will add 'key' and 'agent'
        group: group.trim() || undefined,
        jumpHost: jumpHost || undefined,
        savePassword,
      }

      let saved: SessionProfile
      if (mode === 'create') {
        saved = await window.api.profiles.create(draft)
      } else {
        if (!initial) throw new Error('edit mode requires initial profile')
        saved = await window.api.profiles.update({
          ...initial,
          ...draft,
        })
      }

      // Persist password if user opted in and entered one.
      const hasNewPassword = password.length > 0
      if (savePassword && hasNewPassword) {
        await window.api.credentials.save({
          profileId: saved.id,
          password,
        })
      }
      // If user turned off Save Password on an existing profile, drop any
      // stored credential.
      if (!savePassword && mode === 'edit') {
        await window.api.credentials.delete({ profileId: saved.id })
      }

      const passwordToReturn = hasNewPassword ? password : null
      if (submitIntent === 'connect' && onSaveAndConnect) {
        onSaveAndConnect(saved, passwordToReturn)
      } else {
        onSave(saved, passwordToReturn)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal profile-editor"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>{mode === 'create' ? 'New profile' : 'Edit profile'}</h2>

        <label>
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            disabled={busy}
            placeholder="e.g. RunPod gpu-1"
          />
        </label>

        <label>
          <span>Group (optional)</span>
          <input
            type="text"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            disabled={busy}
            placeholder="e.g. RunPod, Personal, OpenShift"
          />
        </label>

        <div className="row">
          <label className="grow">
            <span>Host</span>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
              placeholder="IP or hostname"
            />
          </label>
          <label className="port">
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
        </div>

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
          <span>Jump host (optional)</span>
          <select
            value={jumpHost}
            onChange={(e) => setJumpHost(e.target.value)}
            disabled={busy}
          >
            <option value="">Direct (no jump)</option>
            {jumpCandidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.username}@{p.host}
              </option>
            ))}
          </select>
        </label>
        {jumpHost && (
          <p className="hint muted">
            Jump host must have <strong>Save Password</strong> enabled. Set up its profile
            with a saved password, otherwise this connection will fail with a clear
            error at connect time.
          </p>
        )}

        <label>
          <span>
            Password
            {mode === 'edit' && ' (leave blank to keep existing)'}
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={savePassword}
            onChange={(e) => setSavePassword(e.target.checked)}
            disabled={busy}
          />
          <span>Save password (encrypted with Windows DPAPI)</span>
        </label>

        {error && <div className="error" role="alert">{error}</div>}

        <div className="actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="secondary"
            disabled={busy}
            onClick={() => setSubmitIntent('save')}
          >
            {busy && submitIntent === 'save' ? 'Saving…' : 'Save'}
          </button>
          {onSaveAndConnect && (
            <button
              type="submit"
              className="primary"
              disabled={busy}
              onClick={() => setSubmitIntent('connect')}
            >
              {busy && submitIntent === 'connect' ? 'Connecting…' : 'Save & Connect'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

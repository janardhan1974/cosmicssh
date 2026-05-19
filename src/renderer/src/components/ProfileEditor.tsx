import { useState, type FormEvent } from 'react'
import type { AuthMethod, ProfileDraft, Protocol, SessionProfile } from '../../../shared/types'
import { usePlatformStore } from '../stores/platform-store'
import { useProfilesStore } from '../stores/profiles-store'
import { ModalBackdrop } from './ModalBackdrop'

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
  const [logSession, setLogSession] = useState(initial?.logSession ?? false)
  const [jumpHost, setJumpHost] = useState<string>(initial?.jumpHost ?? '')
  // 'ssh' (shell + SFTP in one session) is back-compat only — existing saved
  // profiles still load and connect, but the picker no longer offers it.
  // Default for newly created profiles is 'ssh-shell-only'.
  const [protocol, setProtocol] = useState<Protocol>(initial?.protocol ?? 'ssh-shell-only')
  const [authMethod, setAuthMethod] = useState<AuthMethod>(initial?.authMethod ?? 'password')
  const [keyPath, setKeyPath] = useState(initial?.keyPath ?? '')
  const isKey = authMethod === 'key'
  // Secret field labels swap based on auth method — "password" for password
  // auth, "passphrase" for key auth.
  const secretLabel = isKey ? 'Passphrase' : 'Password'
  const platform = usePlatformStore((s) => s.info)
  const keyPlaceholder = platform.isWindows
    ? '%USERPROFILE%\\.ssh\\id_ed25519'
    : '~/.ssh/id_ed25519'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Available jump-host candidates: every other profile (excluding self when
  // editing). Cycle prevention is enforced server-side at connect time; the
  // editor lets you pick anything but yourself.
  const allProfiles = useProfilesStore((s) => s.profiles)
  const jumpCandidates = allProfiles.filter((p) => p.id !== initial?.id)
  // Route saves through the store actions, NOT raw IPC — the store mirrors
  // the disk state into renderer-visible `profiles`, which is what the
  // sidebar subscribes to. Calling window.api.profiles.create directly would
  // persist to disk but leave the sidebar stale until the next reload.
  const createProfile = useProfilesStore((s) => s.create)
  const updateProfileInStore = useProfilesStore((s) => s.update)

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
    if (savePassword && password.length === 0 && mode === 'create' && !isKey) {
      return setError('Save Password is on but no password was entered')
    }
    // For key auth: saving an empty passphrase is meaningful (it means
    // "this key has no passphrase") — don't error in that case.

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
      if (isKey && !keyPath.trim()) {
        return setError('Key path is required for key auth')
      }
      const draft: ProfileDraft = {
        name: name.trim(),
        host: host.trim(),
        port: portNum,
        username: username.trim(),
        authMethod,
        keyPath: isKey ? keyPath.trim() : undefined,
        protocol,
        group: group.trim() || undefined,
        jumpHost: jumpHost || undefined,
        savePassword,
        logSession,
      }

      let saved: SessionProfile
      if (mode === 'create') {
        saved = await createProfile(draft)
      } else {
        if (!initial) throw new Error('edit mode requires initial profile')
        saved = await updateProfileInStore({
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
    <ModalBackdrop onClose={onCancel}>
      <form
        className="modal profile-editor"
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
          <span>Connection type</span>
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as Protocol)}
            disabled={busy}
          >
            <option value="ssh-shell-only">SSH (terminal)</option>
            <option value="sftp-only">SFTP</option>
          </select>
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
          <span>Authentication</span>
          <select
            value={authMethod}
            onChange={(e) => setAuthMethod(e.target.value as AuthMethod)}
            disabled={busy}
          >
            <option value="password">Password</option>
            <option value="key">Private key</option>
          </select>
        </label>

        {isKey && (
          <label>
            <span>Key file</span>
            <span className="row">
              <input
                type="text"
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                className="grow"
                placeholder={'%USERPROFILE%\\.ssh\\id_ed25519'}
              />
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  const picked = await window.api.dialog.pickKeyFile()
                  if (picked) setKeyPath(picked)
                }}
              >
                Browse…
              </button>
            </span>
          </label>
        )}

        <label>
          <span>
            {secretLabel}
            {mode === 'edit' && ' (leave blank to keep existing)'}
            {isKey && ' (blank = key has no passphrase)'}
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
          <span>Save {isKey ? 'passphrase' : 'password'} (encrypted with Windows DPAPI)</span>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={logSession}
            onChange={(e) => setLogSession(e.target.checked)}
            // No shell channel = nothing to log. The checkbox stays editable
            // so the preference is preserved if the user later switches the
            // profile back to a shell-capable protocol.
            disabled={busy || protocol === 'sftp-only'}
          />
          <span>
            Log session to file
            {protocol === 'sftp-only' && ' (not applicable to SFTP-only)'}
          </span>
        </label>
        {logSession && protocol !== 'sftp-only' && (
          <p className="hint muted">
            Each connection appends to <code>&lt;exe-dir&gt;/sessions/{name.trim() || '<profile>'}_DDMMYYYY_HHMM.txt</code>.
            ANSI escapes are stripped. Both your typed commands and the server's output are captured.
          </p>
        )}

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
    </ModalBackdrop>
  )
}

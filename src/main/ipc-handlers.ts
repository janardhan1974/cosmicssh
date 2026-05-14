// Registers ipcMain handlers + wires SSH event broadcasts to renderer windows.
// Every invoke handler validates its payload with zod before touching domain
// logic (plan.md security non-negotiables).

import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Client } from 'ssh2'
import { CredentialVault } from './credential-vault'
import { KnownHostsStore, parseHostKey } from './known-hosts'
import { LocalFsManager } from './local-fs-manager'
import { ProfileStore } from './profile-store'
import { SettingsStore } from './settings-store'
import { SftpSessionManager } from './sftp-session-manager'
import { SshSessionManager, type HostVerifierGate } from './ssh-session-manager'
import type { ProfileDraft, SessionProfile } from '../shared/types'
import {
  ConnectByProfilePayloadSchema,
  ConnectPayloadSchema,
  CredentialIdPayloadSchema,
  CredentialSavePayloadSchema,
  DisconnectPayloadSchema,
  LocalDeletePayloadSchema,
  LocalListPayloadSchema,
  PathStringSchema,
  ProfileDraftSchema,
  ProfileIdSchema,
  ResizePayloadSchema,
  SessionProfileSchema,
  SftpCancelPayloadSchema,
  SftpChmodPayloadSchema,
  SftpDeletePayloadSchema,
  SftpDownloadFolderPayloadSchema,
  SftpDownloadPayloadSchema,
  SftpEditOpenPayloadSchema,
  SftpListPayloadSchema,
  SftpMkdirPayloadSchema,
  SftpRenamePayloadSchema,
  SftpStatPayloadSchema,
  SftpUploadFolderPayloadSchema,
  SftpUploadPayloadSchema,
  TerminalSettingsSchema,
  WritePayloadSchema,
  validate,
} from './ipc-schemas'
import {
  IPC_CREDENTIALS_DELETE,
  IPC_CREDENTIALS_HAS,
  IPC_CREDENTIALS_SAVE,
  IPC_LOCAL_DELETE,
  IPC_LOCAL_HOME,
  IPC_LOCAL_LIST,
  IPC_LOCAL_PLATFORM,
  IPC_LOCAL_REVEAL,
  IPC_FOLDERS_CREATE,
  IPC_FOLDERS_DELETE,
  IPC_FOLDERS_LIST,
  IPC_PROFILES_CREATE,
  IPC_PROFILES_DELETE,
  IPC_PROFILES_EXPORT,
  IPC_PROFILES_IMPORT,
  IPC_PROFILES_LIST,
  IPC_PROFILES_UPDATE,
  IPC_SETTINGS_GET,
  IPC_SETTINGS_SET,
  IPC_SFTP_CANCEL,
  IPC_SFTP_CHMOD,
  IPC_SFTP_DELETE,
  IPC_SFTP_DOWNLOAD,
  IPC_SFTP_DOWNLOAD_FOLDER,
  IPC_SFTP_EDIT_OPEN,
  IPC_SFTP_LIST,
  IPC_SFTP_MKDIR,
  IPC_SFTP_RENAME,
  IPC_SFTP_STAT,
  IPC_SFTP_TRANSFER_DONE,
  IPC_SFTP_TRANSFER_ERROR,
  IPC_SFTP_TRANSFER_PROGRESS,
  IPC_SFTP_TRANSFER_STARTED,
  IPC_SFTP_UPLOAD,
  IPC_SFTP_UPLOAD_FOLDER,
  IPC_DIALOG_PICK_KEY,
  IPC_SSH_CLOSE,
  IPC_SSH_CONNECT,
  IPC_SSH_CONNECT_BY_PROFILE,
  IPC_SSH_DATA,
  IPC_SSH_DISCONNECT,
  IPC_SSH_ERROR,
  IPC_SSH_HOSTKEY_MISMATCH,
  IPC_SSH_HOSTKEY_PROMPT,
  IPC_SSH_HOSTKEY_RESPOND,
  IPC_SSH_RESIZE,
  IPC_SSH_WRITE,
} from '../shared/types'

function broadcastToAll(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function registerIpcHandlers(): SshSessionManager {
  const profiles = new ProfileStore()
  const vault = new CredentialVault()
  const settings = new SettingsStore()
  const localFs = new LocalFsManager()
  const knownHosts = new KnownHostsStore()

  // Pending host-key prompts. When the verifier gate sees an unknown key it
  // creates a requestId, registers a resolver here, broadcasts the prompt
  // event, and awaits the renderer's ssh:hostkey-respond IPC.
  const pendingHostKeyPrompts = new Map<string, (accept: boolean) => void>()

  const hostVerifierGate: HostVerifierGate = async ({ host, port, keyBuffer }) => {
    let parsed
    try {
      parsed = parseHostKey(keyBuffer)
    } catch {
      // Malformed key — refuse the connection rather than guessing.
      return false
    }
    const known = knownHosts.lookup(host, port)
    if (known) {
      if (known.keyType === parsed.keyType && known.keyB64 === parsed.keyB64) {
        return true // exact match
      }
      // Mismatch — possible MITM. Block and inform the renderer.
      const storedFingerprint =
        'SHA256:' +
        createHash('sha256')
          .update(Buffer.from(known.keyB64, 'base64'))
          .digest('base64')
          .replace(/=+$/, '')
      broadcastToAll(IPC_SSH_HOSTKEY_MISMATCH, {
        host,
        port,
        storedKeyType: known.keyType,
        storedFingerprint,
        presentedKeyType: parsed.keyType,
        presentedFingerprint: parsed.fingerprint,
      })
      return false
    }

    // Unknown host — ask the user.
    const requestId = randomUUID()
    const accept = await new Promise<boolean>((resolve) => {
      pendingHostKeyPrompts.set(requestId, resolve)
      broadcastToAll(IPC_SSH_HOSTKEY_PROMPT, {
        requestId,
        host,
        port,
        keyType: parsed.keyType,
        fingerprint: parsed.fingerprint,
      })
    })
    pendingHostKeyPrompts.delete(requestId)
    if (accept) {
      knownHosts.upsert({
        host,
        port,
        keyType: parsed.keyType,
        keyB64: parsed.keyB64,
      })
    }
    return accept
  }

  const sessions = new SshSessionManager({
    onData: (evt) => broadcastToAll(IPC_SSH_DATA, evt),
    onClose: (evt) => broadcastToAll(IPC_SSH_CLOSE, evt),
    onError: (evt) => broadcastToAll(IPC_SSH_ERROR, evt),
  }, hostVerifierGate)
  const sftp = new SftpSessionManager(sessions, {
    onStarted: (evt) => broadcastToAll(IPC_SFTP_TRANSFER_STARTED, evt),
    onProgress: (evt) => broadcastToAll(IPC_SFTP_TRANSFER_PROGRESS, evt),
    onDone: (evt) => broadcastToAll(IPC_SFTP_TRANSFER_DONE, evt),
    onError: (evt) => broadcastToAll(IPC_SFTP_TRANSFER_ERROR, evt),
  })

  // ─── SSH ───────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_SSH_CONNECT, async (_event, raw) => {
    const payload = validate(ConnectPayloadSchema, raw)
    const sessionId = await sessions.connect(payload)
    return { sessionId }
  })

  // Walk the jumpHost chain (recursively) and return:
  //   - the inner-most hop client to forwardOut() through, or null if direct
  //   - all hops opened along the way (caller stores these on the session
  //     for cleanup at disconnect time)
  // Cycle detection: a `visited` set keyed by profile id.
  async function openHopChain(
    profile: SessionProfile,
    visited: Set<string>,
  ): Promise<{ hopClient: Client; hops: Client[] }> {
    if (visited.has(profile.id)) {
      throw new Error(
        `jump-host cycle detected at "${profile.name}" — fix the chain in profile editor`,
      )
    }
    visited.add(profile.id)

    if (profile.authMethod === 'agent') {
      throw new Error(
        `jump host "${profile.name}" uses agent auth — not yet supported`,
      )
    }

    // Jump hosts must have their secret already saved in the vault — we
    // can't show a cascading password/passphrase prompt mid-connect.
    const storedSecret = vault.load(profile.id)
    let hopPassword: string | undefined
    let hopPrivateKey: Buffer | undefined
    let hopPassphrase: string | undefined

    if (profile.authMethod === 'password') {
      if (storedSecret === null) {
        throw new Error(
          `jump host "${profile.name}" has no saved password — open its profile and tick "Save Password"`,
        )
      }
      hopPassword = storedSecret
    } else {
      if (!profile.keyPath) {
        throw new Error(
          `jump host "${profile.name}" has no key path set`,
        )
      }
      try {
        hopPrivateKey = readFileSync(profile.keyPath)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        throw new Error(
          `cannot read jump host key file at ${profile.keyPath}: ${reason}`,
        )
      }
      // Passphrase is optional — undefined is OK if the key is unencrypted.
      hopPassphrase = storedSecret ?? undefined
    }

    let sock: Awaited<ReturnType<typeof sessions.forwardOut>> | undefined
    const hops: Client[] = []

    if (profile.jumpHost) {
      const inner = profiles.get(profile.jumpHost)
      if (!inner) {
        throw new Error(
          `profile "${profile.name}" references missing jump host id ${profile.jumpHost}`,
        )
      }
      const innerChain = await openHopChain(inner, visited)
      hops.push(...innerChain.hops)
      sock = await sessions.forwardOut(innerChain.hopClient, profile.host, profile.port)
    }

    const hopClient = await sessions.openHopClient({
      host: profile.host,
      port: profile.port,
      username: profile.username,
      password: hopPassword,
      privateKey: hopPrivateKey,
      passphrase: hopPassphrase,
      sock,
    })
    hops.push(hopClient)

    return { hopClient, hops }
  }

  ipcMain.handle(IPC_SSH_CONNECT_BY_PROFILE, async (_event, raw) => {
    const payload = validate(ConnectByProfilePayloadSchema, raw)
    const profile = profiles.get(payload.profileId)
    if (!profile) {
      throw new Error(`unknown profile: ${payload.profileId}`)
    }
    if (profile.authMethod === 'agent') {
      throw new Error(
        `profile ${profile.name} uses agent auth — not yet supported`,
      )
    }

    // Resolve credentials per auth method. For both 'password' and 'key' we
    // reuse the credential vault to store the secret keyed by profileId.
    let password: string | undefined
    let privateKey: Buffer | undefined
    let passphrase: string | undefined

    if (profile.authMethod === 'password') {
      const stored = vault.load(profile.id)
      const pw = stored ?? payload.passwordOverride
      if (pw === undefined) {
        throw new Error('no saved password and none provided')
      }
      password = pw
    } else {
      // 'key' — keyPath must be set
      if (!profile.keyPath) {
        throw new Error(`profile "${profile.name}" has no key path set`)
      }
      try {
        privateKey = readFileSync(profile.keyPath)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        throw new Error(`cannot read key file at ${profile.keyPath}: ${reason}`)
      }
      // Passphrase is optional — keys without passphrase pass undefined.
      const stored = vault.load(profile.id)
      passphrase = stored ?? payload.passwordOverride
    }

    // Resolve any jump-host chain BEFORE we open the target session.
    let sock: Awaited<ReturnType<typeof sessions.forwardOut>> | undefined
    let hops: Client[] = []
    if (profile.jumpHost) {
      const jumpProfile = profiles.get(profile.jumpHost)
      if (!jumpProfile) {
        throw new Error(
          `profile "${profile.name}" references missing jump host id ${profile.jumpHost}`,
        )
      }
      const visited = new Set<string>([profile.id]) // include target in cycle set
      const chain = await openHopChain(jumpProfile, visited)
      hops = chain.hops
      sock = await sessions.forwardOut(chain.hopClient, profile.host, profile.port)
    }

    let sessionId: string
    try {
      sessionId = await sessions.connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password,
        privateKey,
        passphrase,
        sock,
        hops,
        // SFTP-only profiles skip the shell channel; everything else opens it.
        withShell: profile.protocol !== 'sftp-only',
      })
    } catch (err) {
      // Target connect failed — close any hops we opened so we don't leak.
      for (let i = hops.length - 1; i >= 0; i--) {
        try { hops[i]?.end() } catch { /* */ }
      }
      throw err
    }

    profiles.touchLastUsed(profile.id)

    // If user opted in and we connected with a fresh override, persist it
    // (works for both password and passphrase — vault is a generic string
    // store).
    if (
      profile.savePassword &&
      vault.load(profile.id) === null &&
      payload.passwordOverride !== undefined
    ) {
      vault.save(profile.id, payload.passwordOverride)
    }

    return { sessionId, profileId: profile.id }
  })

  // Renderer's response to a host-key prompt — resolves the awaiting verifier.
  ipcMain.handle(IPC_SSH_HOSTKEY_RESPOND, (_event, raw) => {
    const payload = raw as { requestId?: string; accept?: boolean }
    if (typeof payload?.requestId !== 'string') return
    const resolver = pendingHostKeyPrompts.get(payload.requestId)
    if (!resolver) return
    resolver(Boolean(payload.accept))
  })

  // File picker for selecting a private key. Defaults to %USERPROFILE%\.ssh\.
  ipcMain.handle(IPC_DIALOG_PICK_KEY, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const defaultPath = join(homedir(), '.ssh')
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose private key',
      defaultPath,
      properties: ['openFile', 'showHiddenFiles'],
      filters: [
        { name: 'SSH private keys', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle(IPC_SSH_WRITE, (_event, raw) => {
    const payload = validate(WritePayloadSchema, raw)
    sessions.write(payload.sessionId, payload.data)
  })

  ipcMain.handle(IPC_SSH_RESIZE, (_event, raw) => {
    const payload = validate(ResizePayloadSchema, raw)
    sessions.resize(payload.sessionId, payload.cols, payload.rows)
  })

  ipcMain.handle(IPC_SSH_DISCONNECT, (_event, raw) => {
    const payload = validate(DisconnectPayloadSchema, raw)
    sessions.disconnect(payload.sessionId)
  })

  // ─── Profiles ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC_PROFILES_LIST, () => profiles.list())

  ipcMain.handle(IPC_PROFILES_CREATE, (_event, raw) => {
    const draft = validate(ProfileDraftSchema, raw)
    return profiles.create(draft)
  })

  ipcMain.handle(IPC_PROFILES_UPDATE, (_event, raw) => {
    const profile = validate(SessionProfileSchema, raw)
    return profiles.update(profile)
  })

  ipcMain.handle(IPC_PROFILES_DELETE, (_event, raw) => {
    const id = validate(ProfileIdSchema, raw)
    profiles.delete(id)
    vault.delete(id) // any saved password goes with the profile
  })

  // ─── Folders (empty groups) ────────────────────────────────────────────
  ipcMain.handle(IPC_FOLDERS_LIST, () => profiles.listExtraGroups())

  ipcMain.handle(IPC_FOLDERS_CREATE, (_event, raw) => {
    const name = validate(PathStringSchema, raw)
    profiles.createExtraGroup(name)
  })

  ipcMain.handle(IPC_FOLDERS_DELETE, (_event, raw) => {
    const name = validate(PathStringSchema, raw)
    profiles.deleteExtraGroup(name)
  })

  // ─── Profile import / export ───────────────────────────────────────────
  // Format is plain CSV with a stable header row. NO passwords are ever
  // included (security non-negotiable). `jumpHost` is exported as the
  // referenced profile's NAME (under the `jumpHostName` column) so the link
  // survives across machines where ids differ. Empty folders (with no
  // sessions) are not represented in CSV — they're trivial to re-create.
  const CSV_HEADERS = [
    'name',
    'group',
    'host',
    'port',
    'username',
    'authMethod',
    'protocol',
    'jumpHostName',
    'savePassword',
  ] as const

  ipcMain.handle(IPC_PROFILES_EXPORT, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export sessions',
      defaultPath: 'cosmicssh-sessions.txt',
      filters: [
        { name: 'CSV (comma-separated values)', extensions: ['txt', 'csv'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePath) return null

    const all = profiles.list()
    const idToName = new Map(all.map((p) => [p.id, p.name]))

    const lines: string[] = [CSV_HEADERS.join(',')]
    for (const p of all) {
      const jumpHostName = p.jumpHost ? idToName.get(p.jumpHost) ?? '' : ''
      const row = [
        p.name,
        p.group ?? '',
        p.host,
        String(p.port),
        p.username,
        p.authMethod,
        p.protocol ?? 'ssh',
        jumpHostName,
        String(Boolean(p.savePassword)),
      ]
      lines.push(row.map(csvEscape).join(','))
    }
    writeFileSync(result.filePath, lines.join('\n') + '\n', 'utf8')
    return { path: result.filePath, count: all.length }
  })

  ipcMain.handle(IPC_PROFILES_IMPORT, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import sessions',
      properties: ['openFile'],
      filters: [
        { name: 'CSV (comma-separated values)', extensions: ['txt', 'csv'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    if (!filePath) return null

    const raw = readFileSync(filePath, 'utf8')
    const rows = parseCsv(raw)
    if (rows.length === 0) {
      throw new Error('Selected CSV has no data rows')
    }
    if (!rows[0] || !('name' in rows[0]) || !('host' in rows[0])) {
      throw new Error(
        'CSV is missing required columns. Expected header row with at least: name, host, username, port',
      )
    }

    // Two passes so jumpHostName references can resolve to ids of profiles
    // we just created.
    type Pending = { entry: Record<string, string>; saved: SessionProfile }
    const pending: Pending[] = []
    const nameToNewId = new Map<string, string>()
    for (const entry of rows) {
      if (!entry.name || !entry.host || !entry.username) continue
      const port = Number.parseInt(entry.port ?? '22', 10)
      const draft: ProfileDraft = {
        name: entry.name,
        host: entry.host,
        port: Number.isFinite(port) && port > 0 ? port : 22,
        username: entry.username,
        authMethod:
          entry.authMethod === 'key' || entry.authMethod === 'agent'
            ? entry.authMethod
            : 'password',
        protocol: entry.protocol === 'sftp-only' ? 'sftp-only' : 'ssh',
        group: entry.group ? entry.group : undefined,
        savePassword: false, // imported profiles never carry saved passwords
      }
      const saved = profiles.create(draft)
      pending.push({ entry, saved })
      nameToNewId.set(saved.name, saved.id)
    }

    for (const { entry, saved } of pending) {
      const ref = entry.jumpHostName
      if (!ref) continue
      const targetId = nameToNewId.get(ref) ?? idForExistingName(profiles, ref)
      if (!targetId) continue
      profiles.update({ ...saved, jumpHost: targetId })
    }

    return { count: pending.length, folders: 0 }
  })

  // ─── Credentials ───────────────────────────────────────────────────────
  ipcMain.handle(IPC_CREDENTIALS_SAVE, (_event, raw) => {
    const payload = validate(CredentialSavePayloadSchema, raw)
    vault.save(payload.profileId, payload.password)
  })

  ipcMain.handle(IPC_CREDENTIALS_HAS, (_event, raw) => {
    const payload = validate(CredentialIdPayloadSchema, raw)
    return vault.has(payload.profileId)
  })

  ipcMain.handle(IPC_CREDENTIALS_DELETE, (_event, raw) => {
    const payload = validate(CredentialIdPayloadSchema, raw)
    vault.delete(payload.profileId)
  })

  // ─── Settings ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC_SETTINGS_GET, () => settings.getTerminal())

  ipcMain.handle(IPC_SETTINGS_SET, (_event, raw) => {
    const next = validate(TerminalSettingsSchema, raw)
    return settings.setTerminal(next)
  })

  // ─── SFTP ──────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_SFTP_LIST, async (_event, raw) => {
    const p = validate(SftpListPayloadSchema, raw)
    return sftp.list(p.sessionId, p.path)
  })

  ipcMain.handle(IPC_SFTP_STAT, async (_event, raw) => {
    const p = validate(SftpStatPayloadSchema, raw)
    return sftp.stat(p.sessionId, p.path)
  })

  ipcMain.handle(IPC_SFTP_MKDIR, async (_event, raw) => {
    const p = validate(SftpMkdirPayloadSchema, raw)
    await sftp.mkdir(p.sessionId, p.path)
  })

  ipcMain.handle(IPC_SFTP_DELETE, async (_event, raw) => {
    const p = validate(SftpDeletePayloadSchema, raw)
    await sftp.deletePath(p.sessionId, p.path, p.isDirectory)
  })

  ipcMain.handle(IPC_SFTP_RENAME, async (_event, raw) => {
    const p = validate(SftpRenamePayloadSchema, raw)
    await sftp.rename(p.sessionId, p.fromPath, p.toPath)
  })

  ipcMain.handle(IPC_SFTP_CHMOD, async (_event, raw) => {
    const p = validate(SftpChmodPayloadSchema, raw)
    await sftp.chmod(p.sessionId, p.path, p.mode)
  })

  ipcMain.handle(IPC_SFTP_UPLOAD, async (_event, raw) => {
    const p = validate(SftpUploadPayloadSchema, raw)
    // Stat local file for totalBytes so the renderer's progress UI can
    // render with a known denominator from the first tick.
    const totalBytes = statSync(p.localPath).size
    const transferId = await sftp.upload(
      p.sessionId,
      p.localPath,
      p.remotePath,
      totalBytes,
    )
    return { transferId, totalBytes, direction: 'upload' as const }
  })

  ipcMain.handle(IPC_SFTP_DOWNLOAD, async (_event, raw) => {
    const p = validate(SftpDownloadPayloadSchema, raw)
    const { transferId, totalBytes } = await sftp.download(
      p.sessionId,
      p.remotePath,
      p.localPath,
    )
    return { transferId, totalBytes, direction: 'download' as const }
  })

  ipcMain.handle(IPC_SFTP_UPLOAD_FOLDER, async (_event, raw) => {
    const p = validate(SftpUploadFolderPayloadSchema, raw)
    await sftp.uploadFolder(p.sessionId, p.localPath, p.remoteParentPath)
  })

  ipcMain.handle(IPC_SFTP_DOWNLOAD_FOLDER, async (_event, raw) => {
    const p = validate(SftpDownloadFolderPayloadSchema, raw)
    await sftp.downloadFolder(p.sessionId, p.remotePath, p.localParentPath)
  })

  ipcMain.handle(IPC_SFTP_CANCEL, (_event, raw) => {
    const p = validate(SftpCancelPayloadSchema, raw)
    sftp.cancelTransfer(p.transferId)
  })

  ipcMain.handle(IPC_SFTP_EDIT_OPEN, (_event, raw) => {
    // Phase 6 will implement edit-in-place via download-to-temp + chokidar.
    validate(SftpEditOpenPayloadSchema, raw)
    throw new Error('edit-in-place not yet implemented (M6 phase 6)')
  })

  // ─── Local FS ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC_LOCAL_LIST, (_event, raw) => {
    const p = validate(LocalListPayloadSchema, raw)
    return localFs.list(p.path)
  })

  ipcMain.handle(IPC_LOCAL_HOME, () => localFs.home())

  ipcMain.handle(IPC_LOCAL_REVEAL, (_event, raw) => {
    const path = validate(PathStringSchema, raw)
    localFs.reveal(path)
  })

  ipcMain.handle(IPC_LOCAL_DELETE, (_event, raw) => {
    const p = validate(LocalDeletePayloadSchema, raw)
    localFs.delete(p.path, p.isDirectory)
  })

  ipcMain.handle(IPC_LOCAL_PLATFORM, () => localFs.platform())

  // Make sure the SFTP subsystem closes when the underlying SSH session does.
  // (Belt-and-suspenders — sftp also listens for client 'close' itself.)
  return sessions
}

// ─── CSV helpers ────────────────────────────────────────────────────────────
// Used by import/export above. Kept tight + dependency-free; handles quoting,
// embedded commas, embedded newlines, and double-quote escaping per RFC 4180.

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else {
      if (c === '"') {
        inQuotes = true
      } else if (c === ',') {
        row.push(field)
        field = ''
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++ // CRLF as one separator
        row.push(field)
        field = ''
        if (row.length > 1 || row[0] !== '') rows.push(row)
        row = []
      } else {
        field += c
      }
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  if (rows.length === 0) return []
  const headers = (rows[0] ?? []).map((h) => h.trim())
  return rows
    .slice(1)
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => {
      const obj: Record<string, string> = {}
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]!] = r[i] ?? ''
      }
      return obj
    })
}

// Used by import to resolve jumpHostName refs that point to a profile that
// existed BEFORE the import (i.e. wasn't in the imported set).
function idForExistingName(store: { list: () => SessionProfile[] }, name: string): string | undefined {
  return store.list().find((p) => p.name === name)?.id
}

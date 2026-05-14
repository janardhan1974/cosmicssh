// Registers ipcMain handlers + wires SSH event broadcasts to renderer windows.
// Every invoke handler validates its payload with zod before touching domain
// logic (plan.md security non-negotiables).

import { BrowserWindow, ipcMain } from 'electron'
import { CredentialVault } from './credential-vault'
import { ProfileStore } from './profile-store'
import { SettingsStore } from './settings-store'
import { SshSessionManager } from './ssh-session-manager'
import {
  ConnectByProfilePayloadSchema,
  ConnectPayloadSchema,
  CredentialIdPayloadSchema,
  CredentialSavePayloadSchema,
  DisconnectPayloadSchema,
  ProfileDraftSchema,
  ProfileIdSchema,
  ResizePayloadSchema,
  SessionProfileSchema,
  TerminalSettingsSchema,
  WritePayloadSchema,
  validate,
} from './ipc-schemas'
import {
  IPC_CREDENTIALS_DELETE,
  IPC_CREDENTIALS_HAS,
  IPC_CREDENTIALS_SAVE,
  IPC_PROFILES_CREATE,
  IPC_PROFILES_DELETE,
  IPC_PROFILES_LIST,
  IPC_PROFILES_UPDATE,
  IPC_SETTINGS_GET,
  IPC_SETTINGS_SET,
  IPC_SSH_CLOSE,
  IPC_SSH_CONNECT,
  IPC_SSH_CONNECT_BY_PROFILE,
  IPC_SSH_DATA,
  IPC_SSH_DISCONNECT,
  IPC_SSH_ERROR,
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
  const sessions = new SshSessionManager({
    onData: (evt) => broadcastToAll(IPC_SSH_DATA, evt),
    onClose: (evt) => broadcastToAll(IPC_SSH_CLOSE, evt),
    onError: (evt) => broadcastToAll(IPC_SSH_ERROR, evt),
  })

  // ─── SSH ───────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_SSH_CONNECT, async (_event, raw) => {
    const payload = validate(ConnectPayloadSchema, raw)
    const sessionId = await sessions.connect(payload)
    return { sessionId }
  })

  ipcMain.handle(IPC_SSH_CONNECT_BY_PROFILE, async (_event, raw) => {
    const payload = validate(ConnectByProfilePayloadSchema, raw)
    const profile = profiles.get(payload.profileId)
    if (!profile) {
      throw new Error(`unknown profile: ${payload.profileId}`)
    }
    if (profile.authMethod !== 'password') {
      throw new Error(
        `profile ${profile.name} uses ${profile.authMethod} auth — not yet supported (M2)`,
      )
    }

    const stored = vault.load(profile.id)
    const password = stored ?? payload.passwordOverride
    if (password === undefined) {
      throw new Error('no saved password and none provided')
    }

    const sessionId = await sessions.connect({
      host: profile.host,
      port: profile.port,
      username: profile.username,
      password,
    })

    profiles.touchLastUsed(profile.id)

    // If user opted in and we connected with a fresh override, persist it
    // for next time.
    if (profile.savePassword && stored === null && payload.passwordOverride !== undefined) {
      vault.save(profile.id, payload.passwordOverride)
    }

    return { sessionId, profileId: profile.id }
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

  return sessions
}

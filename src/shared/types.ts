// IPC contract between main and renderer.
//
// This file is loaded by the sandboxed preload, so it MUST NOT import any
// third-party runtime dependencies (zod, etc.). Sandboxed preload also
// cannot `require` relative project files, so the channel literals below are
// duplicated as inlined string constants in src/preload/index.ts. Keep both
// in sync; if they drift the IPC will silently miss.

// ─── SSH session channels ──────────────────────────────────────────────────
export const IPC_SSH_CONNECT = 'ssh:connect' as const
export const IPC_SSH_CONNECT_BY_PROFILE = 'ssh:connect-by-profile' as const
export const IPC_SSH_WRITE = 'ssh:write' as const
export const IPC_SSH_RESIZE = 'ssh:resize' as const
export const IPC_SSH_DISCONNECT = 'ssh:disconnect' as const

// Event channels (main → renderer, fire-and-forget via webContents.send)
export const IPC_SSH_DATA = 'ssh:data' as const
export const IPC_SSH_CLOSE = 'ssh:close' as const
export const IPC_SSH_ERROR = 'ssh:error' as const

// ─── Profile channels ──────────────────────────────────────────────────────
export const IPC_PROFILES_LIST = 'profiles:list' as const
export const IPC_PROFILES_CREATE = 'profiles:create' as const
export const IPC_PROFILES_UPDATE = 'profiles:update' as const
export const IPC_PROFILES_DELETE = 'profiles:delete' as const

// ─── Credential vault channels ─────────────────────────────────────────────
export const IPC_CREDENTIALS_SAVE = 'credentials:save' as const
export const IPC_CREDENTIALS_HAS = 'credentials:has' as const
export const IPC_CREDENTIALS_DELETE = 'credentials:delete' as const

// ─── Settings channels ────────────────────────────────────────────────────
export const IPC_SETTINGS_GET = 'settings:get' as const
export const IPC_SETTINGS_SET = 'settings:set' as const

// ─── SSH payload types ─────────────────────────────────────────────────────
export type ConnectPayload = {
  host: string
  port: number
  username: string
  password: string
}

export type ConnectByProfilePayload = {
  profileId: string
  // Renderer-supplied password used when no saved credential exists. If a
  // credential is saved for this profile, main ignores this field.
  passwordOverride?: string
}

export type ConnectResult = {
  sessionId: string
  profileId?: string
}

export type WritePayload = {
  sessionId: string
  data: string
}

export type ResizePayload = {
  sessionId: string
  cols: number
  rows: number
}

export type DisconnectPayload = {
  sessionId: string
}

// ─── Event payload types (main → renderer) ─────────────────────────────────
export type SshDataEvent = {
  sessionId: string
  data: string // utf-8 decoded
}

export type SshCloseEvent = {
  sessionId: string
  code: number | null
  signal: string | null
}

export type SshErrorEvent = {
  sessionId: string
  message: string
}

// ─── SessionProfile (persisted) ────────────────────────────────────────────
// Schema is per plan.md M3. Auth methods 'key' and 'agent' are accepted by
// the type but the renderer UI only enables 'password' until M2 lands.

export type AuthMethod = 'password' | 'key' | 'agent'

export type SessionProfile = {
  id: string // uuid
  name: string // user-facing label
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  keyPath?: string // M2 — populated when authMethod === 'key'
  jumpHost?: string // M5 — references another profile id
  group?: string // for sidebar grouping ("Personal", "RunPod", etc.)
  savePassword: boolean // if true, on connect we persist the typed password
  createdAt: number // epoch ms
  lastUsedAt?: number // epoch ms; updated on successful connect
}

// What the renderer sends when creating; main fills id/createdAt.
export type ProfileDraft = Omit<SessionProfile, 'id' | 'createdAt' | 'lastUsedAt'>

// ─── Credential payloads ───────────────────────────────────────────────────
export type CredentialSavePayload = {
  profileId: string
  password: string
}

export type CredentialIdPayload = {
  profileId: string
}

// ─── Settings ─────────────────────────────────────────────────────────────
// Currently terminal-only. Will grow as M8 lands theme/cursor/bell options.
export type TerminalSettings = {
  fontFamily: string
  fontSize: number
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
  fontSize: 13,
}

// ─── Preload API surface (window.api in renderer) ──────────────────────────
export type Unsubscribe = () => void

export interface Api {
  ssh: {
    connect: (payload: ConnectPayload) => Promise<ConnectResult>
    connectByProfile: (payload: ConnectByProfilePayload) => Promise<ConnectResult>
    write: (payload: WritePayload) => Promise<void>
    resize: (payload: ResizePayload) => Promise<void>
    disconnect: (payload: DisconnectPayload) => Promise<void>
    onData: (cb: (evt: SshDataEvent) => void) => Unsubscribe
    onClose: (cb: (evt: SshCloseEvent) => void) => Unsubscribe
    onError: (cb: (evt: SshErrorEvent) => void) => Unsubscribe
  }
  profiles: {
    list: () => Promise<SessionProfile[]>
    create: (draft: ProfileDraft) => Promise<SessionProfile>
    update: (profile: SessionProfile) => Promise<SessionProfile>
    delete: (id: string) => Promise<void>
  }
  credentials: {
    save: (payload: CredentialSavePayload) => Promise<void>
    has: (payload: CredentialIdPayload) => Promise<boolean>
    delete: (payload: CredentialIdPayload) => Promise<void>
  }
  settings: {
    get: () => Promise<TerminalSettings>
    set: (settings: TerminalSettings) => Promise<TerminalSettings>
  }
}

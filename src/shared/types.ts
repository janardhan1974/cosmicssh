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

// Host-key verification round-trip:
// main emits ssh:hostkey-prompt for unknown keys, renderer collects user
// decision via ssh:hostkey-respond. Mismatches fire ssh:hostkey-mismatch
// (informational; the connection is already rejected by main).
export const IPC_SSH_HOSTKEY_PROMPT = 'ssh:hostkey-prompt' as const
export const IPC_SSH_HOSTKEY_RESPOND = 'ssh:hostkey-respond' as const
export const IPC_SSH_HOSTKEY_MISMATCH = 'ssh:hostkey-mismatch' as const

// File-picker for selecting a private key on disk.
export const IPC_DIALOG_PICK_KEY = 'dialog:pick-key' as const

// App menu → renderer commands.
export const IPC_MENU_OPEN_SETTINGS = 'menu:open-settings' as const
export const IPC_MENU_TAB_LAYOUT = 'menu:tab-layout' as const

// In-window arrangement of session tabs.
//  - 'single' shows only the active tab (default — original behavior)
//  - 'tile-v' splits the terminal area into N equal columns, one per tab
//  - 'tile-h' splits into N equal rows
export type TabLayout = 'single' | 'tile-v' | 'tile-h'

// ─── Profile channels ──────────────────────────────────────────────────────
export const IPC_PROFILES_LIST = 'profiles:list' as const
export const IPC_PROFILES_CREATE = 'profiles:create' as const
export const IPC_PROFILES_UPDATE = 'profiles:update' as const
export const IPC_PROFILES_DELETE = 'profiles:delete' as const
export const IPC_PROFILES_EXPORT = 'profiles:export' as const
export const IPC_PROFILES_IMPORT = 'profiles:import' as const

// ─── Folder (empty group) channels ────────────────────────────────────────
export const IPC_FOLDERS_LIST = 'folders:list' as const
export const IPC_FOLDERS_CREATE = 'folders:create' as const
export const IPC_FOLDERS_DELETE = 'folders:delete' as const

// ─── Credential vault channels ─────────────────────────────────────────────
export const IPC_CREDENTIALS_SAVE = 'credentials:save' as const
export const IPC_CREDENTIALS_HAS = 'credentials:has' as const
export const IPC_CREDENTIALS_DELETE = 'credentials:delete' as const

// ─── Settings channels ────────────────────────────────────────────────────
export const IPC_SETTINGS_GET = 'settings:get' as const
export const IPC_SETTINGS_SET = 'settings:set' as const

// ─── SFTP channels ────────────────────────────────────────────────────────
export const IPC_SFTP_LIST = 'sftp:list' as const
export const IPC_SFTP_STAT = 'sftp:stat' as const
export const IPC_SFTP_MKDIR = 'sftp:mkdir' as const
export const IPC_SFTP_DELETE = 'sftp:delete' as const
export const IPC_SFTP_RENAME = 'sftp:rename' as const
export const IPC_SFTP_CHMOD = 'sftp:chmod' as const
export const IPC_SFTP_UPLOAD = 'sftp:upload' as const
export const IPC_SFTP_DOWNLOAD = 'sftp:download' as const
export const IPC_SFTP_UPLOAD_FOLDER = 'sftp:upload-folder' as const
export const IPC_SFTP_DOWNLOAD_FOLDER = 'sftp:download-folder' as const
export const IPC_SFTP_CANCEL = 'sftp:cancel' as const
// Edit-in-place
export const IPC_SFTP_EDIT_OPEN = 'sftp:edit-open' as const
// Events
export const IPC_SFTP_TRANSFER_STARTED = 'sftp:transfer-started' as const
export const IPC_SFTP_TRANSFER_PROGRESS = 'sftp:transfer-progress' as const
export const IPC_SFTP_TRANSFER_DONE = 'sftp:transfer-done' as const
export const IPC_SFTP_TRANSFER_ERROR = 'sftp:transfer-error' as const

// ─── Local FS channels ────────────────────────────────────────────────────
export const IPC_LOCAL_LIST = 'local:list' as const
export const IPC_LOCAL_HOME = 'local:home' as const
export const IPC_LOCAL_REVEAL = 'local:reveal' as const
export const IPC_LOCAL_DELETE = 'local:delete' as const
export const IPC_LOCAL_PLATFORM = 'local:platform' as const

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

// First-time host key — renderer prompts the user.
export type HostKeyPromptEvent = {
  requestId: string // pass back to ssh:hostkey-respond
  host: string
  port: number
  keyType: string
  fingerprint: string // SHA256:base64
}

// Stored fingerprint changed under us — almost always a MITM. We've already
// blocked the connection; this is purely so the renderer can show a clear
// "stored key was X, server presented Y" message.
export type HostKeyMismatchEvent = {
  host: string
  port: number
  storedKeyType: string
  storedFingerprint: string
  presentedKeyType: string
  presentedFingerprint: string
}

export type HostKeyRespondPayload = {
  requestId: string
  accept: boolean
}

// ─── SessionProfile (persisted) ────────────────────────────────────────────
// Schema is per plan.md M3. Auth methods 'key' and 'agent' are accepted by
// the type but the renderer UI only enables 'password' until M2 lands.

export type AuthMethod = 'password' | 'key' | 'agent'

// Connection protocols supported by a profile.
// - 'ssh': opens a shell channel + permits SFTP on demand (default).
// - 'sftp-only': opens only the SFTP subsystem; no shell, no terminal tab.
//   Useful for hosts where shell access is disabled but SFTP is allowed.
export type Protocol = 'ssh' | 'sftp-only'

export type SessionProfile = {
  id: string // uuid
  name: string // user-facing label
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  protocol?: Protocol // defaults to 'ssh' for backward compat with old profiles
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
// Currently terminal + theme. Will grow as M8 lands cursor/bell options.

export type AppTheme = 'dark' | 'light' | 'blue'

export const APP_THEMES: { value: AppTheme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'blue', label: 'Light blue' },
]

export type TerminalSettings = {
  fontFamily: string
  fontSize: number
  theme: AppTheme
  // CSS color (e.g. '#e8e6e3') that overrides the theme's text color. null
  // means "use whatever the theme defines" (the common case). Applies to both
  // the renderer chrome (--fg) and the terminal foreground.
  textColor: string | null
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
  fontSize: 13,
  theme: 'dark',
  textColor: null,
}

// ─── SFTP / file operations ───────────────────────────────────────────────
// One entry returned by sftp:list or local:list.
export type FsEntry = {
  name: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  // Modification time. Local: epoch ms. Remote: ssh2 returns epoch seconds;
  // main multiplies by 1000 before sending so renderer always sees ms.
  mtimeMs: number
  // POSIX mode bits (perm only, mode & 0o7777). Always present for remote;
  // 0 for local entries since Windows ACLs don't map cleanly.
  mode: number
}

export type SftpListPayload = { sessionId: string; path: string }
export type SftpStatPayload = { sessionId: string; path: string }
export type SftpMkdirPayload = { sessionId: string; path: string }
export type SftpDeletePayload = {
  sessionId: string
  path: string
  isDirectory: boolean
}
export type SftpRenamePayload = {
  sessionId: string
  fromPath: string
  toPath: string
}
export type SftpChmodPayload = {
  sessionId: string
  path: string
  // Numeric octal e.g. 0o644. Renderer passes a decimal-encoded number.
  mode: number
}
export type SftpUploadPayload = {
  sessionId: string
  localPath: string
  remotePath: string
}
export type SftpDownloadPayload = {
  sessionId: string
  remotePath: string
  localPath: string
}
// Folder variants — main walks the tree and queues per-file transfers.
// `parentPath` is the destination directory; the source folder's basename is
// preserved at the destination. e.g. uploadFolder('/foo/bar', '/srv') puts
// files under '/srv/bar/...'.
export type SftpUploadFolderPayload = {
  sessionId: string
  localPath: string // source folder (must be a directory)
  remoteParentPath: string // destination parent directory on the remote
}
export type SftpDownloadFolderPayload = {
  sessionId: string
  remotePath: string // source folder
  localParentPath: string // destination parent directory locally
}
export type SftpCancelPayload = { transferId: string }
export type SftpEditOpenPayload = {
  sessionId: string
  remotePath: string
}

// Emitted by main when a transfer (single file or one of many in a folder
// op) starts. Renderer subscribes globally and seeds its transfers store.
export type TransferStartedEvent = {
  transferId: string
  direction: 'upload' | 'download'
  from: string
  to: string
  totalBytes: number
}

// Returned from per-file upload/download invokes for callers that want the
// transferId immediately. Folder ops don't return this — they fire many
// transfer-started events instead.
export type TransferStartResult = {
  transferId: string
  totalBytes: number
  direction: 'upload' | 'download'
}

export type TransferProgressEvent = {
  transferId: string
  bytesTransferred: number
  totalBytes: number
  // bytes/s averaged over the recent window. main computes this.
  bytesPerSecond: number
}

export type TransferDoneEvent = {
  transferId: string
  bytesTransferred: number
}

export type TransferErrorEvent = {
  transferId: string
  message: string
}

// Local FS responses
export type LocalListResult =
  | { type: 'drives'; items: { name: string; path: string }[] }
  | { type: 'directory'; path: string; items: FsEntry[] }
export type LocalListPayload = { path: string } // path '' returns drives

export type LocalDeletePayload = {
  path: string
  isDirectory: boolean
}

// Platform info exposed to renderer so it can format local paths correctly
// (separators, home placeholder text). Returned by api.local.platform().
export type LocalPlatformInfo = {
  // node's path.sep — '\\' on Windows, '/' elsewhere.
  sep: string
  isWindows: boolean
  isMac: boolean
  isLinux: boolean
  homeDir: string
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
    onHostKeyPrompt: (cb: (evt: HostKeyPromptEvent) => void) => Unsubscribe
    onHostKeyMismatch: (cb: (evt: HostKeyMismatchEvent) => void) => Unsubscribe
    respondToHostKey: (payload: HostKeyRespondPayload) => Promise<void>
  }
  dialog: {
    pickKeyFile: () => Promise<string | null>
  }
  menu: {
    onOpenSettings: (cb: () => void) => Unsubscribe
    onTabLayout: (cb: (mode: TabLayout) => void) => Unsubscribe
  }
  profiles: {
    list: () => Promise<SessionProfile[]>
    create: (draft: ProfileDraft) => Promise<SessionProfile>
    update: (profile: SessionProfile) => Promise<SessionProfile>
    delete: (id: string) => Promise<void>
    // Opens an OS save dialog; writes a JSON file with all profiles + empty
    // folders. Resolves with the chosen path, or null if user cancelled.
    exportToFile: () => Promise<{ path: string; count: number } | null>
    // Opens an OS open dialog; reads the JSON and appends entries. Resolves
    // with how many were imported, or null if user cancelled.
    importFromFile: () => Promise<{ count: number; folders: number } | null>
  }
  folders: {
    list: () => Promise<string[]>
    create: (name: string) => Promise<void>
    delete: (name: string) => Promise<void>
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
  sftp: {
    list: (payload: SftpListPayload) => Promise<FsEntry[]>
    stat: (payload: SftpStatPayload) => Promise<FsEntry>
    mkdir: (payload: SftpMkdirPayload) => Promise<void>
    delete: (payload: SftpDeletePayload) => Promise<void>
    rename: (payload: SftpRenamePayload) => Promise<void>
    chmod: (payload: SftpChmodPayload) => Promise<void>
    upload: (payload: SftpUploadPayload) => Promise<TransferStartResult>
    download: (payload: SftpDownloadPayload) => Promise<TransferStartResult>
    uploadFolder: (payload: SftpUploadFolderPayload) => Promise<void>
    downloadFolder: (payload: SftpDownloadFolderPayload) => Promise<void>
    cancel: (payload: SftpCancelPayload) => Promise<void>
    editOpen: (payload: SftpEditOpenPayload) => Promise<void>
    onStarted: (cb: (evt: TransferStartedEvent) => void) => Unsubscribe
    onProgress: (cb: (evt: TransferProgressEvent) => void) => Unsubscribe
    onDone: (cb: (evt: TransferDoneEvent) => void) => Unsubscribe
    onError: (cb: (evt: TransferErrorEvent) => void) => Unsubscribe
  }
  local: {
    list: (payload: LocalListPayload) => Promise<LocalListResult>
    home: () => Promise<string>
    reveal: (path: string) => Promise<void>
    delete: (payload: LocalDeletePayload) => Promise<void>
    platform: () => Promise<LocalPlatformInfo>
  }
}

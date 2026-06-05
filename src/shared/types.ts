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

// App menu → renderer commands. These channels exist for the legacy native
// menu (now disabled — see main/index.ts:Menu.setApplicationMenu(null)) and
// are kept in the preload contract so a future re-introduction wouldn't
// break the type surface. The renderer's MenuBar now drives these locally.
export const IPC_MENU_OPEN_SETTINGS = 'menu:open-settings' as const
export const IPC_MENU_TAB_LAYOUT = 'menu:tab-layout' as const
export const IPC_MENU_TOGGLE_SIDEBAR = 'menu:toggle-sidebar' as const

// Renderer → main: actions the in-app MenuBar surfaces that need main-process
// privileges (new BrowserWindow, devtools, OS-window tile/cascade, zoom on
// the WebContents, full-screen, About dialog, etc.). Single dispatcher
// channel keyed by command string — avoids one IPC per item.
export const IPC_APP_MENU_COMMAND = 'app:menu-command' as const
export type AppMenuCommand =
  | 'new-window'
  | 'tile-windows-v'
  | 'tile-windows-h'
  | 'cascade-windows'
  | 'show-about'
  | 'reload'
  | 'force-reload'
  | 'toggle-devtools'
  | 'reset-zoom'
  | 'zoom-in'
  | 'zoom-out'
  | 'toggle-fullscreen'
  | 'window-minimize'
  | 'window-close'

// In-window arrangement of session tabs.
//  - 'single' shows only the active tab (default — original behavior)
//  - 'tile-v' splits the terminal area into N equal columns, one per tab
//  - 'tile-h' splits into N equal rows
//  - 'mdi'    each tab is a free-form floating sub-window (drag titlebar to
//             move, drag bottom-right corner to resize, minimize to bottom
//             strip). Floating rects are renderer-local state.
export type TabLayout = 'single' | 'tile-v' | 'tile-h' | 'mdi'

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

// ─── Session-logging channels ─────────────────────────────────────────────
// status:   query whether logging is on for a sessionId + where the file is
// save:     dump pre-stripped scrollback text from the renderer into a file
//           under <storage-dir>/sessions/
export const IPC_LOGGING_STATUS = 'logging:status' as const
export const IPC_LOGGING_SAVE_SCROLLBACK = 'logging:save-scrollback' as const

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
  // Absolute path of the session log file if logging was started for this
  // session (profile.logSession === true). Renderer uses this to show a
  // "● REC <path>" indicator on the tab.
  logPath?: string
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
// - 'ssh-shell-only': opens a shell channel; the SFTP mode button is hidden.
//   Useful when you want a terminal-only profile and don't want the SFTP
//   pane cluttering the tab bar.
// - 'sftp-only': opens only the SFTP subsystem; no shell, no terminal tab.
//   Useful for hosts where shell access is disabled but SFTP is allowed.
export type Protocol = 'ssh' | 'ssh-shell-only' | 'sftp-only'

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
  // When true, every byte of shell output (which includes echoed commands)
  // is streamed to a file under <storage-dir>/sessions/ for the duration of
  // each connection. ANSI escapes are stripped; line endings normalized to
  // LF. File name: `<profile-name>_DDMMYYYY_HHMM.txt`, collision-suffixed.
  logSession?: boolean
  // Last directories the SFTP pane was at when this profile's session was
  // last connected. Auto-saved on every successful SFTP navigate; restored
  // when opening a fresh session against this profile. If the saved path is
  // gone (remote dir deleted, local folder moved), the pane falls back to
  // the default (home / '/'). Local-machine state — NOT included in CSV
  // export, since the path likely won't be valid on another machine.
  lastLocalPath?: string
  lastRemotePath?: string
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
  // Retained for the data-theme attribute (chrome CSS) and stored-settings
  // backward compat. No longer exposed in the Settings UI — always 'dark'.
  theme: AppTheme
  // CSS hex (#rrggbb) text/foreground color for the terminal. null = default.
  textColor: string | null
  // 0..100 — lerps the resolved foreground (and cursor) toward white. 0 = no
  // change; 100 paints text pure white.
  brightness: number
  // Override for the sidebar background. null (the default) means "follow the
  // terminal background" (--bg-terminal). Any other value is a literal CSS
  // color (#rrggbb) painted on the sidebar.
  sidebarBackground: string | null
  // Terminal (and SFTP) background. null = dark default (#0f0f10); any other
  // value is the literal CSS color pushed into xterm's theme.background and
  // published as --bg-terminal so the SFTP pane follows it.
  terminalBackground: string | null
  // Override for the menubar + tab bar background. null = use theme tokens.
  chromeBackground: string | null
  // ─── UI text (chrome) ───────────────────────────────────────────────────
  // Decoupled from the terminal-text controls above so a user can run a
  // monospace terminal font alongside a proportional UI font, scale chrome
  // independently of the terminal, etc. The renderer publishes these as
  // --ui-font / --ui-font-size / --fg so MenuBar, Sidebar, TabBar and SFTP
  // pick them up via CSS without needing per-component plumbing.
  uiFontFamily: string
  uiFontSize: number
  // null = follow the app theme's fg (current default). Hex value overrides
  // --fg for non-terminal chrome only — xterm's foreground is controlled by
  // textColor + brightness above, NOT by this.
  uiTextColor: string | null
  // 0..100 — lerps the resolved UI text color toward white. Applied on top
  // of uiTextColor (or the theme default when uiTextColor is null).
  uiBrightness: number
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
  fontSize: 13,
  theme: 'dark',
  textColor: null,
  brightness: 0,
  sidebarBackground: null,
  terminalBackground: null,
  chromeBackground: null,
  uiFontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
  uiFontSize: 12,
  uiTextColor: null,
  uiBrightness: 0,
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

// ─── Session-logging payloads ─────────────────────────────────────────────
export type LoggingStatusPayload = { sessionId: string }
export type LoggingStatusResult = {
  // null = not logging for this sessionId; string = absolute path
  logPath: string | null
}

// Renderer dumps xterm scrollback (already plain text, no ANSI) and the main
// process writes it under <storage-dir>/sessions/. We don't pipe the buffer
// through an OS save-dialog by default — the user already opted into the
// "logs go to sessions/" convention.
export type SaveScrollbackPayload = {
  // Used only for filename generation; defaults to 'session' if blank.
  profileName: string
  // Whole scrollback text — xterm-rendered lines joined with '\n'.
  text: string
}
export type SaveScrollbackResult = { path: string }

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
    onToggleSidebar: (cb: () => void) => Unsubscribe
  }
  app: {
    // Fires a menu-driven main-process action (new window, devtools,
    // OS-window tile/cascade, zoom controls, About dialog, etc.). Resolves
    // when the action has been kicked off — most are best-effort and don't
    // surface a meaningful result.
    menuCommand: (cmd: AppMenuCommand) => Promise<void>
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
  logging: {
    status: (payload: LoggingStatusPayload) => Promise<LoggingStatusResult>
    saveScrollback: (payload: SaveScrollbackPayload) => Promise<SaveScrollbackResult>
  }
}

// Preload script — runs in the renderer process under sandbox.
//
// IMPORTANT: a sandboxed preload (BrowserWindow.webPreferences.sandbox: true)
// can only `require` Electron modules and a tiny set of Node built-ins
// (events, timers, url). It CANNOT require relative project files at runtime,
// so all runtime values (channel name strings) are inlined here. Type
// imports are erased at compile time and are safe.
//
// Channel literals MUST stay in lockstep with src/shared/types.ts.

import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  Api,
  AppMenuCommand,
  ConnectByProfilePayload,
  ConnectPayload,
  ConnectResult,
  CredentialIdPayload,
  CredentialSavePayload,
  DisconnectPayload,
  FsEntry,
  HostKeyMismatchEvent,
  HostKeyPromptEvent,
  HostKeyRespondPayload,
  LocalDeletePayload,
  LocalListPayload,
  LocalListResult,
  LocalPlatformInfo,
  LoggingStatusPayload,
  LoggingStatusResult,
  ProfileDraft,
  ResizePayload,
  SaveScrollbackPayload,
  SaveScrollbackResult,
  SessionProfile,
  SftpCancelPayload,
  SftpChmodPayload,
  SftpDeletePayload,
  SftpDownloadFolderPayload,
  SftpDownloadPayload,
  SftpEditOpenPayload,
  SftpListPayload,
  SftpMkdirPayload,
  SftpRenamePayload,
  SftpStatPayload,
  SftpUploadFolderPayload,
  SftpUploadPayload,
  TabLayout,
  TerminalSettings,
  TransferStartResult,
  Unsubscribe,
  WritePayload,
} from '../shared/types'

// Inlined channel literals — see header note.
const CH = {
  // ssh
  sshConnect: 'ssh:connect',
  sshConnectByProfile: 'ssh:connect-by-profile',
  sshWrite: 'ssh:write',
  sshResize: 'ssh:resize',
  sshDisconnect: 'ssh:disconnect',
  sshData: 'ssh:data',
  sshClose: 'ssh:close',
  sshError: 'ssh:error',
  sshHostKeyPrompt: 'ssh:hostkey-prompt',
  sshHostKeyRespond: 'ssh:hostkey-respond',
  sshHostKeyMismatch: 'ssh:hostkey-mismatch',
  dialogPickKey: 'dialog:pick-key',
  menuOpenSettings: 'menu:open-settings',
  menuTabLayout: 'menu:tab-layout',
  menuToggleSidebar: 'menu:toggle-sidebar',
  // Renderer → main menu dispatcher (see shared/types.ts:IPC_APP_MENU_COMMAND).
  appMenuCommand: 'app:menu-command',
  // profiles
  profilesList: 'profiles:list',
  profilesCreate: 'profiles:create',
  profilesUpdate: 'profiles:update',
  profilesDelete: 'profiles:delete',
  profilesExport: 'profiles:export',
  profilesImport: 'profiles:import',
  // folders (empty groups)
  foldersList: 'folders:list',
  foldersCreate: 'folders:create',
  foldersDelete: 'folders:delete',
  // credentials
  credentialsSave: 'credentials:save',
  credentialsHas: 'credentials:has',
  credentialsDelete: 'credentials:delete',
  // settings
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  // sftp
  sftpList: 'sftp:list',
  sftpStat: 'sftp:stat',
  sftpMkdir: 'sftp:mkdir',
  sftpDelete: 'sftp:delete',
  sftpRename: 'sftp:rename',
  sftpChmod: 'sftp:chmod',
  sftpUpload: 'sftp:upload',
  sftpDownload: 'sftp:download',
  sftpUploadFolder: 'sftp:upload-folder',
  sftpDownloadFolder: 'sftp:download-folder',
  sftpCancel: 'sftp:cancel',
  sftpEditOpen: 'sftp:edit-open',
  sftpStarted: 'sftp:transfer-started',
  sftpProgress: 'sftp:transfer-progress',
  sftpDone: 'sftp:transfer-done',
  sftpErr: 'sftp:transfer-error',
  // local fs
  localList: 'local:list',
  localHome: 'local:home',
  localReveal: 'local:reveal',
  localDelete: 'local:delete',
  localPlatform: 'local:platform',
  // session logging
  loggingStatus: 'logging:status',
  loggingSaveScrollback: 'logging:save-scrollback',
} as const

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: Api = {
  ssh: {
    connect: (payload: ConnectPayload): Promise<ConnectResult> =>
      ipcRenderer.invoke(CH.sshConnect, payload),
    connectByProfile: (payload: ConnectByProfilePayload): Promise<ConnectResult> =>
      ipcRenderer.invoke(CH.sshConnectByProfile, payload),
    write: (payload: WritePayload): Promise<void> =>
      ipcRenderer.invoke(CH.sshWrite, payload),
    resize: (payload: ResizePayload): Promise<void> =>
      ipcRenderer.invoke(CH.sshResize, payload),
    disconnect: (payload: DisconnectPayload): Promise<void> =>
      ipcRenderer.invoke(CH.sshDisconnect, payload),
    onData: (cb) => subscribe(CH.sshData, cb),
    onClose: (cb) => subscribe(CH.sshClose, cb),
    onError: (cb) => subscribe(CH.sshError, cb),
    onHostKeyPrompt: (cb) => subscribe<HostKeyPromptEvent>(CH.sshHostKeyPrompt, cb),
    onHostKeyMismatch: (cb) => subscribe<HostKeyMismatchEvent>(CH.sshHostKeyMismatch, cb),
    respondToHostKey: (payload: HostKeyRespondPayload) =>
      ipcRenderer.invoke(CH.sshHostKeyRespond, payload),
  },
  dialog: {
    pickKeyFile: (): Promise<string | null> =>
      ipcRenderer.invoke(CH.dialogPickKey),
  },
  menu: {
    onOpenSettings: (cb) => subscribe<void>(CH.menuOpenSettings, () => cb()),
    onTabLayout: (cb) => subscribe<TabLayout>(CH.menuTabLayout, cb),
    onToggleSidebar: (cb) => subscribe<void>(CH.menuToggleSidebar, () => cb()),
  },
  app: {
    menuCommand: (cmd: AppMenuCommand): Promise<void> =>
      ipcRenderer.invoke(CH.appMenuCommand, cmd),
  },
  profiles: {
    list: (): Promise<SessionProfile[]> => ipcRenderer.invoke(CH.profilesList),
    create: (draft: ProfileDraft): Promise<SessionProfile> =>
      ipcRenderer.invoke(CH.profilesCreate, draft),
    update: (profile: SessionProfile): Promise<SessionProfile> =>
      ipcRenderer.invoke(CH.profilesUpdate, profile),
    delete: (id: string): Promise<void> =>
      ipcRenderer.invoke(CH.profilesDelete, id),
    exportToFile: () => ipcRenderer.invoke(CH.profilesExport),
    importFromFile: () => ipcRenderer.invoke(CH.profilesImport),
  },
  folders: {
    list: (): Promise<string[]> => ipcRenderer.invoke(CH.foldersList),
    create: (name: string): Promise<void> =>
      ipcRenderer.invoke(CH.foldersCreate, name),
    delete: (name: string): Promise<void> =>
      ipcRenderer.invoke(CH.foldersDelete, name),
  },
  credentials: {
    save: (payload: CredentialSavePayload): Promise<void> =>
      ipcRenderer.invoke(CH.credentialsSave, payload),
    has: (payload: CredentialIdPayload): Promise<boolean> =>
      ipcRenderer.invoke(CH.credentialsHas, payload),
    delete: (payload: CredentialIdPayload): Promise<void> =>
      ipcRenderer.invoke(CH.credentialsDelete, payload),
  },
  settings: {
    get: (): Promise<TerminalSettings> => ipcRenderer.invoke(CH.settingsGet),
    set: (s: TerminalSettings): Promise<TerminalSettings> =>
      ipcRenderer.invoke(CH.settingsSet, s),
  },
  sftp: {
    list: (p: SftpListPayload): Promise<FsEntry[]> =>
      ipcRenderer.invoke(CH.sftpList, p),
    stat: (p: SftpStatPayload): Promise<FsEntry> =>
      ipcRenderer.invoke(CH.sftpStat, p),
    mkdir: (p: SftpMkdirPayload): Promise<void> =>
      ipcRenderer.invoke(CH.sftpMkdir, p),
    delete: (p: SftpDeletePayload): Promise<void> =>
      ipcRenderer.invoke(CH.sftpDelete, p),
    rename: (p: SftpRenamePayload): Promise<void> =>
      ipcRenderer.invoke(CH.sftpRename, p),
    chmod: (p: SftpChmodPayload): Promise<void> =>
      ipcRenderer.invoke(CH.sftpChmod, p),
    upload: (p: SftpUploadPayload): Promise<TransferStartResult> =>
      ipcRenderer.invoke(CH.sftpUpload, p),
    download: (p: SftpDownloadPayload): Promise<TransferStartResult> =>
      ipcRenderer.invoke(CH.sftpDownload, p),
    uploadFolder: (p: SftpUploadFolderPayload): Promise<void> =>
      ipcRenderer.invoke(CH.sftpUploadFolder, p),
    downloadFolder: (p: SftpDownloadFolderPayload): Promise<void> =>
      ipcRenderer.invoke(CH.sftpDownloadFolder, p),
    cancel: (p: SftpCancelPayload): Promise<void> =>
      ipcRenderer.invoke(CH.sftpCancel, p),
    editOpen: (p: SftpEditOpenPayload): Promise<void> =>
      ipcRenderer.invoke(CH.sftpEditOpen, p),
    onStarted: (cb) => subscribe(CH.sftpStarted, cb),
    onProgress: (cb) => subscribe(CH.sftpProgress, cb),
    onDone: (cb) => subscribe(CH.sftpDone, cb),
    onError: (cb) => subscribe(CH.sftpErr, cb),
  },
  local: {
    list: (p: LocalListPayload): Promise<LocalListResult> =>
      ipcRenderer.invoke(CH.localList, p),
    home: (): Promise<string> => ipcRenderer.invoke(CH.localHome),
    reveal: (path: string): Promise<void> =>
      ipcRenderer.invoke(CH.localReveal, path),
    delete: (p: LocalDeletePayload): Promise<void> =>
      ipcRenderer.invoke(CH.localDelete, p),
    platform: (): Promise<LocalPlatformInfo> =>
      ipcRenderer.invoke(CH.localPlatform),
  },
  logging: {
    status: (p: LoggingStatusPayload): Promise<LoggingStatusResult> =>
      ipcRenderer.invoke(CH.loggingStatus, p),
    saveScrollback: (p: SaveScrollbackPayload): Promise<SaveScrollbackResult> =>
      ipcRenderer.invoke(CH.loggingSaveScrollback, p),
  },
}

contextBridge.exposeInMainWorld('api', api)

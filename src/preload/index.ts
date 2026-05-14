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
  ConnectByProfilePayload,
  ConnectPayload,
  ConnectResult,
  CredentialIdPayload,
  CredentialSavePayload,
  DisconnectPayload,
  ProfileDraft,
  ResizePayload,
  SessionProfile,
  TerminalSettings,
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
  // profiles
  profilesList: 'profiles:list',
  profilesCreate: 'profiles:create',
  profilesUpdate: 'profiles:update',
  profilesDelete: 'profiles:delete',
  // credentials
  credentialsSave: 'credentials:save',
  credentialsHas: 'credentials:has',
  credentialsDelete: 'credentials:delete',
  // settings
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
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
  },
  profiles: {
    list: (): Promise<SessionProfile[]> => ipcRenderer.invoke(CH.profilesList),
    create: (draft: ProfileDraft): Promise<SessionProfile> =>
      ipcRenderer.invoke(CH.profilesCreate, draft),
    update: (profile: SessionProfile): Promise<SessionProfile> =>
      ipcRenderer.invoke(CH.profilesUpdate, profile),
    delete: (id: string): Promise<void> =>
      ipcRenderer.invoke(CH.profilesDelete, id),
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
}

contextBridge.exposeInMainWorld('api', api)

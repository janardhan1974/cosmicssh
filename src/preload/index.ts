// Preload script — runs in the renderer process under sandbox.
//
// IMPORTANT: a sandboxed preload (BrowserWindow.webPreferences.sandbox: true)
// can only `require` Electron modules and a tiny set of Node built-ins
// (events, timers, url). It CANNOT require relative project files at runtime,
// so all runtime values (channel name strings) are inlined here.
// The Api type is type-only (erased at compile time) and stays in shared/.

import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  Api,
  ConnectPayload,
  ConnectResult,
  DisconnectPayload,
  ResizePayload,
  Unsubscribe,
  WritePayload,
} from '../shared/types'

// Channel names — keep in sync with src/shared/types.ts (single source of
// truth there for the renderer; duplicated as runtime literals here because
// the sandbox cannot load relative modules).
const CH = {
  connect: 'ssh:connect',
  write: 'ssh:write',
  resize: 'ssh:resize',
  disconnect: 'ssh:disconnect',
  data: 'ssh:data',
  close: 'ssh:close',
  error: 'ssh:error',
} as const

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: Api = {
  ssh: {
    connect: (payload: ConnectPayload): Promise<ConnectResult> =>
      ipcRenderer.invoke(CH.connect, payload),
    write: (payload: WritePayload): Promise<void> =>
      ipcRenderer.invoke(CH.write, payload),
    resize: (payload: ResizePayload): Promise<void> =>
      ipcRenderer.invoke(CH.resize, payload),
    disconnect: (payload: DisconnectPayload): Promise<void> =>
      ipcRenderer.invoke(CH.disconnect, payload),
    onData: (cb) => subscribe(CH.data, cb),
    onClose: (cb) => subscribe(CH.close, cb),
    onError: (cb) => subscribe(CH.error, cb),
  },
}

contextBridge.exposeInMainWorld('api', api)

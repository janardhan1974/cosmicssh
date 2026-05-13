// IPC contract between main and renderer.
//
// This file is loaded by the sandboxed preload, so it MUST NOT import any
// third-party runtime dependencies (zod, etc.) — sandbox can only load
// Electron-internal modules. Runtime payload validation lives in
// src/main/ipc-schemas.ts (main process only).

// ─── Channel names ─────────────────────────────────────────────────────────
// Invoke channels (renderer → main, request/response)
export const IPC_SSH_CONNECT = 'ssh:connect' as const
export const IPC_SSH_WRITE = 'ssh:write' as const
export const IPC_SSH_RESIZE = 'ssh:resize' as const
export const IPC_SSH_DISCONNECT = 'ssh:disconnect' as const

// Event channels (main → renderer, fire-and-forget via webContents.send)
export const IPC_SSH_DATA = 'ssh:data' as const
export const IPC_SSH_CLOSE = 'ssh:close' as const
export const IPC_SSH_ERROR = 'ssh:error' as const

// ─── Invoke payload types ──────────────────────────────────────────────────
export type ConnectPayload = {
  host: string
  port: number
  username: string
  password: string
}

export type ConnectResult = {
  sessionId: string
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

// ─── Preload API surface (window.api in renderer) ──────────────────────────
export type Unsubscribe = () => void

export interface Api {
  ssh: {
    connect: (payload: ConnectPayload) => Promise<ConnectResult>
    write: (payload: WritePayload) => Promise<void>
    resize: (payload: ResizePayload) => Promise<void>
    disconnect: (payload: DisconnectPayload) => Promise<void>
    onData: (cb: (evt: SshDataEvent) => void) => Unsubscribe
    onClose: (cb: (evt: SshCloseEvent) => void) => Unsubscribe
    onError: (cb: (evt: SshErrorEvent) => void) => Unsubscribe
  }
}

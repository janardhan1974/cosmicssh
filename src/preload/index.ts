import { contextBridge } from 'electron'

// Typed API surface exposed to renderer through contextBridge.
// Stays minimal in M0; SSH/SFTP/credential bindings land in M1+.
const api = {
  ping: (): string => 'pong',
} as const

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

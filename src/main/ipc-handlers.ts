// Registers ipcMain handlers + wires SSH event broadcasts to renderer windows.
// Every invoke handler validates its payload with zod before touching the
// session manager (plan.md security non-negotiables).

import { BrowserWindow, ipcMain } from 'electron'
import { SshSessionManager } from './ssh-session-manager'
import {
  ConnectPayloadSchema,
  DisconnectPayloadSchema,
  ResizePayloadSchema,
  WritePayloadSchema,
  validate,
} from './ipc-schemas'
import {
  IPC_SSH_CLOSE,
  IPC_SSH_CONNECT,
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
  const manager = new SshSessionManager({
    onData: (evt) => broadcastToAll(IPC_SSH_DATA, evt),
    onClose: (evt) => broadcastToAll(IPC_SSH_CLOSE, evt),
    onError: (evt) => broadcastToAll(IPC_SSH_ERROR, evt),
  })

  ipcMain.handle(IPC_SSH_CONNECT, async (_event, raw) => {
    const payload = validate(ConnectPayloadSchema, raw)
    const sessionId = await manager.connect(payload)
    return { sessionId }
  })

  ipcMain.handle(IPC_SSH_WRITE, (_event, raw) => {
    const payload = validate(WritePayloadSchema, raw)
    manager.write(payload.sessionId, payload.data)
  })

  ipcMain.handle(IPC_SSH_RESIZE, (_event, raw) => {
    const payload = validate(ResizePayloadSchema, raw)
    manager.resize(payload.sessionId, payload.cols, payload.rows)
  })

  ipcMain.handle(IPC_SSH_DISCONNECT, (_event, raw) => {
    const payload = validate(DisconnectPayloadSchema, raw)
    manager.disconnect(payload.sessionId)
  })

  return manager
}

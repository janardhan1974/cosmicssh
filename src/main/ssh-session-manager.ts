// SSH session manager — owns ssh2 Client instances, one per session.
// Renderer never sees the Client; it only ever has a sessionId.

import { Client } from 'ssh2'
import type { ClientChannel, ConnectConfig } from 'ssh2'
import { randomUUID } from 'node:crypto'
import type { SshCloseEvent, SshDataEvent, SshErrorEvent } from '../shared/types'

type Session = {
  client: Client
  stream: ClientChannel
}

export type SshEventHandlers = {
  onData: (evt: SshDataEvent) => void
  onClose: (evt: SshCloseEvent) => void
  onError: (evt: SshErrorEvent) => void
}

export class SshSessionManager {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly handlers: SshEventHandlers) {}

  connect(config: {
    host: string
    port: number
    username: string
    password: string
  }): Promise<string> {
    const sessionId = randomUUID()
    const client = new Client()

    return new Promise<string>((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        fn()
      }

      client.once('ready', () => {
        client.shell(
          { term: 'xterm-256color' },
          (err, stream) => {
            if (err) {
              client.end()
              return settle(() => reject(err))
            }

            stream.on('data', (chunk: Buffer) => {
              this.handlers.onData({
                sessionId,
                data: chunk.toString('utf8'),
              })
            })
            stream.stderr.on('data', (chunk: Buffer) => {
              this.handlers.onData({
                sessionId,
                data: chunk.toString('utf8'),
              })
            })
            stream.on('close', (code: number | null, signal: string | null) => {
              this.sessions.delete(sessionId)
              this.handlers.onClose({ sessionId, code, signal })
              client.end()
            })

            this.sessions.set(sessionId, { client, stream })
            settle(() => resolve(sessionId))
          },
        )
      })

      client.on('error', (err) => {
        this.handlers.onError({ sessionId, message: err.message })
        settle(() => reject(err))
      })

      const connectConfig: ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        readyTimeout: 20_000,
        keepaliveInterval: 30_000, // plan M7 default; revisit when per-profile config lands
        // SECURITY: host key verification is NOT wired here.
        // Plan.md M2 implements known_hosts-style prompting. Until then, every
        // accepted connection is logged as an explicit warning. This stub MUST
        // be replaced before any non-localhost target.
        hostVerifier: (_key: Buffer): boolean => {
          // eslint-disable-next-line no-console
          console.warn(
            `[ssh] accepting host key for ${config.host}:${config.port} without verification (M2 TODO)`,
          )
          return true
        },
      }

      client.connect(connectConfig)
    })
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`unknown sessionId: ${sessionId}`)
    session.stream.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`unknown sessionId: ${sessionId}`)
    // ssh2 stream supports setWindow(rows, cols, height, width)
    session.stream.setWindow(rows, cols, 0, 0)
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return // idempotent — already gone
    session.stream.end()
    session.client.end()
    this.sessions.delete(sessionId)
  }

  disconnectAll(): void {
    for (const id of this.sessions.keys()) this.disconnect(id)
  }
}

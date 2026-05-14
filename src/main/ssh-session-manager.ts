// SSH session manager — owns ssh2 Client instances, one per session.
// Renderer never sees the Client; it only ever has a sessionId.
//
// Supports jump-host chains via the optional `sock` field on the connect
// config: pass in a stream produced by `forwardOut()` on a previously-opened
// "hop" client and ssh2 will tunnel the new connection through it. Hop
// clients are tracked alongside the session so they close together.

import { Client } from 'ssh2'
import type { ClientChannel, ConnectConfig } from 'ssh2'
import { randomUUID } from 'node:crypto'
import type { Duplex } from 'node:stream'
import type { SshCloseEvent, SshDataEvent, SshErrorEvent } from '../shared/types'

type Session = {
  client: Client
  stream: ClientChannel
  // Jump-chain clients owned by this session. Closed in reverse order when
  // the session ends so each hop's tunnel stays open for whatever it carries.
  hops: Client[]
}

export type SshEventHandlers = {
  onData: (evt: SshDataEvent) => void
  onClose: (evt: SshCloseEvent) => void
  onError: (evt: SshErrorEvent) => void
}

type BaseConnectConfig = {
  host: string
  port: number
  username: string
  password: string
  sock?: Duplex // when set, connection is tunneled over this stream
}

type SessionConnectConfig = BaseConnectConfig & {
  // Hops to close when this session closes. Order: outer→inner.
  hops?: Client[]
}

export class SshSessionManager {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly handlers: SshEventHandlers) {}

  connect(config: SessionConnectConfig): Promise<string> {
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
              // Tear down the jump chain in reverse — innermost hop carried
              // the actual tunnel, so close it last.
              const hops = config.hops ?? []
              for (let i = hops.length - 1; i >= 0; i--) {
                try { hops[i]?.end() } catch { /* best-effort */ }
              }
            })

            this.sessions.set(sessionId, {
              client,
              stream,
              hops: config.hops ?? [],
            })
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
      if (config.sock) connectConfig.sock = config.sock

      client.connect(connectConfig)
    })
  }

  // Open a "hop" Client — a Client used purely to tunnel another connection
  // via forwardOut(). Not registered as a session; caller is responsible for
  // associating it with a session via the `hops` field on connect config so
  // it gets cleaned up correctly.
  openHopClient(config: BaseConnectConfig): Promise<Client> {
    return new Promise<Client>((resolve, reject) => {
      const client = new Client()
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        fn()
      }

      client.once('ready', () => settle(() => resolve(client)))
      client.on('error', (err) => {
        try { client.end() } catch { /* */ }
        settle(() => reject(err))
      })

      const cc: ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        readyTimeout: 20_000,
        keepaliveInterval: 30_000,
        hostVerifier: (_key: Buffer): boolean => {
          // eslint-disable-next-line no-console
          console.warn(
            `[ssh] accepting host key for jump host ${config.host}:${config.port} without verification (M2 TODO)`,
          )
          return true
        },
      }
      if (config.sock) cc.sock = config.sock
      client.connect(cc)
    })
  }

  // Open a TCP-forwarded stream from a hop client to a target host:port. The
  // returned stream can be passed as `sock` to a subsequent connect (or
  // openHopClient) to tunnel through the hop.
  forwardOut(
    hopClient: Client,
    targetHost: string,
    targetPort: number,
  ): Promise<Duplex> {
    return new Promise<Duplex>((resolve, reject) => {
      hopClient.forwardOut('127.0.0.1', 0, targetHost, targetPort, (err, stream) => {
        if (err) return reject(err)
        resolve(stream as unknown as Duplex)
      })
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

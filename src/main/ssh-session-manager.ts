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
  // null for sftp-only sessions — no shell channel was opened.
  stream: ClientChannel | null
  // Jump-chain clients owned by this session. Closed in reverse order when
  // the session ends so each hop's tunnel stays open for whatever it carries.
  hops: Client[]
}

export type SshEventHandlers = {
  onData: (evt: SshDataEvent) => void
  onClose: (evt: SshCloseEvent) => void
  onError: (evt: SshErrorEvent) => void
}

// Verifier callback used to vet host keys against known_hosts and (when
// unknown) to prompt the user. Resolves to true to accept, false to reject.
// `host`/`port` are for context only — the actual check uses `keyBuffer`.
export type HostVerifierGate = (args: {
  host: string
  port: number
  keyBuffer: Buffer
}) => Promise<boolean>

type BaseConnectConfig = {
  host: string
  port: number
  username: string
  // Exactly one of these is set per connect attempt. ssh2 falls back through
  // multiple auth methods if both are present, but we keep the caller
  // explicit so error messages stay clear.
  password?: string
  privateKey?: Buffer
  passphrase?: string
  sock?: Duplex // when set, connection is tunneled over this stream
}

type SessionConnectConfig = BaseConnectConfig & {
  // Hops to close when this session closes. Order: outer→inner.
  hops?: Client[]
  // If false, skip opening a shell channel — useful for sftp-only profiles.
  // Defaults to true.
  withShell?: boolean
}

export class SshSessionManager {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly handlers: SshEventHandlers,
    private readonly hostVerifierGate: HostVerifierGate,
  ) {}

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

      // Common cleanup when the session ends — runs on shell-channel close
      // (ssh sessions) or on client close (sftp-only sessions).
      const closeHops = () => {
        const hops = config.hops ?? []
        for (let i = hops.length - 1; i >= 0; i--) {
          try { hops[i]?.end() } catch { /* best-effort */ }
        }
      }

      client.once('ready', () => {
        if (config.withShell === false) {
          // SFTP-only: skip the shell channel. Register the session with a
          // null stream; clean up on the client's own close event since we
          // have no stream lifecycle to hang things on.
          this.sessions.set(sessionId, {
            client,
            stream: null,
            hops: config.hops ?? [],
          })
          client.on('close', () => {
            if (!this.sessions.has(sessionId)) return
            this.sessions.delete(sessionId)
            this.handlers.onClose({ sessionId, code: null, signal: null })
            closeHops()
          })
          settle(() => resolve(sessionId))
          return
        }

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
              closeHops()
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

      // Track auth methods the server says it accepts (filled in by
      // authHandler) so we can surface a clearer error when everything fails.
      let serverAuthMethods: string[] = []
      const attemptedMethods = new Set<string>()

      client.on('error', (err) => {
        let message = err.message
        // Enrich the famously unhelpful "All configured authentication
        // methods failed" with the methods the server actually wanted +
        // which ones we tried.
        if (message.includes('authentication methods failed')) {
          const tried = [...attemptedMethods].join(', ') || 'none'
          const allowed = serverAuthMethods.length > 0
            ? serverAuthMethods.join(', ')
            : '(unknown)'
          message =
            `${message}\n` +
            `  We tried: ${tried}\n` +
            `  Server accepts: ${allowed}`
        }
        this.handlers.onError({ sessionId, message })
        settle(() => reject(new Error(message)))
      })

      const connectConfig: ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 20_000,
        keepaliveInterval: 30_000, // plan M7 default; revisit when per-profile config lands
        // Async hostVerifier: defer to the injected gate which checks
        // known_hosts and prompts the user on unknown keys.
        hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
          this.hostVerifierGate({ host: config.host, port: config.port, keyBuffer: key })
            .then((ok) => verify(ok))
            .catch(() => verify(false))
        },
        // Explicit auth-method ordering. ssh2's default flow tries one
        // method based on which credentials are set; with authHandler we
        // control the sequence AND see the server's accepted-methods list.
        authHandler: (methodsLeft, _partialSuccess, callback) => {
          if (Array.isArray(methodsLeft)) serverAuthMethods = methodsLeft
          // Order: publickey first if we have one, else password, then
          // keyboard-interactive (covers the "no plain password but kbd-
          // interactive enabled" case common on Fortinet/F5 fronted boxes).
          const wanted: Array<'publickey' | 'password' | 'keyboard-interactive'> = []
          if (config.privateKey) wanted.push('publickey')
          if (config.password !== undefined) {
            wanted.push('password', 'keyboard-interactive')
          }
          for (const m of wanted) {
            if (attemptedMethods.has(m)) continue
            // If the server told us which methods are still left, skip ones
            // not in that list — saves a guaranteed failure round-trip.
            if (Array.isArray(methodsLeft) && !methodsLeft.includes(m)) continue
            attemptedMethods.add(m)
            if (m === 'password') {
              return callback({
                type: 'password',
                username: config.username,
                password: config.password!,
              })
            }
            if (m === 'keyboard-interactive') {
              return callback({
                type: 'keyboard-interactive',
                username: config.username,
                // Respond to every prompt with the stored password — works for
                // single-prompt "Password:" servers (most Fortinet/F5 setups).
                // True multi-prompt 2FA needs a UI surface; that's a follow-up.
                prompt: (_name, _instr, _lang, prompts, finish) => {
                  finish(prompts.map(() => config.password ?? ''))
                },
              })
            }
            if (m === 'publickey') {
              return callback({
                type: 'publickey',
                username: config.username,
                key: config.privateKey!,
                passphrase: config.passphrase,
              })
            }
          }
          // No more methods to try — abort. ssh2's runtime accepts `false`
          // here to fail the connection (the @types/ssh2 signature omits it).
          ;(callback as unknown as (v: false) => void)(false)
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
        readyTimeout: 20_000,
        keepaliveInterval: 30_000,
        hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
          this.hostVerifierGate({ host: config.host, port: config.port, keyBuffer: key })
            .then((ok) => verify(ok))
            .catch(() => verify(false))
        },
      }
      if (config.password !== undefined) cc.password = config.password
      if (config.privateKey) cc.privateKey = config.privateKey
      if (config.passphrase) cc.passphrase = config.passphrase
      if (config.sock) cc.sock = config.sock
      // Same keyboard-interactive fallback as the main connect path.
      if (config.password !== undefined) {
        cc.tryKeyboard = true
        client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
          finish(prompts.map(() => config.password ?? ''))
        })
      }
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

  // Exposed so the SFTP manager can attach a sftp() subsystem to an active
  // SSH connection. Throws if no session — caller should ensure the session
  // is open first.
  getClient(sessionId: string): Client {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`unknown sessionId: ${sessionId}`)
    return session.client
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`unknown sessionId: ${sessionId}`)
    if (!session.stream) {
      throw new Error('session has no shell channel (SFTP-only profile)')
    }
    session.stream.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`unknown sessionId: ${sessionId}`)
    if (!session.stream) return // no shell to resize on sftp-only sessions
    // ssh2 stream supports setWindow(rows, cols, height, width)
    session.stream.setWindow(rows, cols, 0, 0)
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return // idempotent — already gone
    if (session.stream) session.stream.end()
    session.client.end()
    this.sessions.delete(sessionId)
  }

  disconnectAll(): void {
    for (const id of this.sessions.keys()) this.disconnect(id)
  }
}

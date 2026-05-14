// OpenSSH-compatible known_hosts store. Lines look like:
//   host[:port] keytype base64-of-public-key
// (We don't write the [host]:port bracket form — simple "host:port" parses
// both directions cleanly for our own writes/reads. OpenSSH won't read these
// directly, but the format is conceptually the same.)
//
// On every SSH connect, the host's public key is parsed from the raw wire
// buffer ssh2 hands the hostVerifier. We match by exact (keyType, base64).
// If a host:port entry exists with a different key, that's a real mismatch
// (potential MITM) and we block the connection.

import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type HostKeyEntry = {
  host: string
  port: number
  keyType: string
  // Base64 of the full SSH wire-format public key (matches what's after
  // "ssh-rsa " etc. in a standard authorized_keys / known_hosts file).
  keyB64: string
}

export type ParsedKey = {
  keyType: string
  keyB64: string
  // SHA256:base64(no-padding) — the same fingerprint format `ssh-keygen -lf`
  // prints by default.
  fingerprint: string
}

// SSH wire-format public keys start with a 4-byte big-endian length prefix
// followed by the keyType string. We pull that out and base64-encode the
// whole buffer so we can match exactly against stored lines.
export function parseHostKey(buf: Buffer): ParsedKey {
  if (buf.length < 4) {
    throw new Error('host key buffer is too short')
  }
  const typeLen = buf.readUInt32BE(0)
  if (typeLen <= 0 || typeLen > 64 || 4 + typeLen > buf.length) {
    throw new Error('host key buffer has invalid type length')
  }
  const keyType = buf.toString('utf8', 4, 4 + typeLen)
  const keyB64 = buf.toString('base64')
  const fingerprint =
    'SHA256:' +
    createHash('sha256').update(buf).digest('base64').replace(/=+$/, '')
  return { keyType, keyB64, fingerprint }
}

export class KnownHostsStore {
  private readonly path: string
  private entries: HostKeyEntry[] = []

  constructor() {
    this.path = join(app.getPath('userData'), 'known_hosts')
    this.load()
  }

  private load(): void {
    if (!existsSync(this.path)) {
      this.entries = []
      return
    }
    try {
      const raw = readFileSync(this.path, 'utf8')
      this.entries = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .map((line) => parseLine(line))
        .filter((e): e is HostKeyEntry => e !== null)
    } catch {
      this.entries = []
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const header = '# CosmicSSH known_hosts — accepted host keys. Format:\n# host[:port] keytype base64key\n'
    const body = this.entries
      .map((e) => `${formatHost(e.host, e.port)} ${e.keyType} ${e.keyB64}`)
      .join('\n')
    writeFileSync(this.path, header + body + (body ? '\n' : ''), 'utf8')
  }

  lookup(host: string, port: number): HostKeyEntry | undefined {
    return this.entries.find((e) => e.host === host && e.port === port)
  }

  // Add a new (host, port, key) entry. Caller has already decided this is OK
  // (either matched a previous entry, or the user just clicked Accept on the
  // prompt). Overwrites any previous entry for the same host:port.
  upsert(entry: HostKeyEntry): void {
    this.entries = this.entries.filter(
      (e) => !(e.host === entry.host && e.port === entry.port),
    )
    this.entries.push(entry)
    this.save()
  }

  // Used during testing / a "forget host" UX. Not exposed in v1 UI.
  remove(host: string, port: number): void {
    const before = this.entries.length
    this.entries = this.entries.filter((e) => !(e.host === host && e.port === port))
    if (this.entries.length !== before) this.save()
  }
}

function formatHost(host: string, port: number): string {
  return port === 22 ? host : `${host}:${port}`
}

function parseLine(line: string): HostKeyEntry | null {
  const parts = line.split(/\s+/)
  if (parts.length < 3) return null
  const hostPart = parts[0]!
  const keyType = parts[1]!
  const keyB64 = parts[2]!
  // host:port — but watch for IPv6 brackets, which we don't write but might
  // see if user imports from OpenSSH. Strip them if present.
  let host = hostPart
  let port = 22
  if (hostPart.startsWith('[') && hostPart.includes(']:')) {
    const close = hostPart.indexOf(']:')
    host = hostPart.substring(1, close)
    port = Number.parseInt(hostPart.substring(close + 2), 10) || 22
  } else if (hostPart.includes(':') && !hostPart.includes('::')) {
    // IPv4/hostname with :port. IPv6 addresses without brackets would also
    // contain ':' — those won't round-trip but are rare enough to skip.
    const idx = hostPart.lastIndexOf(':')
    const maybePort = Number.parseInt(hostPart.substring(idx + 1), 10)
    if (Number.isFinite(maybePort) && maybePort > 0 && maybePort < 65536) {
      host = hostPart.substring(0, idx)
      port = maybePort
    }
  }
  return { host, port, keyType, keyB64 }
}

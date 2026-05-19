// Per-session log file writer.
//
// Two entry points:
//   - `start(sessionId, profileName)` opens an append stream for the duration
//     of an SSH session. Every chunk that flows into `append()` is stripped
//     of ANSI escapes / control chars and written to disk. Captures both the
//     server's output AND the user's typed commands implicitly (the remote
//     shell echoes them back, so they appear in the stream).
//   - `saveScrollback(profileName, text)` writes a one-shot dump of plain
//     text (no ANSI assumed) — used by the renderer's "Save scrollback…"
//     action.
//
// Files land in `<userData>/sessions/`. The userData path was relocated to
// the exe folder in packaged builds by storage-dir.ts at startup, so this
// path resolves to `<exe-dir>/sessions/` for portable / installed builds and
// `%APPDATA%\CosmicSSH\sessions\` in dev.

import { app } from 'electron'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'

// Matches the bulk of ECMA-48 escape sequences a server actually emits over
// a PTY: CSI (`ESC[...<final>`), OSC (`ESC]...BEL`), and single-char escapes
// (`ESC <C0>`). DCS/SOS/PM/APC framings (rare, used by sixel etc.) get
// caught by the single-char fallback — the contents leak through as plain
// text, which is acceptable for a human-readable log. Hex escapes are used
// throughout so the file stays safe to copy/paste without losing control
// chars to editor normalization.
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[@-Z\\-_]/g
// Bell (BEL=0x07), backspace (BS=0x08), and DEL (0x7f) — meaningless in a
// plain-text log. CR (0x0d) is left intact and handled by the line-ending
// normalizer below.
// eslint-disable-next-line no-control-regex
const CONTROL_REGEX = /[\x07\x08\x7f]/g

function stripAnsi(input: string): string {
  // Normalize CRLF → LF first so the resulting log is consistent across
  // remote OSes; then strip standalone CRs (cursor-return overstrike) so
  // progress bars don't accumulate as garbled overlap.
  const lf = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return lf.replace(ANSI_REGEX, '').replace(CONTROL_REGEX, '')
}

function sanitizeForFilename(name: string): string {
  // Strip / collapse anything Windows or Linux dislikes in a filename. Falls
  // back to 'session' if the profile name is empty or all-special.
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  return cleaned || 'session'
}

function formatDateStamp(d: Date): string {
  const pad2 = (n: number): string => String(n).padStart(2, '0')
  // DDMMYYYY per the user's spec — note this is NOT ISO order.
  return `${pad2(d.getDate())}${pad2(d.getMonth() + 1)}${d.getFullYear()}`
}

function formatTimeStamp(d: Date): string {
  const pad2 = (n: number): string => String(n).padStart(2, '0')
  return `${pad2(d.getHours())}${pad2(d.getMinutes())}`
}

// Resolve a non-colliding path under `sessions/`. If `gpu-1_15052026_1430.txt`
// already exists, returns `gpu-1_15052026_1430_2.txt`, etc.
function resolveUniquePath(dir: string, baseStem: string, ext: string): string {
  let candidate = join(dir, `${baseStem}${ext}`)
  if (!existsSync(candidate)) return candidate
  for (let i = 2; i < 1000; i++) {
    candidate = join(dir, `${baseStem}_${i}${ext}`)
    if (!existsSync(candidate)) return candidate
  }
  // Pathological — return the i=999 candidate; openSync will throw if it
  // also exists, which is fine.
  return candidate
}

type Entry = {
  fd: number
  path: string
}

export class SessionLogger {
  // sessionId → open append-mode fd. Absent entries = not logging.
  private readonly active = new Map<string, Entry>()

  private sessionsDir(): string {
    const dir = join(app.getPath('userData'), 'sessions')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  // Open a fresh log file for this sessionId. Returns the absolute path so
  // ipc-handlers can surface it on the ConnectResult for renderer display.
  // No-op if a logger is already open for this sessionId (defensive — should
  // not happen, but reconnect paths can be racy).
  start(sessionId: string, profileName: string): string {
    const existing = this.active.get(sessionId)
    if (existing) return existing.path
    const dir = this.sessionsDir()
    const now = new Date()
    const stem = `${sanitizeForFilename(profileName)}_${formatDateStamp(now)}_${formatTimeStamp(now)}`
    const path = resolveUniquePath(dir, stem, '.txt')
    const fd = openSync(path, 'a')
    const header =
      `# CosmicSSH session log\n` +
      `# profile: ${profileName}\n` +
      `# started: ${now.toISOString()}\n` +
      `# ---------------------------------------------\n`
    writeSync(fd, header)
    this.active.set(sessionId, { fd, path })
    return path
  }

  append(sessionId: string, data: string): void {
    const entry = this.active.get(sessionId)
    if (!entry) return
    const clean = stripAnsi(data)
    if (clean.length === 0) return
    try {
      writeSync(entry.fd, clean)
    } catch (err) {
      // Disk full / fd closed underneath us / etc. Drop the entry so we
      // don't keep retrying on every chunk; the partial log on disk is
      // still good up to this point.
      // eslint-disable-next-line no-console
      console.error(
        `[session-logger] write failed for ${sessionId}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      )
      this.stop(sessionId)
    }
  }

  stop(sessionId: string): void {
    const entry = this.active.get(sessionId)
    if (!entry) return
    this.active.delete(sessionId)
    try {
      const footer =
        `\n# ---------------------------------------------\n` +
        `# ended: ${new Date().toISOString()}\n`
      writeSync(entry.fd, footer)
    } catch { /* swallow — we're closing anyway */ }
    try { closeSync(entry.fd) } catch { /* */ }
  }

  // Path of the currently-logged file, or null if not logging.
  pathFor(sessionId: string): string | null {
    return this.active.get(sessionId)?.path ?? null
  }

  // One-shot scrollback dump — used by the renderer's "Save scrollback…"
  // action. Text is assumed already plain (xterm exposes the rendered
  // buffer as text, with no escape sequences). Filename uses the same
  // pattern as the streaming logger so dumps and stream logs sort together.
  saveScrollback(profileName: string, text: string): string {
    const dir = this.sessionsDir()
    const now = new Date()
    const stem =
      `${sanitizeForFilename(profileName)}_` +
      `${formatDateStamp(now)}_${formatTimeStamp(now)}_scrollback`
    const path = resolveUniquePath(dir, stem, '.txt')
    const header =
      `# CosmicSSH scrollback dump\n` +
      `# profile: ${profileName}\n` +
      `# saved:   ${now.toISOString()}\n` +
      `# ---------------------------------------------\n`
    const body = text.endsWith('\n') ? text : text + '\n'
    writeFileSync(path, header + body, 'utf8')
    return path
  }

  // Called from main on before-quit so partial logs get a proper footer.
  closeAll(): void {
    for (const id of [...this.active.keys()]) this.stop(id)
  }
}

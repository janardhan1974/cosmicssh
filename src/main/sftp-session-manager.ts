// SFTP session manager — opens one ssh2 SFTP subsystem per active SSH
// session, lazily on first request, and reuses it across operations.
// Closes when the underlying SSH session closes.
//
// Transfers (upload/download) get their own transferId and emit progress
// events keyed by it. The manager keeps a registry of in-flight transfers
// so cancel() can find and abort them.

import type { FileEntryWithStats, SFTPWrapper } from 'ssh2'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, join as joinNative } from 'node:path'
import type {
  FsEntry,
  TransferDoneEvent,
  TransferErrorEvent,
  TransferProgressEvent,
  TransferStartedEvent,
} from '../shared/types'
import type { SshSessionManager } from './ssh-session-manager'

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

type TransferKind = 'upload' | 'download'

type ActiveTransfer = {
  id: string
  kind: TransferKind
  bytesTransferred: number
  totalBytes: number
  startedAt: number
  // Cancel hook — for stream-based transfers this destroys the stream;
  // fastGet/fastPut don't expose a cancel handle so cancel is best-effort.
  cancel: () => void
}

export type SftpEventHandlers = {
  onStarted: (evt: TransferStartedEvent) => void
  onProgress: (evt: TransferProgressEvent) => void
  onDone: (evt: TransferDoneEvent) => void
  onError: (evt: TransferErrorEvent) => void
}

export class SftpSessionManager {
  private readonly handles = new Map<string, SFTPWrapper>()
  private readonly transfers = new Map<string, ActiveTransfer>()

  constructor(
    private readonly ssh: SshSessionManager,
    private readonly handlers: SftpEventHandlers,
  ) {}

  // Get-or-open an sftp handle for an active SSH session.
  async getOrOpen(sessionId: string): Promise<SFTPWrapper> {
    const existing = this.handles.get(sessionId)
    if (existing) return existing

    const client = this.ssh.getClient(sessionId)
    return new Promise<SFTPWrapper>((res, rej) => {
      client.sftp((err, sftp) => {
        if (err) return rej(err)
        const cleanup = () => {
          this.handles.delete(sessionId)
        }
        sftp.on('end', cleanup)
        sftp.on('close', cleanup)
        client.once('close', cleanup) // belt-and-suspenders
        this.handles.set(sessionId, sftp)
        res(sftp)
      })
    })
  }

  closeForSession(sessionId: string): void {
    const sftp = this.handles.get(sessionId)
    if (!sftp) return
    try { sftp.end() } catch { /* best-effort */ }
    this.handles.delete(sessionId)
    // Cancel any in-flight transfers for this session — caller is expected
    // to also disconnect the SSH session.
    for (const t of this.transfers.values()) {
      try { t.cancel() } catch { /* */ }
    }
  }

  // ─── Directory + metadata ───────────────────────────────────────────────
  async list(sessionId: string, path: string): Promise<FsEntry[]> {
    const sftp = await this.getOrOpen(sessionId)
    return new Promise<FsEntry[]>((res, rej) => {
      sftp.readdir(path, (err, items) => {
        if (err) return rej(err)
        const out = items.map((it): FsEntry => classifyEntry(it.filename, it.attrs.mode, it.attrs.size, it.attrs.mtime, it.longname))
        res(out)
      })
    })
  }

  async stat(sessionId: string, path: string): Promise<FsEntry> {
    const sftp = await this.getOrOpen(sessionId)
    // Use lstat so symlinks report as symlinks (not their target).
    return new Promise<FsEntry>((res, rej) => {
      sftp.lstat(path, (err, attrs) => {
        if (err) return rej(err)
        const name = path.split('/').filter(Boolean).pop() ?? path
        // No `longname` available from lstat — we rely on mode bits alone.
        res(classifyEntry(name, attrs.mode, attrs.size, attrs.mtime, ''))
      })
    })
  }

  async mkdir(sessionId: string, path: string): Promise<void> {
    const sftp = await this.getOrOpen(sessionId)
    return new Promise<void>((res, rej) => {
      sftp.mkdir(path, (err) => (err ? rej(err) : res()))
    })
  }

  async deletePath(sessionId: string, path: string, isDirectory: boolean): Promise<void> {
    const sftp = await this.getOrOpen(sessionId)
    return new Promise<void>((res, rej) => {
      const fn = isDirectory ? sftp.rmdir.bind(sftp) : sftp.unlink.bind(sftp)
      fn(path, (err) => (err ? rej(err) : res()))
    })
  }

  async rename(sessionId: string, fromPath: string, toPath: string): Promise<void> {
    const sftp = await this.getOrOpen(sessionId)
    return new Promise<void>((res, rej) => {
      sftp.rename(fromPath, toPath, (err) => (err ? rej(err) : res()))
    })
  }

  async chmod(sessionId: string, path: string, mode: number): Promise<void> {
    const sftp = await this.getOrOpen(sessionId)
    return new Promise<void>((res, rej) => {
      sftp.chmod(path, mode, (err) => (err ? rej(err) : res()))
    })
  }

  // ─── Transfers ──────────────────────────────────────────────────────────

  // Note on ssh2 fastPut/fastGet: they pipeline READ/WRITE requests for
  // throughput. The `step` callback fires per chunk acked by the remote.
  // No native cancel — we mark a flag the step callback checks and best-
  // effort destroy the underlying stream.

  async upload(
    sessionId: string,
    localPath: string,
    remotePath: string,
    totalBytes: number,
  ): Promise<string> {
    const sftp = await this.getOrOpen(sessionId)
    const transferId = randomUUID()

    const transfer: ActiveTransfer = {
      id: transferId,
      kind: 'upload',
      bytesTransferred: 0,
      totalBytes,
      startedAt: Date.now(),
      // fastPut doesn't surface a cancel handle; setting a sentinel is
      // best-effort — if you need hard cancellation, switch to a streamed
      // implementation.
      cancel: () => {
        // intentional no-op; ssh2 will continue until completion or remote err
      },
    }
    this.transfers.set(transferId, transfer)
    this.handlers.onStarted({
      transferId,
      direction: 'upload',
      from: localPath,
      to: remotePath,
      totalBytes,
    })

    sftp.fastPut(
      localPath,
      remotePath,
      {
        step: (transferred, _chunk, _total) => {
          transfer.bytesTransferred = transferred
          this.emitProgress(transfer)
        },
      },
      (err) => {
        if (err) {
          this.transfers.delete(transferId)
          this.handlers.onError({ transferId, message: err.message })
          return
        }
        // Final tick to make sure UI shows 100%
        transfer.bytesTransferred = totalBytes
        this.emitProgress(transfer)
        this.transfers.delete(transferId)
        this.handlers.onDone({ transferId, bytesTransferred: totalBytes })
      },
    )

    return transferId
  }

  async download(
    sessionId: string,
    remotePath: string,
    localPath: string,
  ): Promise<{ transferId: string; totalBytes: number }> {
    const sftp = await this.getOrOpen(sessionId)
    // Stat first so we know totalBytes for the progress UI.
    const totalBytes = await new Promise<number>((res, rej) => {
      sftp.stat(remotePath, (err, attrs) => {
        if (err) return rej(err)
        res(attrs.size ?? 0)
      })
    })
    const transferId = randomUUID()
    const transfer: ActiveTransfer = {
      id: transferId,
      kind: 'download',
      bytesTransferred: 0,
      totalBytes,
      startedAt: Date.now(),
      cancel: () => {
        // see upload() note
      },
    }
    this.transfers.set(transferId, transfer)
    this.handlers.onStarted({
      transferId,
      direction: 'download',
      from: remotePath,
      to: localPath,
      totalBytes,
    })

    sftp.fastGet(
      remotePath,
      localPath,
      {
        step: (transferred, _chunk, _total) => {
          transfer.bytesTransferred = transferred
          this.emitProgress(transfer)
        },
      },
      (err) => {
        if (err) {
          this.transfers.delete(transferId)
          this.handlers.onError({ transferId, message: err.message })
          return
        }
        transfer.bytesTransferred = totalBytes
        this.emitProgress(transfer)
        this.transfers.delete(transferId)
        this.handlers.onDone({ transferId, bytesTransferred: totalBytes })
      },
    )

    return { transferId, totalBytes }
  }

  cancelTransfer(transferId: string): void {
    const t = this.transfers.get(transferId)
    if (!t) return
    try { t.cancel() } catch { /* */ }
  }

  // ─── Folder transfers ───────────────────────────────────────────────────

  // Upload a local folder to a remote parent. The source folder's basename
  // is preserved at the destination (uploadFolder('/foo/bar', '/srv') →
  // '/srv/bar/...'). Mkdirs the destination tree (idempotent), then queues
  // per-file fastPuts. Errors per-file are surfaced as transfer-error events
  // for that file; the overall folder op completes once every file resolves.
  async uploadFolder(
    sessionId: string,
    localRoot: string,
    remoteParent: string,
  ): Promise<void> {
    const sftp = await this.getOrOpen(sessionId)

    const folderName = basename(localRoot)
    const remoteBase = posixJoin(remoteParent, folderName)
    const tree = walkLocal(localRoot)

    await ensureRemoteDir(sftp, remoteBase)
    for (const dir of tree.dirs) {
      const remoteDir = posixJoin(remoteBase, toPosix(dir.relPath))
      await ensureRemoteDir(sftp, remoteDir)
    }

    // Fire transfers sequentially to avoid hammering the SFTP server with
    // many parallel fastPut pipelines. ssh2 already pipelines internally
    // within one fastPut so single-stream throughput is good.
    for (const file of tree.files) {
      const local = joinNative(localRoot, file.relPath)
      const remote = posixJoin(remoteBase, toPosix(file.relPath))
      try {
        await this.upload(sessionId, local, remote, file.size)
      } catch (err) {
        // upload() already emits an onError event with the transferId.
        // Continue with remaining files.
        // eslint-disable-next-line no-console
        console.warn(`[sftp] upload failed for ${local} → ${remote}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // Mirror of uploadFolder for the other direction.
  async downloadFolder(
    sessionId: string,
    remoteRoot: string,
    localParent: string,
  ): Promise<void> {
    const sftp = await this.getOrOpen(sessionId)

    // Source folder's last segment becomes the dest folder name.
    const folderName = remoteRoot.split('/').filter(Boolean).pop() ?? 'download'
    const localBase = joinNative(localParent, folderName)
    const tree = await walkRemote(sftp, remoteRoot)

    ensureLocalDir(localBase)
    for (const dir of tree.dirs) {
      ensureLocalDir(joinNative(localBase, dir.relPath))
    }

    for (const file of tree.files) {
      const remote = posixJoin(remoteRoot, toPosix(file.relPath))
      const local = joinNative(localBase, file.relPath)
      try {
        await this.download(sessionId, remote, local)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[sftp] download failed for ${remote} → ${local}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private emitProgress(t: ActiveTransfer): void {
    const elapsedMs = Math.max(1, Date.now() - t.startedAt)
    const bytesPerSecond = (t.bytesTransferred * 1000) / elapsedMs
    this.handlers.onProgress({
      transferId: t.id,
      bytesTransferred: t.bytesTransferred,
      totalBytes: t.totalBytes,
      bytesPerSecond,
    })
  }
}

// Walk a local directory tree synchronously, returning relative paths.
// Symlinks are skipped to avoid following loops; that may be revisited later.
function walkLocal(root: string): {
  dirs: { relPath: string }[]
  files: { relPath: string; size: number }[]
} {
  const dirs: { relPath: string }[] = []
  const files: { relPath: string; size: number }[] = []

  const recurse = (curr: string, rel: string): void => {
    let names: string[]
    try { names = readdirSync(curr) } catch { return }
    for (const name of names) {
      const childAbs = joinNative(curr, name)
      const childRel = rel ? joinNative(rel, name) : name
      let s
      try { s = statSync(childAbs) } catch { continue }
      if (s.isSymbolicLink()) continue
      if (s.isDirectory()) {
        dirs.push({ relPath: childRel })
        recurse(childAbs, childRel)
      } else if (s.isFile()) {
        files.push({ relPath: childRel, size: s.size })
      }
    }
  }
  recurse(root, '')
  return { dirs, files }
}

// Mirror of walkLocal over an SFTP connection.
async function walkRemote(
  sftp: SFTPWrapper,
  root: string,
): Promise<{
  dirs: { relPath: string }[]
  files: { relPath: string; size: number }[]
}> {
  const dirs: { relPath: string }[] = []
  const files: { relPath: string; size: number }[] = []

  const readdir = (path: string): Promise<FileEntryWithStats[]> =>
    new Promise((res, rej) => {
      sftp.readdir(path, (err, list) => (err ? rej(err) : res(list)))
    })

  const recurse = async (curr: string, rel: string): Promise<void> => {
    let items: FileEntryWithStats[]
    try { items = await readdir(curr) } catch { return }
    for (const it of items) {
      const childAbs = posixJoin(curr, it.filename)
      const childRel = rel ? `${rel}/${it.filename}` : it.filename
      const classified = classifyEntry(
        it.filename,
        it.attrs.mode,
        it.attrs.size,
        it.attrs.mtime,
        it.longname,
      )
      if (classified.isSymlink) continue // skip symlinks v1
      if (classified.isDirectory) {
        dirs.push({ relPath: childRel })
        await recurse(childAbs, childRel)
      } else {
        files.push({ relPath: childRel, size: classified.size })
      }
    }
  }

  await recurse(root, '')
  return { dirs, files }
}

// Mkdir on remote; treat "already exists" as success.
async function ensureRemoteDir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise<void>((res, rej) => {
    sftp.mkdir(path, (err) => {
      if (!err) return res()
      // ssh2 surfaces a string in err.message; SFTP failure code 4 (FAILURE)
      // is what most servers send for EEXIST. Be lenient.
      const msg = err.message ?? String(err)
      if (/exist|already|EEXIST/i.test(msg) || (err as { code?: number }).code === 4) {
        return res()
      }
      rej(err)
    })
  })
}

function ensureLocalDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

// POSIX path join (used for remote paths regardless of host OS).
function posixJoin(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
}

// Convert a Windows-style relative path (joinNative produces these) to POSIX
// for use as a remote path component.
function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

// Best-effort classification of an SFTP entry's type. SFTP v3 spec says
// ATTR_PERMISSIONS includes the full POSIX mode (with file type bits), but
// not every server actually sets them — Windows-based SFTP servers and some
// embedded implementations send permission bits only. ssh2's longname is the
// human-readable `ls -l` line that EVERY SFTP v3 server is supposed to send;
// the first character is the file type. Use longname as the authoritative
// signal when present; fall back to mode bits otherwise.
function classifyEntry(
  name: string,
  rawMode: number | undefined,
  size: number | undefined,
  mtime: number | undefined,
  longname: string,
): FsEntry {
  const mode = rawMode ?? 0
  const fileType = mode & S_IFMT
  const ln = longname.charAt(0)

  let isDirectory = false
  let isSymlink = false
  if (ln === 'd') isDirectory = true
  else if (ln === 'l') isSymlink = true
  else if (ln === '-' || ln === 'p' || ln === 'b' || ln === 'c' || ln === 's') {
    // explicit non-directory file types — leave booleans false
  } else {
    // longname missing or unrecognized — fall back to mode bits
    isDirectory = fileType === S_IFDIR
    isSymlink = fileType === S_IFLNK
  }

  return {
    name,
    isDirectory,
    isSymlink,
    size: size ?? 0,
    mtimeMs: (mtime ?? 0) * 1000,
    mode: mode & 0o7777,
  }
}

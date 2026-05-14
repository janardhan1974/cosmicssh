import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { FsEntry } from '../../../shared/types'
import { usePlatformStore } from '../stores/platform-store'
import { useSessionsStore } from '../stores/sessions-store'

type Kind = 'local' | 'remote'

export type SftpPaneAction =
  | 'upload' // local pane only
  | 'download' // remote pane only
  | 'delete'
  | 'mkdir'
  | 'rename'
  | 'chmod' // remote only

export type SftpPaneHandle = {
  refresh: () => Promise<void>
  getPath: () => string
  getSelected: () => FsEntry[]
  // Re-list the current path. Used after a remote mutation completes.
  reload: () => Promise<void>
}

// Custom MIME used for intra-app sftp drags. Distinct from text/uri-list etc.
// so external drops (Windows Explorer files) can be detected separately.
export const SFTP_DRAG_MIME = 'application/x-cosmicssh-sftp'

export type SftpDragSource = {
  kind: Kind
  sessionId: string
  basePath: string // POSIX for remote, OS-native for local
  entries: { name: string; isDirectory: boolean }[]
}

type Props = {
  kind: Kind
  sessionId: string
  onAction: (action: SftpPaneAction) => void
  // Intra-app drop arrived. `targetSubfolder` is set when the drop landed on
  // a folder row (used for "move into" semantics on the remote pane);
  // otherwise the drop is on the pane background and target = current path.
  onDrop: (source: SftpDragSource, targetSubfolder: string | null) => void
  // Fired when the user clicks Reconnect on a closed-session banner.
  onReconnect: () => void
}

type SortKey = 'name' | 'size' | 'mtime'
type SortDir = 'asc' | 'desc'

const DRIVES_PATH = ''
const SEP_REMOTE = '/'

export const SftpPane = forwardRef<SftpPaneHandle, Props>(function SftpPane(
  { kind, sessionId, onAction, onDrop, onReconnect },
  ref,
) {
  // Read this tab's session status. If it flips to 'closed' we render a
  // Reconnect banner instead of letting the user fire useless IPCs.
  const sessionStatus = useSessionsStore(
    (s) => s.tabs.find((t) => t.sessionId === sessionId)?.status ?? 'open',
  )
  const isDisconnected = sessionStatus === 'closed'
  const [dragOver, setDragOver] = useState<string | null>(null)
  // dragOver: null = no drop highlight; '' = pane background; folder name = that row
  const platform = usePlatformStore((s) => s.info)

  // Remote pane uses '/' as its safe default; local uses '' (drives view).
  // This avoids ever firing an sftp:list IPC with an empty `path` — the zod
  // schema requires min 1 char so an empty string would crash mid-session
  // (was seen after the SSH connection idled out for an hour).
  const remoteDefaultPath = '/'
  // For the local pane we use the OS's native separator; remote is always POSIX.
  const sep = kind === 'local' ? platform.sep : SEP_REMOTE
  // Remote starts at '/' so even a fast-fire Refresh (before mount-effect
  // navigate finishes) sends a valid path. Local starts at '' = drives view.
  const [path, setPath] = useState<string>(kind === 'remote' ? remoteDefaultPath : '')
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // (sep already computed above from platform store)

  const navigate = useCallback(
    async (newPath: string) => {
      // Belt-and-suspenders: zod requires min 1 char on the remote `path`,
      // so refuse to fire an IPC with an empty string. Fall back to '/'.
      const targetPath =
        kind === 'remote' && newPath.trim() === '' ? remoteDefaultPath : newPath
      setError(null)
      setBusy(true)
      try {
        if (kind === 'local') {
          const result = await window.api.local.list({ path: targetPath })
          if (result.type === 'drives') {
            setPath(DRIVES_PATH)
            setEntries(
              result.items.map(
                (d): FsEntry => ({
                  name: d.name,
                  isDirectory: true,
                  isSymlink: false,
                  size: 0,
                  mtimeMs: 0,
                  mode: 0,
                }),
              ),
            )
          } else {
            setPath(result.path)
            setEntries(result.items)
          }
        } else {
          const items = await window.api.sftp.list({ sessionId, path: targetPath })
          // ssh2's sftp.realpath('.') would resolve cwd; we don't expose it.
          // Display '.' as '~' so users see something meaningful.
          const resolved = targetPath === '.' ? '~' : targetPath
          setPath(resolved)
          setEntries(items)
        }
        setSelected(new Set())
      } catch (err) {
        setError(formatErr(err))
      } finally {
        setBusy(false)
      }
    },
    [kind, sessionId],
  )

  const reload = useCallback(async () => {
    // If the underlying SSH session has died, "Refresh" auto-triggers a
    // reconnect rather than firing a doomed sftp:list. After replaceSession
    // swaps in the fresh sessionId, the pane's mount-effect re-fetches.
    if (isDisconnected) {
      onReconnect()
      return
    }
    // navigate to current path; for remote with display '~' we re-use '.'
    const target = kind === 'remote' && path === '~' ? '.' : path
    await navigate(target)
  }, [kind, path, navigate, isDisconnected, onReconnect])

  // Initial path
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (kind === 'local') {
          const home = await window.api.local.home()
          if (!cancelled) await navigate(home)
        } else {
          // Start at the filesystem root rather than the user's cwd — gives a
          // predictable jumping-off point regardless of the SFTP server's
          // default landing directory.
          if (!cancelled) await navigate('/')
        }
      } catch (err) {
        if (!cancelled) setError(formatErr(err))
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, sessionId])

  const goUp = useCallback(() => {
    if (kind === 'local') {
      if (!platform.isWindows) {
        // POSIX local: strip trailing /, drop last segment, fall back to /.
        // No drives view on Linux/macOS.
        if (path === '/' || path === '') return
        const stripped = path.replace(/\/+$/, '')
        const parent = stripped.substring(0, stripped.lastIndexOf('/'))
        void navigate(parent === '' ? '/' : parent)
        return
      }
      // Windows local: drives view + drive-root rules.
      if (path === DRIVES_PATH) return
      const stripped = path.replace(/[\\/]+$/, '')
      // Drive root e.g. "C:" or "C:\" → drives view
      if (/^[A-Za-z]:$/.test(stripped)) {
        void navigate(DRIVES_PATH)
        return
      }
      const parent = stripped.replace(/[\\/][^\\/]+$/, '')
      // If trimmed to bare drive, go to drive root
      if (/^[A-Za-z]:$/.test(parent)) {
        void navigate(parent + '\\')
        return
      }
      void navigate(parent || DRIVES_PATH)
    } else {
      if (path === '/' || path === '' || path === '~') {
        // From the home shorthand, go to '/'
        void navigate('/')
        return
      }
      const stripped = path.replace(/\/+$/, '')
      const parent = stripped.substring(0, stripped.lastIndexOf('/'))
      void navigate(parent === '' ? '/' : parent)
    }
  }, [kind, path, navigate, platform.isWindows])

  const onItemDoubleClick = useCallback(
    (entry: FsEntry) => {
      if (entry.isDirectory) {
        if (kind === 'local' && path === DRIVES_PATH) {
          // Drive entry name is "C:" on Windows / "/" on POSIX. Append the
          // OS separator so we land at the drive's root contents.
          const target = entry.name.endsWith(sep) ? entry.name : entry.name + sep
          void navigate(target)
          return
        }
        const base = path.endsWith(sep) ? path : path + sep
        void navigate(base + entry.name)
        return
      }
      // File on remote → could open for editing later (M6 phase 6).
      // Local file double-click: no-op for now (could open in default app).
    },
    [kind, path, sep, navigate],
  )

  const sorted = useMemo(() => {
    const arr = [...entries]
    arr.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      let cmp = 0
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true })
      } else if (sortKey === 'size') {
        cmp = a.size - b.size
      } else if (sortKey === 'mtime') {
        cmp = a.mtimeMs - b.mtimeMs
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [entries, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const toggleSelect = (name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelected((prev) => {
      const next = new Set(prev)
      if (e.ctrlKey || e.metaKey) {
        if (next.has(name)) next.delete(name)
        else next.add(name)
      } else {
        next.clear()
        next.add(name)
      }
      return next
    })
  }

  // Imperative handle exposed to SftpView for cross-pane ops.
  useImperativeHandle(
    ref,
    () => ({
      refresh: reload,
      reload,
      getPath: () => (kind === 'remote' && path === '~' ? '.' : path),
      getSelected: () => entries.filter((e) => selected.has(e.name)),
    }),
    [reload, kind, path, entries, selected],
  )

  // ─── Drag and drop ─────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, entry: FsEntry) => {
    // Source includes the clicked entry plus any other selected entries (so
    // multi-drag works after Ctrl-clicking).
    const sourceNames = new Set<string>([entry.name, ...selected])
    const sourceEntries = entries
      .filter((it) => sourceNames.has(it.name))
      .map((it) => ({ name: it.name, isDirectory: it.isDirectory }))

    const source: SftpDragSource = {
      kind,
      sessionId,
      basePath: kind === 'remote' && path === '~' ? '.' : path,
      entries: sourceEntries,
    }
    e.dataTransfer.setData(SFTP_DRAG_MIME, JSON.stringify(source))
    e.dataTransfer.effectAllowed = 'copyMove'
  }

  const handleDragOverPane = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(SFTP_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (dragOver === null) setDragOver('')
  }

  const handleDragLeavePane = (e: React.DragEvent) => {
    // Only reset if leaving to outside the pane entirely. relatedTarget is
    // null when leaving the window.
    if (e.currentTarget === e.target || !e.relatedTarget) setDragOver(null)
  }

  const handleDropPane = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(SFTP_DRAG_MIME)) return
    e.preventDefault()
    setDragOver(null)
    const raw = e.dataTransfer.getData(SFTP_DRAG_MIME)
    if (!raw) return
    try {
      const source = JSON.parse(raw) as SftpDragSource
      onDrop(source, null)
    } catch {
      // bad payload — ignore
    }
  }

  // Per-folder-row drop handler: lets users drop INTO a specific subfolder
  // shown in the list (instead of into the current path).
  const handleDropOnRow = (e: React.DragEvent, entry: FsEntry) => {
    if (!entry.isDirectory) return
    if (!e.dataTransfer.types.includes(SFTP_DRAG_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    setDragOver(null)
    const raw = e.dataTransfer.getData(SFTP_DRAG_MIME)
    if (!raw) return
    try {
      const source = JSON.parse(raw) as SftpDragSource
      onDrop(source, entry.name)
    } catch {
      // ignore
    }
  }

  const handleDragOverRow = (e: React.DragEvent, entry: FsEntry) => {
    if (!entry.isDirectory) return
    if (!e.dataTransfer.types.includes(SFTP_DRAG_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    if (dragOver !== entry.name) setDragOver(entry.name)
  }

  const isRemote = kind === 'remote'
  const isLocal = !isRemote
  const hasSelection = selected.size > 0

  // Shift+Delete (or plain Delete) on the pane triggers a delete on the
  // current selection. Pane container is focusable (tabIndex=-1) and gets
  // focus on mousedown so the keystroke lands here even when no specific
  // child has focus.
  const paneRef = useRef<HTMLDivElement | null>(null)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' && selected.size > 0) {
      e.preventDefault()
      onAction('delete')
    }
  }

  return (
    <div
      ref={paneRef}
      className={`sftp-pane ${dragOver === '' ? 'drag-over-pane' : ''}`}
      tabIndex={-1}
      onMouseDown={() => paneRef.current?.focus()}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOverPane}
      onDragLeave={handleDragLeavePane}
      onDrop={handleDropPane}
    >
      <header className="sftp-pane-header">
        <span className="sftp-pane-title">{isRemote ? 'Remote' : 'Local'}</span>
        <button type="button" className="icon-btn" onClick={goUp} title="Up" disabled={isDisconnected}>↑</button>
      </header>

      {isDisconnected && isRemote && (
        <div className="sftp-disconnected" role="alert">
          <span className="sftp-disconnected-msg">
            Session disconnected — likely an idle timeout. The file list is
            stale; refresh and other actions will fail until you reconnect.
          </span>
          <button
            type="button"
            className="sftp-reconnect-btn"
            onClick={onReconnect}
          >
            Reconnect
          </button>
        </div>
      )}

      <div className="sftp-toolbar">
        {isLocal && (
          <button
            type="button"
            className="icon-btn"
            disabled={!hasSelection}
            onClick={() => onAction('upload')}
            title="Upload selected to remote pane's current directory"
          >
            ↑ Upload
          </button>
        )}
        {isRemote && (
          <button
            type="button"
            className="icon-btn"
            disabled={!hasSelection}
            onClick={() => onAction('download')}
            title="Download selected to local pane's current directory"
          >
            ↓ Download
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={reload}
          title={isDisconnected && isRemote ? 'Reconnect (session dropped)' : 'Refresh'}
        >
          {isDisconnected && isRemote ? '⟳' : '↻'}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => onAction('mkdir')}
          title="New folder here"
        >
          📁+
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={selected.size !== 1}
          onClick={() => onAction('rename')}
          title="Rename selected"
        >
          ✎
        </button>
        <button
          type="button"
          className="icon-btn danger"
          disabled={!hasSelection}
          onClick={() => onAction('delete')}
          title="Delete selected"
        >
          ✕
        </button>
        {isRemote && (
          <button
            type="button"
            className="icon-btn"
            disabled={selected.size !== 1}
            onClick={() => onAction('chmod')}
            title="Change permissions"
          >
            chmod
          </button>
        )}
      </div>

      <div className="sftp-path-bar">
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void navigate(path)
          }}
          spellCheck={false}
          placeholder={isLocal ? (platform.isWindows ? 'C:\\Users\\…' : '/home/…') : '/home/…'}
        />
      </div>

      {error && <div className="sftp-error">{error}</div>}

      <div className="sftp-list" role="grid">
        <div className="sftp-row sftp-head" role="row">
          <button type="button" className="sftp-col-name" onClick={() => toggleSort('name')}>
            Name {sortKey === 'name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
          </button>
          <button type="button" className="sftp-col-size" onClick={() => toggleSort('size')}>
            Size {sortKey === 'size' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
          </button>
          <button type="button" className="sftp-col-mtime" onClick={() => toggleSort('mtime')}>
            Modified {sortKey === 'mtime' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
          </button>
        </div>

        {busy && <div className="sftp-loading">loading…</div>}

        {sorted.map((entry) => {
          const isSel = selected.has(entry.name)
          const isDragTarget = dragOver === entry.name && entry.isDirectory
          return (
            <div
              key={entry.name}
              role="row"
              className={`sftp-row ${isSel ? 'selected' : ''} ${isDragTarget ? 'drag-target-row' : ''}`}
              draggable={true}
              onDragStart={(e) => handleDragStart(e, entry)}
              onDragOver={(e) => handleDragOverRow(e, entry)}
              onDrop={(e) => handleDropOnRow(e, entry)}
              onClick={(e) => toggleSelect(entry.name, e)}
              onDoubleClick={() => onItemDoubleClick(entry)}
            >
              <span className="sftp-col-name" title={entry.name}>
                {entry.isDirectory ? '📁 ' : entry.isSymlink ? '🔗 ' : '📄 '}
                {entry.name}
              </span>
              <span className="sftp-col-size">
                {entry.isDirectory ? '' : formatBytes(entry.size)}
              </span>
              <span className="sftp-col-mtime">
                {entry.mtimeMs ? new Date(entry.mtimeMs).toLocaleString() : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
})

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

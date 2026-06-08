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
import { useProfilesStore } from '../stores/profiles-store'
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
  // Browser-style visit history. `back` holds previously-visited paths (most
  // recent at the end). `forward` holds paths we backed away from and could
  // re-enter (most recent at the end). Normal navigation pushes the OLD path
  // onto `back` and clears `forward`. Back/Forward pop from one stack and
  // push the current path onto the other. History is per-pane and resets
  // when the underlying sessionId changes (Reconnect).
  const [back, setBack] = useState<string[]>([])
  const [forward, setForward] = useState<string[]>([])
  // First navigate after mount/sessionId-change shouldn't push to history —
  // there's no meaningful "previous" location to back into yet.
  const isFirstNavigateRef = useRef(true)
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Anchor for Shift+Click range selection. Set to the most recently clicked
  // entry that wasn't itself a Shift+Click. Cleared whenever the listing
  // changes (navigate / reload) so a stale anchor never spans across a fresh
  // listing's row positions.
  const [anchorName, setAnchorName] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // (sep already computed above from platform store)

  // Write the just-landed-at path back to the profile's lastLocalPath /
  // lastRemotePath so the next session against this profile starts here.
  // No-op for ad-hoc tabs (no profile id) and when the path is unchanged
  // (avoids redundant disk writes when the user navigates back to the same
  // folder repeatedly). Reads from the store fresh so concurrent writes
  // from the sibling pane (the other kind) don't get clobbered.
  const persistLastPath = useCallback(
    (newPath: string) => {
      const tab = useSessionsStore
        .getState()
        .tabs.find((t) => t.sessionId === sessionId)
      const profileId = tab?.profile.id
      if (!profileId) return
      const store = useProfilesStore.getState()
      const current = store.profiles.find((p) => p.id === profileId)
      if (!current) return
      const existing =
        kind === 'local' ? current.lastLocalPath : current.lastRemotePath
      if (existing === newPath) return
      const updated =
        kind === 'local'
          ? { ...current, lastLocalPath: newPath }
          : { ...current, lastRemotePath: newPath }
      void store.update(updated).catch(() => {
        // Persistence is best-effort; a profile-update failure shouldn't
        // disrupt navigation. The next successful navigate will retry.
      })
    },
    [kind, sessionId],
  )

  const navigate = useCallback(
    // `recordHistory` defaults true. Back/Forward call this with false so the
    // pop doesn't push the just-popped path back onto the same stack.
    // `persist` defaults true. The mount-effect's initial/fallback navigates
    // pass false so they don't echo the just-read-from-disk path back to disk
    // (and so the fallback doesn't overwrite a still-valid saved path).
    // Returns true on success, false on error — the mount-effect uses the
    // return value to decide whether to try the default-path fallback.
    async (
      newPath: string,
      opts: { recordHistory?: boolean; persist?: boolean } = {},
    ): Promise<boolean> => {
      const recordHistory = opts.recordHistory ?? true
      const persist = opts.persist ?? true
      // Capture the OLD path BEFORE awaiting the IPC, because by the time
      // setPath() fires, `path` from closure could already be stale if the
      // user navigated again. We push this old value onto `back` only after
      // the IPC succeeds, so a failed navigate doesn't corrupt history.
      const oldPath = path
      // Belt-and-suspenders: zod requires min 1 char on the remote `path`,
      // so refuse to fire an IPC with an empty string. Fall back to '/'.
      const targetPath =
        kind === 'remote' && newPath.trim() === '' ? remoteDefaultPath : newPath
      setError(null)
      setBusy(true)
      try {
        let resolvedPath = targetPath
        if (kind === 'local') {
          const result = await window.api.local.list({ path: targetPath })
          if (result.type === 'drives') {
            resolvedPath = DRIVES_PATH
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
            resolvedPath = result.path
            setPath(result.path)
            setEntries(result.items)
          }
        } else {
          const items = await window.api.sftp.list({ sessionId, path: targetPath })
          // ssh2's sftp.realpath('.') would resolve cwd; we don't expose it.
          // Display '.' as '~' so users see something meaningful.
          resolvedPath = targetPath === '.' ? '~' : targetPath
          setPath(resolvedPath)
          setEntries(items)
        }
        setSelected(new Set())
        setAnchorName(null)
        // Record history only for user-initiated navigation that actually
        // moved somewhere new. Reload (same path) and the first-mount nav
        // are both skipped naturally by these guards.
        if (
          recordHistory &&
          !isFirstNavigateRef.current &&
          oldPath &&
          oldPath !== resolvedPath
        ) {
          setBack((prev) => [...prev, oldPath])
          setForward([])
        }
        if (persist) persistLastPath(resolvedPath)
        isFirstNavigateRef.current = false
        return true
      } catch (err) {
        setError(formatErr(err))
        return false
      } finally {
        setBusy(false)
      }
    },
    [kind, sessionId, path, persistLastPath],
  )

  const goBack = useCallback(() => {
    if (back.length === 0) return
    const target = back[back.length - 1]!
    setBack((prev) => prev.slice(0, -1))
    setForward((prev) => [...prev, path])
    void navigate(target, { recordHistory: false })
  }, [back, path, navigate])

  const goForward = useCallback(() => {
    if (forward.length === 0) return
    const target = forward[forward.length - 1]!
    setForward((prev) => prev.slice(0, -1))
    setBack((prev) => [...prev, path])
    void navigate(target, { recordHistory: false })
  }, [forward, path, navigate])

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

  // Initial path. Reset history too — when the sessionId changes (Reconnect
  // swap-in), the old back/forward entries reference a now-defunct session
  // and shouldn't be navigable.
  //
  // Path-restore: if the tab is backed by a saved profile that has a
  // lastLocalPath / lastRemotePath recorded, try that first. It can fail
  // (path was deleted on the remote, local folder was moved/unmounted),
  // in which case we fall through to the default. We pass `persist: false`
  // on both attempts so the just-read-from-disk value isn't echoed back to
  // disk, and a fallback-to-default doesn't overwrite a still-meaningful
  // saved path the user might want back after fixing the remote.
  useEffect(() => {
    let cancelled = false
    isFirstNavigateRef.current = true
    setBack([])
    setForward([])
    void (async () => {
      try {
        const tab = useSessionsStore
          .getState()
          .tabs.find((t) => t.sessionId === sessionId)
        const profileId = tab?.profile.id
        const profile = profileId
          ? useProfilesStore.getState().profiles.find((p) => p.id === profileId)
          : undefined
        const savedPath =
          kind === 'local' ? profile?.lastLocalPath : profile?.lastRemotePath

        // Resolve the default jumping-off point for this pane.
        const defaultPath = kind === 'local'
          ? await window.api.local.home()
          : '/'

        if (cancelled) return

        if (savedPath && savedPath !== defaultPath) {
          const ok = await navigate(savedPath, { persist: false })
          if (ok || cancelled) return
          // Saved path failed (e.g. removed on remote, local folder moved).
          // The error banner from the failed navigate is briefly visible;
          // clearing it here so the fallback list looks clean.
          setError(null)
        }
        if (!cancelled) await navigate(defaultPath, { persist: false })
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

  // sortedNames is recomputed below; we capture the array on every click via
  // closure over `sorted`, so range math always reflects the current order.
  const handleRowClick = (name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const sortedNames = sorted.map((it) => it.name)
    if (e.shiftKey && anchorName !== null) {
      // Shift+Click: select the contiguous range from the anchor to here in
      // the current sort order. Anchor stays put so successive Shift+Clicks
      // always re-anchor from the same point (matches Explorer / Finder).
      const a = sortedNames.indexOf(anchorName)
      const b = sortedNames.indexOf(name)
      if (a < 0 || b < 0) {
        // Anchor was filtered out somehow — treat as a fresh single-select.
        setSelected(new Set([name]))
        setAnchorName(name)
        return
      }
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      const range = new Set(sortedNames.slice(lo, hi + 1))
      // Ctrl+Shift+Click: union the range into the existing selection rather
      // than replacing it.
      if (e.ctrlKey || e.metaKey) {
        setSelected((prev) => {
          const next = new Set(prev)
          for (const n of range) next.add(n)
          return next
        })
      } else {
        setSelected(range)
      }
      return
    }
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+Click: toggle this row in/out of the selection. Becomes
      // the new anchor regardless of toggle direction.
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        return next
      })
      setAnchorName(name)
      return
    }
    // Plain click: single-select + new anchor.
    setSelected(new Set([name]))
    setAnchorName(name)
  }

  // Select-all helper used by Ctrl+A and (potentially) a future toolbar button.
  const selectAll = useCallback(() => {
    setSelected(new Set(sorted.map((it) => it.name)))
    setAnchorName(sorted[0]?.name ?? null)
  }, [sorted])

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

  // ─── Drag and drop ──────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, entry: FsEntry) => {
    // Standard file-manager drag rule: dragging an item that's part of the
    // current selection drags THE WHOLE selection. Dragging an item that's
    // NOT in the selection drags just that item (and replaces the selection
    // with it, so the drop visually matches what was carried).
    let sourceNames: Set<string>
    if (selected.has(entry.name) && selected.size > 1) {
      sourceNames = new Set(selected)
    } else {
      sourceNames = new Set([entry.name])
      if (!selected.has(entry.name)) {
        setSelected(new Set([entry.name]))
        setAnchorName(entry.name)
      }
    }
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
      return
    }
    // Ctrl+A / Cmd+A select-all. Skip when typing in an input (path bar,
    // rename modal, etc.) so we don't hijack normal text-selection.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      const tgt = e.target as HTMLElement
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA') return
      e.preventDefault()
      selectAll()
      return
    }
    // Letter/number key: jump to the first entry whose name starts with that
    // character (case-insensitive), and on repeated presses of the same key,
    // cycle through every matching entry and loop back to the top. Mirrors the
    // typeahead navigation in Windows Explorer / macOS Finder. Skip when a
    // modifier is held or the user is typing in an input field.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      const tgt = e.target as HTMLElement
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA') return
      e.preventDefault()
      const char = e.key.toLowerCase()
      // All entries starting with this character, in display order.
      const matches = sorted.filter((it) => it.name.toLowerCase().startsWith(char))
      if (matches.length === 0) return
      // If the current single selection is one of the matches, advance to the
      // next (wrapping past the end); otherwise jump to the first match. The
      // selection itself is the cursor, so no extra state is needed to track
      // where we are in the cycle.
      const currentName = selected.size === 1 ? [...selected][0] : null
      const pos = currentName ? matches.findIndex((it) => it.name === currentName) : -1
      const next = matches[(pos + 1) % matches.length]!
      setSelected(new Set([next.name]))
      setAnchorName(next.name)
      const idx = sorted.indexOf(next)
      const rows = paneRef.current?.querySelectorAll<HTMLElement>('.sftp-row:not(.sftp-head)')
      rows?.[idx]?.scrollIntoView({ block: 'nearest' })
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
        <button
          type="button"
          className="icon-btn"
          onClick={goBack}
          disabled={back.length === 0 || isDisconnected}
          title="Back"
          aria-label="Back"
        >
          ←
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={goForward}
          disabled={forward.length === 0 || isDisconnected}
          title="Forward"
          aria-label="Forward"
        >
          →
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={goUp}
          disabled={isDisconnected}
          title="Up to parent"
          aria-label="Up to parent"
        >
          ↑
        </button>
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
              onClick={(e) => handleRowClick(entry.name, e)}
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

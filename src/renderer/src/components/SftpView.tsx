import { useCallback, useRef, useState } from 'react'
import {
  SftpPane,
  type SftpDragSource,
  type SftpPaneAction,
  type SftpPaneHandle,
} from './SftpPane'
import { InputPrompt } from './InputPrompt'
import { usePlatformStore } from '../stores/platform-store'

// Promise-style input prompt — pending resolver lives in state; the modal is
// rendered when set. Used in place of window.prompt() since Electron disables
// the latter for security.
type PromptRequest = {
  title: string
  label?: string
  hint?: string
  initial?: string
  placeholder?: string
  submitLabel?: string
  resolve: (value: string | null) => void
}

type Props = {
  sessionId: string
  isActive: boolean
}

const SPLITTER_DEFAULT_PCT = 50
const SPLITTER_MIN_PCT = 15
const SPLITTER_MAX_PCT = 85

const SEP_REMOTE = '/'

// joinLocal is platform-aware — uses the OS's native separator (provided by
// the main process via the platform store).
function joinLocal(dir: string, name: string, sep: string): string {
  if (dir.endsWith(sep) || dir.endsWith('/') || dir.endsWith('\\')) return dir + name
  return dir + sep + name
}

function joinRemote(dir: string, name: string): string {
  if (dir === '' || dir === '.') return name
  if (dir.endsWith(SEP_REMOTE)) return dir + name
  return dir + SEP_REMOTE + name
}

export function SftpView({ sessionId, isActive }: Props) {
  const [splitPct, setSplitPct] = useState<number>(SPLITTER_DEFAULT_PCT)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const localRef = useRef<SftpPaneHandle | null>(null)
  const remoteRef = useRef<SftpPaneHandle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const localSep = usePlatformStore((s) => s.info.sep)

  // Pending input prompt (replaces window.prompt). One at a time is fine.
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const askInput = useCallback(
    (opts: Omit<PromptRequest, 'resolve'>) =>
      new Promise<string | null>((resolve) => {
        setPrompt({ ...opts, resolve })
      }),
    [],
  )

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      const px = ev.clientX - rect.left
      const pct = (px / rect.width) * 100
      setSplitPct(Math.min(SPLITTER_MAX_PCT, Math.max(SPLITTER_MIN_PCT, pct)))
    }
    const onUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const surface = (err: unknown) => {
    setError(err instanceof Error ? err.message : String(err))
  }

  const handleLocalAction = useCallback(
    async (action: SftpPaneAction) => {
      const local = localRef.current
      const remote = remoteRef.current
      if (!local || !remote) return
      const localPath = local.getPath()
      const selected = local.getSelected()
      try {
        if (action === 'upload') {
          const remotePath = remote.getPath()
          if (selected.length === 0) {
            surface(new Error('Select one or more local files first'))
            return
          }
          if (!remotePath) {
            surface(new Error('Remote pane has no path yet — wait for it to load'))
            return
          }
          for (const entry of selected) {
            const lp = joinLocal(localPath, entry.name, localSep)
            if (entry.isDirectory) {
              await window.api.sftp.uploadFolder({
                sessionId,
                localPath: lp,
                remoteParentPath: remotePath,
              })
            } else {
              const rp = joinRemote(remotePath, entry.name)
              await window.api.sftp.upload({
                sessionId,
                localPath: lp,
                remotePath: rp,
              })
            }
          }
          await remote.reload()
        } else if (action === 'mkdir') {
          surface(new Error('Local mkdir unsupported (use Explorer); use the remote pane to create remote folders.'))
        } else if (action === 'rename') {
          surface(new Error('Local rename unsupported in this phase.'))
        } else if (action === 'delete') {
          if (selected.length === 0) return
          if (!confirm(`Delete ${selected.length} item(s) from local? This is permanent.`)) return
          for (const entry of selected) {
            const target = joinLocal(localPath, entry.name, localSep)
            await window.api.local.delete({
              path: target,
              isDirectory: entry.isDirectory,
            })
          }
          await local.reload()
        }
      } catch (err) {
        surface(err)
      }
    },
    [sessionId, localSep],
  )

  const handleRemoteAction = useCallback(
    async (action: SftpPaneAction) => {
      const local = localRef.current
      const remote = remoteRef.current
      if (!local || !remote) return
      const remotePath = remote.getPath()
      const selected = remote.getSelected()
      try {
        if (action === 'download') {
          const localPath = local.getPath()
          if (selected.length === 0) {
            surface(new Error('Select one or more remote files first'))
            return
          }
          if (!localPath || localPath === '') {
            surface(new Error('Local pane is on the drives view — open a folder there first (e.g. Documents)'))
            return
          }
          for (const entry of selected) {
            const rp = joinRemote(remotePath, entry.name)
            if (entry.isDirectory) {
              await window.api.sftp.downloadFolder({
                sessionId,
                remotePath: rp,
                localParentPath: localPath,
              })
            } else {
              const lp = joinLocal(localPath, entry.name, localSep)
              await window.api.sftp.download({
                sessionId,
                remotePath: rp,
                localPath: lp,
              })
            }
          }
          await local.reload()
        } else if (action === 'mkdir') {
          const name = await askInput({
            title: 'New remote folder',
            label: 'Folder name',
            placeholder: 'my-folder',
            submitLabel: 'Create',
          })
          if (!name?.trim()) return
          const target = joinRemote(remotePath, name.trim())
          await window.api.sftp.mkdir({ sessionId, path: target })
          await remote.reload()
        } else if (action === 'rename') {
          if (selected.length !== 1) return
          const entry = selected[0]
          if (!entry) return
          const next = await askInput({
            title: `Rename ${entry.name}`,
            label: 'New name',
            initial: entry.name,
            submitLabel: 'Rename',
          })
          if (!next || next === entry.name) return
          const fromPath = joinRemote(remotePath, entry.name)
          const toPath = joinRemote(remotePath, next)
          await window.api.sftp.rename({ sessionId, fromPath, toPath })
          await remote.reload()
        } else if (action === 'delete') {
          if (
            !confirm(
              `Delete ${selected.length} item(s) from remote? This cannot be undone.`,
            )
          ) {
            return
          }
          for (const entry of selected) {
            const target = joinRemote(remotePath, entry.name)
            await window.api.sftp.delete({
              sessionId,
              path: target,
              isDirectory: entry.isDirectory,
            })
          }
          await remote.reload()
        } else if (action === 'chmod') {
          if (selected.length !== 1) return
          const entry = selected[0]
          if (!entry) return
          const current = (entry.mode & 0o7777).toString(8)
          const input = await askInput({
            title: `Permissions for ${entry.name}`,
            label: 'Octal mode',
            initial: current,
            hint: 'e.g. 644 for rw-r--r--, 755 for rwxr-xr-x',
            submitLabel: 'Apply',
          })
          if (!input) return
          const parsed = Number.parseInt(input, 8)
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0o7777) {
            surface(new Error(`Invalid octal mode: ${input}`))
            return
          }
          const target = joinRemote(remotePath, entry.name)
          await window.api.sftp.chmod({ sessionId, path: target, mode: parsed })
          await remote.reload()
        }
      } catch (err) {
        surface(err)
      }
    },
    [sessionId, localSep, askInput],
  )

  // ─── Drag-and-drop dispatch ────────────────────────────────────────────
  // A drop on a pane fires this with the source info from dragstart and an
  // optional subfolder name (if the drop landed on a folder row).
  const handleDropOnLocal = useCallback(
    (source: SftpDragSource, subfolder: string | null) => {
      const local = localRef.current
      if (!local) return
      const localBase = local.getPath()
      const targetDir = subfolder ? joinLocal(localBase, subfolder, localSep) : localBase

      if (source.kind === 'local') {
        // Local → Local: not implemented in v1 (use Explorer for local moves)
        surface(new Error('Local-to-local moves: use Explorer for now.'))
        return
      }
      // Remote → Local: download
      void (async () => {
        try {
          if (!targetDir) {
            surface(new Error('Drop target has no path — open a folder first'))
            return
          }
          for (const entry of source.entries) {
            const rp = joinRemote(source.basePath, entry.name)
            if (entry.isDirectory) {
              await window.api.sftp.downloadFolder({
                sessionId,
                remotePath: rp,
                localParentPath: targetDir,
              })
            } else {
              const lp = joinLocal(targetDir, entry.name, localSep)
              await window.api.sftp.download({
                sessionId,
                remotePath: rp,
                localPath: lp,
              })
            }
          }
          await local.reload()
        } catch (err) {
          surface(err)
        }
      })()
    },
    [sessionId, localSep],
  )

  const handleDropOnRemote = useCallback(
    (source: SftpDragSource, subfolder: string | null) => {
      const remote = remoteRef.current
      if (!remote) return
      const remoteBase = remote.getPath()
      const targetDir = subfolder ? joinRemote(remoteBase, subfolder) : remoteBase

      if (source.kind === 'local') {
        // Local → Remote: upload (folders use uploadFolder; files use upload)
        void (async () => {
          try {
            for (const entry of source.entries) {
              const lp = joinLocal(source.basePath, entry.name, localSep)
              if (entry.isDirectory) {
                await window.api.sftp.uploadFolder({
                  sessionId,
                  localPath: lp,
                  remoteParentPath: targetDir,
                })
              } else {
                const rp = joinRemote(targetDir, entry.name)
                await window.api.sftp.upload({
                  sessionId,
                  localPath: lp,
                  remotePath: rp,
                })
              }
            }
            await remote.reload()
          } catch (err) {
            surface(err)
          }
        })()
      } else {
        // Remote → Remote: rename/move within the same SSH session
        if (source.sessionId !== sessionId) {
          surface(new Error('Cross-session SFTP move not supported.'))
          return
        }
        void (async () => {
          try {
            for (const entry of source.entries) {
              const fromPath = joinRemote(source.basePath, entry.name)
              const toPath = joinRemote(targetDir, entry.name)
              if (fromPath === toPath) continue
              await window.api.sftp.rename({ sessionId, fromPath, toPath })
            }
            await remote.reload()
          } catch (err) {
            surface(err)
          }
        })()
      }
    },
    [sessionId, localSep],
  )

  return (
    <div
      ref={containerRef}
      className={`sftp-view ${isActive ? '' : 'hidden'}`}
      style={{ gridTemplateColumns: `${splitPct}% 4px ${100 - splitPct}%` }}
    >
      <SftpPane
        ref={localRef}
        kind="local"
        sessionId={sessionId}
        onAction={handleLocalAction}
        onDrop={handleDropOnLocal}
      />
      <div className="sftp-splitter" onMouseDown={startResize} title="Drag to resize" />
      <SftpPane
        ref={remoteRef}
        kind="remote"
        sessionId={sessionId}
        onAction={handleRemoteAction}
        onDrop={handleDropOnRemote}
      />
      {error && (
        <div
          className="sftp-error sftp-error-floating"
          role="alert"
          onClick={() => setError(null)}
          title="Click to dismiss"
        >
          {error}
        </div>
      )}
      {prompt && (
        <InputPrompt
          title={prompt.title}
          label={prompt.label}
          hint={prompt.hint}
          initial={prompt.initial}
          placeholder={prompt.placeholder}
          submitLabel={prompt.submitLabel}
          onSubmit={(value) => {
            const r = prompt.resolve
            setPrompt(null)
            r(value)
          }}
          onCancel={() => {
            const r = prompt.resolve
            setPrompt(null)
            r(null)
          }}
        />
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { HostKeyPrompt } from './components/HostKeyPrompt'
import { ProfileEditor } from './components/ProfileEditor'
import { PasswordPrompt } from './components/PasswordPrompt'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { SftpView } from './components/SftpView'
import { TabBar } from './components/TabBar'
import { TabModeBar } from './components/TabModeBar'
import { TerminalView } from './components/TerminalView'
import { TransfersPanel } from './components/TransfersPanel'
import { usePlatformStore } from './stores/platform-store'
import { useProfilesStore } from './stores/profiles-store'
import { tabFromProfile, useSessionsStore } from './stores/sessions-store'
import { useSettingsStore } from './stores/settings-store'
import { useTransfersStore } from './stores/transfers-store'
import type { HostKeyPromptEvent, SessionProfile, TabLayout } from '../../shared/types'

// Sidebar width is layout state — kept in renderer-side localStorage rather
// than the IPC-backed settings store. No need to round-trip the main process
// for every drag delta.
const SIDEBAR_WIDTH_KEY = 'cosmicssh.sidebarWidth'
const SIDEBAR_DEFAULT = 260
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 500

function readSidebarWidth(): number {
  const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
  if (!raw) return SIDEBAR_DEFAULT
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return SIDEBAR_DEFAULT
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n))
}

type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; profile: SessionProfile }
  | null

export function App() {
  const tabs = useSessionsStore((s) => s.tabs)
  const activeId = useSessionsStore((s) => s.activeId)
  const addTab = useSessionsStore((s) => s.addTab)
  const closeTab = useSessionsStore((s) => s.closeTab)
  const markClosed = useSessionsStore((s) => s.markClosed)

  const [editor, setEditor] = useState<EditorState>(null)
  const [passwordPrompt, setPasswordPrompt] = useState<SessionProfile | null>(null)
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPromptEvent | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Tab tiling within this window. 'single' = original behavior (only the
  // active tab is shown). Driven by the Window menu's "Tile Tabs …" items.
  const [tabLayout, setTabLayout] = useState<TabLayout>('single')
  const [sidebarWidth, setSidebarWidth] = useState<number>(readSidebarWidth)
  // Mirror live width into a ref so the mouseup persistence reads the latest
  // value without re-creating the drag handler each render.
  const widthRef = useRef(sidebarWidth)
  widthRef.current = sidebarWidth

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = widthRef.current
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      const next = Math.min(
        SIDEBAR_MAX,
        Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)),
      )
      setSidebarWidth(next)
    }
    const onUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const loadSettings = useSettingsStore((s) => s.load)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const theme = useSettingsStore((s) => s.terminal.theme)
  const textColor = useSettingsStore((s) => s.terminal.textColor)
  const loadPlatform = usePlatformStore((s) => s.load)
  const platformLoaded = usePlatformStore((s) => s.loaded)
  useEffect(() => {
    if (!settingsLoaded) void loadSettings()
  }, [settingsLoaded, loadSettings])
  useEffect(() => {
    if (!platformLoaded) void loadPlatform()
  }, [platformLoaded, loadPlatform])

  // Reflect the chosen theme on <html> so the CSS [data-theme="..."] rules
  // take effect across the entire UI.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // View → Settings… in the app menu (also bound to Ctrl+,) opens the
  // existing in-app Settings modal.
  useEffect(() => {
    return window.api.menu.onOpenSettings(() => setShowSettings(true))
  }, [])

  // Window → Tile/Stack Tabs … menu items (Ctrl+Alt+V/H/S).
  useEffect(() => {
    return window.api.menu.onTabLayout((mode) => setTabLayout(mode))
  }, [])

  // User-overridden text color tweaks the --fg variable inline at the root,
  // shadowing the theme's default for as long as it's set. Clearing the
  // override restores the theme value.
  useEffect(() => {
    if (textColor) {
      document.documentElement.style.setProperty('--fg', textColor)
    } else {
      document.documentElement.style.removeProperty('--fg')
    }
  }, [textColor])

  // Global subscriber: keep tab status in sync with main's lifecycle events.
  // Per-terminal close/error rendering still happens inside TerminalView.
  useEffect(() => {
    const offClose = window.api.ssh.onClose((evt) => {
      const detail =
        evt.code !== null
          ? `exit ${evt.code}`
          : evt.signal !== null
            ? `signal ${evt.signal}`
            : 'closed'
      markClosed(evt.sessionId, detail)
    })
    const offError = window.api.ssh.onError((evt) => {
      markClosed(evt.sessionId, `error: ${evt.message}`)
    })
    // Host-key prompts (first-time hosts) and mismatches (potential MITM).
    const offHostPrompt = window.api.ssh.onHostKeyPrompt((evt) => {
      // Stack one at a time. If a second arrives while one is open it'll
      // replace the visible prompt — fine in practice since connects are
      // user-initiated and serial.
      setHostKeyPrompt(evt)
    })
    const offHostMismatch = window.api.ssh.onHostKeyMismatch((evt) => {
      setError(
        `Host key mismatch for ${evt.host}:${evt.port}!\n` +
        `Stored: ${evt.storedKeyType} ${evt.storedFingerprint}\n` +
        `Received: ${evt.presentedKeyType} ${evt.presentedFingerprint}\n` +
        `Connection blocked. If this is a deliberate key rotation, edit ` +
        `%APPDATA%\\CosmicSSH\\known_hosts and remove the stored line.`,
      )
    })
    return () => {
      offClose()
      offError()
      offHostPrompt()
      offHostMismatch()
    }
  }, [markClosed])

  const handleHostKeyResponse = (accept: boolean) => {
    if (!hostKeyPrompt) return
    void window.api.ssh.respondToHostKey({
      requestId: hostKeyPrompt.requestId,
      accept,
    })
    setHostKeyPrompt(null)
  }

  // SFTP transfer events fan out to the global transfers store so the
  // TransfersPanel can render progress/done/error from anywhere. The `started`
  // event is the single source of truth for new entries — every transfer
  // (single-file or one of many in a folder op) emits it from main, so callers
  // don't have to call `beginTransfer` themselves.
  useEffect(() => {
    const t = useTransfersStore.getState()
    const offStarted = window.api.sftp.onStarted((evt) => {
      t.begin({
        id: evt.transferId,
        direction: evt.direction,
        from: evt.from,
        to: evt.to,
        totalBytes: evt.totalBytes,
      })
    })
    const offProgress = window.api.sftp.onProgress((evt) => {
      t.progress(
        evt.transferId,
        evt.bytesTransferred,
        evt.totalBytes,
        evt.bytesPerSecond,
      )
    })
    const offDone = window.api.sftp.onDone((evt) => {
      t.done(evt.transferId)
    })
    const offError = window.api.sftp.onError((evt) => {
      t.error(evt.transferId, evt.message)
    })
    return () => {
      offStarted()
      offProgress()
      offDone()
      offError()
    }
  }, [])

  const surface = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err))
  }, [])

  const handleConnectFromSidebar = useCallback(
    async (profile: SessionProfile) => {
      try {
        const hasCred = await window.api.credentials.has({ profileId: profile.id })
        if (hasCred) {
          const result = await window.api.ssh.connectByProfile({ profileId: profile.id })
          addTab(tabFromProfile(result.sessionId, profile))
        } else {
          setPasswordPrompt(profile)
        }
      } catch (err) {
        surface(err)
      }
    },
    [addTab, surface],
  )

  // Callbacks passed to Sidebar — wrapped in useCallback so the Sidebar
  // (React.memo'd) doesn't re-render whenever any other App-level state
  // (passwordPrompt, hostKeyPrompt, settings, etc.) changes. With dozens of
  // profile rows this was making the password modal's input feel laggy
  // because the renderer was busy reconciling the sidebar tree.
  const handleEditFromSidebar = useCallback(
    (p: SessionProfile) => setEditor({ mode: 'edit', profile: p }),
    [],
  )
  const handleNewProfile = useCallback(() => setEditor({ mode: 'create' }), [])
  const handleOpenSettings = useCallback(() => setShowSettings(true), [])

  const handlePasswordSubmit = async (password: string, savePassword: boolean) => {
    const profile = passwordPrompt
    if (!profile) return
    setPasswordPrompt(null)
    try {
      let target = profile
      if (savePassword !== profile.savePassword) {
        target = await useProfilesStore
          .getState()
          .update({ ...profile, savePassword })
      }
      const result = await window.api.ssh.connectByProfile({
        profileId: target.id,
        passwordOverride: password,
      })
      addTab(tabFromProfile(result.sessionId, target))
    } catch (err) {
      surface(err)
    }
  }

  const handleSaveAndConnect = async (
    saved: SessionProfile,
    password: string | null,
  ) => {
    setEditor(null)
    try {
      const result = await window.api.ssh.connectByProfile({
        profileId: saved.id,
        passwordOverride: password ?? undefined,
      })
      addTab(tabFromProfile(result.sessionId, saved))
    } catch (err) {
      surface(err)
    }
  }

  const handleCloseTab = async (sessionId: string) => {
    try {
      await window.api.ssh.disconnect({ sessionId })
    } catch {
      // disconnect is best-effort; close the tab regardless
    }
    closeTab(sessionId)
  }

  return (
    <div
      className="app-shell"
      style={{ gridTemplateColumns: `${sidebarWidth}px 4px 1fr` }}
    >
      <Sidebar
        onConnect={handleConnectFromSidebar}
        onEdit={handleEditFromSidebar}
        onNewProfile={handleNewProfile}
        onOpenSettings={handleOpenSettings}
      />

      <div
        className="sidebar-resize-handle"
        onMouseDown={startResize}
        title="Drag to resize"
      />

      <main className="main-pane">
        <TabBar onCloseTab={handleCloseTab} />
        {activeId && (
          <TabModeBar key={activeId} sessionId={activeId} />
        )}
        <div className={`terminal-stack layout-${tabLayout}`}>
          {tabs.length === 0 && (
            <EmptyState onNewProfile={() => setEditor({ mode: 'create' })} />
          )}
          {tabs.map((tab) => {
            const isActive = tab.sessionId === activeId
            const hasShell = tab.profile.protocol !== 'sftp-only'
            // In tile modes every tab cell is visible side-by-side. In single
            // mode only the active tab's cell is visible (display:flex/none).
            const tiled = tabLayout !== 'single'
            const visible = tiled || isActive
            return (
              <div
                key={tab.sessionId}
                className={`tab-content ${tab.sessionId === activeId ? 'tab-active' : ''}`}
                style={{ display: visible ? 'flex' : 'none' }}
              >
                {/* Terminal stays mounted across mode switches so scrollback
                    survives — except on SFTP-only profiles where there's no
                    shell channel to attach to. */}
                {hasShell && (
                  <TerminalView
                    sessionId={tab.sessionId}
                    isActive={(tiled || isActive) && tab.mode === 'terminal'}
                  />
                )}
                {/* SFTP mounts only when its mode is selected so the file
                    list isn't fetched until needed. */}
                {tab.mode === 'sftp' && (
                  <SftpView
                    sessionId={tab.sessionId}
                    isActive={tiled || isActive}
                  />
                )}
              </div>
            )
          })}
        </div>
      </main>

      {editor && (
        <ProfileEditor
          mode={editor.mode}
          initial={editor.mode === 'edit' ? editor.profile : undefined}
          onCancel={() => setEditor(null)}
          onSave={() => setEditor(null)}
          onSaveAndConnect={handleSaveAndConnect}
        />
      )}

      {passwordPrompt && (
        <PasswordPrompt
          profile={passwordPrompt}
          onCancel={() => setPasswordPrompt(null)}
          onSubmit={handlePasswordSubmit}
        />
      )}

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {hostKeyPrompt && (
        <HostKeyPrompt
          prompt={hostKeyPrompt}
          onRespond={handleHostKeyResponse}
        />
      )}

      <TransfersPanel />

      {error && (
        <div className="error-toast" role="alert" onClick={() => setError(null)}>
          {error}
          <span className="dismiss"> (click to dismiss)</span>
        </div>
      )}
    </div>
  )
}

function EmptyState({ onNewProfile }: { onNewProfile: () => void }) {
  return (
    <div className="empty-pane">
      <div>
        <h1>CosmicSSH</h1>
        <p className="muted">
          Pick a profile in the sidebar, or
        </p>
        <button type="button" className="primary" onClick={onNewProfile}>
          + New profile
        </button>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { ProfileEditor } from './components/ProfileEditor'
import { PasswordPrompt } from './components/PasswordPrompt'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { TerminalView } from './components/TerminalView'
import { useProfilesStore } from './stores/profiles-store'
import { tabFromProfile, useSessionsStore } from './stores/sessions-store'
import { useSettingsStore } from './stores/settings-store'
import type { SessionProfile } from '../../shared/types'

// Sidebar width is layout state — kept in renderer-side localStorage rather
// than the IPC-backed settings store. No need to round-trip the main process
// for every drag delta.
const SIDEBAR_WIDTH_KEY = 'termbox.sidebarWidth'
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
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  useEffect(() => {
    if (!settingsLoaded) void loadSettings()
  }, [settingsLoaded, loadSettings])

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
    return () => {
      offClose()
      offError()
    }
  }, [markClosed])

  const surface = (err: unknown) => {
    setError(err instanceof Error ? err.message : String(err))
  }

  const handleConnectFromSidebar = async (profile: SessionProfile) => {
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
  }

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
        onEdit={(p) => setEditor({ mode: 'edit', profile: p })}
        onNewProfile={() => setEditor({ mode: 'create' })}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div
        className="sidebar-resize-handle"
        onMouseDown={startResize}
        title="Drag to resize"
      />

      <main className="main-pane">
        <TabBar onCloseTab={handleCloseTab} />
        <div className="terminal-stack">
          {tabs.length === 0 && (
            <EmptyState onNewProfile={() => setEditor({ mode: 'create' })} />
          )}
          {tabs.map((tab) => (
            <TerminalView
              key={tab.sessionId}
              sessionId={tab.sessionId}
              isActive={tab.sessionId === activeId}
            />
          ))}
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
        <h1>TermBox</h1>
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

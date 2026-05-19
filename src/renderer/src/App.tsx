import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FloatingChrome } from './components/FloatingChrome'
import { HostKeyPrompt } from './components/HostKeyPrompt'
import { MenuBar, type MenuDef } from './components/MenuBar'
import { MinimizedStrip } from './components/MinimizedStrip'
import { ProfileEditor } from './components/ProfileEditor'
import { PasswordPrompt } from './components/PasswordPrompt'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { SftpView } from './components/SftpView'
import { TabBar } from './components/TabBar'
import { TerminalView } from './components/TerminalView'
import { TileDivider } from './components/TileDivider'
import { TileHeader } from './components/TileHeader'
import { TransfersPanel } from './components/TransfersPanel'
import { usePlatformStore } from './stores/platform-store'
import { useProfilesStore } from './stores/profiles-store'
import { tabFromProfile, useSessionsStore, type Tab } from './stores/sessions-store'
import { useSettingsStore } from './stores/settings-store'
import { useTransfersStore } from './stores/transfers-store'
import { getEffectiveTerminalBg } from './lib/color-schemes'
import type { HostKeyPromptEvent, SessionProfile, TabLayout } from '../../shared/types'

// Sidebar width is layout state — kept in renderer-side localStorage rather
// than the IPC-backed settings store. No need to round-trip the main process
// for every drag delta.
const SIDEBAR_WIDTH_KEY = 'cosmicssh.sidebarWidth'
const SIDEBAR_VISIBLE_KEY = 'cosmicssh.sidebarVisible'
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

function readSidebarVisible(): boolean {
  // Default visible. Only the explicit string 'false' hides it — anything
  // else (missing key, garbage value) restores the default.
  return localStorage.getItem(SIDEBAR_VISIBLE_KEY) !== 'false'
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
  // When set, the next successful connect via PasswordPrompt should REPLACE
  // this dead session in-place (used by the SFTP-pane Reconnect button)
  // rather than opening a new tab.
  const [reconnectTargetSessionId, setReconnectTargetSessionId] = useState<string | null>(null)
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPromptEvent | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Tab tiling within this window. 'single' = original behavior (only the
  // active tab is shown). Driven by the Window menu's "Tile Tabs …" items.
  // 'mdi' switches to free-form floating sub-windows (see FloatingWindow).
  const [tabLayout, setTabLayout] = useState<TabLayout>('single')
  // Ref on the per-tab content container. FloatingWindow uses this to clamp
  // drag/resize gestures and to re-clamp on container resize.
  const terminalStackRef = useRef<HTMLDivElement | null>(null)
  // MDI-mode actions on the sessions store. ensureFloating lazy-initializes a
  // floating rect for any tab that doesn't have one (cascade default), so a
  // user switching to 'mdi' mid-session gets sensible starting positions.
  const ensureFloating = useSessionsStore((s) => s.ensureFloating)
  const [sidebarWidth, setSidebarWidth] = useState<number>(readSidebarWidth)
  // View → Sidebar (Ctrl+B) toggles this. When false the sidebar + resize
  // handle unmount and the grid collapses to a single column. Sidebar's own
  // internal state (collapsed groups) is reset on hide — acceptable since
  // those expansions are usually quick to redo.
  const [sidebarVisible, setSidebarVisible] = useState<boolean>(readSidebarVisible)
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
  const fontFamily = useSettingsStore((s) => s.terminal.fontFamily)
  const colorScheme = useSettingsStore((s) => s.terminal.colorScheme)
  const sidebarBackground = useSettingsStore((s) => s.terminal.sidebarBackground)
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

  // Window → Tile/Stack Tabs … menu items (Ctrl+Alt+V/H/S/F).
  useEffect(() => {
    return window.api.menu.onTabLayout((mode) => setTabLayout(mode))
  }, [])

  // When in MDI mode, make sure every open tab has a floating rect. New tabs
  // opened while in MDI need a rect too; rects survive layout switches so
  // flipping out to 'single' and back preserves window positions.
  useEffect(() => {
    if (tabLayout !== 'mdi') return
    tabs.forEach((tab, i) => ensureFloating(tab.sessionId, i))
  }, [tabLayout, tabs, ensureFloating])

  // View → Sidebar (Ctrl+B), and the X button in the sidebar header, both
  // route through this. Persist immediately so a crash or app quit preserves
  // the user's choice.
  const toggleSidebar = useCallback(() => {
    setSidebarVisible((v) => {
      const next = !v
      localStorage.setItem(SIDEBAR_VISIBLE_KEY, String(next))
      return next
    })
  }, [])
  const hideSidebar = useCallback(() => {
    setSidebarVisible(false)
    localStorage.setItem(SIDEBAR_VISIBLE_KEY, 'false')
  }, [])
  useEffect(() => {
    return window.api.menu.onToggleSidebar(toggleSidebar)
  }, [toggleSidebar])

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

  // Publish the chosen font as a CSS variable so non-terminal chrome
  // (sidebar, tab labels, etc.) can opt into it via `font-family: var(--ui-font)`.
  // The terminal itself doesn't read this — xterm.js applies the font directly
  // via its options API in TerminalView. Size is intentionally NOT propagated:
  // bumping the terminal font (Ctrl+wheel) shouldn't reflow the sidebar.
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-font', fontFamily)
  }, [fontFamily])

  // Publish --bg-terminal: the actual color xterm is painting (color scheme
  // bg when a scheme is active, otherwise the app theme's bg). The sidebar
  // default and the SFTP window read this so they visually match whatever
  // the terminal looks like.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--bg-terminal',
      getEffectiveTerminalBg(theme, colorScheme),
    )
  }, [theme, colorScheme])

  // Sidebar background override. When the user picks a custom color it wins
  // over --bg-terminal; clearing it falls back to "follow terminal bg".
  useEffect(() => {
    if (sidebarBackground) {
      document.documentElement.style.setProperty('--bg-sidebar-override', sidebarBackground)
    } else {
      document.documentElement.style.removeProperty('--bg-sidebar-override')
    }
  }, [sidebarBackground])

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
          addTab(tabFromProfile(result.sessionId, profile, result.logPath))
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
    const reconnectInto = reconnectTargetSessionId
    setReconnectTargetSessionId(null)
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
      if (reconnectInto) {
        // Swap into the existing (closed) tab; preserves its position + mode.
        replaceSession(reconnectInto, result.sessionId)
      } else {
        addTab(tabFromProfile(result.sessionId, target, result.logPath))
      }
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
      addTab(tabFromProfile(result.sessionId, saved, result.logPath))
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

  // Reconnect a closed tab in place using its profile snapshot. Asks for the
  // password if no saved credential exists. The tab keeps its position and
  // mode (terminal/SFTP) — only the sessionId is swapped.
  const replaceSession = useSessionsStore((s) => s.replaceSession)
  const handleReconnectTab = useCallback(
    async (oldSessionId: string) => {
      const tab = useSessionsStore.getState().tabs.find((t) => t.sessionId === oldSessionId)
      if (!tab) return
      const profileId = tab.profile.id
      if (!profileId) {
        surface(new Error('This tab was opened ad-hoc and cannot be reconnected automatically.'))
        return
      }
      // Look up the live profile (in case it was renamed/edited since connect)
      const profile = useProfilesStore.getState().profiles.find((p) => p.id === profileId)
      if (!profile) {
        surface(new Error('The original profile no longer exists.'))
        return
      }
      // If the tab is still open (user-triggered Reconnect from the tab menu
      // rather than from the SFTP "stale" banner), drop the live session
      // first so we don't leak it on the server.
      if (tab.status === 'open') {
        try {
          await window.api.ssh.disconnect({ sessionId: oldSessionId })
        } catch {
          // best-effort — proceed to reconnect regardless
        }
      }
      try {
        const hasCred = await window.api.credentials.has({ profileId: profile.id })
        if (!hasCred) {
          // Need to ask for password — defer to existing PasswordPrompt flow.
          // Mark which tab we're targeting via a stash; PasswordPrompt's
          // submit handler will swap into that tab.
          setReconnectTargetSessionId(oldSessionId)
          setPasswordPrompt(profile)
          return
        }
        const result = await window.api.ssh.connectByProfile({ profileId: profile.id })
        replaceSession(oldSessionId, result.sessionId)
      } catch (err) {
        surface(err)
      }
    },
    [replaceSession, surface],
  )

  // Open a NEW tab against the same profile this tab was opened from.
  // Lives parallel to the original — does not touch the existing session.
  const handleCloneTab = useCallback(
    async (sessionId: string) => {
      const tab = useSessionsStore.getState().tabs.find((t) => t.sessionId === sessionId)
      if (!tab) return
      const profileId = tab.profile.id
      if (!profileId) {
        surface(new Error('This tab was opened ad-hoc and cannot be cloned.'))
        return
      }
      const profile = useProfilesStore.getState().profiles.find((p) => p.id === profileId)
      if (!profile) {
        surface(new Error('The original profile no longer exists.'))
        return
      }
      // Reuse the sidebar-connect path so password-prompt + DPAPI behave
      // identically to a fresh connect.
      await handleConnectFromSidebar(profile)
    },
    [handleConnectFromSidebar, surface],
  )

  // ─── Menu bar wiring ─────────────────────────────────────────────────────
  // Renderer-local handlers wrap the existing state setters; main-side ones
  // call the IPC dispatcher in main/index.ts. Stable refs via useCallback so
  // the menus prop into <MenuBar> doesn't re-create every render.
  const cmd = useCallback((c: Parameters<typeof window.api.app.menuCommand>[0]) => {
    void window.api.app.menuCommand(c)
  }, [])
  // handleOpenSettings already exists (passed to Sidebar) — reused below for
  // the View → Settings… menu item and the Ctrl+, accelerator.
  const setLayoutSingle = useCallback(() => setTabLayout('single'), [])
  const setLayoutTileV = useCallback(() => setTabLayout('tile-v'), [])
  const setLayoutTileH = useCallback(() => setTabLayout('tile-h'), [])
  const setLayoutMdi = useCallback(() => setTabLayout('mdi'), [])

  const menus = useMemo<MenuDef[]>(
    () => [
      {
        label: 'Edit',
        items: [
          // execCommand still works for cut/copy/paste in form inputs; browser
          // handles the keyboard accelerators directly so we don't re-register
          // them here. xterm captures Ctrl+C/V on the terminal itself.
          { type: 'item', label: 'Cut', accelerator: 'Ctrl+X', onClick: () => document.execCommand('cut') },
          { type: 'item', label: 'Copy', accelerator: 'Ctrl+C', onClick: () => document.execCommand('copy') },
          { type: 'item', label: 'Paste', accelerator: 'Ctrl+V', onClick: () => document.execCommand('paste') },
          { type: 'separator' },
          { type: 'item', label: 'Select All', accelerator: 'Ctrl+A', onClick: () => document.execCommand('selectAll') },
        ],
      },
      {
        label: 'View',
        items: [
          { type: 'item', label: 'Reload', accelerator: 'Ctrl+R', onClick: () => cmd('reload') },
          { type: 'item', label: 'Force Reload', accelerator: 'Ctrl+Shift+R', onClick: () => cmd('force-reload') },
          { type: 'item', label: 'Toggle Developer Tools', accelerator: 'F12', onClick: () => cmd('toggle-devtools') },
          { type: 'separator' },
          { type: 'item', label: 'Actual Size', accelerator: 'Ctrl+0', onClick: () => cmd('reset-zoom') },
          { type: 'item', label: 'Zoom In', accelerator: 'Ctrl++', onClick: () => cmd('zoom-in') },
          { type: 'item', label: 'Zoom Out', accelerator: 'Ctrl+-', onClick: () => cmd('zoom-out') },
          { type: 'separator' },
          { type: 'item', label: 'Toggle Full Screen', accelerator: 'F11', onClick: () => cmd('toggle-fullscreen') },
          { type: 'separator' },
          { type: 'item', label: 'Sidebar', accelerator: 'Ctrl+B', onClick: toggleSidebar },
          { type: 'separator' },
          { type: 'item', label: 'Settings…', accelerator: 'Ctrl+,', onClick: handleOpenSettings },
        ],
      },
      {
        label: 'Window',
        items: [
          { type: 'item', label: 'New Window', accelerator: 'Ctrl+Shift+N', onClick: () => cmd('new-window') },
          { type: 'separator' },
          { type: 'item', label: 'Tile Windows Vertically', onClick: () => cmd('tile-windows-v') },
          { type: 'item', label: 'Tile Windows Horizontally', onClick: () => cmd('tile-windows-h') },
          { type: 'item', label: 'Cascade Windows', onClick: () => cmd('cascade-windows') },
          { type: 'separator' },
          { type: 'item', label: 'Tile Tabs Vertically', accelerator: 'Ctrl+Alt+V', onClick: setLayoutTileV },
          { type: 'item', label: 'Tile Tabs Horizontally', accelerator: 'Ctrl+Alt+H', onClick: setLayoutTileH },
          { type: 'item', label: 'Stack Tabs (single view)', accelerator: 'Ctrl+Alt+S', onClick: setLayoutSingle },
          { type: 'item', label: 'Floating Windows (MDI)', accelerator: 'Ctrl+Alt+F', onClick: setLayoutMdi },
          { type: 'separator' },
          { type: 'item', label: 'Minimize', onClick: () => cmd('window-minimize') },
          { type: 'item', label: 'Close', onClick: () => cmd('window-close') },
        ],
      },
      {
        label: 'Help',
        items: [
          { type: 'item', label: 'About CosmicSSH', onClick: () => cmd('show-about') },
        ],
      },
    ],
    [cmd, handleOpenSettings, toggleSidebar, setLayoutSingle, setLayoutTileV, setLayoutTileH, setLayoutMdi],
  )

  // Keyboard accelerators that used to fire via the native menu. Capture-phase
  // so xterm doesn't swallow Ctrl+B / Ctrl+Alt+X as a control sequence before
  // we see it. preventDefault on the ones we handle stops the browser default
  // (e.g., Ctrl+R reload happens via our IPC, not Chromium's reload).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      const key = e.key
      const lower = key.toLowerCase()
      // F-keys (no modifier needed)
      if (key === 'F11') { e.preventDefault(); cmd('toggle-fullscreen'); return }
      if (key === 'F12') { e.preventDefault(); cmd('toggle-devtools'); return }
      if (!ctrl) return
      // Ctrl+Alt+… → tab-layout commands. Order matters: check alt-bearing
      // shortcuts BEFORE plain Ctrl+letter so Ctrl+Alt+V doesn't fall through
      // to "no handler".
      if (e.altKey && !e.shiftKey) {
        if (lower === 'v') { e.preventDefault(); setLayoutTileV(); return }
        if (lower === 'h') { e.preventDefault(); setLayoutTileH(); return }
        if (lower === 's') { e.preventDefault(); setLayoutSingle(); return }
        if (lower === 'f') { e.preventDefault(); setLayoutMdi(); return }
        return
      }
      if (e.altKey) return // any other alt-bearing combo is not ours
      // Ctrl(+Shift)+…
      if (e.shiftKey) {
        if (lower === 'n') { e.preventDefault(); cmd('new-window'); return }
        if (lower === 'r') { e.preventDefault(); cmd('force-reload'); return }
        return
      }
      // Plain Ctrl+letter / Ctrl+punctuation
      if (lower === 'b') { e.preventDefault(); toggleSidebar(); return }
      if (key === ',') { e.preventDefault(); handleOpenSettings(); return }
      if (lower === 'r') { e.preventDefault(); cmd('reload'); return }
      if (key === '0') { e.preventDefault(); cmd('reset-zoom'); return }
      if (key === '=' || key === '+') { e.preventDefault(); cmd('zoom-in'); return }
      if (key === '-' || key === '_') { e.preventDefault(); cmd('zoom-out'); return }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [cmd, handleOpenSettings, toggleSidebar, setLayoutSingle, setLayoutTileV, setLayoutTileH, setLayoutMdi])

  // Chrome buttons (sidebar, tab bar, tab-mode bar) shouldn't steal keyboard
  // focus from the xterm textarea underneath. Without this guard, clicking a
  // tab/profile/mode button moves focus to that <button>, and the next
  // Space/Enter is consumed by the browser's button-activation behavior
  // instead of being sent to the SSH stream. Symptom: spacebar appears dead
  // in the terminal until the user clicks back inside the grid — and gets
  // worse with multiple windows because every cross-window switch tends to
  // start with a click on chrome.
  //
  // `preventDefault` on mousedown blocks the focus move only; the subsequent
  // `click` event still fires normally, so the button still does its thing.
  // Keyboard a11y is unaffected — keyboard activation (Tab + Enter/Space)
  // doesn't go through mousedown.
  //
  // Modals (.modal) and context menus (.context-menu) are deliberately
  // excluded — their buttons SHOULD take focus so e.g. Enter on a primary
  // action works, and Escape can dismiss.
  const handleChromeMouseDownCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null
    if (!target) return
    const button = target.closest('button')
    if (!button) return
    if (button.closest('.modal, .context-menu')) return
    if (!button.closest('.sidebar, .tab-bar')) return
    e.preventDefault()
  }

  return (
    <div className="app-root" onMouseDownCapture={handleChromeMouseDownCapture}>
      <MenuBar menus={menus} />
      <div
        className="app-shell"
        style={{
          gridTemplateColumns: sidebarVisible
            ? `${sidebarWidth}px 4px 1fr`
            : '1fr',
        }}
      >
      {sidebarVisible && (
        <>
          <Sidebar
            onConnect={handleConnectFromSidebar}
            onEdit={handleEditFromSidebar}
            onNewProfile={handleNewProfile}
            onOpenSettings={handleOpenSettings}
            onHide={hideSidebar}
          />

          <div
            className="sidebar-resize-handle"
            onMouseDown={startResize}
            title="Drag to resize"
          />
        </>
      )}

      <main className="main-pane">
        {/* The global TabBar is only useful in layouts where not every tab
            is on screen. In tile modes each tile carries its own TileHeader,
            and in MDI each floating window has its own titlebar — showing
            the bar above them would just duplicate every tab. */}
        {(tabLayout === 'single' || tabLayout === 'mdi') && (
          <TabBar
            onCloseTab={handleCloseTab}
            onReconnect={handleReconnectTab}
            onClone={handleCloneTab}
          />
        )}
        <div
          ref={terminalStackRef}
          className={`terminal-stack layout-${tabLayout}`}
        >
          {tabs.length === 0 && (
            <EmptyState onNewProfile={() => setEditor({ mode: 'create' })} />
          )}
          {tabs.map((tab, i) => {
            const cell = (
              <TabCell
                key={tab.sessionId}
                tab={tab}
                isActive={tab.sessionId === activeId}
                tabLayout={tabLayout}
                containerRef={terminalStackRef}
                onCloseTab={handleCloseTab}
                onReconnect={handleReconnectTab}
              />
            )
            // In tile modes, drop a draggable divider between every adjacent
            // pair so the user can redistribute the row/column. Single and
            // MDI layouts don't get dividers — single shows one tab at a
            // time, MDI windows are free-form.
            const showDivider =
              i > 0 && (tabLayout === 'tile-v' || tabLayout === 'tile-h')
            if (!showDivider) return cell
            const prev = tabs[i - 1]!
            return (
              <Fragment key={`pair-${tab.sessionId}`}>
                <TileDivider
                  containerRef={terminalStackRef}
                  orientation={tabLayout === 'tile-v' ? 'v' : 'h'}
                  aId={prev.sessionId}
                  bId={tab.sessionId}
                />
                {cell}
              </Fragment>
            )
          })}
        </div>
        {tabLayout === 'mdi' && <MinimizedStrip />}
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
    </div>
  )
}

// Per-tab cell. ONE .tab-content div per tab, independent of layout — the
// MDI chrome and the tile header are siblings of the terminal/SFTP content
// inside that div, never wrappers. This is the structural invariant that
// keeps xterm scrollback alive across layout switches: React only swaps the
// chrome around the terminal, not the wrapper containing it, so TerminalView
// never unmounts.
//
// Per-cell subscription to the floating rect means dragging one window in
// MDI mode only re-renders that cell, not the whole tabs.map().
type TabCellProps = {
  tab: Tab
  isActive: boolean
  tabLayout: TabLayout
  containerRef: React.RefObject<HTMLDivElement>
  onCloseTab: (sessionId: string) => void
  onReconnect: (sessionId: string) => void
}

function TabCell({
  tab,
  isActive,
  tabLayout,
  containerRef,
  onCloseTab,
  onReconnect,
}: TabCellProps) {
  const rect = useSessionsStore((s) => s.floating[tab.sessionId])
  // Per-tile flex weight. Subscribed so TileDivider drags re-render only
  // the cells that changed (this cell + its neighbour).
  const tileWeight = useSessionsStore(
    (s) => s.tileWeights[tab.sessionId] ?? 1,
  )
  const bringToFront = useSessionsStore((s) => s.bringToFront)
  const setActive = useSessionsStore((s) => s.setActive)

  const mdi = tabLayout === 'mdi'
  const tiled = tabLayout !== 'single' && !mdi
  const visible = mdi || tiled || isActive
  const hasShell = tab.profile.protocol !== 'sftp-only'

  // Compute the wrapping div's style based on layout. In MDI the div becomes
  // a positioned floating box (left/top/w/h from rect, z-index for stacking,
  // display:none while minimized). In tile mode the div is a flex cell whose
  // share of the row/column is driven by tileWeight. In single mode only
  // the active tab is visible.
  const style: React.CSSProperties = mdi && rect
    ? {
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex: rect.z,
        display: rect.minimized ? 'none' : 'flex',
      }
    : tiled
      ? { display: 'flex', flex: `${tileWeight} 1 0` }
      : { display: visible ? 'flex' : 'none' }

  // In MDI, any pointerdown anywhere on the cell brings it to front and
  // activates the tab — same UX the old FloatingWindow had.
  const onPointerDown = mdi
    ? () => {
        bringToFront(tab.sessionId)
        setActive(tab.sessionId)
      }
    : undefined

  const className = [
    'tab-content',
    isActive ? 'tab-active' : '',
    mdi ? 'tab-content-floating' : '',
    tiled ? 'tab-content-tiled' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      style={style}
      onPointerDown={onPointerDown}
      // data-session-id lets TileDivider find this cell via DOM query at
      // gesture start (needed to read the starting widths/heights for the
      // weight-redistribution math). Cheap; stamped in all layouts.
      data-session-id={tab.sessionId}
    >
      {/* Chrome (MDI titlebar OR tile header) renders as a sibling of inner.
          When neither is shown (single mode) the inner takes the full cell. */}
      {mdi && (
        <FloatingChrome
          sessionId={tab.sessionId}
          title={tab.profile.name}
          containerRef={containerRef}
          onClose={() => onCloseTab(tab.sessionId)}
        />
      )}
      {tiled && (
        <TileHeader
          tab={tab}
          isActive={isActive}
          onClose={onCloseTab}
          onReconnect={onReconnect}
        />
      )}
      {/* TerminalView stays mounted across mode switches AND layout switches —
          its React position inside .tab-content is stable, only the chrome
          siblings change. SFTP-only profiles skip the terminal. */}
      {hasShell && (
        <TerminalView
          sessionId={tab.sessionId}
          isActive={visible && tab.mode === 'terminal'}
        />
      )}
      {tab.mode === 'sftp' && (
        <SftpView
          sessionId={tab.sessionId}
          isActive={visible}
          onReconnect={() => onReconnect(tab.sessionId)}
        />
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

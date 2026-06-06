import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, screen } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BUILD_DATE_DISPLAY, BUILD_VERSION } from './build-info'
import { AppMenuCommandSchema, TitleBarColorSchema, validate } from './ipc-schemas'
import { registerIpcHandlers } from './ipc-handlers'
import { resolveStorageDir } from './storage-dir'
import {
  IPC_APP_MENU_COMMAND,
  IPC_WINDOW_SET_TITLE_BAR_OVERLAY,
  type AppMenuCommand,
} from '../shared/types'

// Relocate userData to live next to the .exe (portable layout) BEFORE any
// store is constructed. ProfileStore / SettingsStore / CredentialVault /
// KnownHostsStore all derive their paths from `app.getPath('userData')`, so
// a single setPath here moves everything in one go. Must run before
// `registerIpcHandlers()` below since that constructs the stores. Dev mode
// is left on the default %APPDATA% — see storage-dir.ts for why.
app.setPath('userData', resolveStorageDir(app.getPath('userData')))

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

// Resolve the runtime icon path. In dev/unpacked mode the file lives at
// <repo>/resources/icon.{png,ico} (two levels up from dist/main). In packaged
// builds electron-builder copies it into the app's resources dir per the
// `extraResources` entry in electron-builder.yml. We accept either extension
// and only set the BrowserWindow option when the file actually exists.
function resolveIconPath(): string | undefined {
  const dir = app.isPackaged
    ? process.resourcesPath
    : join(__dirname, '../../resources')
  for (const name of ['icon.png', 'icon.ico']) {
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function createWindow(): void {
  const iconPath = resolveIconPath()
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: '#0f0f10',
    // Hide the native OS title bar so our custom TitleBar.tsx fills that area
    // with the correct chrome background. On Windows, titleBarOverlay keeps the
    // close/minimise/maximise buttons (Windows Controls Overlay). On Linux the
    // bar simply disappears — acceptable for the secondary target.
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: '#131317',     // matches dark-theme --bg-sidebar default
            symbolColor: '#cccccc',
            height: 32,
          },
        }
      : {}),
    // No native menu — the renderer ships its own themable menu bar via
    // MenuBar.tsx. autoHideMenuBar:true keeps Alt from re-summoning the
    // (now empty) OS menu strip and stealing a row of vertical space.
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  appWindows.add(win)
  win.on('closed', () => appWindows.delete(win))

  win.once('ready-to-show', () => win.show())

  // Surface preload load errors instead of letting them vanish silently
  // (sandboxed preloads otherwise fail without any visible message).
  win.webContents.on('preload-error', (_e, preloadPath, err) => {
    // eslint-disable-next-line no-console
    console.error(`[preload-error] ${preloadPath}: ${err.message}\n${err.stack ?? ''}`)
  })

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Tracked set of OUR app windows. We don't use BrowserWindow.getAllWindows()
// because that also includes the detached DevTools BrowserWindow in dev mode
// — tiling would resize it alongside the main window, which is never what
// the user wants.
const appWindows = new Set<BrowserWindow>()

// Window-arrangement helpers used by the Window menu. They operate on the
// primary display's `workArea` (which excludes the taskbar). Minimized and
// destroyed windows are skipped so a minimized window isn't yanked back
// into view.
function arrangeableWindows(): BrowserWindow[] {
  return [...appWindows].filter(
    (w) => !w.isDestroyed() && !w.isMinimized(),
  )
}

// Tile/cascade helpers. Use the display the *first* window currently sits on
// as the reference (handles multi-monitor: if all your CosmicSSH windows are
// on monitor 2, they'll tile on monitor 2, not the primary). Each window is
// explicitly unmaximized/unfullscreened/made resizable before setSize +
// setPosition — sometimes setBounds is silently rejected if the window is
// in a snapped or maximized state on Windows.

function referenceWorkArea(wins: BrowserWindow[]): Electron.Rectangle {
  const first = wins[0]!
  const display = screen.getDisplayNearestPoint({
    x: first.getBounds().x + 1,
    y: first.getBounds().y + 1,
  })
  return display.workArea
}

function prepWindow(win: BrowserWindow): void {
  if (win.isFullScreen()) win.setFullScreen(false)
  if (win.isMaximized()) win.unmaximize()
  if (!win.isResizable()) win.setResizable(true)
  if (win.isMinimized()) win.restore()
}

function applyBounds(
  win: BrowserWindow,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  prepWindow(win)
  // setSize/setPosition individually is more reliable on Windows when the
  // window is freshly unmaximized — setBounds in one call sometimes no-ops.
  win.setSize(width, height)
  win.setPosition(x, y)
}

function maybeHintNoWindows(label: string): boolean {
  const wins = arrangeableWindows()
  if (wins.length >= 2) return false
  void dialog.showMessageBox({
    type: 'info',
    title: `${label} needs at least two windows`,
    message: `Open another window first (Window → New Window, or Ctrl+Shift+N), then ${label.toLowerCase()} will arrange them side-by-side.`,
    buttons: ['OK'],
    noLink: true,
  })
  return true
}

function tileVertically(): void {
  if (maybeHintNoWindows('Tile Vertically')) return
  const wins = arrangeableWindows()
  const area = referenceWorkArea(wins)
  const w = Math.floor(area.width / wins.length)
  wins.forEach((win, i) => {
    applyBounds(win, area.x + i * w, area.y, w, area.height)
  })
}

function tileHorizontally(): void {
  if (maybeHintNoWindows('Tile Horizontally')) return
  const wins = arrangeableWindows()
  const area = referenceWorkArea(wins)
  const h = Math.floor(area.height / wins.length)
  wins.forEach((win, i) => {
    applyBounds(win, area.x, area.y + i * h, area.width, h)
  })
}

function cascade(): void {
  const wins = arrangeableWindows()
  if (wins.length === 0) return
  const area = referenceWorkArea(wins)
  const offset = 30
  const w = Math.max(640, Math.floor(area.width * 0.7))
  const h = Math.max(480, Math.floor(area.height * 0.7))
  wins.forEach((win, i) => {
    applyBounds(win, area.x + i * offset, area.y + i * offset, w, h)
    win.focus()
  })
}

// Standalone About dialog — used to live as a Help menu item; the renderer's
// MenuBar invokes this via the app:menu-command IPC since the native menu
// no longer exists. Body unchanged from the old menu wiring.
export function showAboutDialog(): void {
  const iconPath = resolveIconPath()
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : undefined

  void dialog.showMessageBox({
    type: 'info',
    title: 'About CosmicSSH',
    message: 'CosmicSSH',
    detail:
      `Personal SSH/SFTP client for Windows · May 2026\n` +
      `Version ${BUILD_VERSION} — built ${BUILD_DATE_DISPLAY}\n\n` +
      `Features\n` +
      `  • Multi-tab SSH terminals (xterm.js, 256-color)\n` +
      `  • Dual-pane SFTP with drag-and-drop transfers\n` +
      `  • Folder upload / download with progress + ETA\n` +
      `  • Private-key auth (OpenSSH, with passphrase)\n` +
      `  • Host-key verification (SHA256 fingerprints + known_hosts)\n` +
      `  • Jump-host (ProxyJump) chains, multiple levels\n` +
      `  • SSH-only and SFTP-only connection modes\n` +
      `  • Multi-window with Tile / Cascade\n` +
      `  • Session profiles in folders, F2 rename, right-click menu\n` +
      `  • CSV import / export of sessions\n` +
      `  • Encrypted credential storage (Windows DPAPI)\n` +
      `  • Themes (Dark / Light / Blue), custom text color,\n` +
      `    Ctrl+wheel font zoom\n\n` +
      `Created by Janardhan Srinivasan\n` +
      `Janardhan.Srinivasan@gmail.com`,
    buttons: ['OK'],
    noLink: true,
    ...(icon ? { icon } : {}),
  })
}

const { sessions: sessionManager, logger: sessionLogger } = registerIpcHandlers()

// Windows uses AppUserModelId to group taskbar entries and pick which icon
// to show. Without this, taskbar may show electron.exe's default icon even
// when BrowserWindow.icon is set. Must be called before the first window.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.shriramjana.cosmicssh')
}

// Renderer → main menu dispatcher. The renderer's MenuBar calls
// `window.api.app.menuCommand(cmd)` and we map each command to the
// existing helpers (createWindow / tileVertically / etc.) plus the
// per-window methods on the sender's WebContents/BrowserWindow.
ipcMain.handle(IPC_APP_MENU_COMMAND, (event, raw) => {
  const cmd: AppMenuCommand = validate(AppMenuCommandSchema, raw)
  const wc = event.sender
  const win = BrowserWindow.fromWebContents(wc)
  switch (cmd) {
    case 'new-window':
      createWindow()
      return
    case 'tile-windows-v':
      tileVertically()
      return
    case 'tile-windows-h':
      tileHorizontally()
      return
    case 'cascade-windows':
      cascade()
      return
    case 'show-about':
      showAboutDialog()
      return
    case 'reload':
      wc.reload()
      return
    case 'force-reload':
      wc.reloadIgnoringCache()
      return
    case 'toggle-devtools':
      wc.toggleDevTools()
      return
    case 'reset-zoom':
      wc.setZoomLevel(0)
      return
    case 'zoom-in':
      wc.setZoomLevel(wc.getZoomLevel() + 0.5)
      return
    case 'zoom-out':
      wc.setZoomLevel(wc.getZoomLevel() - 0.5)
      return
    case 'toggle-fullscreen':
      if (win) win.setFullScreen(!win.isFullScreen())
      return
    case 'window-minimize':
      if (win) win.minimize()
      return
    case 'window-close':
      if (win) win.close()
      return
  }
})

// Returns true when a #rrggbb colour has enough brightness that black symbols
// are legible on it (used to pick the WCO button icon colour).
function isLightColor(hex: string): boolean {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return false
  const n = parseInt(m[1]!, 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5
}

ipcMain.handle(IPC_WINDOW_SET_TITLE_BAR_OVERLAY, (event, raw) => {
  if (process.platform !== 'win32') return
  const color = validate(TitleBarColorSchema, raw)
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  const bg = color ?? '#131317'
  win.setTitleBarOverlay({
    color: bg,
    symbolColor: isLightColor(bg) ? '#000000' : '#cccccc',
    height: 32,
  })
})

void app.whenReady().then(() => {
  // The renderer's MenuBar provides the menu now; remove Electron's default
  // app menu so we don't end up with two stacked menu bars.
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Flush + close any active session logs first so partial transcripts get
  // their footer line on disk before the SSH disconnect tears the streams
  // down (otherwise the very last server output might still be queued in
  // a TCP buffer when we abort).
  sessionLogger.closeAll()
  sessionManager.disconnectAll()
})

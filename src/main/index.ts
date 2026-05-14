import { app, BrowserWindow, Menu, dialog, nativeImage, screen } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BUILD_DATE_DISPLAY, BUILD_VERSION } from './build-info'
import { registerIpcHandlers } from './ipc-handlers'

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

// Replace Electron's default app menu so:
//   - View has an extra "Settings…" item that opens the in-app modal
//   - Help has only our custom "About CosmicSSH" entry (no Learn More etc.)
function buildAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CommandOrControl+,',
          click: (_item, focusedWindow) => {
            // Send the message to whichever window the user is looking at.
            // Fall back to the first window if focus is detached.
            const target = focusedWindow ?? BrowserWindow.getAllWindows()[0]
            target?.webContents.send('menu:open-settings')
          },
        },
      ],
    },
    {
      label: 'Window',
      role: 'window',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CommandOrControl+Shift+N',
          click: () => createWindow(),
        },
        { type: 'separator' },
        // OS-window arrangement (across all open CosmicSSH windows)
        { label: 'Tile Windows Vertically', click: tileVertically },
        { label: 'Tile Windows Horizontally', click: tileHorizontally },
        { label: 'Cascade Windows', click: cascade },
        { type: 'separator' },
        // In-window tab arrangement (within the focused window)
        {
          label: 'Tile Tabs Vertically',
          accelerator: 'CommandOrControl+Alt+V',
          click: (_item, focusedWindow) => {
            const target = focusedWindow ?? BrowserWindow.getAllWindows()[0]
            target?.webContents.send('menu:tab-layout', 'tile-v')
          },
        },
        {
          label: 'Tile Tabs Horizontally',
          accelerator: 'CommandOrControl+Alt+H',
          click: (_item, focusedWindow) => {
            const target = focusedWindow ?? BrowserWindow.getAllWindows()[0]
            target?.webContents.send('menu:tab-layout', 'tile-h')
          },
        },
        {
          label: 'Stack Tabs (single view)',
          accelerator: 'CommandOrControl+Alt+S',
          click: (_item, focusedWindow) => {
            const target = focusedWindow ?? BrowserWindow.getAllWindows()[0]
            target?.webContents.send('menu:tab-layout', 'single')
          },
        },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'About CosmicSSH',
          click: () => {
            // Load the app icon for the dialog. Falls back to default if not
            // found. nativeImage handles PNG natively; on Windows it also
            // resizes appropriately for the message-box icon slot.
            const iconPath = resolveIconPath()
            const icon = iconPath
              ? nativeImage.createFromPath(iconPath)
              : undefined

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
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const sessionManager = registerIpcHandlers()

// Windows uses AppUserModelId to group taskbar entries and pick which icon
// to show. Without this, taskbar may show electron.exe's default icon even
// when BrowserWindow.icon is set. Must be called before the first window.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.shriramjana.cosmicssh')
}

void app.whenReady().then(() => {
  buildAppMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  sessionManager.disconnectAll()
})

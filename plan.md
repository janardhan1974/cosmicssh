# Project: TermBox — Personal SSH/SFTP Client for Windows

A production-quality, distributable SSH and SFTP client for personal use on Windows 10/11. Inspired by MobaXterm but stripped to the essentials.

## Target User

Single developer (me) on a Windows ThinkPad. Connects to corporate jump hosts, OpenShift clouds, and RunPod cloud instances. Must coexist with Zscaler proxy and corporate endpoint security.

## Tech Stack — DO NOT DEVIATE WITHOUT ASKING

- **Electron 30+** (main + renderer + preload, contextIsolation on, nodeIntegration off)
- **Vite + React 18 + TypeScript 5** for renderer
- **xterm.js** (`@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-web-links` + `@xterm/addon-search`)
- **ssh2** (npm package, v1.15+) for SSH and SFTP — the Node-native one, NOT ssh2-streams
- **keytar** for encrypted credential storage (Windows Credential Manager backend)
- **electron-store** for non-sensitive config (session list, settings, window state)
- **electron-builder** for packaging (NSIS installer for Windows)
- **Tailwind CSS v4** for styling (I prefer dark/editorial aesthetics, no purple gradients)
- **Zustand** for renderer state management (NOT Redux)
- **react-arborist** or **@tanstack/react-virtual** for the file tree if needed

## Architecture — Strict IPC Boundaries

```
┌────────────────────────────────────────────────────────────┐
│ Main Process (Node)                                         │
│  ├── SSH session manager (ssh2 Client instances)            │
│  ├── SFTP session manager (per-SSH client SFTP subsystem)   │
│  ├── Credential vault (keytar wrapper)                      │
│  ├── Session profile store (electron-store, encrypted)      │
│  └── IPC handlers (ipcMain.handle for invoke/respond)       │
├────────────────────────────────────────────────────────────┤
│ Preload (contextBridge)                                     │
│  └── Exposes typed `window.api` surface only                │
├────────────────────────────────────────────────────────────┤
│ Renderer (React)                                            │
│  ├── Session tabs, terminal panes (xterm.js)                │
│  ├── SFTP dual-pane file browser                            │
│  └── Settings + session manager UI                          │
└────────────────────────────────────────────────────────────┘
```

**Rule**: The renderer NEVER imports `ssh2`, `keytar`, `fs`, or `child_process` directly. Everything goes through the preload bridge.

## Milestones

Build in this order. Do not start a milestone until the previous one runs end-to-end on Windows.

### M0: Scaffold (target: working "hello world" Electron app)

- [ ] Init repo with `npm create vite@latest` for the renderer, then layer Electron on top manually. Do NOT use electron-vite or similar — I want to understand the wiring.
- [ ] Folder structure:
  ```
  /src
    /main          # Electron main process
    /preload       # contextBridge
    /renderer      # React app (Vite)
    /shared        # Types shared between main and renderer
  /resources       # Icons, installer assets
  /scripts         # Build/dev helpers
  ```
- [ ] TypeScript strict mode everywhere. Separate tsconfig per process.
- [ ] Dev workflow: `npm run dev` starts Vite + Electron with HMR for renderer, restart-on-change for main.
- [ ] CI sanity: `npm run build` produces an unpacked Electron app that launches and shows "Hello".
- [ ] Verify on actual Windows 10/11. Stop and confirm with me before continuing.

### M1: One working SSH session

- [ ] Add `ssh2` to main process. Create `SshSessionManager` class.
- [ ] IPC: `ssh:connect(profile) → sessionId`, `ssh:write(sessionId, data)`, `ssh:resize(sessionId, cols, rows)`, `ssh:disconnect(sessionId)`. Events: `ssh:data`, `ssh:close`, `ssh:error` via `webContents.send`.
- [ ] Renderer: one xterm.js pane wired to one session. Hardcoded test host for now (I'll provide it later — use `localhost:22` to a WSL instance during dev).
- [ ] Password auth only at this milestone. Key auth comes in M2.
- [ ] **Acceptance test**: I can open the app, click Connect, enter host/user/password, and get a working bash prompt where vim, htop, and tmux render correctly. If escape sequences are broken, fix before moving on.
- [ ] Test specifically with ConPTY-related quirks on Windows. xterm.js needs `windowsMode: false` because the remote PTY is Linux, not local Windows.

### M2: Auth methods that matter

- [ ] Private key auth: support OpenSSH format (`id_ed25519`, `id_rsa`), with passphrase prompt via modal.
- [ ] Path picker for key file. Default scan of `%USERPROFILE%\.ssh\`.
- [ ] SSH agent integration on Windows: support both **Pageant** (PuTTY) via named pipe `\\.\pipe\pageant` AND **OpenSSH ssh-agent** via `\\.\pipe\openssh-ssh-agent`. `ssh2` supports agent forwarding — wire `agent` option correctly per agent type.
- [ ] Host key verification: on first connect, prompt to accept fingerprint. Store accepted keys in `known_hosts`-style file under `%APPDATA%\TermBox\known_hosts`. On mismatch, BLOCK connection with a loud warning (this is a real security boundary, don't make it easy to bypass).
- [ ] Acceptance: I can connect with a key + passphrase to a real remote host.

### M3: Session profiles + credential vault

- [ ] Session profile schema (in `/src/shared/types.ts`):
  ```typescript
  type SessionProfile = {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    authMethod: 'password' | 'key' | 'agent';
    keyPath?: string;
    jumpHost?: string; // references another profile id
    group?: string;    // for folder organization in sidebar
    createdAt: number;
    lastUsedAt?: number;
  }
  ```
- [ ] CRUD UI for profiles. Sidebar tree with groups (e.g., "OpenShift clouds", "Personal", "RunPod").
- [ ] Passwords NEVER stored in the profile JSON. Use keytar: `service: 'termbox', account: profile.id`.
- [ ] Passphrases for keys: optional save to keytar, or prompt every time (user choice per profile).
- [ ] Import from `~/.ssh/config` on Windows (`%USERPROFILE%\.ssh\config`). Parse Host blocks, ProxyJump directives, IdentityFile paths. Show preview before importing.
- [ ] Acceptance: I can save 5 profiles, restart the app, and reconnect to any of them with one click.

### M4: Tabs, splits, and multi-session

- [ ] Tab bar at top. Each tab = one SSH session. Closeable, reorderable (drag).
- [ ] Keyboard shortcuts: Ctrl+T new tab (opens session picker), Ctrl+W close, Ctrl+Tab cycle, Ctrl+1..9 jump to tab N.
- [ ] Split pane support (horizontal + vertical). Each pane is its own session (independent connections — do not multiplex over one SSH client unless I ask).
- [ ] Sessions persist across app restarts as "recently used", but DO NOT auto-reconnect on launch unless user opts in per profile.

### M5: Jump hosts (ProxyJump)

- [ ] `ssh2` supports nested connections — open Client A, then use A's `forwardOut` to tunnel Client B's TCP stream.
- [ ] UI: in profile editor, pick another profile as the jump host. Support chained jumps (A → B → C) — at least 2 levels deep.
- [ ] This is critical for my work. Test against a real jump host before declaring done.

### M6: SFTP file browser

- [ ] Open SFTP subsystem on the active SSH client (`client.sftp()`). One SFTP session per SSH connection, reused across operations.
- [ ] Dual-pane UI: left = local Windows filesystem, right = remote. Resizable splitter.
- [ ] Local pane: use Node `fs` via IPC. Show drives, navigate folders, sort by name/size/date.
- [ ] Remote pane: `sftp.readdir`, `sftp.stat`. Handle symlinks (resolve with `lstat` and show indicator).
- [ ] File operations (remote): rename, delete (with confirm), mkdir, chmod (via numeric input).
- [ ] Drag-and-drop:
  - Local file → remote pane = upload (with progress bar, queued if multiple)
  - Remote file → local pane = download
  - Within remote pane = move (use `sftp.rename`)
- [ ] Large file transfers: use `sftp.fastGet` / `sftp.fastPut` with concurrent chunks. Show progress, ETA, throughput.
- [ ] Resume on interrupted transfer: track byte offset, support partial transfer continuation.
- [ ] Edit-in-place: double-click remote text file → download to temp → open in default editor → watch for changes → re-upload on save. Use `chokidar` for file watching.

### M7: Reconnect + resilience

- [ ] Detect dropped connections (Zscaler likes to kill idle sessions). On `'close'` or `'error'`, show a non-blocking banner in the affected tab with a Reconnect button.
- [ ] Keepalive: enable `ssh2` `keepaliveInterval` (default 30s) on connect. Make configurable per profile.
- [ ] Auto-reconnect (opt-in per profile): retry with exponential backoff (1s, 2s, 4s, 8s, 16s, give up). Preserve scrollback in the terminal across reconnects (xterm.js buffer stays, just append a "── reconnected ──" line).

### M8: Settings + theming

- [ ] Settings page: font family + size, terminal theme (provide 4–5 presets: One Dark, Solarized Dark, Gruvbox Dark, plus a custom obsidian/earthy default), cursor style, bell behavior, scrollback lines.
- [ ] Keybinding customization (basic — just remap the existing shortcuts, not full Vim/Emacs mode).
- [ ] Per-profile overrides: a profile can override font/theme for context (e.g., red theme for prod).
- [ ] Persist via electron-store. Apply live without restart.

### M9: Error handling + observability

- [ ] All connection errors surface in-UI with actionable messages, not stack traces:
  - "Connection refused" → check host/port
  - "Authentication failed" → password/key wrong
  - "Host key mismatch" → security warning with fingerprint comparison
  - "Network unreachable" → check VPN/Zscaler
- [ ] Local log file at `%APPDATA%\TermBox\logs\termbox.log` with rotation (use `electron-log`). Log levels: error/warn/info, no debug spam in production builds.
- [ ] "Open logs folder" menu item under Help.
- [ ] Crash reporter: capture uncaught exceptions in main + renderer, write to log, show user a "something went wrong" dialog with a Copy Details button.

### M10: Packaging + distribution

- [ ] electron-builder config in `electron-builder.yml`:
  - Target: `nsis` (Windows installer) and `portable` (single .exe for sideloading)
  - App ID: `com.shriramjana.termbox`
  - Per-machine install option in NSIS
  - Icon: provide a clean SVG that builds to .ico (I'll handle the actual icon design — leave a placeholder)
- [ ] Code signing: leave config stubbed for signing later. Document the cert acquisition steps in `BUILD.md`.
- [ ] Auto-updater: integrate `electron-updater` with a GitHub Releases feed. Disabled by default for v1 — confirm with me before enabling.
- [ ] Build commands:
  - `npm run build` → production bundle
  - `npm run dist` → installer in `/release`
  - `npm run dist:portable` → portable .exe
- [ ] Verify the installer runs on a clean Windows VM without dev tools installed.

## Things I Explicitly DO NOT Want in v1

- X11 forwarding (rabbit hole, requires bundling/detecting VcXsrv)
- Port forwarding UI (the SSH library supports it; expose it in v1.1)
- Telnet, RDP, VNC, serial — SSH and SFTP only
- Built-in text editor — defer to system default
- Cloud sync of profiles
- Multi-user features
- A plugin system
- Themes beyond the 4–5 presets above
- An icon library beyond `lucide-react`

## Coding Conventions

- TypeScript strict, no `any` without a comment explaining why
- Async/await over `.then` chains
- Use `zod` for runtime validation of IPC payloads — every `ipcMain.handle` validates input before doing anything
- Errors thrown from main → caught in renderer → shown to user. Never silently swallow.
- React: functional components + hooks only. No class components.
- File naming: `kebab-case.ts` for modules, `PascalCase.tsx` for components
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`)
- Tests: write Vitest unit tests for the SSH session manager and credential vault. Don't bother testing UI components in v1.

## Security Non-Negotiables

- Passwords/passphrases ONLY in keytar, never in JSON config
- contextIsolation: true, nodeIntegration: false, sandbox: true where possible
- All IPC inputs validated with zod
- Host key verification is mandatory — no "skip verification" toggle
- No `shell: true` in any `child_process` call
- Disable Electron remote module entirely
- CSP on the renderer: no inline scripts, no eval, only local resources

## Definition of Done for v1

I should be able to:

1. Install TermBox from an NSIS installer on a fresh Windows 11 machine
2. Import my `~/.ssh/config`, see all my hosts grouped sensibly
3. Connect to a corporate jump host with a key + passphrase
4. ProxyJump through it to an internal OpenShift cloud
5. Run vim, htop, tmux without rendering issues
6. Open an SFTP pane, drag a 500MB file from Windows to remote, see progress, have it actually arrive intact
7. Close my laptop lid, reopen 20 minutes later, see the dropped-connection banner, click Reconnect, and resume work
8. Quit the app, relaunch, and reconnect to the same host with one click

If all 8 work without bugs on Windows 11, v1 ships.

## How to Work With Me

- Stop at the end of every milestone and confirm before starting the next.
- If a dependency choice in the stack list above is wrong for Windows specifically, raise it as a question — don't silently swap.
- Show me the `package.json` and the IPC type surface in `/src/shared/types.ts` whenever they change.
- If you discover a Windows-specific gotcha (ConPTY, path handling, line endings, code signing weirdness), document it in `NOTES.md` as you go.
- Prefer fewer dependencies over more. If you're about to add a package, ask first unless it's already in the stack list above.

Start with M0. Confirm the scaffold works on Windows before touching M1.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**CosmicSSH** (repo name `mobajana`, package `cosmicssh`) — a personal Electron SSH/SFTP client for Windows 10/11 (Linux secondary). Specced in `plan.md` (read it before doing anything substantive), with running implementation notes in `NOTES.md` and packaging notes in `BUILD.md`. Milestones M0–M6 (plus partial M8) are done; M7/M9/M10 are partly in.

Inspired by MobaXterm but stripped to essentials: SSH terminals (xterm.js), dual-pane SFTP with drag-and-drop, ProxyJump chains, host-key verification, encrypted credential vault, session profiles. No telnet/RDP/VNC, no X11 forwarding, no plugin system — see plan.md "Things I Explicitly DO NOT Want".

## Working principles

1./ Think before coding
Don't assume. Don't hide confusion. State ambiguity explicitly. Present multiple interpretations rather than silently picking one. Push back if a simpler approach exists. Stop and ask rather than guess.

2./ Simplicity first
No features beyond what was asked. No abstractions for single-use code. No "flexibility" that wasn't requested. No error handling for impossible scenarios. The test: would a senior engineer say this is overcomplicated? If yes, rewrite it.

3./ Surgical changes
Don't "improve" adjacent code. Don't refactor things that aren't broken. Match the existing style even if you'd do it differently. If you notice unrelated dead code, mention it, don't delete it. Every changed line should trace directly to the request.

4./ Goal-driven execution
Transform "fix the bug" into "write a test that reproduces it, then make it pass." Transform "add validation" into "write tests for invalid inputs, then make them pass." Give it success criteria and watch it loop until done.

## Commands

```powershell
npm run dev            # Vite + tsc -w (main, preload) + Electron, all via scripts/dev.mjs
npm run build          # prebuild → tsc main + tsc preload + vite build, output to dist/
npm run typecheck      # tsc --noEmit across all three tsconfigs
npm start              # run the already-built app (does not rebuild)

npm run dist           # full Windows build → NSIS installer + portable .exe in release/
npm run dist:installer # NSIS only
npm run dist:portable  # portable only
npm run dist:linux     # AppImage + .deb (run on Linux host)
```

No test runner is wired up (plan.md M-section asks for Vitest on SSH manager / credential vault; not yet added). No linter configured. **Typecheck is the only static gate** — run it before declaring work done.

### Build versioning

`scripts/write-build-info.mjs` runs as `prebuild`. It overwrites `src/main/build-info.ts` with the current date as `BUILD_VERSION` (e.g. `"05.15.2026"`). The diff on that file after every build is expected noise — don't try to revert it. The `version` field in `package.json` is separately used by electron-builder for installer artifact filenames.

### Zscaler / corporate TLS

If `npm install` fails on Electron's postinstall with `unable to get local issuer certificate`, set `NODE_OPTIONS=--use-system-ca` (Node 24+) or `NODE_EXTRA_CA_CERTS` to the Zscaler root (older Node). See NOTES.md "Zscaler / corporate TLS interception".

## Architecture

Three TS compilation targets, three runtimes. Strict IPC boundary between them.

```
src/main/      → tsc (CommonJS, Node)     → dist/main/index.js
src/preload/   → tsc (CommonJS, sandboxed) → dist/preload/index.js
src/renderer/  → vite (ESM, browser)       → dist/renderer/
src/shared/    → emitted by both tsc:main and tsc:preload (idempotent)
```

`package.json` `"main": "dist/main/index.js"` is the Electron entry. The renderer loads from `VITE_DEV_SERVER_URL` in dev, `dist/renderer/index.html` in production.

### Main process (`src/main/`)

`index.ts` creates BrowserWindows with `contextIsolation: true, nodeIntegration: false, sandbox: true` — never relax these. It builds the app menu (View/Window/Help) and owns the tile/cascade window-arrangement helpers. `registerIpcHandlers()` (in `ipc-handlers.ts`) returns the `SshSessionManager`; on `before-quit` it disconnects all sessions.

Stateful managers, one per concern:

- **`SshSessionManager`** — owns `ssh2.Client` instances keyed by `sessionId` (UUID). Supports jump-host chains: outer hop's `forwardOut()` produces a `Duplex` passed as `sock` to the inner client's connect. Hops close in reverse order on session end. Sftp-only profiles set `withShell: false` and skip the shell channel.
- **`sftp-session-manager.ts`** — one SFTP subsystem per SSH client, reused across operations. Per-file transfers go through `fastGet`/`fastPut`; folder uploads/downloads walk the tree and queue per-file transfers, emitting `transfer-started`/`-progress`/`-done`/`-error` events with a `transferId` the renderer correlates against.
- **`credential-vault.ts`** — uses Electron's `safeStorage` (DPAPI on Windows), NOT keytar. Plan said keytar; this is a deliberate deviation (NOTES.md "safeStorage instead of keytar"). Ciphertext bytes are written to `%APPDATA%\CosmicSSH\credentials.json` keyed by profileId.
- **`profile-store.ts`** / **`settings-store.ts`** — `electron-store@^8` (pinned to v8 because v9+ went ESM-only and we're CJS in main). Profiles in `profiles.json` (non-secret only); settings in `settings.json`.
- **`known-hosts.ts`** — host-key verification gate. First-time key fires `ssh:hostkey-prompt` to the renderer; mismatch fires `ssh:hostkey-mismatch` and the connection is rejected. **No skip toggle exists by design** (plan.md security non-negotiables). The verifier callback contract is in `ssh-session-manager.ts` as `HostVerifierGate`.
- **`local-fs-manager.ts`** — `local:list/home/reveal/delete/platform` for the local pane of the SFTP browser.
- **`ipc-schemas.ts`** — zod schemas. **Every `ipcMain.handle` validates input with these before doing anything.** Zod lives only in main because the sandboxed preload can't load third-party modules (see below).

### Preload (`src/preload/index.ts`)

**Sandboxed preload constraint** (the single biggest footgun in this codebase, hit twice — see NOTES.md M1 and M3):

With `sandbox: true` the preload can `require` only:
- Electron modules
- A handful of Node built-ins (`events`, `timers`, `url`)
- **Not** third-party packages (`zod`, `ssh2`, …)
- **Not** relative project files (`require('../shared/types')`)

`type` imports are fine (erased at compile time). **Runtime values are not** — so the IPC channel string literals are duplicated between `src/shared/types.ts` (exported as `IPC_*` constants for the main side) and the inlined `CH` object in `src/preload/index.ts`. **If you add or rename a channel, you MUST touch both files.** IPC silently misses otherwise. A bundled preload (esbuild) would fix this; not yet done.

`win.webContents.on('preload-error', ...)` is wired in `main/index.ts` because sandboxed preload errors otherwise vanish silently and surface as `window.api is undefined` in the renderer.

### Renderer (`src/renderer/src/`)

React 18 + TS strict + Vite 5. Zustand stores in `src/renderer/src/stores/`:
- `sessions-store` — open tabs + active tab id; tabs survive across switches (each `TerminalView` mounts on first appearance and stays mounted, toggling `display: none`)
- `profiles-store`, `settings-store`, `platform-store`, `transfers-store`

`TerminalView` uses xterm v6 (`@xterm/xterm` + addon-fit + addon-web-links + addon-search). **Do NOT set `windowsMode`** — that option was removed in v6; the v6 replacement (`windowsPty`) is for local Windows ConPTY, which we never use (every PTY is a remote Linux shell). Default options are correct. A `ResizeObserver` on the terminal host calls `FitAddon.fit()` on layout changes (sidebar drag, tab tiling) and propagates `cols/rows` back through `ssh:resize`.

Tab tiling within a window (`tabLayout`: `'single' | 'tile-v' | 'tile-h'`) is driven by the Window menu and applies across all open tabs in that window. Window-level tiling (across multiple BrowserWindows) is separate, handled in `main/index.ts` (`tileVertically`/`tileHorizontally`/`cascade`).

Sidebar width is renderer-local — `localStorage` (`cosmicssh.sidebarWidth`), not IPC + electron-store. Pure layout state, no need to round-trip main on every drag delta.

### `src/shared/types.ts`

The single source of truth for the IPC surface. Defines:
- All channel string constants (`IPC_*`)
- Payload types (`ConnectPayload`, `SftpListPayload`, …)
- Event types (`TransferProgressEvent`, `HostKeyPromptEvent`, …)
- Domain types (`SessionProfile`, `TerminalSettings`, `FsEntry`, …)
- The `Api` interface exposed via `contextBridge` as `window.api` in the renderer

**Must not import third-party runtime deps** (the preload bug above) — types only, plus string constants.

## Conventions (from plan.md, still binding)

- TypeScript strict everywhere. `no any` without a comment explaining why.
- Async/await over `.then` chains.
- Every `ipcMain.handle` validates its input with the corresponding `ipc-schemas.ts` schema before doing anything.
- React: functional components + hooks only. No class components.
- File naming: `kebab-case.ts` for modules, `PascalCase.tsx` for components.
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`).
- Errors thrown from main → surface in the renderer with actionable messages, not stack traces. Never silently swallow.

## Security non-negotiables (do not relax without explicit ask)

- Passwords/passphrases ONLY via `safeStorage` (or keytar if migrated later), never in JSON config or in `profiles.json`.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — all three, all windows.
- All IPC inputs validated with zod.
- Host-key verification is mandatory. The `hostVerifierGate` is the chokepoint; do not add a bypass toggle.
- No `shell: true` in any `child_process` call.

## Dependency policy

Prefer fewer dependencies. The stack list in plan.md "Tech Stack — DO NOT DEVIATE WITHOUT ASKING" is binding for new additions. The two deviations already in tree are documented:
- **safeStorage instead of keytar** — Electron-native, no native rebuild needed.
- **electron-store pinned to v8** — v9+ is ESM-only and the main process is CJS.

If `ssh2`'s native modules (`cpu-features`, `sshcrypto.node`) become a perf bottleneck (currently pure-JS fallback, fine for interactive shells), run `npx electron-builder install-app-deps` before `dist` — not wired yet. See NOTES.md / BUILD.md.

## Userdata layout (Windows)

```
<exe-dir>\                    # packaged builds — see resolution below
  CosmicSSH.exe
  app\                        # <data-dir>
    profiles.json             # non-secret SessionProfile[]
    credentials.json          # { profileId: base64-DPAPI-ciphertext }
    settings.json             # TerminalSettings
    known_hosts               # accepted host-key fingerprints
    sessions\                 # session logs (see "Session logging" below)
    Cache/, GPUCache/, ...    # Electron's own caches (move with userData)
```

`<data-dir>` is resolved in `src/main/storage-dir.ts` and applied via a single
`app.setPath('userData', ...)` at startup (before stores are constructed —
they all derive from `app.getPath('userData')`):

- **Packaged portable build** (`npm run dist:portable`) — `<PORTABLE_EXECUTABLE_DIR>/app/`.
  The portable target is a self-extracting wrapper; `app.getPath('exe')`
  returns the *temp extraction folder* and must NOT be used for this case.
- **Packaged NSIS install** — `<exe-dir>/app/`, if writable (perUser install
  at `%LOCALAPPDATA%\Programs\CosmicSSH\`). If unwritable (perMachine
  install in `C:\Program Files\` without admin), falls back to
  `%APPDATA%\CosmicSSH\` with a console warning, so saves don't silently
  drop on disk.
- **Dev / `npm start`** — `%APPDATA%\CosmicSSH\` unchanged (no `app/`
  suffix). We don't write next to `node_modules\electron\dist\electron.exe`
  because reinstalls wipe that path, and `%APPDATA%` is already dedicated
  so adding `/app` inside it just lengthens the path for no benefit.

The `app/` nesting in packaged builds is for tidiness — the exe folder
ends up with just the .exe + one subfolder, instead of a dozen bare JSON
files and Electron's cache directories spilling next to the .exe. The
subdir name is the `APP_SUBDIR` constant at the top of `storage-dir.ts`;
renaming it relocates everything on next launch with no migration.

There is NO migration from the old `%APPDATA%\CosmicSSH\` location to the
new exe-dir location — pre-existing data stays in APPDATA and the packaged
app starts fresh. Copy files manually if you want them carried over.

Wiping the data dir fully resets the app for that Windows user.

## Session logging

Two complementary capture paths, both writing to `<data-dir>/sessions/`:

1. **Streaming capture** (`src/main/session-logger.ts` `SessionLogger.start`):
   per-session append-mode file opened at connect time when the profile has
   `logSession: true`. `ipc-handlers.ts` tees every `onData` chunk into the
   logger, which strips ANSI escapes (`ANSI_REGEX`) and control chars
   (BEL/BS/DEL), normalizes CRLF→LF, and writes. Captures both server
   output and user-typed commands (the remote shell echoes the latter).
   Stopped on `IPC_SSH_DISCONNECT`, on the SSH `close` event, and on
   `before-quit` (footer-writing is idempotent).

2. **Scrollback dump** (`SessionLogger.saveScrollback`): one-shot dump of
   xterm's already-rendered buffer text. Triggered from the TabBar
   right-click menu "Save scrollback to file…". Renderer reads the buffer
   via `lib/terminal-registry.ts` (which TerminalView registers into on
   mount), ships the plain text over `logging:save-scrollback`, and main
   writes it with a header. No ANSI in the input — xterm already stripped
   it during parse.

Filename pattern: `<sanitized-profile-name>_DDMMYYYY_HHMM.txt` (streaming)
or `..._scrollback.txt` (dump). Collisions get a numeric suffix
(`_2`, `_3`, …). Note the date is **DDMMYYYY**, not ISO order, per the
spec — sorts within a day but not across months.

Limitations:
- `sftp-only` profiles cannot enable session logging — no shell channel
  exists. ProfileEditor disables the checkbox when protocol is sftp-only.
- DCS/SOS/PM/APC framings (sixel, kitty graphics) are not handled — their
  payloads leak through as plain text. Fine for human-readable logs.
- Logs do NOT survive a renderer crash mid-chunk (the chunk hadn't reached
  main yet), but DO survive a renderer crash for everything received up to
  that point (writes are sync, fd is in main).

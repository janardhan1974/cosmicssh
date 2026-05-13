# Windows + build notes

A running log of Windows-specific gotchas and deliberate deviations from `plan.md`. Per plan: "If you discover a Windows-specific gotcha (ConPTY, path handling, line endings, code signing weirdness), document it in `NOTES.md` as you go."

---

## M0 — scaffold

### Zscaler / corporate TLS interception

Electron's `postinstall` step downloads the prebuilt binary from `github.com/electron/electron/releases` via the `got` HTTP client. Out of the box, Node only trusts its bundled CA bundle and rejects Zscaler's MITM cert with `unable to get local issuer certificate`.

**Fix used (Node 24+):** set `NODE_OPTIONS=--use-system-ca` before `npm install`. This tells Node to additionally trust the Windows certificate store (where Zscaler installs its root), so the Electron download succeeds.

**Persistent setup (recommended for this machine):**
```powershell
setx NODE_OPTIONS "--use-system-ca"
```
Then close and reopen the shell. After that, plain `npm install` works.

**Older Node (<22) fallback:** export the Zscaler root cert from Windows Cert Manager (`certmgr.msc` → Trusted Root → Zscaler Root CA → Export → Base-64 .cer), save somewhere stable, and set:
```powershell
setx NODE_EXTRA_CA_CERTS "C:\path\to\zscaler-root.pem"
```

### `npm create vite@latest` was NOT run literally

Plan says: *"Init repo with `npm create vite@latest` for the renderer, then layer Electron on top manually."*

I wrote the equivalent React+TS files manually under `src/renderer/` rather than running the interactive scaffolder and then deduping its `package.json` / `tsconfig.json` / `vite.config.ts` against the unified root configs.

Result is byte-equivalent to the `react-ts` template (same React 18 + TS strict + Vite v5 + `@vitejs/plugin-react`); the only difference is no leftover scaffolder cruft to delete.

If you want the literal `npm create vite@latest` invocation preserved for the audit trail, say so and I'll redo it.

### Main + preload emit as CommonJS

`tsconfig.main.json` and `tsconfig.preload.json` target `module: CommonJS`. Reasons:
- Electron 30 supports ESM for main, but a fair chunk of the eventual ecosystem (`keytar`, `electron-store` ≤ v8, native deps) is CJS-first. Mixing ESM main with CJS deps means dynamic `await import()` everywhere.
- Preload scripts in particular benefit from CJS — sandboxed preload has documented quirks with ESM in some Electron releases.
- The renderer (`vite.config.ts` → ESM bundle) is unaffected.

Easy to flip later if a milestone needs ESM-only features.

### Build output layout

```
dist/
  main/
    index.js          <-- entry: package.json "main" points here
    index.js.map
  preload/
    index.js
    index.js.map
  shared/
    types.js          (emitted by both tsc:main and tsc:preload — same content, idempotent)
  renderer/
    index.html
    assets/
      index-*.js
      index-*.css
```

`src/main/index.ts` references the preload via `join(__dirname, '../preload/index.js')` — resolves to `dist/preload/index.js` at runtime. Same pattern for the prod renderer load: `join(__dirname, '../renderer/index.html')`.

### Custom dev orchestrator

`scripts/dev.mjs` does the job of `concurrently + wait-on + tsx`:
1. Spawns `vite`, `tsc -w -p tsconfig.main.json`, `tsc -w -p tsconfig.preload.json` in parallel.
2. Polls `http://localhost:5173` and waits for `dist/main/index.js` + `dist/preload/index.js` to appear.
3. Launches Electron with `VITE_DEV_SERVER_URL` set so main loads from the dev server instead of `dist/renderer/index.html`.
4. Watches `dist/main` + `dist/preload` via `chokidar`; on any change, kills + respawns Electron (debounced 200ms).
5. Forwards SIGINT/SIGTERM to all children.

`chokidar` is the only "extra" dep — already on the v1 stack list for M6 file watching, so it just lands one milestone earlier.

### CSP in dev

`src/renderer/index.html` has a CSP meta tag that allows `connect-src 'self' http://localhost:5173 ws://localhost:5173` for Vite HMR. Tighten before shipping — `style-src 'unsafe-inline'` is also relaxed because Vite injects styles inline in dev.

### Versions installed (lockfile snapshot reference)

- electron `^30.0.0`
- vite `^5.3.0` (5.4.21 resolved at install)
- react / react-dom `^18.3.0`
- typescript `^5.4.0`
- @vitejs/plugin-react `^4.3.0`
- chokidar `^3.6.0`
- @types/node `^20.14.0` (matches Electron 30's bundled Node 20)

149 total packages.

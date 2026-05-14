# Building JaiJak for Windows

This document covers producing distributable `.exe` artifacts. For day-to-day development see `plan.md` (M0 has the dev workflow).

---

## Quick start

From the repo root in PowerShell:

```powershell
# One-time, if you haven't already:
$env:NODE_OPTIONS = "--use-system-ca"   # for Zscaler / corporate TLS
npm install

# Produce both NSIS installer + portable .exe
npm run dist
```

Outputs land in `release/`:

- `release/JaiJak-Setup-0.0.1-x64.exe` — wizard installer (Start Menu + desktop shortcut, uninstaller registered)
- `release/JaiJak-0.0.1-x64-portable.exe` — single-file portable, no install

You can also build either target alone:

```powershell
npm run dist:installer   # NSIS only
npm run dist:portable    # portable only
```

---

## What gets bundled

`electron-builder` reads `electron-builder.yml` and:

1. Runs `npm run build` first (compiles main, preload, renderer to `dist/`).
2. Bundles `dist/`, `package.json`, and the production `node_modules` into an asar archive.
3. Wraps that with the Electron runtime.
4. For NSIS: wraps the runtime in an installer shell.
5. For portable: produces a self-extracting executable that unpacks to a temp dir on first run.

Final installer size: roughly 80–110 MB. Portable is similar (it embeds the same payload).

---

## Distributing to friends

### 1. Send them the file

Either output works. The portable `.exe` is friendliest — no install, just double-click.

### 2. They will see a SmartScreen warning

Until the binary is **code-signed**, Windows shows:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognized app from starting. Running this app might put your PC at risk.

They need to click **More info** → **Run anyway**.

This is normal for any unsigned `.exe`. To make it disappear, you need code signing (next section).

### 3. First-run state

`%APPDATA%\JaiJak\` will be created on first launch and hold:

```
%APPDATA%\JaiJak\
  profiles.json       # session metadata (no secrets)
  credentials.json    # DPAPI-encrypted passwords (opaque to other Windows users)
  settings.json       # font, etc.
```

Friends can wipe this folder to fully reset the app.

---

## Code signing (deferred — currently stubbed)

The plan requires code signing; the build is wired but no cert is configured. To enable later:

### Option A: standard OV cert (~$200–400/yr)

- Buy from DigiCert, Sectigo, SSL.com, etc.
- You'll receive a `.pfx` file + password.
- SmartScreen reputation accumulates as users run the binary; the warning eventually disappears (weeks to months).

### Option B: EV cert (~$500+/yr) — instant SmartScreen trust

- Same providers, more verification steps (you'll get a USB hardware token).
- New binaries skip SmartScreen warnings immediately.

### Wiring once you have a cert

Drop the `.pfx` somewhere outside the repo (e.g. `C:\Users\<you>\codesign\jaijak.pfx`) and in PowerShell before running the dist command:

```powershell
$env:CSC_LINK = "C:\Users\janardha\codesign\jaijak.pfx"
$env:CSC_KEY_PASSWORD = "<the cert password>"
npm run dist
```

`electron-builder` automatically picks up `CSC_LINK` and `CSC_KEY_PASSWORD`. Or uncomment the `certificateFile` block in `electron-builder.yml`.

EV / hardware-token signing typically requires switching to `azure-trusted-signing` or running the signer manually after `electron-builder` produces the unsigned `.exe` — out of scope here, document inline when you go that route.

---

## Auto-updates (deferred)

`publish: null` in `electron-builder.yml`. The plan defers this for v1 ("confirm with me before enabling"). When ready:

```yaml
# electron-builder.yml
publish:
  provider: github
  owner: janardhan1974
  repo: mobajana
```

Then add `electron-updater` as a runtime dep, wire it into the main process, and use `gh release create` (or electron-builder's `--publish always`) to push artifacts to GitHub Releases.

---

## Known build-time gotchas on Windows

### Zscaler / corporate TLS

`npm install` will fail Electron's post-install download with `unable to get local issuer certificate` unless Node trusts the Windows cert store:

```powershell
setx NODE_OPTIONS "--use-system-ca"
```

Then close and reopen the shell. Already documented in NOTES.md.

### Native modules not rebuilt

`ssh2` ships optional native modules (`cpu-features`, `sshcrypto.node`) for hardware-accelerated AES. We don't run `@electron/rebuild` after `npm install`, so they fall back to pure JS. Performance is fine for interactive shells. If SFTP throughput in M6 turns out to bottleneck on this, add:

```powershell
npx electron-builder install-app-deps
```

before `dist`, and the native deps will be compiled against Electron's Node ABI.

### Antivirus / Defender slowing the build

Real-time scanning hammers `electron-builder` (it shuffles thousands of small files into the asar). If a build takes much more than a couple of minutes, consider adding `release/` and `node_modules/` to your Defender exclusions.

---

## Verifying a build before sending it

1. Run the portable `.exe` from a clean directory (not the repo).
2. Confirm:
   - Window opens.
   - You can create a profile, save it.
   - Reopening the app, the profile persists.
   - You can connect through it (smoke test against a real host).
3. Open `%APPDATA%\JaiJak\` and confirm the JSON files were created.
4. Check `Control Panel → Programs and Features` (NSIS only) — JaiJak should be listed and uninstallable.

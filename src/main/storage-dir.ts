// Resolves the directory used for persistent app data (profiles.json,
// credentials.json, settings.json, known_hosts, sessions/, Electron's own
// caches).
//
// In packaged builds we store data under an `app/` subdirectory next to the
// user-visible .exe so the layout is portable — drop the folder on a USB
// stick and it carries its profiles — without cluttering the exe folder
// with bare JSON files and Electron's caches. Result on disk:
//
//     CosmicSSH/
//       CosmicSSH.exe
//       app/                ← <-- userData
//         profiles.json
//         credentials.json
//         settings.json
//         known_hosts
//         sessions/
//         Cache/, GPUCache/, Local Storage/, ...
//
// In dev we leave the default %APPDATA% location alone, because in dev
// `app.getPath('exe')` points at `node_modules\electron\dist\electron.exe`
// which gets wiped on reinstall. (And %APPDATA%\CosmicSSH\ is already a
// dedicated folder — adding /app inside it would just make the path longer
// for no benefit.)
//
// Three packaged-build cases we handle distinctly:
//   1. Portable build (`npm run dist:portable`): electron-builder's portable
//      target is a self-extracting wrapper. At runtime it unpacks the app to
//      a temp folder, so `app.getPath('exe')` returns THAT temp dir — NOT
//      the folder where the user placed the .exe. electron-builder exposes
//      the user-visible directory via the `PORTABLE_EXECUTABLE_DIR` env var.
//   2. NSIS installed build (`npm run dist:installer`) into a writable dir
//      (e.g. perUser install at %LOCALAPPDATA%\Programs\CosmicSSH\): write
//      under `app/` next to the .exe.
//   3. NSIS installed build into Program Files (perMachine, non-admin user):
//      exe dir is read-only. Falling back to the default keeps the app
//      working instead of silently losing every profile save.

import { app } from 'electron'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Subdirectory under the exe folder where all app data lives. Keeps the
// .exe's own folder tidy (just the .exe + this one folder). Changing the
// name here moves the entire data tree on next launch — handle migration
// explicitly if you ever rename this.
const APP_SUBDIR = 'app'

export function resolveStorageDir(defaultDir: string): string {
  // Dev / `npm start`: leave userData alone.
  if (!app.isPackaged) return defaultDir

  // electron-builder portable target — env var holds the user-visible folder.
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  if (portableDir) {
    const target = join(portableDir, APP_SUBDIR)
    if (isWritable(target)) return target
    // eslint-disable-next-line no-console
    console.warn(
      `[storage] ${target} is not writable; falling back to ${defaultDir}`,
    )
    return defaultDir
  }

  // Installed build: under `app/` next to the .exe, if writable.
  const exeDir = dirname(app.getPath('exe'))
  const target = join(exeDir, APP_SUBDIR)
  if (isWritable(target)) return target

  // eslint-disable-next-line no-console
  console.warn(
    `[storage] ${target} is not writable; falling back to ${defaultDir}`,
  )
  return defaultDir
}

// `fs.accessSync(dir, W_OK)` is unreliable on Windows — ACLs can deny actual
// writes even when access() reports OK. The only reliable check is to
// actually create + delete a file.
function isWritable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, `.write-test-${process.pid}-${Date.now()}`)
    writeFileSync(probe, '')
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

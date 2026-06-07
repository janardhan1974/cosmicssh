// Thin wrapper around electron-builder that pre-sets env vars which cannot
// be expressed in electron-builder.yml.
//
// CSC_IDENTITY_AUTO_DISCOVERY=false prevents electron-builder from discovering
// signing identities. On its own this is insufficient — electron-builder v26
// eagerly downloads winCodeSign before checking whether a cert exists. The
// pre-create block below short-circuits that: electron-builder checks whether
// the cache directory exists; if it does, it skips the download+extraction.
// winCodeSign bundles macOS dylib symlinks that 7-Zip cannot extract on
// Windows without the "Create symbolic links" privilege (absent on corporate
// machines without dev mode). The stub is skipped on CI (GitHub Actions sets
// CI=true) because those VMs do have symlink rights and need the real binaries
// — rcedit-x64.exe inside winCodeSign is required to stamp version metadata
// into the packaged exe even when code signing is disabled.

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'

// Pre-create the winCodeSign cache directory (Windows only, non-CI only).
// LOCALAPPDATA is absent on Linux/macOS so the block is always skipped there.
const localAppData = process.env.LOCALAPPDATA
if (localAppData && !process.env.CI) {
  const winCodeSignDir = join(
    localAppData, 'electron-builder', 'Cache', 'winCodeSign', 'winCodeSign-2.6.0',
  )
  try { mkdirSync(winCodeSignDir, { recursive: true }) } catch { /* already exists */ }
}

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

// Resolve electron-builder's JS CLI entry directly instead of going through
// the .cmd wrapper in node_modules/.bin/. The wrapper approach breaks on
// Windows when the repo path contains spaces (OneDrive etc.) because
// spawnSync + .cmd + spaces triggers an EINVAL bug in Node's child_process.
// Running via process.execPath (node) bypasses the issue entirely.
const require = createRequire(pathToFileURL(root + '/'))
const ebPkgPath = require.resolve('electron-builder/package.json')
const ebPkg = JSON.parse(readFileSync(ebPkgPath, 'utf8'))
const cliPath = resolve(dirname(ebPkgPath), ebPkg.bin['electron-builder'])

const [target, ...rest] = process.argv.slice(2)
const args = ['--win', ...(target ? [target] : []), ...rest]

const result = spawnSync(process.execPath, [cliPath, ...args], {
  stdio: 'inherit',
  env: process.env,
  cwd: root,
})

if (result.error) {
  console.error('dist.mjs: failed to launch electron-builder:', result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)

// Thin wrapper around electron-builder that pre-sets env vars which cannot
// be expressed in electron-builder.yml.
//
// CSC_IDENTITY_AUTO_DISCOVERY=false prevents electron-builder from downloading
// winCodeSign (its cross-platform code-signing toolkit). winCodeSign bundles
// macOS dylib symlinks that 7-Zip cannot extract on Windows without the
// "Create symbolic links" privilege (typically absent on corporate machines).
// Setting this env var is a no-op for unsigned builds — we have no cert
// configured, so electron-builder would have skipped signing anyway.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'

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

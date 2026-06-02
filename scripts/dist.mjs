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
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const bin = resolve(root, 'node_modules', '.bin', 'electron-builder')

// argv[2] is the optional target name (e.g. "portable", "nsis").
// argv[3] onwards are additional flags.
const [target, ...rest] = process.argv.slice(2)

const args = ['--win', ...(target ? [target] : []), ...rest]

const result = spawnSync(bin, args, {
  stdio: 'inherit',
  env: process.env,
  // electron-builder needs the repo root as cwd so it finds electron-builder.yml
  cwd: root,
})

process.exit(result.status ?? 1)

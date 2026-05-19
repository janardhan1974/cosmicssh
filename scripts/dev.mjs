// Custom dev orchestrator — see plan.md M0.
//
// Responsibilities:
//   1. Spawn Vite (renderer HMR server)
//   2. Spawn `tsc -w` for main and preload (each emits to dist/)
//   3. Wait for Vite to be reachable AND for first JS emit of main + preload
//   4. Launch Electron with VITE_DEV_SERVER_URL set
//   5. Watch dist/main + dist/preload via chokidar; restart Electron on change
//   6. Forward Ctrl-C cleanly to all children
//
// No concurrently / wait-on / nodemon / tsx — see plan rule on minimal deps.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import process from 'node:process'
import chokidar from 'chokidar'
import { stampBuildInfo } from './write-build-info.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const DIST_MAIN = resolve(root, 'dist/main/index.js')
const DIST_PRELOAD = resolve(root, 'dist/preload/index.js')
const VITE_URL = 'http://localhost:5173'

const COLORS = {
  vite: '\x1b[36m',
  'tsc:main': '\x1b[33m',
  'tsc:preload': '\x1b[35m',
  electron: '\x1b[32m',
  dev: '\x1b[34m',
  'build-info': '\x1b[90m',
}
const RESET = '\x1b[0m'

function log(label, msg) {
  const color = COLORS[label] ?? ''
  process.stdout.write(`${color}[${label}]${RESET} ${msg}\n`)
}

function run(label, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    shell: process.platform === 'win32', // npx is a .cmd on Windows
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  })
  const color = COLORS[label] ?? ''
  const prefix = `${color}[${label}]${RESET}`
  const forward = (stream) => (chunk) => {
    const text = chunk.toString()
    for (const line of text.split('\n')) {
      if (line.length === 0) continue
      stream.write(`${prefix} ${line}\n`)
    }
  }
  child.stdout?.on('data', forward(process.stdout))
  child.stderr?.on('data', forward(process.stderr))
  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null && !shuttingDown) {
      log('dev', `${label} exited with code ${code} (signal=${signal ?? 'none'})`)
    }
  })
  return child
}

async function waitForFile(path, timeoutMs = 60_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) return
    await wait(200)
  }
  throw new Error(`Timed out waiting for ${path}`)
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return // dev server up even on 404
    } catch {
      // not ready yet
    }
    await wait(200)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

let shuttingDown = false
const children = new Set()

function track(child) {
  children.add(child)
  child.on('exit', () => children.delete(child))
  return child
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  log('dev', 'shutting down...')
  for (const c of children) {
    if (!c.killed) c.kill()
  }
  // Give children a moment to flush; then exit.
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

// 1. Vite
log('dev', 'starting Vite + tsc watchers')
track(run('vite', 'npx', ['vite']))

// 2. tsc watchers — --preserveWatchOutput stops them clearing the terminal
track(run('tsc:main', 'npx', ['tsc', '-w', '-p', 'tsconfig.main.json', '--preserveWatchOutput']))
track(run('tsc:preload', 'npx', ['tsc', '-w', '-p', 'tsconfig.preload.json', '--preserveWatchOutput']))

// 3. Wait for everything
try {
  await Promise.all([
    waitForUrl(VITE_URL),
    waitForFile(DIST_MAIN),
    waitForFile(DIST_PRELOAD),
  ])
} catch (err) {
  log('dev', `startup failed: ${err.message}`)
  shutdown(1)
  process.exit(1)
}

log('dev', 'all watchers ready, launching Electron')

// 4. Electron with restart-on-change
let electron = null
let restartTimer = null

function startElectron() {
  electron = track(run('electron', 'npx', ['electron', '.'], {
    env: { ...process.env, VITE_DEV_SERVER_URL: VITE_URL },
  }))
  electron.on('exit', (code) => {
    electron = null
    if (!shuttingDown && restartTimer === null) {
      log('dev', `Electron exited (code=${code}); shutting down`)
      shutdown(0)
    }
  })
}

function scheduleRestart() {
  if (shuttingDown) return
  clearTimeout(restartTimer)
  restartTimer = setTimeout(async () => {
    restartTimer = null
    if (electron && !electron.killed) {
      log('dev', 'main/preload rebuilt — restarting Electron')
      electron.kill()
      await wait(200)
    }
    startElectron()
  }, 200)
}

startElectron()

// 5. Watch compiled main/preload for changes
const watcher = chokidar.watch(['dist/main', 'dist/preload'], {
  cwd: root,
  ignoreInitial: true,
})
watcher.on('change', scheduleRestart)
watcher.on('add', scheduleRestart)

// 6. Restamp build-info.ts on every main/preload/shared source change so
// Help → About reflects the time of the LATEST code change, not the time
// `npm run dev` was started. tsc:main will pick up the new build-info.ts
// and the dist/main watcher above will trigger the Electron restart — so
// this is purely "stamp ahead of the recompile".
//
// Renderer changes (src/renderer/**) are deliberately NOT watched: they use
// Vite HMR and don't restart Electron, so a stamp would either be invisible
// until the next main-side change, or force a restart that breaks HMR. If
// you need About to reflect a renderer-only change, restart `npm run dev`.
//
// src/main/build-info.ts itself is excluded — stamping rewrites it, and
// reacting to that event would loop forever.
let stampPending = null
function bumpBuildInfo() {
  if (stampPending) clearTimeout(stampPending)
  stampPending = setTimeout(() => {
    stampPending = null
    try {
      const { buildVersion } = stampBuildInfo()
      log('build-info', `restamped v${buildVersion}`)
    } catch (err) {
      log('dev', `build-info stamp failed: ${err.message}`)
    }
  }, 150)
}
const srcWatcher = chokidar.watch(
  ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts'],
  {
    cwd: root,
    ignored: ['src/main/build-info.ts', 'src/main/build-info.d.ts'],
    ignoreInitial: true,
  },
)
srcWatcher.on('change', bumpBuildInfo)
srcWatcher.on('add', bumpBuildInfo)
srcWatcher.on('unlink', bumpBuildInfo)

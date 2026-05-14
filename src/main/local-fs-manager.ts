// Local filesystem operations exposed to the renderer through IPC. The
// sandboxed renderer has no `fs` access — every read/write goes through
// here.

import { accessSync, constants, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { shell } from 'electron'
import type { FsEntry, LocalListResult, LocalPlatformInfo } from '../shared/types'

const WIN_DRIVE_LETTERS = 'CDEFGHIJKLMNOPQRSTUVWXYZ'

export class LocalFsManager {
  list(path: string): LocalListResult {
    if (path === '' || path === ':drives:') {
      return { type: 'drives', items: this.listDrives() }
    }
    const items = this.listDirectory(path)
    return { type: 'directory', path, items }
  }

  home(): string {
    return homedir()
  }

  reveal(path: string): void {
    // Opens the parent directory and selects the file in Explorer.
    shell.showItemInFolder(path)
  }

  delete(path: string, isDirectory: boolean): void {
    if (isDirectory) {
      // recursive + force makes this idempotent and handles non-empty dirs.
      rmSync(path, { recursive: true, force: true })
    } else {
      unlinkSync(path)
    }
  }

  platform(): LocalPlatformInfo {
    return {
      sep,
      isWindows: process.platform === 'win32',
      isMac: process.platform === 'darwin',
      isLinux: process.platform === 'linux',
      homeDir: homedir(),
    }
  }

  private listDrives(): { name: string; path: string }[] {
    if (process.platform !== 'win32') {
      // POSIX: just return root. (We're a Windows app per the plan, but
      // dev/test sometimes runs on other OSes.)
      return [{ name: '/', path: '/' }]
    }
    const drives: { name: string; path: string }[] = []
    for (const letter of WIN_DRIVE_LETTERS) {
      const root = `${letter}:\\`
      try {
        accessSync(root, constants.F_OK)
        drives.push({ name: `${letter}:`, path: root })
      } catch {
        // drive letter not assigned
      }
    }
    return drives
  }

  private listDirectory(path: string): FsEntry[] {
    const names = readdirSync(path)
    const entries: FsEntry[] = []
    for (const name of names) {
      try {
        const full = join(path, name)
        // lstat so symlinks show as symlinks, matching the remote pane behavior
        const s = statSync(full, { throwIfNoEntry: false })
        if (!s) continue
        entries.push({
          name,
          isDirectory: s.isDirectory(),
          isSymlink: s.isSymbolicLink(),
          size: s.size,
          mtimeMs: s.mtimeMs,
          mode: 0, // Windows ACLs don't map to POSIX cleanly; M8 may add an indicator
        })
      } catch {
        // Inaccessible entry — common on Windows for system folders. Skip.
        continue
      }
    }
    return entries
  }
}

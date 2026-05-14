// Credential vault — encrypts passwords with Electron's safeStorage (Windows
// DPAPI on Windows; same crypto class as keytar / Credential Manager) and
// persists the ciphertext bytes in a JSON file under userData. The plaintext
// password never touches disk; the renderer never receives it.

import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type StoredVault = {
  // profileId → base64-encoded ciphertext from safeStorage.encryptString
  [profileId: string]: string
}

export class CredentialVault {
  private readonly path: string
  private cache: StoredVault

  constructor() {
    this.path = join(app.getPath('userData'), 'credentials.json')
    this.cache = this.read()
  }

  private read(): StoredVault {
    if (!existsSync(this.path)) return {}
    try {
      const raw = readFileSync(this.path, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as StoredVault
      }
      return {}
    } catch {
      // Corrupt file — start clean. We don't recover from arbitrary JSON
      // damage; the user can re-save their passwords.
      return {}
    }
  }

  private write(): void {
    writeFileSync(this.path, JSON.stringify(this.cache, null, 2), 'utf8')
  }

  private ensureAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'OS encryption (DPAPI) is unavailable. Cannot store credentials.',
      )
    }
  }

  save(profileId: string, password: string): void {
    this.ensureAvailable()
    const ciphertext = safeStorage.encryptString(password)
    this.cache[profileId] = ciphertext.toString('base64')
    this.write()
  }

  load(profileId: string): string | null {
    const stored = this.cache[profileId]
    if (!stored) return null
    this.ensureAvailable()
    try {
      const ciphertext = Buffer.from(stored, 'base64')
      return safeStorage.decryptString(ciphertext)
    } catch {
      return null // ciphertext was produced under a different OS user / key
    }
  }

  has(profileId: string): boolean {
    return Boolean(this.cache[profileId])
  }

  delete(profileId: string): void {
    if (!(profileId in this.cache)) return
    delete this.cache[profileId]
    this.write()
  }
}

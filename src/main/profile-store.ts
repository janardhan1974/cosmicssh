// Profile store — non-sensitive session metadata persisted via electron-store.
// Passwords NEVER live here (plan.md security non-negotiables); see
// credential-vault.ts for encrypted password storage.

import Store from 'electron-store'
import { randomUUID } from 'node:crypto'
import type { ProfileDraft, SessionProfile } from '../shared/types'

type StoreShape = {
  profiles: SessionProfile[]
  // Folder names that have no profiles yet — lets users create an empty
  // folder via right-click and put profiles into it later. A group name only
  // needs to be in this list if it has zero profiles; once at least one
  // profile uses it, the folder is implied by the profile's `group` field.
  extraGroups: string[]
}

export class ProfileStore {
  private readonly store: Store<StoreShape>

  constructor() {
    this.store = new Store<StoreShape>({
      name: 'profiles',
      defaults: { profiles: [], extraGroups: [] },
      // Schema validation handled at the IPC boundary via zod.
    })
  }

  list(): SessionProfile[] {
    return this.store.get('profiles')
  }

  listExtraGroups(): string[] {
    return this.store.get('extraGroups') ?? []
  }

  createExtraGroup(name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    const current = this.listExtraGroups()
    if (current.includes(trimmed)) return
    // No need to add it if profiles already imply the group.
    if (this.list().some((p) => p.group === trimmed)) return
    this.store.set('extraGroups', [...current, trimmed])
  }

  deleteExtraGroup(name: string): void {
    this.store.set(
      'extraGroups',
      this.listExtraGroups().filter((g) => g !== name),
    )
  }

  // Bulk replace — used by import.
  replaceProfiles(profiles: SessionProfile[]): void {
    this.store.set('profiles', profiles)
  }

  get(id: string): SessionProfile | undefined {
    return this.list().find((p) => p.id === id)
  }

  create(draft: ProfileDraft): SessionProfile {
    const profile: SessionProfile = {
      ...draft,
      id: randomUUID(),
      createdAt: Date.now(),
    }
    this.store.set('profiles', [...this.list(), profile])
    return profile
  }

  update(profile: SessionProfile): SessionProfile {
    const next = this.list().map((p) => (p.id === profile.id ? profile : p))
    if (next.length === this.list().length && !this.get(profile.id)) {
      throw new Error(`unknown profile id: ${profile.id}`)
    }
    this.store.set('profiles', next)
    return profile
  }

  delete(id: string): void {
    this.store.set(
      'profiles',
      this.list().filter((p) => p.id !== id),
    )
  }

  touchLastUsed(id: string): void {
    const profile = this.get(id)
    if (!profile) return
    this.update({ ...profile, lastUsedAt: Date.now() })
  }
}

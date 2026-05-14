// Profile store — non-sensitive session metadata persisted via electron-store.
// Passwords NEVER live here (plan.md security non-negotiables); see
// credential-vault.ts for encrypted password storage.

import Store from 'electron-store'
import { randomUUID } from 'node:crypto'
import type { ProfileDraft, SessionProfile } from '../shared/types'

type StoreShape = {
  profiles: SessionProfile[]
}

export class ProfileStore {
  private readonly store: Store<StoreShape>

  constructor() {
    this.store = new Store<StoreShape>({
      name: 'profiles',
      defaults: { profiles: [] },
      // Schema validation handled at the IPC boundary via zod.
    })
  }

  list(): SessionProfile[] {
    return this.store.get('profiles')
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

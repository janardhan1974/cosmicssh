import { create } from 'zustand'
import type { ProfileDraft, SessionProfile } from '../../../shared/types'

type State = {
  profiles: SessionProfile[]
  // Empty folders that have no profiles yet. Persisted by main.
  extraFolders: string[]
  loaded: boolean
  load: () => Promise<void>
  create: (draft: ProfileDraft) => Promise<SessionProfile>
  update: (profile: SessionProfile) => Promise<SessionProfile>
  delete: (id: string) => Promise<void>
  createFolder: (name: string) => Promise<void>
  deleteFolder: (name: string) => Promise<void>
}

export const useProfilesStore = create<State>((set, get) => ({
  profiles: [],
  extraFolders: [],
  loaded: false,
  load: async () => {
    const [profiles, extraFolders] = await Promise.all([
      window.api.profiles.list(),
      window.api.folders.list(),
    ])
    set({ profiles, extraFolders, loaded: true })
  },
  create: async (draft) => {
    const profile = await window.api.profiles.create(draft)
    // Once a profile uses a group name, that name doesn't need to live in
    // extraFolders any more. Drop it to keep state tidy.
    const folders = profile.group
      ? get().extraFolders.filter((f) => f !== profile.group)
      : get().extraFolders
    set({ profiles: [...get().profiles, profile], extraFolders: folders })
    return profile
  },
  update: async (profile) => {
    const updated = await window.api.profiles.update(profile)
    set({
      profiles: get().profiles.map((p) => (p.id === updated.id ? updated : p)),
    })
    return updated
  },
  delete: async (id) => {
    await window.api.profiles.delete(id)
    set({ profiles: get().profiles.filter((p) => p.id !== id) })
  },
  createFolder: async (name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    await window.api.folders.create(trimmed)
    if (!get().extraFolders.includes(trimmed)) {
      set({ extraFolders: [...get().extraFolders, trimmed] })
    }
  },
  deleteFolder: async (name) => {
    await window.api.folders.delete(name)
    set({ extraFolders: get().extraFolders.filter((f) => f !== name) })
  },
}))

// Sort profiles into groups for sidebar rendering. Profiles without a group
// land under '' (rendered as "Ungrouped" by the sidebar). Empty folders that
// have no profiles in them yet are surfaced as well so the user can still
// see + add to them.
export function groupProfiles(
  profiles: readonly SessionProfile[],
  extraFolders: readonly string[] = [],
): Array<{ group: string; items: SessionProfile[] }> {
  const map = new Map<string, SessionProfile[]>()
  for (const p of profiles) {
    const key = p.group?.trim() ?? ''
    const arr = map.get(key) ?? []
    arr.push(p)
    map.set(key, arr)
  }
  // Layer in any empty folders that don't already have profiles.
  for (const folder of extraFolders) {
    if (!map.has(folder)) map.set(folder, [])
  }
  // Sort groups (ungrouped last), items by name within each group
  return [...map.entries()]
    .map(([group, items]) => ({
      group,
      items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => {
      if (a.group === '' && b.group !== '') return 1
      if (b.group === '' && a.group !== '') return -1
      return a.group.localeCompare(b.group)
    })
}

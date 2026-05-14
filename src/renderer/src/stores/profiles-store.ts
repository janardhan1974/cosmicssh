import { create } from 'zustand'
import type { ProfileDraft, SessionProfile } from '../../../shared/types'

type State = {
  profiles: SessionProfile[]
  loaded: boolean
  load: () => Promise<void>
  create: (draft: ProfileDraft) => Promise<SessionProfile>
  update: (profile: SessionProfile) => Promise<SessionProfile>
  delete: (id: string) => Promise<void>
}

export const useProfilesStore = create<State>((set, get) => ({
  profiles: [],
  loaded: false,
  load: async () => {
    const profiles = await window.api.profiles.list()
    set({ profiles, loaded: true })
  },
  create: async (draft) => {
    const profile = await window.api.profiles.create(draft)
    set({ profiles: [...get().profiles, profile] })
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
}))

// Sort profiles into groups for sidebar rendering. Profiles without a group
// land under '' (rendered as "Ungrouped" by the sidebar).
export function groupProfiles(
  profiles: readonly SessionProfile[],
): Array<{ group: string; items: SessionProfile[] }> {
  const map = new Map<string, SessionProfile[]>()
  for (const p of profiles) {
    const key = p.group?.trim() ?? ''
    const arr = map.get(key) ?? []
    arr.push(p)
    map.set(key, arr)
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

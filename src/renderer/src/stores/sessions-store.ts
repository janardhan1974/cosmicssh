import { create } from 'zustand'
import type { SessionProfile } from '../../../shared/types'

export type Tab = {
  sessionId: string
  // Snapshot of the profile at connect time. We keep it on the tab so the
  // header keeps rendering correctly even if the profile is later renamed
  // or deleted while the session is alive.
  profile: { id?: string; name: string; host: string; username: string }
  status: 'open' | 'closed'
  closedDetail?: string
}

type State = {
  tabs: Tab[]
  activeId: string | null
  addTab: (tab: Tab) => void
  setActive: (sessionId: string) => void
  closeTab: (sessionId: string) => void
  markClosed: (sessionId: string, detail: string) => void
}

export const useSessionsStore = create<State>((set, get) => ({
  tabs: [],
  activeId: null,
  addTab: (tab) =>
    set({ tabs: [...get().tabs, tab], activeId: tab.sessionId }),
  setActive: (sessionId) => set({ activeId: sessionId }),
  closeTab: (sessionId) => {
    const remaining = get().tabs.filter((t) => t.sessionId !== sessionId)
    let nextActive = get().activeId
    if (nextActive === sessionId) {
      const lastTab = remaining[remaining.length - 1]
      nextActive = lastTab ? lastTab.sessionId : null
    }
    set({ tabs: remaining, activeId: nextActive })
  },
  markClosed: (sessionId, detail) =>
    set({
      tabs: get().tabs.map((t) =>
        t.sessionId === sessionId
          ? { ...t, status: 'closed', closedDetail: detail }
          : t,
      ),
    }),
}))

export function tabFromProfile(
  sessionId: string,
  profile: SessionProfile,
): Tab {
  return {
    sessionId,
    profile: {
      id: profile.id,
      name: profile.name,
      host: profile.host,
      username: profile.username,
    },
    status: 'open',
  }
}

export function tabFromAdHoc(
  sessionId: string,
  meta: { host: string; username: string },
): Tab {
  return {
    sessionId,
    profile: { name: `${meta.username}@${meta.host}`, ...meta },
    status: 'open',
  }
}

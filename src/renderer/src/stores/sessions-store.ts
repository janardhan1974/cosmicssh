import { create } from 'zustand'
import type { Protocol, SessionProfile } from '../../../shared/types'

export type TabMode = 'terminal' | 'sftp'

export type Tab = {
  sessionId: string
  // Snapshot of the profile at connect time. We keep it on the tab so the
  // header keeps rendering correctly even if the profile is later renamed
  // or deleted while the session is alive.
  profile: {
    id?: string
    name: string
    host: string
    username: string
    protocol: Protocol
  }
  status: 'open' | 'closed'
  closedDetail?: string
  mode: TabMode
}

type State = {
  tabs: Tab[]
  activeId: string | null
  addTab: (tab: Tab) => void
  setActive: (sessionId: string) => void
  setMode: (sessionId: string, mode: TabMode) => void
  closeTab: (sessionId: string) => void
  markClosed: (sessionId: string, detail: string) => void
  // Replace a closed tab's sessionId with a freshly-opened one. Used by the
  // SFTP-pane Reconnect button so the tab keeps its position rather than
  // being closed + reopened (which loses tab order and tab-mode state).
  replaceSession: (oldSessionId: string, newSessionId: string) => void
}

export const useSessionsStore = create<State>((set, get) => ({
  tabs: [],
  activeId: null,
  addTab: (tab) =>
    set({ tabs: [...get().tabs, tab], activeId: tab.sessionId }),
  setActive: (sessionId) => set({ activeId: sessionId }),
  setMode: (sessionId, mode) =>
    set({
      tabs: get().tabs.map((t) =>
        t.sessionId === sessionId ? { ...t, mode } : t,
      ),
    }),
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
  replaceSession: (oldSessionId, newSessionId) =>
    set((s) => {
      const tabs: Tab[] = s.tabs.map((t) =>
        t.sessionId === oldSessionId
          ? { ...t, sessionId: newSessionId, status: 'open' as const, closedDetail: undefined }
          : t,
      )
      const activeId = s.activeId === oldSessionId ? newSessionId : s.activeId
      return { tabs, activeId }
    }),
}))

export function tabFromProfile(
  sessionId: string,
  profile: SessionProfile,
): Tab {
  const protocol = profile.protocol ?? 'ssh'
  return {
    sessionId,
    profile: {
      id: profile.id,
      name: profile.name,
      host: profile.host,
      username: profile.username,
      protocol,
    },
    status: 'open',
    mode: protocol === 'sftp-only' ? 'sftp' : 'terminal',
  }
}

export function tabFromAdHoc(
  sessionId: string,
  meta: { host: string; username: string },
): Tab {
  return {
    sessionId,
    profile: { name: `${meta.username}@${meta.host}`, protocol: 'ssh', ...meta },
    status: 'open',
    mode: 'terminal',
  }
}

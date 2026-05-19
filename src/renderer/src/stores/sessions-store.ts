import { create } from 'zustand'
import type { Protocol, SessionProfile } from '../../../shared/types'

export type TabMode = 'terminal' | 'sftp'

// Per-tab floating-window rect used when tabLayout === 'mdi'. Positions are in
// CSS pixels relative to the `.terminal-stack` container (NOT the BrowserWindow
// — the sidebar / chrome offset is handled by the container itself). `z` is a
// monotonic ordinal; the highest z renders on top. `minimized` hides the
// window and surfaces a chip in the bottom MinimizedStrip. Renderer-local; not
// persisted across restarts in v1.
export type FloatingRect = {
  x: number
  y: number
  w: number
  h: number
  z: number
  minimized: boolean
}

// Default size for a freshly-floated window. Cascade origin (top-left) and
// step keep new windows visible against typical container sizes; cascade wraps
// after CASCADE_WRAP windows so they don't walk off-screen on small monitors.
const FLOAT_DEFAULT_W = 720
const FLOAT_DEFAULT_H = 480
const CASCADE_ORIGIN = 20
const CASCADE_STEP = 30
const CASCADE_WRAP = 8

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
  // When the profile has `logSession: true` and main successfully opened a
  // session log file, the absolute path lands here. Renderer uses it to
  // show a "● REC" indicator on the tab and surface the path on hover.
  // Cleared when the session closes (file stream is closed in main too).
  logPath?: string
}

type State = {
  tabs: Tab[]
  activeId: string | null
  // Floating-window rects keyed by sessionId. Only populated for sessions that
  // have been seen in MDI mode at least once; getFloatingRect() below lazily
  // fills missing entries with a cascade default. Stays around after layout
  // switches back to single/tile so positions are remembered if the user flips
  // back to MDI in the same app session.
  floating: Record<string, FloatingRect>
  // Monotonic z-order counter. bringToFront stamps the focused window with
  // ++zSeq so it renders on top of all others.
  zSeq: number
  // Per-tab flex weight used in tile-v/tile-h layouts. Each cell is rendered
  // with `flex: weight 1 0`, so two cells with equal weight split 50/50, and
  // a cell with weight 2 gets twice the slice of a cell with weight 1.
  // Default-missing entries are treated as 1. Updated by TileDivider drags;
  // survives layout switches so coming back to tile mode preserves splits.
  tileWeights: Record<string, number>
  addTab: (tab: Tab) => void
  setActive: (sessionId: string) => void
  setMode: (sessionId: string, mode: TabMode) => void
  closeTab: (sessionId: string) => void
  markClosed: (sessionId: string, detail: string) => void
  // Replace a closed tab's sessionId with a freshly-opened one. Used by the
  // SFTP-pane Reconnect button so the tab keeps its position rather than
  // being closed + reopened (which loses tab order and tab-mode state).
  replaceSession: (oldSessionId: string, newSessionId: string) => void
  // MDI-mode actions. Each is a no-op when called for a sessionId that
  // doesn't exist in `tabs` (defensive — callers already gate on tab presence).
  ensureFloating: (sessionId: string, index: number) => void
  updateFloating: (sessionId: string, partial: Partial<FloatingRect>) => void
  bringToFront: (sessionId: string) => void
  setMinimized: (sessionId: string, minimized: boolean) => void
  // Merge a partial map into tileWeights. Bulk update is intentional — a
  // single TileDivider drag changes the weights of TWO adjacent cells per
  // pointermove tick, and doing it as one set keeps the store consistent
  // (and avoids two re-render passes per frame).
  setTileWeights: (next: Record<string, number>) => void
}

export const useSessionsStore = create<State>((set, get) => ({
  tabs: [],
  activeId: null,
  floating: {},
  zSeq: 0,
  tileWeights: {},
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
    // Drop the floating rect for the closed session so a future tab opened
    // with the same (recycled, very unlikely) UUID gets a fresh cascade.
    const floating = { ...get().floating }
    delete floating[sessionId]
    // Same for the tile weight — its absence means "default 1" anyway, but
    // dropping the entry keeps the map tidy.
    const tileWeights = { ...get().tileWeights }
    delete tileWeights[sessionId]
    set({ tabs: remaining, activeId: nextActive, floating, tileWeights })
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
      // Migrate the floating rect to the new sessionId so reconnect-in-place
      // preserves the window's position and size.
      const floating = { ...s.floating }
      if (floating[oldSessionId]) {
        floating[newSessionId] = floating[oldSessionId]
        delete floating[oldSessionId]
      }
      return { tabs, activeId, floating }
    }),
  ensureFloating: (sessionId, index) => {
    const existing = get().floating[sessionId]
    if (existing) return
    // Cascade defaults: walk the diagonal, wrap after CASCADE_WRAP so new
    // windows can't march off the bottom-right of small containers. Index
    // comes from the caller (the tab's position in `tabs`) so positions are
    // stable across re-renders.
    const step = (index % CASCADE_WRAP) * CASCADE_STEP
    const z = get().zSeq + 1
    set((s) => ({
      zSeq: z,
      floating: {
        ...s.floating,
        [sessionId]: {
          x: CASCADE_ORIGIN + step,
          y: CASCADE_ORIGIN + step,
          w: FLOAT_DEFAULT_W,
          h: FLOAT_DEFAULT_H,
          z,
          minimized: false,
        },
      },
    }))
  },
  updateFloating: (sessionId, partial) =>
    set((s) => {
      const cur = s.floating[sessionId]
      if (!cur) return s
      return { floating: { ...s.floating, [sessionId]: { ...cur, ...partial } } }
    }),
  bringToFront: (sessionId) =>
    set((s) => {
      const cur = s.floating[sessionId]
      if (!cur) return s
      const z = s.zSeq + 1
      return {
        zSeq: z,
        floating: { ...s.floating, [sessionId]: { ...cur, z } },
      }
    }),
  setMinimized: (sessionId, minimized) =>
    set((s) => {
      const cur = s.floating[sessionId]
      if (!cur) return s
      return {
        floating: { ...s.floating, [sessionId]: { ...cur, minimized } },
      }
    }),
  setTileWeights: (next) =>
    set((s) => ({ tileWeights: { ...s.tileWeights, ...next } })),
}))

export function tabFromProfile(
  sessionId: string,
  profile: SessionProfile,
  logPath?: string,
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
    logPath,
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

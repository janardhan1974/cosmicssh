// Transfers store — tracks SFTP uploads/downloads across all sessions so
// the global TransfersPanel can render them.

import { create } from 'zustand'

export type TransferDirection = 'upload' | 'download'

export type Transfer = {
  id: string
  direction: TransferDirection
  from: string
  to: string
  totalBytes: number
  bytesTransferred: number
  bytesPerSecond: number
  status: 'active' | 'done' | 'error'
  error?: string
  startedAt: number
}

type State = {
  transfers: Map<string, Transfer>
  begin: (init: {
    id: string
    direction: TransferDirection
    from: string
    to: string
    totalBytes: number
  }) => void
  progress: (id: string, bytesTransferred: number, totalBytes: number, bytesPerSecond: number) => void
  done: (id: string) => void
  error: (id: string, message: string) => void
  remove: (id: string) => void
  clearFinished: () => void
}

export const useTransfersStore = create<State>((set) => ({
  transfers: new Map(),
  begin: (init) =>
    set((s) => {
      const next = new Map(s.transfers)
      next.set(init.id, {
        ...init,
        bytesTransferred: 0,
        bytesPerSecond: 0,
        status: 'active',
        startedAt: Date.now(),
      })
      return { transfers: next }
    }),
  progress: (id, bytesTransferred, totalBytes, bytesPerSecond) =>
    set((s) => {
      const t = s.transfers.get(id)
      if (!t) return s
      const next = new Map(s.transfers)
      next.set(id, { ...t, bytesTransferred, totalBytes, bytesPerSecond })
      return { transfers: next }
    }),
  done: (id) =>
    set((s) => {
      const t = s.transfers.get(id)
      if (!t) return s
      const next = new Map(s.transfers)
      next.set(id, { ...t, status: 'done', bytesTransferred: t.totalBytes })
      return { transfers: next }
    }),
  error: (id, message) =>
    set((s) => {
      const t = s.transfers.get(id)
      if (!t) return s
      const next = new Map(s.transfers)
      next.set(id, { ...t, status: 'error', error: message })
      return { transfers: next }
    }),
  remove: (id) =>
    set((s) => {
      if (!s.transfers.has(id)) return s
      const next = new Map(s.transfers)
      next.delete(id)
      return { transfers: next }
    }),
  clearFinished: () =>
    set((s) => {
      const next = new Map<string, Transfer>()
      for (const [id, t] of s.transfers) {
        if (t.status === 'active') next.set(id, t)
      }
      return { transfers: next }
    }),
}))

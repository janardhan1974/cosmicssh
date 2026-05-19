import { useSessionsStore } from '../stores/sessions-store'

// Bottom strip surfaced only in MDI layout. Lists each currently-minimized
// floating window as a chip; clicking restores the window (un-minimizes,
// brings to front, makes its tab active). Hides itself entirely when nothing
// is minimized so it doesn't waste vertical space.
export function MinimizedStrip() {
  const tabs = useSessionsStore((s) => s.tabs)
  const floating = useSessionsStore((s) => s.floating)
  const setMinimized = useSessionsStore((s) => s.setMinimized)
  const bringToFront = useSessionsStore((s) => s.bringToFront)
  const setActive = useSessionsStore((s) => s.setActive)

  const minimized = tabs.filter((t) => floating[t.sessionId]?.minimized)
  if (minimized.length === 0) return null

  return (
    <div className="minimized-strip" role="toolbar" aria-label="Minimized windows">
      {minimized.map((t) => (
        <button
          key={t.sessionId}
          type="button"
          className="minimized-chip"
          title={`Restore ${t.profile.name}`}
          onClick={() => {
            setMinimized(t.sessionId, false)
            bringToFront(t.sessionId)
            setActive(t.sessionId)
          }}
        >
          {t.profile.name}
        </button>
      ))}
    </div>
  )
}

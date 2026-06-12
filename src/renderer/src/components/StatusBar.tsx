import { useSessionsStore } from '../stores/sessions-store'

export function StatusBar() {
  const activeId = useSessionsStore((s) => s.activeId)
  const tabs = useSessionsStore((s) => s.tabs)
  const dims = useSessionsStore((s) =>
    activeId ? s.terminalDimensions[activeId] : undefined,
  )

  const tab = tabs.find((t) => t.sessionId === activeId)

  return (
    <div className="status-bar" aria-label="Status bar">
      {tab ? (
        <>
          <span
            className={`status-dot ${tab.status}`}
            title={tab.status === 'open' ? 'Connected' : 'Disconnected'}
            aria-hidden="true"
          />
          <span className="status-session-info">
            {tab.customLabel ?? tab.profile.name}
            {' — '}
            {tab.profile.username}@{tab.profile.host}
          </span>
          <span className="status-spacer" />
          <span className="status-right">
            <span className="status-encoding">UTF-8</span>
            {dims && (
              <span className="status-dims">
                {dims.rows} rows × {dims.cols} cols
              </span>
            )}
          </span>
        </>
      ) : (
        <span className="status-spacer" />
      )}
    </div>
  )
}

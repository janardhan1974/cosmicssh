import { useSessionsStore } from '../stores/sessions-store'

type Props = {
  onCloseTab: (sessionId: string) => void
}

export function TabBar({ onCloseTab }: Props) {
  const tabs = useSessionsStore((s) => s.tabs)
  const activeId = useSessionsStore((s) => s.activeId)
  const setActive = useSessionsStore((s) => s.setActive)

  if (tabs.length === 0) return null

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.sessionId === activeId
        return (
          <div
            key={tab.sessionId}
            role="tab"
            aria-selected={isActive}
            className={`tab ${isActive ? 'active' : ''} ${tab.status}`}
            onClick={() => setActive(tab.sessionId)}
            title={`${tab.profile.username}@${tab.profile.host}`}
          >
            <span className="tab-label">{tab.profile.name}</span>
            <button
              type="button"
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                onCloseTab(tab.sessionId)
              }}
              title="Close tab"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}

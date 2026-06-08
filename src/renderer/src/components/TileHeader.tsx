import { useState } from 'react'
import { useSessionsStore, type Tab } from '../stores/sessions-store'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { SftpIcon, TerminalIcon } from './icons'

type Props = {
  tab: Tab
  isActive: boolean
  onClose: (sessionId: string) => void
  onReconnect: (sessionId: string) => void
  onDoubleClick?: () => void
}

// Per-tile header that travels with its terminal/SFTP pane when the user
// arranges sessions with Tile Tabs Vertically/Horizontally. Visually mirrors
// the global TabBar's tab so the two layouts feel coherent — same icon,
// label, REC indicator, close button, and right-click menu. The global
// TabBar is hidden in tile modes (it'd just duplicate every header).
export function TileHeader({ tab, isActive, onClose, onReconnect, onDoubleClick }: Props) {
  const setActive = useSessionsStore((s) => s.setActive)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const isAdHoc = !tab.profile.id
  const menuItems: ContextMenuItem[] = [
    {
      label: isAdHoc ? 'Reconnect (needs a saved profile)' : 'Reconnect',
      onClick: () => onReconnect(tab.sessionId),
      disabled: isAdHoc,
    },
  ]

  return (
    <div
      className={`tile-header ${isActive ? 'active' : ''} ${tab.status}`}
      role="tab"
      aria-selected={isActive}
      onClick={() => setActive(tab.sessionId)}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault()
        setActive(tab.sessionId)
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      title={
        tab.logPath && tab.status === 'open'
          ? `${tab.profile.username}@${tab.profile.host}\nLogging to: ${tab.logPath}`
          : `${tab.profile.username}@${tab.profile.host}`
      }
    >
      {tab.logPath && tab.status === 'open' && (
        <span
          className="tab-rec"
          aria-label="Session is being logged to a file"
          title={`Logging to: ${tab.logPath}`}
        >
          ●
        </span>
      )}
      <span className="tab-icon" aria-hidden="true">
        {tab.mode === 'sftp' ? <SftpIcon size={14} /> : <TerminalIcon size={14} />}
      </span>
      <span className="tab-label">{tab.profile.name}</span>
      <button
        type="button"
        className="tab-close"
        onClick={(e) => {
          e.stopPropagation()
          onClose(tab.sessionId)
        }}
        title="Close tab"
      >
        ✕
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

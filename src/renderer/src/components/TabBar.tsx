import { useState } from 'react'
import { getScrollbackText } from '../lib/terminal-registry'
import { useSessionsStore } from '../stores/sessions-store'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { SftpIcon, TerminalIcon } from './icons'

type Props = {
  onCloseTab: (sessionId: string) => void
  // Right-click → "Reconnect": disconnects (if open) and opens a fresh
  // connection for the same profile, swapped into THIS tab in place.
  onReconnect: (sessionId: string) => void
  // Right-click → "Clone connection": opens a NEW tab against the same
  // profile, leaving this tab's session alone.
  onClone: (sessionId: string) => void
}

type MenuState = { x: number; y: number; sessionId: string } | null

// Map a tab's identifying key to one of 8 palette slots (defined in
// index.css as --tab-c0 … --tab-c7). Profile id is preferred when the tab
// is backed by a saved profile so the color stays stable across reconnects;
// ad-hoc tabs fall back to sessionId. djb2-lite hash → simple and stable.
const TAB_PALETTE_SIZE = 8
function tabColorIndex(key: string): number {
  let h = 5381
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) >>> 0
  }
  return h % TAB_PALETTE_SIZE
}

export function TabBar({ onCloseTab, onReconnect, onClone }: Props) {
  const tabs = useSessionsStore((s) => s.tabs)
  const activeId = useSessionsStore((s) => s.activeId)
  const setActive = useSessionsStore((s) => s.setActive)
  const [menu, setMenu] = useState<MenuState>(null)

  if (tabs.length === 0) return null

  // Tab right-click menu. Reduced to a single Reconnect item per request.
  // Reconnect requires a saved profile id (ad-hoc tabs can't be re-derived);
  // shown disabled with a hint when unavailable so the menu shape is stable.
  const menuItems = (sessionId: string): ContextMenuItem[] => {
    const tab = tabs.find((t) => t.sessionId === sessionId)
    const isAdHoc = !tab?.profile.id
    return [
      {
        label: isAdHoc ? 'Reconnect (needs a saved profile)' : 'Reconnect',
        onClick: () => onReconnect(sessionId),
        disabled: isAdHoc,
      },
    ]
  }

  // Dump the current xterm scrollback for this tab and ship it to main for
  // writing under <storage-dir>/sessions/. The text comes out of xterm
  // already rendered (no ANSI), so main just adds the header + writes.
  const saveScrollback = async (sessionId: string): Promise<void> => {
    const tab = tabs.find((t) => t.sessionId === sessionId)
    if (!tab) return
    const text = getScrollbackText(sessionId)
    if (text === null) {
      alert('No terminal scrollback available for this tab.')
      return
    }
    if (text.length === 0) {
      alert('Scrollback is empty — nothing to save.')
      return
    }
    try {
      const result = await window.api.logging.saveScrollback({
        profileName: tab.profile.name,
        text,
      })
      alert(`Saved scrollback to:\n${result.path}`)
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.sessionId === activeId
        // Stable accent color per tab. Prefer profile.id so the color stays
        // the same across reconnects (replaceSession swaps sessionId but
        // keeps profile.id). Ad-hoc tabs fall back to sessionId.
        const colorIdx = tabColorIndex(tab.profile.id ?? tab.sessionId)
        const tabStyle = {
          ['--tab-accent' as string]: `var(--tab-c${colorIdx})`,
        } as React.CSSProperties
        return (
          <div
            key={tab.sessionId}
            role="tab"
            aria-selected={isActive}
            className={`tab ${isActive ? 'active' : ''} ${tab.status}`}
            style={tabStyle}
            onClick={() => setActive(tab.sessionId)}
            onContextMenu={(e) => {
              e.preventDefault()
              // Activating the tab on right-click matches Chrome/VS Code:
              // the menu's actions then unambiguously target what the user
              // is looking at.
              setActive(tab.sessionId)
              setMenu({ x: e.clientX, y: e.clientY, sessionId: tab.sessionId })
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
            {/* Leading icon — Terminal for shell tabs, SFTP for file-transfer
                tabs. tab.mode is fixed at connect time now that the in-tab
                mode toggle has been removed; the icon is purely informational. */}
            <span className="tab-icon" aria-hidden="true">
              {tab.mode === 'sftp' ? <SftpIcon size={14} /> : <TerminalIcon size={14} />}
            </span>
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.sessionId)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

import { useSessionsStore, type TabMode } from '../stores/sessions-store'
import { SftpIcon, TerminalIcon } from './icons'

type Props = {
  sessionId: string
}

const MODES: { value: TabMode; label: string; Icon: typeof TerminalIcon }[] = [
  { value: 'terminal', label: 'Terminal', Icon: TerminalIcon },
  { value: 'sftp', label: 'SFTP', Icon: SftpIcon },
]

export function TabModeBar({ sessionId }: Props) {
  const tab = useSessionsStore((s) =>
    s.tabs.find((t) => t.sessionId === sessionId),
  )
  const setMode = useSessionsStore((s) => s.setMode)
  if (!tab) return null
  // Hide the Terminal mode button on SFTP-only tabs — there's no shell
  // channel underneath, so the button would just produce confusing errors.
  const visible = tab.profile.protocol === 'sftp-only'
    ? MODES.filter((m) => m.value === 'sftp')
    : MODES
  return (
    <div className="tab-mode-bar" role="tablist">
      {visible.map((m) => (
        <button
          key={m.value}
          type="button"
          role="tab"
          aria-selected={tab.mode === m.value}
          data-mode={m.value}
          className={`tab-mode-btn ${tab.mode === m.value ? 'active' : ''}`}
          onClick={() => setMode(sessionId, m.value)}
        >
          <m.Icon size={14} />
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  )
}

import { useState } from 'react'
import { useTransfersStore } from '../stores/transfers-store'

export function TransfersPanel() {
  const transfersMap = useTransfersStore((s) => s.transfers)
  const clearFinished = useTransfersStore((s) => s.clearFinished)
  const remove = useTransfersStore((s) => s.remove)
  const [collapsed, setCollapsed] = useState(false)

  const transfers = [...transfersMap.values()]
  if (transfers.length === 0) return null

  const active = transfers.filter((t) => t.status === 'active').length

  return (
    <div className={`transfers-panel ${collapsed ? 'collapsed' : ''}`}>
      <header
        className="transfers-header"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span>Transfers ({active} active, {transfers.length} total)</span>
        <button
          type="button"
          className="icon-btn"
          onClick={(e) => { e.stopPropagation(); clearFinished() }}
          title="Clear completed"
        >
          Clear
        </button>
      </header>
      {!collapsed && (
        <ul className="transfers-list">
          {transfers.map((t) => {
            const pct = t.totalBytes > 0
              ? Math.min(100, (t.bytesTransferred / t.totalBytes) * 100)
              : 0
            const eta = t.bytesPerSecond > 0 && t.status === 'active'
              ? formatEta((t.totalBytes - t.bytesTransferred) / t.bytesPerSecond)
              : ''
            return (
              <li key={t.id} className={`transfer-item ${t.status}`}>
                <div className="transfer-meta">
                  <span className="arrow">{t.direction === 'upload' ? '↑' : '↓'}</span>
                  <span className="path" title={`${t.from} → ${t.to}`}>
                    {basename(t.from)}
                  </span>
                  <button
                    type="button"
                    className="icon-btn dismiss"
                    onClick={() => remove(t.id)}
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </div>
                <div className="transfer-bar">
                  <div
                    className={`transfer-bar-fill ${t.status}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="transfer-stats">
                  {t.status === 'error' ? (
                    <span className="err">{t.error ?? 'failed'}</span>
                  ) : t.status === 'done' ? (
                    <span>{formatBytes(t.totalBytes)} · done</span>
                  ) : (
                    <>
                      <span>
                        {formatBytes(t.bytesTransferred)} / {formatBytes(t.totalBytes)}
                      </span>
                      <span>{formatBytes(t.bytesPerSecond)}/s</span>
                      {eta && <span>ETA {eta}</span>}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function basename(p: string): string {
  const m = /[^\\/]+$/.exec(p)
  return m ? m[0] : p
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n.toFixed(0)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

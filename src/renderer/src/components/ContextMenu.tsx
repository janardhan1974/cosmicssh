import { useEffect, useRef } from 'react'

export type ContextMenuItem = {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

type Props = {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)

  // Close on any click outside the menu, on Escape, or on a window blur.
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  // Clamp position into viewport so the menu doesn't get cut off near edges.
  const margin = 4
  const menuMaxW = 220
  const menuMaxH = items.length * 28 + 8
  const left = Math.min(x, window.innerWidth - menuMaxW - margin)
  const top = Math.min(y, window.innerHeight - menuMaxH - margin)

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          className={`context-menu-item ${item.danger ? 'danger' : ''}`}
          disabled={item.disabled}
          onClick={() => {
            item.onClick()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

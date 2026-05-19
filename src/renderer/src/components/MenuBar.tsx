import { useEffect, useRef, useState } from 'react'

// One row in a dropdown — either a clickable item or a visual separator.
export type MenuItem =
  | {
      type: 'item'
      label: string
      // Visual hint only — keyboard accelerators are registered separately in
      // App.tsx so the keystroke fires whether or not the menu is open.
      accelerator?: string
      onClick: () => void
      disabled?: boolean
    }
  | { type: 'separator' }

export type MenuDef = {
  label: string
  items: MenuItem[]
}

type Props = {
  menus: MenuDef[]
}

// Custom HTML menu bar that replaces the OS-drawn one. Colored by the theme
// (see .menu-bar in index.css), so it follows Dark / Light / Light Blue
// instead of always being white. Click a top-level item to open its
// dropdown; hover another while open to switch; click outside or Escape to
// close. Items invoke their own onClick handlers and don't double up with
// the keyboard shortcuts (those are handled in App.tsx).
export function MenuBar({ menus }: Props) {
  const [open, setOpen] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click + Escape. Keep the listeners scoped to when a
  // menu is open so we don't pay the cost on every render.
  useEffect(() => {
    if (open === null) return
    const onDocClick = (e: MouseEvent) => {
      if (!barRef.current) return
      if (!barRef.current.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menu-bar" role="menubar" ref={barRef}>
      {menus.map((menu, i) => {
        const isOpen = open === i
        return (
          <div key={menu.label} className="menu-bar-slot">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              className={`menu-bar-button ${isOpen ? 'open' : ''}`}
              onClick={() => setOpen(isOpen ? null : i)}
              // Once any menu is open, hovering another top-level switches
              // to it — matches every native menu bar's behavior.
              onMouseEnter={() => {
                if (open !== null && open !== i) setOpen(i)
              }}
            >
              {menu.label}
            </button>
            {isOpen && (
              <div className="menu-dropdown" role="menu">
                {menu.items.map((item, j) => {
                  if (item.type === 'separator') {
                    return <div key={j} className="menu-separator" role="separator" />
                  }
                  return (
                    <button
                      key={j}
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      disabled={item.disabled}
                      onClick={() => {
                        setOpen(null)
                        item.onClick()
                      }}
                    >
                      <span className="menu-item-label">{item.label}</span>
                      {item.accelerator && (
                        <span className="menu-item-accel">{item.accelerator}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useSessionsStore, type FloatingRect } from '../stores/sessions-store'

// Minimum window dimensions when resizing in MDI mode. Anything smaller and
// xterm.fit() can't compute a meaningful cols/rows; the titlebar alone is
// ~28px tall.
const MIN_W = 240
const MIN_H = 120

// Resize directions: 4 edges + 4 corners. Each character encodes whether
// that side moves: 'n' = top edge moves, 's' = bottom, 'e' = right, 'w' =
// left. The 'move' kind translates the whole rect via the titlebar.
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type GestureKind = 'move' | ResizeDir

// Cursor lookup. Edges get the bidirectional ns-/ew-resize; corners get the
// diagonal nwse-/nesw-resize. Locked in once during gesture so the cursor
// stays correct even if the pointer leaves the handle during a fast drag.
const CURSOR_FOR: Record<GestureKind, string> = {
  move: 'move',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
}

type Props = {
  sessionId: string
  title: string
  // The container (.terminal-stack) the floating window lives inside. Used
  // for clamping drag/resize to its bounds so windows can't be dragged out of
  // sight. Read on each pointer move (the container can resize too).
  containerRef: React.RefObject<HTMLDivElement>
  onClose: () => void
  onDoubleClick?: () => void
}

// Resolve a new rect from a starting rect, a gesture direction, the pointer
// delta, and the container bounds. For left/top edges the x/y coordinate
// moves along with the width/height so the OPPOSITE edge stays anchored —
// that's what makes "drag left edge right" shrink the window rather than
// pushing the whole thing.
function resizedRect(
  start: FloatingRect,
  dx: number,
  dy: number,
  dir: ResizeDir,
  cb: { width: number; height: number },
): Pick<FloatingRect, 'x' | 'y' | 'w' | 'h'> {
  let x = start.x
  let y = start.y
  let w = start.w
  let h = start.h
  // Right edge: width grows/shrinks; clamp to MIN_W and to "fits inside
  // container from start.x".
  if (dir === 'e' || dir === 'ne' || dir === 'se') {
    w = Math.min(cb.width - start.x, Math.max(MIN_W, start.w + dx))
  }
  // Left edge: x moves; width is the distance from the new x to the
  // anchored right edge (start.x + start.w). Clamp x to keep both x >= 0
  // and the resulting width >= MIN_W.
  if (dir === 'w' || dir === 'nw' || dir === 'sw') {
    const right = start.x + start.w
    const nx = Math.min(Math.max(0, start.x + dx), right - MIN_W)
    x = nx
    w = right - nx
  }
  // Bottom edge: height grows/shrinks.
  if (dir === 's' || dir === 'se' || dir === 'sw') {
    h = Math.min(cb.height - start.y, Math.max(MIN_H, start.h + dy))
  }
  // Top edge: y moves with the bottom edge anchored.
  if (dir === 'n' || dir === 'ne' || dir === 'nw') {
    const bottom = start.y + start.h
    const ny = Math.min(Math.max(0, start.y + dy), bottom - MIN_H)
    y = ny
    h = bottom - ny
  }
  return { x, y, w, h }
}

// MDI chrome: titlebar + bottom-right resize corner. Rendered as SIBLINGS of
// the terminal content inside a stable .tab-content wrapper (NOT wrapping
// the content). This is what makes layout switches MDI ↔ tile-v/h preserve
// xterm scrollback — the TerminalView never unmounts because its parent
// .tab-content stays the same React element across layouts; only the chrome
// around it appears/disappears.
//
// Positioning of the parent .tab-content is set inline by the caller from
// the floating rect. We just handle the user gestures that mutate that rect.
export function FloatingChrome({ sessionId, title, containerRef, onClose, onDoubleClick }: Props) {
  const rect = useSessionsStore((s) => s.floating[sessionId])
  const updateFloating = useSessionsStore((s) => s.updateFloating)
  const bringToFront = useSessionsStore((s) => s.bringToFront)
  const setMinimized = useSessionsStore((s) => s.setMinimized)
  const setActive = useSessionsStore((s) => s.setActive)

  // Live ref into the latest rect so the pointermove handler always sees the
  // up-to-date values without re-attaching listeners on every store update.
  const rectRef = useRef(rect)
  rectRef.current = rect

  const startGesture = (e: ReactPointerEvent, kind: GestureKind) => {
    if (!containerRef.current || !rect) return
    e.preventDefault()
    e.stopPropagation()
    const cb = containerRef.current.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    const start = rectRef.current!
    bringToFront(sessionId)
    setActive(sessionId)

    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = CURSOR_FOR[kind]
    document.body.style.userSelect = 'none'

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (kind === 'move') {
        // Translate; clamp so the window stays fully inside the container.
        const maxX = Math.max(0, cb.width - start.w)
        const maxY = Math.max(0, cb.height - start.h)
        const nx = Math.min(maxX, Math.max(0, start.x + dx))
        const ny = Math.min(maxY, Math.max(0, start.y + dy))
        updateFloating(sessionId, { x: nx, y: ny })
      } else {
        updateFloating(sessionId, resizedRect(start, dx, dy, kind, cb))
      }
    }
    const onUp = () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Re-clamp on container resize. Without this, shrinking the main window
  // could leave floating windows partially off-screen with no way to recover
  // them other than minimize → restore.
  useEffect(() => {
    if (!containerRef.current || !rect) return
    const el = containerRef.current
    const obs = new ResizeObserver(() => {
      const cb = el.getBoundingClientRect()
      const r = rectRef.current
      if (!r) return
      const nx = Math.min(Math.max(0, cb.width - r.w), Math.max(0, r.x))
      const ny = Math.min(Math.max(0, cb.height - r.h), Math.max(0, r.y))
      if (nx !== r.x || ny !== r.y) updateFloating(sessionId, { x: nx, y: ny })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [containerRef, sessionId, updateFloating, rect])

  if (!rect) return null

  return (
    <>
      <div
        className="floating-window-titlebar"
        onPointerDown={(e) => {
          // Only the titlebar background — not the buttons inside it — should
          // initiate a drag.
          const target = e.target as HTMLElement
          if (target.closest('button')) return
          startGesture(e, 'move')
        }}
        onDoubleClick={(e) => { e.preventDefault(); onDoubleClick?.() }}
      >
        <span className="floating-window-title" title={title}>{title}</span>
        <div className="floating-window-controls">
          <button
            type="button"
            className="floating-window-btn"
            title="Minimize"
            onClick={() => setMinimized(sessionId, true)}
          >
            ─
          </button>
          <button
            type="button"
            className="floating-window-btn floating-window-btn-close"
            title="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>
      {/* Eight resize handles. Edges resize one dimension; corners resize
          both. Corners overlap the edge handles by a few pixels at the
          window's actual corners — CSS z-index puts corners on top so they
          win at the exact corner pixels. The SE corner keeps a visible
          diagonal-stripe affordance; the other seven are invisible but
          hittable. */}
      <div
        className="floating-window-resize floating-window-resize-n"
        onPointerDown={(e) => startGesture(e, 'n')}
      />
      <div
        className="floating-window-resize floating-window-resize-s"
        onPointerDown={(e) => startGesture(e, 's')}
      />
      <div
        className="floating-window-resize floating-window-resize-e"
        onPointerDown={(e) => startGesture(e, 'e')}
      />
      <div
        className="floating-window-resize floating-window-resize-w"
        onPointerDown={(e) => startGesture(e, 'w')}
      />
      <div
        className="floating-window-resize floating-window-resize-nw"
        onPointerDown={(e) => startGesture(e, 'nw')}
      />
      <div
        className="floating-window-resize floating-window-resize-ne"
        onPointerDown={(e) => startGesture(e, 'ne')}
      />
      <div
        className="floating-window-resize floating-window-resize-sw"
        onPointerDown={(e) => startGesture(e, 'sw')}
      />
      <div
        className="floating-window-resize floating-window-resize-se"
        onPointerDown={(e) => startGesture(e, 'se')}
        title="Drag to resize"
      />
    </>
  )
}

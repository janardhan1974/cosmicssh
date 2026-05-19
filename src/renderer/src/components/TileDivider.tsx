import { type PointerEvent as ReactPointerEvent } from 'react'
import { useSessionsStore } from '../stores/sessions-store'

// Minimum width/height for a tile while dragging the divider. Anything
// smaller and xterm.fit() can't compute useful cols/rows for the cell.
const MIN_TILE_PX = 80

type Props = {
  // Parent `.terminal-stack`. Used to look up the two adjacent TabCells by
  // their data-session-id so we can read their starting widths/heights.
  containerRef: React.RefObject<HTMLDivElement>
  // 'v' = vertical divider (between columns in tile-v); drag changes width.
  // 'h' = horizontal divider (between rows in tile-h); drag changes height.
  orientation: 'v' | 'h'
  aId: string
  bId: string
}

// One draggable separator between two adjacent tiles. Owns the gesture that
// redistributes flex weight between the two neighbours — total weight is
// preserved across drags so the rest of the row/column isn't disturbed.
export function TileDivider({ containerRef, orientation, aId, bId }: Props) {
  const onPointerDown = (e: ReactPointerEvent) => {
    if (!containerRef.current) return
    e.preventDefault()
    const container = containerRef.current
    // Locate the two neighbour cells by the data-session-id attribute
    // TabCell stamps onto every .tab-content (only present in tile modes —
    // single/MDI don't render dividers, so a missing element here is a bug).
    const a = container.querySelector<HTMLElement>(`[data-session-id="${aId}"]`)
    const b = container.querySelector<HTMLElement>(`[data-session-id="${bId}"]`)
    if (!a || !b) return

    const aRect = a.getBoundingClientRect()
    const bRect = b.getBoundingClientRect()
    const startA = orientation === 'v' ? aRect.width : aRect.height
    const startB = orientation === 'v' ? bRect.width : bRect.height
    const span = startA + startB
    const startPointer = orientation === 'v' ? e.clientX : e.clientY

    // Capture the current weights once at gesture start. Preserve their sum
    // so the divider only affects A ↔ B and the rest of the row stays put.
    const weights = useSessionsStore.getState().tileWeights
    const wA = weights[aId] ?? 1
    const wB = weights[bId] ?? 1
    const totalWeight = wA + wB

    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = orientation === 'v' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: PointerEvent) => {
      const pointer = orientation === 'v' ? ev.clientX : ev.clientY
      const delta = pointer - startPointer
      // Compute new pixel sizes; clamp so neither tile drops below MIN_TILE_PX.
      const newA = Math.min(span - MIN_TILE_PX, Math.max(MIN_TILE_PX, startA + delta))
      const ratio = newA / span
      // Translate pixels back into flex weights. Keeping totalWeight constant
      // means tiles that aren't touched by this divider don't change size.
      useSessionsStore.getState().setTileWeights({
        [aId]: totalWeight * ratio,
        [bId]: totalWeight * (1 - ratio),
      })
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

  return (
    <div
      className={`tile-divider tile-divider-${orientation}`}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={orientation === 'v' ? 'vertical' : 'horizontal'}
    />
  )
}

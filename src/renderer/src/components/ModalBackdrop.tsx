import { useRef, type ReactNode } from 'react'

type Props = {
  onClose: () => void
  children: ReactNode
}

// Modal backdrop that closes only when the user truly clicks the backdrop
// itself.
//
// The naïve `onClick={onClose}` pattern misfires whenever a click is *initiated*
// inside the modal (e.g. mousedown in a text input) and *released* outside it
// (mouseup on the backdrop) — for instance, when selecting text by dragging
// past the modal's edge. Browsers fire the click event on the common ancestor
// of mousedown- and mouseup-targets, which is the backdrop, so the modal would
// close even though the user never intended to dismiss it.
//
// The fix: only close when *both* mousedown AND click land directly on the
// backdrop element (not bubbled from a child). We track the mousedown target
// in a ref and check it on click. `target === currentTarget` rules out clicks
// that bubbled up from the modal content.
export function ModalBackdrop({ onClose, children }: Props) {
  const downOnBackdrop = useRef(false)
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) {
          onClose()
        }
        downOnBackdrop.current = false
      }}
    >
      {children}
    </div>
  )
}

// Replacement for window.prompt() — Electron disables that for security.
// Promise-style: caller renders <InputPrompt …/> when open, awaits via the
// onSubmit/onCancel callbacks.

import { useEffect, useRef, useState, type FormEvent } from 'react'

type Props = {
  title: string
  label?: string
  hint?: string
  initial?: string
  placeholder?: string
  submitLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function InputPrompt({
  title,
  label,
  hint,
  initial = '',
  placeholder,
  submitLabel = 'OK',
  onSubmit,
  onCancel,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [value, setValue] = useState(initial)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit(value)
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal input-prompt"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>{title}</h2>
        {label && (
          <label>
            <span>{label}</span>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
        )}
        {!label && (
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
          />
        )}
        {hint && <p className="muted hint">{hint}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary">{submitLabel}</button>
        </div>
      </form>
    </div>
  )
}

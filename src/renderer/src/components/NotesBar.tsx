import { useRef, useState } from 'react'
import {
  DEFAULT_NOTES_WIDTH,
  MAX_NOTES_LENGTH,
  MAX_NOTES_WIDTH,
  MIN_NOTES_WIDTH
} from '../../../shared/uiState'
import { toggleSessionNotes } from '../actions'
import { useStore } from '../store'
import { getTerminal } from '../terminal/TerminalSession'

/** Dragging the notes wider stops this short of squeezing the terminal out. */
const MIN_TERMINAL_PX = 120

/** A notepad: the button for a session's notes, and the mark on a tab that has some. */
export function NotesIcon({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3.5 1.75h6.25l2.75 2.75v9.75h-9z" />
      <path d="M5.75 7h4.5M5.75 9.5h4.5M5.75 12h2.5" />
    </svg>
  )
}

/** The column on a session's right with your own notes on it; they save as you type. */
export function NotesBar({ terminalKey }: { terminalKey: string }): React.JSX.Element {
  const notes = useStore((s) => s.terminals[terminalKey]?.notes ?? '')
  const savedWidth = useStore((s) => s.settings?.notesWidth ?? DEFAULT_NOTES_WIDTH)
  const setNotes = useStore((s) => s.setNotes)
  const focusTerminal = useStore((s) => s.focusTerminal)
  // While its edge is dragged; saved (for every session's bar) once it is let go.
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const drag = useRef<{ start: number; initial: number; max: number; width: number } | null>(null)
  const width = dragWidth ?? savedWidth

  /** Saves the width; the dragged one stays shown until the saved one comes back. */
  const save = (next: number): void => {
    if (next === savedWidth) {
      setDragWidth(null)
      return
    }
    void useStore
      .getState()
      .updateSettings({ notesWidth: next })
      .finally(() => setDragWidth(null))
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.classList.remove('resizing-col')
    // A click (or a double-click's first half) changes nothing, even where the bar is squeezed.
    if (d.width === d.initial) setDragWidth(null)
    else save(d.width)
  }

  return (
    <aside
      className="notes-bar"
      aria-label="Session notes"
      data-terminal={terminalKey}
      style={{ width }}
      // Not the pane's own mousedown, which puts the focus into the terminal.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className={`notes-resizer${dragWidth !== null ? ' dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize notes"
        title="Drag to resize; double-click for the default width"
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          const bar = e.currentTarget.parentElement!
          const row = bar.parentElement!.getBoundingClientRect().width
          const initial = Math.round(bar.getBoundingClientRect().width)
          drag.current = {
            start: e.clientX,
            initial,
            // The terminal beside it keeps some room.
            max: Math.min(MAX_NOTES_WIDTH, row - MIN_TERMINAL_PX),
            width: initial
          }
          setDragWidth(initial)
          document.body.classList.add('resizing-col')
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const next = d.initial + (d.start - e.clientX)
          d.width = Math.round(Math.max(MIN_NOTES_WIDTH, Math.min(d.max, next)))
          setDragWidth(d.width)
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => save(DEFAULT_NOTES_WIDTH)}
      />
      <header>
        <strong>Notes</strong>
        <button
          className="icon-button"
          aria-label="Close notes"
          title="Close"
          onClick={() => toggleSessionNotes(terminalKey, false)}
        >
          ×
        </button>
      </header>
      <textarea
        value={notes}
        maxLength={MAX_NOTES_LENGTH}
        placeholder="Notes for this session…"
        aria-label="Notes"
        onChange={(e) => setNotes(terminalKey, e.target.value)}
        // Writing here is working in this pane: it becomes the active one.
        onFocus={() => focusTerminal(terminalKey)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          getTerminal(terminalKey)?.focus()
        }}
      />
    </aside>
  )
}

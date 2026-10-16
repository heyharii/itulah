import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/// The line that says what the last change did, and takes it back.
///
/// The prototype's `toast(…, undo)`. This app has no toast of its own — a
/// banner is for a page-level fact and a dialog is for a question — so this is
/// the Schedule's alone: one line, bottom centre (above the dock and the bottom bar on a phone),
/// gone by itself after a few seconds. It is a confirmation, not an alert: a
/// refused write is a banner over the grid.
///
/// Enters by rising 8px as it fades in, leaves faster than it came (the person
/// has already moved on), and nothing but opacity and one transform moves.

export interface Note {
  /// A new id replaces the note on screen, and restarts its clock.
  readonly id: number
  readonly text: string
  /// Present only when the change can be taken back.
  readonly undo?: () => void
}

/// How long the line stays. Long enough to read a sentence and reach for Undo.
const STAY_MS = 7000
/// The leave: `--t-exit`, and the same here so the timer and the CSS agree.
const LEAVE_MS = 200

export function NoteToast({
  note,
  onGone,
}: {
  note: Note | null
  /// Called when the line should go — its time is up, or Undo was pressed.
  /// Must be stable: the clock restarts when it changes.
  onGone: () => void
}) {
  // The last note is kept while it leaves, so the line fades out with its
  // words instead of emptying first.
  const [kept, setKept] = useState<Note | null>(note)
  if (note !== null && note !== kept) setKept(note)

  useEffect(() => {
    if (note === null) return
    const stop = setTimeout(onGone, STAY_MS)
    return () => clearTimeout(stop)
  }, [note, onGone])

  useEffect(() => {
    if (note !== null) return
    const unmount = setTimeout(() => setKept(null), LEAVE_MS)
    return () => clearTimeout(unmount)
  }, [note])

  const line = note ?? kept
  if (line === null) return null
  return createPortal(
    <Line key={line.id} line={line} open={note !== null} onGone={onGone} />,
    document.body,
  )
}

function Line({
  line,
  open,
  onGone,
}: {
  line: Note
  open: boolean
  onGone: () => void
}) {
  // One frame after mounting, so the transition has a start to go from.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const shown = entered && open

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4 max-md:bottom-[calc(7.5rem+env(safe-area-inset-bottom))]"
    >
      <div
        className={cn(
          "pointer-events-auto flex max-w-full items-center gap-3 rounded-card bg-dark py-2 pr-2 pl-4 text-cell text-on-dark shadow-float",
          "transition-[opacity,translate] ease-(--ease-out) motion-reduce:translate-y-0",
          shown
            ? "translate-y-0 opacity-100 duration-(--t-panel)"
            : "translate-y-2 opacity-0 duration-(--t-exit)",
        )}
      >
        <span className="min-w-0 truncate">{line.text}</span>
        {line.undo !== undefined && open && (
          <Button
            variant="quiet"
            size="sm"
            className="text-on-dark hover:bg-white/10 hover:text-on-dark"
            onClick={() => {
              line.undo?.()
              onGone()
            }}
          >
            Undo
          </Button>
        )}
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from "react"

import { Check } from "lucide-react"

/// What a save says once it has happened, with the one way back.
///
/// A toast confirms an action that did not change the screen it was taken on —
/// the sheet closed and the card moved, and this says what just happened. An
/// Undo stays for ten seconds, a plain confirmation for five.
export interface Toast {
  /// Distinguishes one toast from the next, so a second save starts the
  /// clock again.
  readonly id: number
  readonly message: string
  readonly undo?: () => void
}

export function UndoToast({
  toast,
  onDismiss,
}: {
  toast: Toast | null
  onDismiss: () => void
}) {
  // The last toast stays drawn while it fades out, instead of vanishing the
  // moment it is dismissed.
  const [held, setHeld] = useState<Toast | null>(toast)
  if (toast !== null && toast !== held) setHeld(toast)

  const dismiss = useRef(onDismiss)
  useEffect(() => {
    dismiss.current = onDismiss
  })
  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(
      () => dismiss.current(),
      toast.undo === undefined ? 5_000 : 10_000,
    )
    return () => window.clearTimeout(timer)
  }, [toast])

  if (held === null) return null
  const open = toast !== null
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4 max-md:bottom-[calc(9rem+env(safe-area-inset-bottom,0px))] md:bottom-5 md:justify-end md:px-5"
    >
      <div
        role="status"
        inert={open ? undefined : true}
        data-open={open}
        // A transition, not a keyframe: a second toast arriving mid-exit
        // retargets from where this one is. Out faster than in.
        className="flex max-w-full items-center gap-3 rounded-card bg-dark py-2 pr-2 pl-4 text-meta text-on-dark shadow-float transition-[opacity,translate] duration-200 ease-(--ease-out) data-[open=false]:translate-y-2 data-[open=false]:opacity-0 data-[open=false]:duration-150 data-[open=true]:pointer-events-auto motion-reduce:transition-opacity starting:translate-y-2 starting:opacity-0"
      >
        <Check className="size-4 shrink-0 text-ok" />
        <span className="min-w-0 truncate">{held.message}</span>
        {held.undo !== undefined && (
          <button
            type="button"
            onClick={() => {
              held.undo?.()
              onDismiss()
            }}
            className="h-9 shrink-0 rounded-inner px-3 font-semibold text-on-dark/90 transition-colors duration-(--t-press) hover:bg-white/10 active:bg-white/15 pointer-coarse:h-11"
          >
            Undo
          </button>
        )}
      </div>
    </div>
  )
}

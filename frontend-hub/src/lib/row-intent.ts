import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react"
import type { HTMLAttributes } from "react"

import { intentAllowed } from "@/lib/prefetch"

/// A row that is about to be opened, noticed before it is: the pointer rests on
/// it, the keyboard lands on it, a finger goes down on it. A table (`DataTable`
/// `onRowIntent`) tells its screen, and the screen starts the request for the
/// row's sheet (`prefetchQuery` of its detail), so the sheet opens with its
/// facts in hand.
///
/// The table hands the handler to its rows through context, so the rows of
/// every layout — desk table, tablet, phone card — get it without a prop
/// threaded through each. A pointer must rest `REST_MS` before it counts (a
/// sweep down a list asks for nothing); a finger and the keyboard are certain
/// and count at once. Asking again for a row already fresh costs nothing: the
/// prefetcher skips fresh data.

const REST_MS = 80

type Intent = (original: unknown) => HTMLAttributes<HTMLElement>

export const RowIntentContext = createContext<Intent | null>(null)

/// The value a table provides: one function that turns a row into the handlers
/// it spreads on its element, or `null` when the screen gave no handler.
export function useRowIntent(
  handler: ((original: never) => void) | undefined
): Intent | null {
  // Always the latest handler, behind an identity that never changes, so a
  // screen passing an inline function does not re-render every row.
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  const timer = useRef<number | undefined>(undefined)
  const intent = useCallback<Intent>((original) => {
    const run = () => {
      if (intentAllowed()) latest.current?.(original as never)
    }
    const rest = () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(run, REST_MS)
    }
    return {
      onPointerEnter: (event) => {
        if (event.pointerType !== "touch") rest()
      },
      onPointerLeave: () => window.clearTimeout(timer.current),
      onFocus: rest,
      onTouchStart: run,
    }
  }, [])
  return handler === undefined ? null : intent
}

const NONE: HTMLAttributes<HTMLElement> = {}

/// The handlers a row spreads onto its element, or nothing when the table has
/// no `onRowIntent`.
export function useRowIntentProps(
  original: unknown
): HTMLAttributes<HTMLElement> {
  const intent = useContext(RowIntentContext)
  return intent === null ? NONE : intent(original)
}

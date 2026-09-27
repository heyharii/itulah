import { useCallback, useEffect, useRef, useState } from "react"
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react"
import { ArrowDown, Loader2 } from "lucide-react"

import { SPRING_PANEL } from "@/lib/motion"

/// Pull the page down to ask again.
///
/// The gesture is beUI's (https://beui.dev/components/motion/pull-to-refresh):
/// the same exponential resistance, the same threshold-then-settle shape, the
/// same `SPRING_PANEL` release. Two things are ours.
///
/// First, the scroller. beUI's container scrolls itself; this app scrolls the
/// *window*, because the history list is windowed by TanStack's
/// `useWindowVirtualizer` and moving the scroll into a div would leave the
/// virtualiser measuring a viewport nothing scrolls. So the guard is
/// `window.scrollY`, not `element.scrollTop`.
///
/// Second, the chrome. beUI's indicator is a glass pill; this one is
/// DESIGN.md's frosted icon chip — `{soft-2}` fill, hairline, soft shadow —
/// because a glass surface is the sort of borrowed material that makes a
/// screen stop being Cloud Hub.
///
/// It exists at all because of what this app is for. A member puts the phone
/// on the counter, the cashier rings the sale through, and they pick it up
/// again wanting one number. `refetchOnWindowFocus` covers the case where they
/// switched apps; this covers the case where they never did.
const THRESHOLD = 76
const MAX_PULL = 132
const HOLD = 60

/// Rubber band: every pixel of finger travel moves the page less than the last,
/// so the pull can never run away and the limit is approached but not reached.
function resisted(distance: number): number {
  return MAX_PULL * (1 - Math.exp(-Math.max(0, distance) / MAX_PULL))
}

export function PullToRefresh({
  onRefresh,
  busy = false,
  children,
}: {
  /// Resolves when the data behind the screen has been asked for again.
  onRefresh: () => Promise<unknown>
  /// Whether a refresh started elsewhere is already in flight.
  busy?: boolean
  children: React.ReactNode
}) {
  const reduce = useReducedMotion()
  const y = useMotionValue(0)
  const [state, setState] = useState<"idle" | "pulling" | "ready" | "busy">(
    "idle",
  )

  const spin = useTransform(y, [0, THRESHOLD], [0, 180])
  const opacity = useTransform(y, [0, 12, THRESHOLD], [0, 0.5, 1])
  const scale = useTransform(y, [0, THRESHOLD], [0.86, 1])

  // Read inside listeners that are registered once; state in a closure would
  // be the value it had when the gesture library attached.
  // Synced after commit rather than during render: React may render and throw
  // away a pass, and a ref written from that pass would be a value no screen
  // ever showed.
  const stateRef = useRef(state)
  const busyRef = useRef(busy)
  useEffect(() => {
    stateRef.current = state
    busyRef.current = busy
  }, [state, busy])
  const settleRef = useRef<{ stop: () => void } | null>(null)

  const settle = useCallback(
    (to: number) => {
      settleRef.current?.stop()
      if (reduce) {
        y.set(to)
        return
      }
      settleRef.current = animate(y, to, SPRING_PANEL)
    },
    [reduce, y],
  )

  const run = useCallback(async () => {
    setState("busy")
    settle(HOLD)
    try {
      await onRefresh()
    } finally {
      setState("idle")
      settle(0)
    }
  }, [onRefresh, settle])

  useEffect(() => {
    // A finger only. A mouse has a scrollbar and a refresh button; wiring a
    // pointer drag here would fight text selection on a desktop for a gesture
    // nobody makes with a mouse.
    if (!window.matchMedia("(pointer: coarse)").matches) return

    let startY = 0
    let startX = 0
    let active = false

    function onStart(event: TouchEvent) {
      if (
        event.touches.length !== 1 ||
        window.scrollY > 0 ||
        stateRef.current === "busy" ||
        busyRef.current
      ) {
        active = false
        return
      }
      const touch = event.touches[0]
      startY = touch.clientY
      startX = touch.clientX
      active = true
    }

    function onMove(event: TouchEvent) {
      const touch = event.touches[0]
      if (!active || touch === undefined) return
      const dy = touch.clientY - startY
      const dx = touch.clientX - startX
      // Scrolled away, or pulling upward: this is an ordinary scroll and the
      // gesture gives it back rather than competing for it.
      if (window.scrollY > 0 || dy < 0) {
        active = false
        settle(0)
        setState("idle")
        return
      }
      // A mostly-sideways drag belongs to whatever is under it.
      if (Math.abs(dx) > dy) return

      event.preventDefault()
      settleRef.current?.stop()
      const next = resisted(dy)
      y.set(next)
      setState(next >= THRESHOLD ? "ready" : "pulling")
    }

    function onEnd() {
      if (!active) return
      active = false
      if (y.get() >= THRESHOLD) {
        void run()
        return
      }
      setState("idle")
      settle(0)
    }

    // `passive: false` on move only — the handler calls `preventDefault` to
    // take the pull away from the browser's own overscroll.
    window.addEventListener("touchstart", onStart, { passive: true })
    window.addEventListener("touchmove", onMove, { passive: false })
    window.addEventListener("touchend", onEnd)
    window.addEventListener("touchcancel", onEnd)
    return () => {
      window.removeEventListener("touchstart", onStart)
      window.removeEventListener("touchmove", onMove)
      window.removeEventListener("touchend", onEnd)
      window.removeEventListener("touchcancel", onEnd)
    }
  }, [run, settle, y])

  const spinning = state === "busy" || busy

  return (
    <>
      <motion.div
        aria-hidden
        style={{ y, opacity, scale }}
        className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center pt-2"
      >
        <span className="flex size-10 items-center justify-center rounded-full border border-hairline bg-soft-2 shadow-soft">
          {spinning ? (
            <Loader2 className="size-4 animate-spin text-accent" />
          ) : (
            <motion.span
              style={{ rotate: reduce ? 0 : spin }}
              className="flex items-center justify-center"
            >
              {/* The arrow turns over as the pull crosses the threshold, so
                  the moment a release will actually do something is visible
                  before the finger lifts rather than after. */}
              <ArrowDown
                className={
                  state === "ready" ? "size-4 text-accent" : "size-4 text-mute"
                }
              />
            </motion.span>
          )}
        </span>
      </motion.div>
      <motion.div style={{ y }}>{children}</motion.div>
    </>
  )
}

import { useCallback, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { EASE_OUT, SPRING_PRESS } from "@/lib/motion"
import { cn } from "@/lib/utils"

/// What a card or a row does when a thumb lands on it.
///
/// DESIGN.md asks for exactly one thing here — "press feedback (mobile): a
/// soft gray expanding ripple on tapped cards/rows" — and says nothing about
/// how it should spring, so the physics are beUI's `SPRING_PRESS`.
///
/// It is a wrapper rather than a button, because the things that need it are
/// already links: a receipt row IS a navigation, and turning it into a button
/// that navigates would cost the reader a long-press menu, a middle-click and
/// a copyable address for no gain.
///
/// The ripple is drawn from the point that was actually touched. A ripple that
/// always blooms from the centre reads as an animation the screen decided to
/// play; one that starts under the finger reads as the screen answering.
interface Ripple {
  id: number
  x: number
  y: number
  size: number
}

export function Pressable({
  children,
  className,
  disabled = false,
}: {
  children: React.ReactNode
  className?: string
  disabled?: boolean
}) {
  const reduce = useReducedMotion()
  const [ripples, setRipples] = useState<ReadonlyArray<Ripple>>([])
  const next = useRef(0)

  const start = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || reduce) return
      const box = event.currentTarget.getBoundingClientRect()
      // Big enough to reach the far corner from wherever the finger landed,
      // so the wash always finishes covering the row rather than stopping
      // short of one edge.
      const size =
        2 *
        Math.hypot(
          Math.max(event.clientX - box.left, box.right - event.clientX),
          Math.max(event.clientY - box.top, box.bottom - event.clientY),
        )
      const id = next.current++
      setRipples((current) => [
        ...current,
        { id, x: event.clientX - box.left, y: event.clientY - box.top, size },
      ])
    },
    [disabled, reduce],
  )

  const settle = useCallback((id: number) => {
    setRipples((current) => current.filter((ripple) => ripple.id !== id))
  }, [])

  return (
    <motion.div
      onPointerDown={start}
      whileTap={disabled || reduce ? undefined : { scale: 0.985 }}
      transition={SPRING_PRESS}
      className={cn("relative isolate overflow-hidden", className)}
    >
      <AnimatePresence>
        {ripples.map((ripple) => (
          <motion.span
            key={ripple.id}
            aria-hidden
            initial={{ opacity: 0.5, scale: 0 }}
            animate={{ opacity: 0, scale: 1 }}
            transition={{ duration: 0.55, ease: EASE_OUT }}
            onAnimationComplete={() => settle(ripple.id)}
            className="pointer-events-none absolute -z-10 rounded-full bg-soft-2"
            style={{
              left: ripple.x - ripple.size / 2,
              top: ripple.y - ripple.size / 2,
              width: ripple.size,
              height: ripple.size,
            }}
          />
        ))}
      </AnimatePresence>
      {children}
    </motion.div>
  )
}

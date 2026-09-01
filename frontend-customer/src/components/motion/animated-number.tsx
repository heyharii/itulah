import { useEffect, useRef, useState } from "react"
import { animate, useReducedMotion } from "motion/react"

import { EASE_OUT, useDocumentVisible } from "@/lib/motion"
import { cn } from "@/lib/utils"

/// A figure that counts up to itself.
///
/// beUI's animated-number (https://beui.dev/components/motion/number), minus
/// its in-view trigger: the tiles this renders in are above the fold on every
/// screen size this app has, so waiting for an intersection would only make
/// them arrive late.
///
/// It animates from wherever it last was, not from zero. A refetch that
/// returns the same total therefore does nothing visible, and one that returns
/// a larger one shows the difference — which is the only thing the movement is
/// for.
export function AnimatedNumber({
  value,
  format,
  duration = 1,
  className,
}: {
  value: number
  format: (value: number) => string
  duration?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  // See `useDocumentVisible`: a count-up frozen by a hidden tab is a wrong
  // figure sitting on screen, so a hidden document takes the value whole.
  const watched = useDocumentVisible()
  const from = useRef(value)
  const [display, setDisplay] = useState(value)

  useEffect(() => {
    if (reduce || !watched || from.current === value) {
      from.current = value
      setDisplay(value)
      return
    }
    const controls = animate(from.current, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: setDisplay,
    })
    from.current = value
    return () => controls.stop()
  }, [value, duration, reduce, watched])

  return <span className={cn("num", className)}>{format(display)}</span>
}

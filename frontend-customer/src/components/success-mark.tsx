import { motion, useReducedMotion } from "motion/react"

import { EASE_OUT, SPRING_CELEBRATE } from "@/lib/motion"

/// A check in a green disc — the moment something the member was waiting on
/// went through. Rare by construction (a redemption confirmed, a phone
/// paired), which is the only reason it is allowed a bounce: the disc settles
/// with a little overshoot, and the tick draws itself once the disc has
/// landed. Reduced motion gets the same picture, faded in.
export function SuccessMark({ size = "lg" }: { size?: "md" | "lg" }) {
  const reduce = useReducedMotion()
  const outer = size === "lg" ? "size-24" : "size-16"
  const inner = size === "lg" ? "size-14" : "size-10"
  return (
    <motion.span
      aria-hidden
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduce ? { duration: 0.2 } : SPRING_CELEBRATE}
      className={`flex ${outer} items-center justify-center rounded-full bg-ok-bg`}
    >
      <span className={`flex ${inner} items-center justify-center rounded-full bg-ok`}>
        <svg viewBox="0 0 24 24" className="size-[55%]" fill="none">
          <motion.path
            d="M5 12.5l4.2 4.2L19 7"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.3, delay: reduce ? 0 : 0.18, ease: EASE_OUT }}
          />
        </svg>
      </span>
    </motion.span>
  )
}

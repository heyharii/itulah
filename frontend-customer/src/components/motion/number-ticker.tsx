import { useEffect, useMemo, useState } from "react"
import { motion, useReducedMotion } from "motion/react"

import { EASE_OUT, useDocumentVisible } from "@/lib/motion"
import { cn } from "@/lib/utils"

/// Digits on a slot reel.
///
/// Adapted from beUI's number-ticker (https://beui.dev/components/motion/number).
/// Used once, on the points figure, because that is the number the whole app
/// exists to show and a member opening it after a purchase is looking for
/// exactly one thing: whether it went up. A count-up would say the same in
/// less; the reel says it in the shape of a scoreboard, which is what points
/// are.
///
/// Two mechanics are load-bearing and are beUI's, not ours:
///
///  - each glyph is keyed by its **place value**, counted from the right, so a
///    member crossing from 9.980 to 10.030 keeps the tens and units they were
///    already reading and adds a glyph on the left, instead of every digit
///    remounting and replaying from zero;
///  - the per-digit stagger is an entrance flourish only. Once the reveal has
///    played, later changes roll every digit at once — a stagger on a live
///    update reads as lag rather than as choreography.
const DIGIT_HEIGHT_EM = 1.1
const DIGITS = Array.from({ length: 10 }, (_, n) => n)

export function NumberTicker({
  value,
  format,
  duration = 0.9,
  stagger = 0.04,
  className,
}: {
  value: number
  /// How the number is written out — grouped for reading, in the member's
  /// locale. Separators are rendered as static glyphs, not reels.
  format: (value: number) => string
  duration?: number
  stagger?: number
  className?: string
}) {
  const text = useMemo(() => format(Math.round(value)), [format, value])

  const glyphs = useMemo(() => {
    const chars = text.split("")
    return chars.map((char, index) => ({
      char,
      id: `g-${chars.length - 1 - index}`,
    }))
  }, [text])

  // A hidden tab freezes `requestAnimationFrame`, and a reel frozen part-way
  // shows a points total that is not the member's. When nothing can be
  // watching, the digits simply start where they belong.
  const watched = useDocumentVisible()
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (entered) return
    const total = (duration + glyphs.length * stagger) * 1000
    const timer = window.setTimeout(() => setEntered(true), total)
    return () => window.clearTimeout(timer)
  }, [entered, duration, stagger, glyphs.length])

  return (
    <span className={cn("inline-flex items-center num", className)}>
      {/* The reel is decoration as far as a screen reader is concerned: it
          announces the number once, in full, rather than ten columns of
          digits. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex items-center">
        {glyphs.map(({ char, id }, index) =>
          /\d/.test(char) ? (
            <Digit
              key={id}
              digit={Number(char)}
              delay={entered || !watched ? 0 : index * stagger}
              duration={duration}
              roll={watched}
            />
          ) : (
            <span key={id} className="inline-block">
              {char}
            </span>
          ),
        )}
      </span>
    </span>
  )
}

function Digit({
  digit,
  delay,
  duration,
  roll,
}: {
  digit: number
  delay: number
  duration: number
  roll: boolean
}) {
  const reduce = useReducedMotion()
  const still = reduce || !roll
  return (
    <span
      className="relative inline-block overflow-hidden"
      style={{ height: `${DIGIT_HEIGHT_EM}em`, width: "1ch" }}
    >
      <motion.span
        initial={{ y: 0 }}
        animate={{ y: `-${digit * DIGIT_HEIGHT_EM}em` }}
        transition={still ? { duration: 0 } : { duration, delay, ease: EASE_OUT }}
        className="absolute inset-x-0 top-0 flex flex-col items-center will-change-transform"
      >
        {DIGITS.map((n) => (
          <span
            key={n}
            className="flex items-center justify-center leading-none"
            style={{ height: `${DIGIT_HEIGHT_EM}em` }}
          >
            {n}
          </span>
        ))}
      </motion.span>
    </span>
  )
}

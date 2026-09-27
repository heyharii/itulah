import { useLayoutEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

/// The segmented control: switch which slice of one dataset is shown.
///
/// `{soft-2}` track, white active chip with a hairline and the whisper shadow —
/// one of the two places DESIGN.md allows a shadow to mean "on". At 44px,
/// because everything on this surface is aimed at with a thumb, and full width
/// because a segmented control floating in a gutter is a desktop shape.
///
/// **One chip that moves, not one per option.** The white chip is a single
/// element that slides to whichever option is chosen, the way the hub's rail
/// moves its light, so Hitung → Periksa reads as a move rather than as one chip
/// switching off and another switching on. It is measured off the DOM rather
/// than computed from an index, because the options are as wide as their words
/// allow. Until the first measurement lands the chosen button draws its own
/// chip, so nothing flashes empty on the first frame; the slide only starts
/// from the second position on.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly { readonly value: T; readonly label: React.ReactNode }[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  const track = useRef<HTMLDivElement>(null)
  const [chip, setChip] = useState<{ x: number; width: number } | null>(null)
  const [settled, setSettled] = useState(false)
  const index = options.findIndex((option) => option.value === value)

  useLayoutEffect(() => {
    const node = track.current
    if (node === null) return
    const measure = () => {
      const button = node.querySelectorAll("button")[index]
      setChip(
        button === undefined
          ? null
          : { x: button.offsetLeft, width: button.offsetWidth },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [index, options.length])

  // After the first commit, not after the first frame: a frame never comes to a
  // tab that is hidden, or to a phone whose screen went dark on the bench, and
  // a chip waiting on one would jump for as long as it waited. The first
  // position has been styled by the time this runs, so turning the transition
  // on here does not animate it; the next change does.
  useLayoutEffect(() => {
    const timer = setTimeout(() => setSettled(true), 0)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      ref={track}
      role="group"
      className={cn(
        "relative flex w-full gap-1 rounded-[0.5625rem] bg-soft-2 p-1",
        className,
      )}
    >
      {chip !== null && (
        <span
          aria-hidden
          style={{ width: chip.width, translate: `${chip.x}px 0` }}
          className={cn(
            "absolute top-1 bottom-1 left-0 rounded-inner border border-hairline-2 bg-canvas shadow-soft",
            settled &&
              "transition-[translate,width] duration-(--t-panel) ease-(--ease-out)",
          )}
        />
      )}
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative h-10 flex-1 rounded-inner border border-transparent text-cell font-medium transition-colors duration-(--t-panel) ease-(--ease-out)",
              on ? "text-ink" : "text-body",
              chip === null && on && "border-hairline-2 bg-canvas shadow-soft",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

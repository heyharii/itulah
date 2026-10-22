/// Motion of the Dispatch sheet.
///
/// A press that puts koli on a trip sends a "+N" flying to that trip's tile,
/// the tile gives a small pulse, and a tile that has just been made pops in
/// (pack-sheet-options.html: fly 320, hit 220, born 320). Reduced motion keeps
/// none of it.
const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)"
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)"
const still = () =>
  typeof window === "undefined" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

/// The tile of a trip (or of Back to Pick, `"back"`), once it is on screen.
export const tileOf = (id: number | "back") =>
  document.querySelector<HTMLElement>(`[data-trip-tile="${id}"]`)

/// "+N" from where the press was to the tile.
export function flyTo(
  from: DOMRect | undefined,
  tile: HTMLElement | null,
  text: string
) {
  if (!from || !tile || still()) return
  const to = tile.getBoundingClientRect()
  const chip = document.createElement("div")
  chip.textContent = text
  chip.className =
    "pointer-events-none fixed top-0 left-0 z-[400] rounded-full bg-accent px-2.5 py-1 font-semibold text-white tabular-nums"
  document.body.appendChild(chip)
  chip.animate(
    [
      {
        transform: `translate(${from.right - 70}px, ${from.top + from.height / 2 - 14}px)`,
        opacity: 1,
      },
      {
        transform: `translate(${to.left + to.width / 2 - 20}px, ${to.top + to.height / 2 - 14}px) scale(0.85)`,
        opacity: 0.25,
      },
    ],
    { duration: 320, easing: EASE_IN_OUT }
  ).onfinish = () => chip.remove()
}

/// The tile takes the koli in: a short swell.
export function pulse(tile: HTMLElement | null) {
  if (!tile || still()) return
  tile.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(1.04)", offset: 0.4 },
      { transform: "scale(1)" },
    ],
    { duration: 220, easing: EASE_OUT }
  )
}

/// A tile that was just made comes in from a little smaller.
export function bornIn(tile: HTMLElement | null) {
  if (!tile || still()) return
  tile.animate(
    [
      { transform: "scale(0.9)", opacity: 0 },
      { transform: "scale(1)", opacity: 1 },
    ],
    { duration: 320, easing: EASE_OUT }
  )
}

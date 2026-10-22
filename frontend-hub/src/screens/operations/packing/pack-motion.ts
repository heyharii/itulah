/// The small motions of the Pack sheet (pack-sheet-options.html, H): a tile
/// lands, a tile takes a put, a sealed koli's icon pops, and a "+N" flies from
/// the row to the koli it went into. All of them are the web animations API on
/// the element that is already there: they move transform and opacity only and
/// stop short in a few hundred milliseconds. Reduced motion draws none.

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)"
const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)"

const calm = () =>
  typeof window === "undefined" ||
  typeof window.matchMedia !== "function" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

/// What the last change asks to be drawn, once the screen has the new tiles.
export interface Fx {
  /// A koli that was just opened: it lands.
  born?: string
  /// The koli that took pieces: it gives a nudge.
  hit?: string
  /// A koli that was just sealed: its icon pops.
  seal?: string
  /// A "+N" from the row that was pressed to the koli that took it.
  fly?: { from: DOMRect | null; text: string; to: string }
}

const tileOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-tile="${CSS.escape(id)}"]`)

export function playFx(fx: Fx) {
  if (calm()) return
  const born = fx.born ? tileOf(fx.born) : null
  born?.animate(
    [
      { transform: "scale(0.9)", opacity: 0 },
      { transform: "none", opacity: 1 },
    ],
    { duration: 320, easing: EASE }
  )
  // A tile that has just landed does not also nudge.
  const hit = fx.hit && fx.hit !== fx.born ? tileOf(fx.hit) : null
  hit?.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(1.04)", offset: 0.4 },
      { transform: "scale(1)" },
    ],
    { duration: 220, easing: EASE }
  )
  const sealed = fx.seal ? tileOf(fx.seal)?.querySelector("svg") : null
  sealed?.animate(
    [
      { transform: "scale(0.85)", opacity: 0 },
      { transform: "none", opacity: 1 },
    ],
    { duration: 300, easing: EASE }
  )
  const { fly } = fx
  const to = fly ? tileOf(fly.to) : null
  if (fly?.from && to) {
    const target = to.getBoundingClientRect()
    const chip = document.createElement("div")
    chip.textContent = fly.text
    chip.setAttribute("aria-hidden", "true")
    chip.className =
      "pointer-events-none fixed top-0 left-0 z-[99] rounded-[14px] bg-accent px-2.5 py-1 text-[0.9375rem] font-semibold text-white tabular-nums"
    document.body.appendChild(chip)
    chip.animate(
      [
        {
          transform: `translate(${fly.from.right - 70}px, ${fly.from.top + fly.from.height / 2 - 14}px)`,
          opacity: 1,
        },
        {
          transform: `translate(${target.left + target.width / 2 - 20}px, ${target.top + target.height / 2 - 14}px) scale(0.85)`,
          opacity: 0.25,
        },
      ],
      { duration: 320, easing: EASE_IN_OUT }
    ).onfinish = () => chip.remove()
  }
}

/// Where a row (or the All in button) is now, to fly from.
export const rowRect = (code: string | null) =>
  document
    .querySelector<HTMLElement>(
      code === null ? "[data-put-all]" : `[data-put="${CSS.escape(code)}"]`
    )
    ?.getBoundingClientRect() ?? null

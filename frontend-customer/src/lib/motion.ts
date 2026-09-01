/// The motion vocabulary, named once.
///
/// The curves and spring physics below are beUI's (https://beui.dev — its
/// `lib/ease.ts`), adopted rather than invented for the same reason the colour
/// tokens are Cloud Hub's: a spring somebody tuned by feel in one component is
/// a value no second component can match. Every animation in this app resolves
/// to one of these.
///
/// They do not conflict with the Cloud Hub language — DESIGN.md specifies what
/// a screen looks like and says almost nothing about how it moves, beyond
/// "press feedback (mobile): a soft gray expanding ripple on tapped
/// cards/rows". These fill that gap; where the two ever met, DESIGN.md won:
/// the pull-to-refresh chrome is a `{soft-2}` chip on a white veil, not the
/// glass surface beUI ships.
///
/// This file is only for what CSS cannot do. Hover, press and panel timings
/// are `--ease-out` and the `--t-*` bands in `styles/index.css`, which are the
/// same beUI values `frontend-hub` uses; reach for a spring here when an
/// animation crosses two elements or follows a finger, and for the CSS tokens
/// otherwise.

/// The house curve. Browser defaults (`ease-out`) are limp by comparison —
/// this one leaves fast and settles slowly, which is what makes a 200ms
/// transition read as physical rather than as a delay.
export const EASE_OUT = [0.16, 1, 0.3, 1] as const

/// CSS form of the same curve, for the handful of transitions that are cheaper
/// as plain CSS than as a motion value.
export const EASE_OUT_CSS = "cubic-bezier(0.16, 1, 0.3, 1)"

/// Press feedback on anything tappable.
export const SPRING_PRESS = {
  type: "spring",
  stiffness: 500,
  damping: 30,
  mass: 0.6,
} as const

/// Content trading places inside a control — a label swapping for a spinner.
export const SPRING_SWAP = {
  type: "spring",
  stiffness: 460,
  damping: 30,
  mass: 0.55,
} as const

/// Panels summoned by a gesture: the pull-to-refresh head, sheets.
export const SPRING_PANEL = {
  type: "spring",
  stiffness: 420,
  damping: 40,
  mass: 0.5,
} as const

/// Shared-layout glides — the indigo squircle travelling between tabs.
export const SPRING_LAYOUT = {
  type: "spring",
  stiffness: 360,
  damping: 32,
  mass: 0.6,
} as const

import { useEffect, useState } from "react"

/// Whether anybody could actually be watching.
///
/// Every animation here is driven by `requestAnimationFrame`, which a browser
/// stops in a hidden tab. A count-up or a digit reel caught by that freezes
/// part-way — and part-way through a points total is a number that is simply
/// wrong, sitting on screen looking like a fact until the tab comes forward.
///
/// So motion that travels between two values asks this first: if the document
/// is hidden it takes the destination immediately, and the flourish is skipped
/// for the audience that was not there. It is the same bargain
/// `prefers-reduced-motion` makes.
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  )
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden)
    document.addEventListener("visibilitychange", onChange)
    return () => document.removeEventListener("visibilitychange", onChange)
  }, [])
  return visible
}

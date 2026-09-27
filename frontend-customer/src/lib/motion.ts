/// The motion vocabulary, named once.
///
/// Curves are Emil Kowalski's (`~/.claude/skills/emil-design-eng`), springs
/// are Apple's two-parameter form (`bounce` + `duration`, which Motion maps
/// onto damping ratio + response). Every animation in this app resolves to one
/// of these; a value tuned by feel inside one component is a value no second
/// component can match.
///
/// The rules they serve: entrances ease out, nothing on screen runs longer
/// than 300ms unless a finger is driving it, springs are critically damped
/// (`bounce: 0`) unless the gesture that started them carried momentum, and
/// only transform and opacity ever move. CSS does everything it can — see the
/// `--ease-*` and `--t-*` tokens in `styles/index.css`; this file is for what
/// needs a spring, a gesture or a shared layout.

/// Strong ease-out for UI. The browser's own `ease-out` is limp by
/// comparison: this one leaves fast, so the first frame after a tap already
/// shows movement.
export const EASE_OUT = [0.23, 1, 0.32, 1] as const

/// For something already on screen moving to a new place.
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const

/// iOS sheet curve.
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const

export const EASE_OUT_CSS = "cubic-bezier(0.23, 1, 0.32, 1)"

/// Press feedback on anything tappable.
export const SPRING_PRESS = { type: "spring", duration: 0.25, bounce: 0 } as const

/// Content trading places inside a control — a label swapping for a spinner.
export const SPRING_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const

/// Panels summoned by a gesture: the pull-to-refresh head, sheets.
export const SPRING_PANEL = { type: "spring", duration: 0.4, bounce: 0 } as const

/// Shared-layout glides — the tab highlight travelling between tabs.
export const SPRING_LAYOUT = { type: "spring", duration: 0.35, bounce: 0 } as const

/// Something the member threw or flicked — the card flipping over. The only
/// place bounce is allowed, because the gesture carried momentum into it.
export const SPRING_THROW = { type: "spring", duration: 0.6, bounce: 0.18 } as const

/// Decorative tracking of a finger or pointer (the card's tilt). Soft, so the
/// card lags the finger a touch the way a real object would.
export const SPRING_TRACK = { stiffness: 170, damping: 22, mass: 0.6 } as const

/// A rare moment worth marking — the check after a redemption goes through.
export const SPRING_CELEBRATE = { type: "spring", duration: 0.5, bounce: 0.3 } as const

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

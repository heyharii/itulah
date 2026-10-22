import { useLayoutEffect, useRef } from "react"

/// How long after its sheet closed a card may still fly: the board reads
/// again once the step is saved, and the lists do not all land at once.
const AFTER_CLOSE_MS = 15_000

/// The flight across the board.
const FLIGHT_MS = 300

interface Flight {
  readonly from: string
  readonly to: string
  readonly rect: DOMRect
  readonly copy: HTMLElement
  readonly pieces: number
  /// When its sheet closed; `null` while it is open.
  closedAt: number | null
}

const card = (id: string) =>
  document.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`)

/// **Where the card went** (allotment-board-options A, 17 Oct 2026): when a
/// step is done, a copy of the card flies from where it stood into the card
/// of the next lane (Pick → that store's Pack card → its Dispatch card → the
/// Dispatched button), which rings once. One move on screen, 300 ms on the
/// strong ease-in-out (it moves across the screen, and a picker sees it tens
/// of times a day, so it stays under 300 ms); with less motion asked for,
/// only the ring.
///
/// `launch(from, to)` is called as the card opens its sheet (the board under a
/// sheet never moves, so where it stood then is where it stands). The flight
/// leaves once the card is gone or holds fewer pieces and the card it goes to
/// is on the board. `open` says whether a step's sheet is open; `watch`
/// changes whenever the board has read again.
export function useHandOff(open: boolean, watch: string) {
  const flight = useRef<Flight | null>(null)

  useLayoutEffect(() => {
    const one = flight.current
    if (one === null) return
    if (!open && one.closedAt === null) one.closedAt = Date.now()
    if (one.closedAt !== null && Date.now() - one.closedAt > AFTER_CLOSE_MS) {
      flight.current = null
      return
    }
    const here = card(one.from)
    const left = here === null || Number(here.dataset.pieces) < one.pieces
    const to = card(one.to)
    if (!left || to === null) return
    flight.current = null
    fly(one, to)
  }, [open, watch])

  return (from: string, to: string) => {
    const here = card(from)
    if (here === null) return
    flight.current = {
      from,
      to,
      rect: here.getBoundingClientRect(),
      copy: here.cloneNode(true) as HTMLElement,
      pieces: Number(here.dataset.pieces),
      closedAt: null,
    }
  }
}

function fly(one: Flight, to: HTMLElement) {
  to.scrollIntoView({ block: "nearest" })
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    ring(to)
    return
  }
  const target = to.getBoundingClientRect()
  const copy = one.copy
  copy.removeAttribute("data-card")
  copy.setAttribute("aria-hidden", "true")
  Object.assign(copy.style, {
    position: "fixed",
    left: `${one.rect.left}px`,
    top: `${one.rect.top}px`,
    width: `${one.rect.width}px`,
    margin: "0",
    zIndex: "60",
    pointerEvents: "none",
    transformOrigin: "0 0",
    boxShadow: "var(--shadow-pop)",
  })
  document.body.append(copy)
  const scale = Math.max(0.2, Math.min(1, target.width / one.rect.width))
  const move = copy.animate(
    [
      { transform: "none" },
      {
        transform: `translate(${target.left - one.rect.left}px, ${target.top - one.rect.top}px) scale(${scale})`,
      },
    ],
    {
      duration: FLIGHT_MS,
      easing: "cubic-bezier(0.77, 0, 0.175, 1)",
      fill: "forwards",
    }
  )
  copy.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], {
    duration: FLIGHT_MS,
    fill: "forwards",
  })
  let landed = false
  const land = () => {
    if (landed) return
    landed = true
    copy.remove()
    ring(to)
  }
  move.onfinish = land
  // A tab in the background can hold the flight; the copy never outlives it.
  window.setTimeout(land, FLIGHT_MS + 200)
}

/// The card that took the pieces says so once.
function ring(to: HTMLElement) {
  to.animate(
    [
      {
        boxShadow:
          "0 0 0 3px color-mix(in oklab, var(--accent) 50%, transparent)",
      },
      { boxShadow: "0 0 0 0 transparent" },
    ],
    { duration: 600, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
  )
}

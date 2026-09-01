import { useNavigate } from "@tanstack/react-router"

import { allNavItems } from "@/lib/navigation"
import { useIdentity } from "@/lib/session"

/// The small facts every commercial screen needs and no shared module owns.
///
/// Nothing here is a component, so it lives in a `.ts` beside the screens
/// rather than in `components/ui`: these are this module's readings of its own
/// data, not new primitives for the app.

/// Who the command will record as having done this.
///
/// Every commercial write names an `actor_id` and the server has no default —
/// so an empty string here is not a placeholder to send, it is the reason a
/// Publish button is disabled. `username` rather than a display name: the
/// command log holds the identity, not the greeting.
export function useActor(): string {
  const identity = useIdentity()
  return identity.data?.username ?? ""
}

/// `<AppLink>`, for the places a link cannot go.
///
/// `<ExceptionQueue>` takes an `onOpen` callback rather than a destination, so
/// the queue on the overview has to navigate in code. This does what
/// `<AppLink>` does and for the same reason: Router cannot type a generated
/// route tree, so the path is checked against the navigation registry instead —
/// in development a path nothing declares throws where it is written rather
/// than 404ing when somebody clicks it.
export function useGo() {
  const navigate = useNavigate()
  return (to: string) => {
    if (import.meta.env.DEV && !allNavItems.some((item) => item.path === to)) {
      throw new Error(
        `useGo("${to}") — no nav entry declares that path. Add it to the module's nav.ts, or fix the typo.`
      )
    }
    navigate({ to: to as never })
  }
}

/// Basis points as a person reads them.
///
/// A ratio, never money. Every amount on these screens is drawn from the
/// integer minor units the server sent; this exists so a *proportion* — how
/// deep a markdown is, how much of a budget is gone — can be said in one word.
export function percent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`
}

/// How much of a budget has been spent, as 0–1 for `<Meter>`.
///
/// `null` for an unlimited budget, which is not zero and must never be drawn as
/// a full bar — or as an empty one, which would read as "plenty left" when the
/// honest answer is "there is no line to cross".
export function consumed(
  spentMinor: number,
  budgetMinor: number | null
): number | null {
  if (budgetMinor === null || budgetMinor <= 0) return null
  return spentMinor / budgetMinor
}

/// The value a `datetime-local` input wants, from an instant.
export function localInput(at: Date): string {
  const shifted = new Date(at.getTime() - at.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

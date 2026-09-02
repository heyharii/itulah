import { useNavigate } from "@tanstack/react-router"
import type { Effect, Rule } from "@itulah/contract"

import { money } from "@/lib/format"
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

// ── reading a promotion out loud ───────────────────────────────────────────
//
// A rule arrives as `pricing_engine::Rule`, handed back whole by the server
// and typed here from the generated contract. These turn it into the sentence
// a merchandiser would say. They are *readings*, never re-derivations: nothing
// below decides what a rule does, and every branch that a build has not been
// told about falls through to the wire word rather than to a guess.

/// What a rule matches.
export function describeScope(rule: Rule): string {
  const on = rule.scope.applicability
  if (on === null) return "Everything"
  switch (on.on) {
    case "SKU":
      return `${on.sku_codes.length} product${on.sku_codes.length === 1 ? "" : "s"}`
    case "ARTICLE":
      return on.article_codes.length === 1
        ? `Article ${on.article_codes[0]}`
        : `${on.article_codes.length} articles`
    case "DIVISION":
      return on.divisions.length === 1
        ? `Division ${on.divisions[0]}`
        : `${on.divisions.length} divisions`
    case "TAG":
      return on.tags.length === 1
        ? `Tag ${on.tags[0]}`
        : `${on.tags.length} tags`
    case "WHOLE_CART":
      return "The whole basket"
    default:
      return "Everything"
  }
}

/// What it does when it applies.
export function describeEffect(effect: Effect): string {
  switch (effect.kind) {
    case "PERCENT":
      return `${percent(effect.bps)} off${effect.compound ? ", compounding" : ""}`
    case "AMOUNT":
      return `${money(effect.amount.minor)} off the basket`
    case "FIXED_UNIT_PRICE":
      return `${money(effect.unit_price.minor)} each`
    case "FREE_ITEM":
      // Refused on publish today, so it can only be read from a book written
      // before that gate existed. Still said properly rather than shown blank.
      return effect.every_matched_quantity
        ? `${effect.quantity} free per ${effect.every_matched_quantity}`
        : `${effect.quantity} free`
    case "EARN_POINTS":
      return effect.mode === "SPEND_RATE"
        ? `1 point per ${money(effect.spend_per_point.minor)}`
        : `${effect.points} point${effect.points === 1 ? "" : "s"}`
    default:
      return "—"
  }
}

/// Who it is for. Two answers, not three: the engine's `CustomerScope` has
/// `EVERYONE` and `MEMBERS` and no tier arm at all, so a tier control here
/// would be a field that cannot be sent.
export function describeCustomers(rule: Rule): string {
  return rule.scope.customers.who === "MEMBERS" ? "Members" : "Everyone"
}

/// How one cell of the Pricelist grid is named — in the URL, in the selection,
/// and in the map of pending edits.
///
/// One cell is one article at one shop and neither half identifies it alone.
/// Lives here rather than beside the grid because it is shared by the screen
/// and its editor, and a `.tsx` exporting a plain function beside its
/// components loses fast refresh for the file.
export function cellKey(articleCode: string, siteId: string): string {
  return `${articleCode}@${siteId}`
}

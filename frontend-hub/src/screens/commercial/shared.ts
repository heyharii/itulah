import { useNavigate } from "@tanstack/react-router"
import type { Effect, Rule } from "@itulah/contract"

import { count, day, money } from "@/lib/format"
import { oxford } from "@/screens/commercial/compose"
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

// ── the offer, as somebody will have to read it ─────────────────────────────

/// A rule's terms, in the shape a shopper meets an offer in.
///
/// **One reader, two callers.** The composer previews the document it is about
/// to send; the promotion sheet reads the document that was sent. Two readings
/// would drift, and the one that drifted would be the composer's — which is the
/// one somebody trusts before pressing Publish.
///
/// Split in two, and the split is the point. `clauses` are terms: things a
/// shopper could be told and would have to satisfy. `hidden` are true and
/// invisible — nobody at the counter is told the offer stopped because a
/// number in the centre ran out. The console this replaces previewed a rule by
/// calculating it against a sample product, which answers a question the author
/// already knows the answer to; what they cannot hold in their head is the
/// combination, and a promotion that never fires is nearly always a combination
/// nobody read back.
export function termsOf(
  rule: Rule,
  /// A code as a person reads it. The composer has the labels it just picked
  /// from; a published rule carries only codes, and a code is what is shown.
  named: (code: string) => string = (code) => code
): {
  clauses: readonly (string | false)[]
  hidden: readonly (string | false)[]
} {
  const on = rule.scope.applicability
  const conditions = rule.conditions
  const least = conditions.min_quantity
  const spend = conditions.min_amount.minor
  const cart = on === null || on.on === "WHOLE_CART"

  return {
    clauses: [
      appliesTo(rule, named),
      rule.scope.customers.who === "MEMBERS" &&
        "The shopper has to be identified at the till as a member.",
      conditions.effective_from !== null && conditions.effective_to !== null
        ? `It runs from ${day(conditions.effective_from)} to ${day(conditions.effective_to)}, both days included.`
        : conditions.effective_from !== null
          ? `It runs from ${day(conditions.effective_from)}, with no end date.`
          : conditions.effective_to !== null
            ? `It runs until the end of ${day(conditions.effective_to)}.`
            : "It starts the moment it is published and does not stop on its own.",
      // Both thresholds are summed over the lines the rule MATCHED, not over
      // the basket — `check_conditions` in `engine.rs` adds up `quantity` and
      // `gross_total` for `matched` alone. Said as "the basket has to reach
      // Rp 150.000", a rule scoped to two divisions promised something it does
      // not do: a basket of a million rupiah of footwear does not open a
      // menswear offer. Whole-cart is the one scope where matched IS the
      // basket, and only there is the shorter sentence true.
      least > 0 &&
        (cart
          ? `The basket has to hold at least ${count(least)} items.`
          : `At least ${count(least)} of the items it applies to have to be in the basket.`),
      spend > 0 &&
        (cart
          ? `The basket has to reach ${money(spend)}.`
          : `Those items have to come to ${money(spend)} between them — the rest of the basket does not count towards it.`),
      rule.coupon_code !== null &&
        rule.coupon_code !== "" &&
        `The code ${rule.coupon_code} has to be presented at the till.`,
      // Said as the engine behaves rather than as the word suggests: `Alone`
      // is "applies on its own, but loses to a better combination"
      // (`pricing-engine/src/rule.rs`). No control on the form writes it, which
      // is why an offer nobody realised was exclusive is easy to publish.
      rule.stacking === "ALONE"
        ? "It applies on its own — never added to another offer — and the till uses it only when it beats every other combination."
        : rule.stacking === "EXCLUSIVE"
          ? "If it applies, nothing else does."
          : "It combines with every other offer that also shares.",
    ],
    hidden: [
      rule.caps.budget !== null &&
        `it stops once ${money(rule.caps.budget.minor)} has been given away`,
      rule.caps.max_uses !== null &&
        `it stops after ${count(rule.caps.max_uses)} baskets`,
      rule.priority > 0 &&
        `it is ranked ${count(rule.priority)} where two offers cannot both apply`,
    ],
  }
}

/// What a rule matches, in the words its scope promised.
///
/// Each arm says the thing that distinguishes it from the one above — an
/// article carries its colourways and sizes with it, a SKU does not — because
/// "it applies to Kemeja Katun" is the clause somebody reads without noticing
/// they scoped it to one size.
function appliesTo(
  rule: Rule,
  named: (code: string) => string
): string | false {
  const on = rule.scope.applicability
  if (on === null || on.on === "WHOLE_CART")
    return "It applies to the sale itself, not to any particular item."
  switch (on.on) {
    case "ARTICLE": {
      if (on.article_codes.length === 0) return false
      const some = oxford(on.article_codes.map(named))
      return `It applies to ${some} — every colourway and every size of ${on.article_codes.length === 1 ? "it" : "them"}.`
    }
    case "SKU": {
      if (on.sku_codes.length === 0) return false
      return `It applies to ${oxford(on.sku_codes.map(named))} and nothing else — that colourway in that size, not the whole article.`
    }
    case "DIVISION": {
      if (on.divisions.length === 0) return false
      return `It applies to everything filed under ${oxford(on.divisions.map(named))}.`
    }
    case "TAG": {
      if (on.tags.length === 0) return false
      return `It applies to anything tagged ${oxford(on.tags.map(named))}, however it is filed.`
    }
    default:
      return false
  }
}

import { useNavigate } from "@tanstack/react-router"
import type {
  Caps,
  Conditions,
  Effect,
  Rule,
  RuleScope,
} from "@itulah/contract"

import { count, day, money, percentBps, span } from "@/lib/format"
import type { PromotionTotals } from "@/lib/queries/commercial-performance"
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
  return percentBps(bps)
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

// ── adding up what the offers did ──────────────────────────────────────────

/// Add up a list of performance rows without pretending the total is a fleet
/// figure.
///
/// Money, counts and units add; **customers do not**. Two campaigns that both
/// served the same shopper would count them twice, and the server ships no
/// distinct roll-up, so those two report the largest single row rather than a
/// sum — the honest lower bound, said out loud where they are drawn.
///
/// One caveat the caller has to carry, because it is a property of the list
/// and not of this function: **rows overlap unless they are RULES.** A
/// promotion fact is one row per `(sale, rule)`, so summing rules is exact;
/// summing campaigns counts a basket twice when two campaigns both touched it,
/// which is why `performance.rs` ships no fleet total of its own.
export function fold(
  rows: readonly PromotionTotals[]
): PromotionTotals & { readonly overlapping: boolean } {
  const add = (read: (one: PromotionTotals) => number) =>
    rows.reduce((total, one) => total + read(one), 0)
  const most = (read: (one: PromotionTotals) => number) =>
    rows.reduce((highest, one) => Math.max(highest, read(one)), 0)
  return {
    benefit_minor: add((one) => one.benefit_minor),
    clearance_minor: add((one) => one.clearance_minor),
    sale_count: add((one) => one.sale_count),
    basket_revenue_minor: add((one) => one.basket_revenue_minor),
    units: add((one) => one.units),
    cost_minor: add((one) => one.cost_minor),
    costed_units: add((one) => one.costed_units),
    customer_count: most((one) => one.customer_count),
    new_customer_count: most((one) => one.new_customer_count),
    overlapping: rows.length > 1,
  }
}

/// Percentage change against the previous window of the same length, or `null`
/// when there is nothing to compare against. Zero to something is not "infinite
/// per cent", it is new — and is drawn as such.
export function delta(now: number, before: number): number | null {
  if (before === 0) return null
  return Math.round(((now - before) / before) * 1000) / 10
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

// A rule document is only as new as the book it was published in, and a book is
// frozen. Every optional field on `pricing_engine::Rule` carries
// `#[serde(default)]`, so a promotion written before `scope` — or `conditions`,
// or `caps` — existed is still applied by every till in the fleet, which reads
// it through that parse and notices nothing missing.
//
// The centre normalises the same way before it answers now
// (`cloud/postgres/catalogue.rs::canonical`), and that is the fix. These three
// are the second line: a hub deployed ahead of its node reads books that node
// has not normalised yet, and the failure mode is not a blank cell but a thrown
// `TypeError` inside a table cell, which takes the entire screen down — fifteen
// legible promotions replaced by "Something went wrong!" because one row was
// published in March. A list that cannot show a row must still show the rest.
//
// The defaults are the engine's own, not a guess: `RuleScope::default()` is
// unscoped and open to everyone, `Conditions::default()` demands nothing,
// `Caps::default()` limits nothing.

const NO_SCOPE: RuleScope = {
  applicability: null,
  excluded_sku_codes: [],
  site_ids: [],
  channels: [],
  customers: { who: "EVERYONE" },
  effect_on: null,
}

const NO_CONDITIONS: Conditions = {
  min_quantity: 0,
  max_quantity: null,
  min_amount: { minor: 0 },
  max_amount: null,
  effective_from: null,
  effective_to: null,
  days: { iso_weekdays: [] },
  time_window: null,
}

const NO_CAPS: Caps = {
  budget: null,
  spent: { minor: 0 },
  max_uses: null,
  used: 0,
}

/// The three fields a stored document may predate, read the way the engine
/// reads them. Exported because the screens reach for `caps` and `conditions`
/// directly as well as through the sentences below.
export function scopeOf(rule: Rule): RuleScope {
  return rule.scope ?? NO_SCOPE
}

export function conditionsOf(rule: Rule): Conditions {
  return rule.conditions ?? NO_CONDITIONS
}

export function capsOf(rule: Rule): Caps {
  return rule.caps ?? NO_CAPS
}

/// What a rule matches.
///
/// `named` turns a code into the word a person reads, where the caller holds
/// the list that knows it (divisions, tags); a code is shown otherwise.
export function describeScope(
  rule: Rule,
  named: (code: string) => string = (code) => code
): string {
  const on = scopeOf(rule).applicability
  if (on === null) return "Everything"
  switch (on.on) {
    case "SKU":
      return `${on.sku_codes.length} SKU${on.sku_codes.length === 1 ? "" : "s"}`
    case "ARTICLE":
      return on.article_codes.length === 1
        ? `Article ${named(on.article_codes[0])}`
        : `${on.article_codes.length} articles`
    case "DIVISION":
      // The name alone when there is one; a bare code still says what it is.
      return on.divisions.length === 1
        ? named(on.divisions[0]) === on.divisions[0]
          ? `Division ${on.divisions[0]}`
          : named(on.divisions[0])
        : `${on.divisions.length} divisions`
    case "TAG":
      return on.tags.length === 1
        ? `Tagged ${named(on.tags[0])}`
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
    case "BUY_X_GET_Y":
      return `Buy ${count(effect.buy)}, get ${count(effect.get)} at ${percent(effect.reward_bps)} off`
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
  return scopeOf(rule).customers.who === "MEMBERS" ? "Members" : "Everyone"
}

/// When it runs, or `null` when it does not say.
///
/// `null` is the answer most rules give — a shop that publishes an offer and
/// takes it down by hand never writes a window — and it is handed back rather
/// than worded so the caller can draw *nothing*. A column reading "Always on"
/// fifteen times is the same noise a column of "Unlimited" was: the two rows
/// that do have a window are the ones somebody is scanning for, and they only
/// stand out if the rest is blank.
export function describePeriod(rule: Rule): string | null {
  const conditions = conditionsOf(rule)
  if (conditions.effective_from === null && conditions.effective_to === null)
    return null
  return span(conditions.effective_from, conditions.effective_to)
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
  const on = scopeOf(rule).applicability
  const conditions = conditionsOf(rule)
  const least = conditions.min_quantity
  const spend = conditions.min_amount.minor
  const cart = on === null || on.on === "WHOLE_CART"

  return {
    clauses: [
      appliesTo(rule, named),
      scopeOf(rule).customers.who === "MEMBERS" &&
        "The shopper has to be identified at the POS as a member.",
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
        `The code ${rule.coupon_code} has to be presented at the POS.`,
      // Excluded unless the rule says otherwise — the engine's default, and
      // what "not valid on sale items" means.
      (rule.markdown_policy ?? "EXCLUDE") === "ALLOW"
        ? "It also applies to items already marked down."
        : "It does not apply to items already marked down.",
      withOthers(rule),
      rule.effect.kind === "EARN_POINTS" && pointsWith(rule),
    ],
    hidden: [
      capsOf(rule).budget !== null &&
        `it stops once ${money(capsOf(rule).budget!.minor)} has been given away`,
      capsOf(rule).max_uses !== null &&
        `it stops after ${count(capsOf(rule).max_uses!)} baskets`,
      // Lower goes first since D03.
      rule.priority > 0 &&
        `when offers compete it is tried in position ${count(rule.priority)} — lower numbers go first`,
    ],
  }
}

/// How it sits beside other offers: `stacking` read together with
/// `exclusive_scope`, which only means something when the rule will not share.
///
/// `Alone` is "applies on its own, but loses to a better combination"
/// (`pricing-engine/src/rule.rs`), so that half is only said for it.
function withOthers(rule: Rule): string {
  if (rule.stacking === "STACKABLE")
    return "It combines with every other offer that also shares."
  const line = (rule.exclusive_scope ?? "BASKET") === "LINE"
  const shuts = line
    ? "no other offer applies to the same items — offers on the rest of the basket still do"
    : "no other offer applies anywhere in the basket"
  return rule.stacking === "EXCLUSIVE"
    ? `If it applies, ${shuts}.`
    : `It is never added to another offer: when the POS uses it, ${shuts}, and it uses it only when that comes out better than the alternatives.`
}

/// What a points rate is worth on an item a better rate already reached.
function pointsWith(rule: Rule): string {
  switch (rule.points_combination ?? "HIGHEST") {
    case "ADD":
      return "Where a better points rate already applies to an item, its extra over the everyday rate is added on top."
    case "COMPOUND":
      return "Where another points rate already applies to an item, the two are multiplied."
    default:
      return "Where a better points rate already applies to an item, this one adds nothing."
  }
}

/// Whether the promotion form can write this rule back without losing its
/// effect. The form writes five effects; a free item or a flat points bonus
/// was published by something else and can only be read.
export function authorable(rule: Rule): boolean {
  switch (rule.effect.kind) {
    case "PERCENT":
    case "AMOUNT":
    case "FIXED_UNIT_PRICE":
    case "BUY_X_GET_Y":
      return true
    case "EARN_POINTS":
      return rule.effect.mode === "SPEND_RATE"
    default:
      return false
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
  const on = scopeOf(rule).applicability
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

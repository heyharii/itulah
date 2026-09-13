import type {
  Caps,
  Conditions,
  Effect,
  Rule,
  RuleScope,
} from "@itulah/contract"

import { amount, count, day } from "@/lib/format"
import type { PriceLevel } from "@/modules/commercial/wire"

/// This module's readings of its own data — and not one of its decisions.
///
/// A `.ts` beside the screens rather than a `.tsx`, for the same reason
/// `people/labels.ts` is: a file that exports a mix of components and plain
/// functions is one React cannot hot-swap, and these are read from column
/// definitions that must not drag a component graph along.
///
/// **Everything here is a READING, never a re-derivation.** Nothing below
/// decides what a promotion does, what a price is, or whether an offer is
/// live — the engine decides all three and the server answers. Every branch a
/// build has not been told about falls through to the word on the wire rather
/// than to a guess: a status this screen cannot name is still a status
/// somebody has to deal with, and dropping it is how a promotion nobody can
/// see is one nobody turns off.

// ── the price cascade ──────────────────────────────────────────────────────

/// Why a price is the price, in the words the engine uses for it.
///
/// The cascade runs narrowest first — a price naming one shop beats one naming
/// a group, which beats a tier, which beats the company default — and a
/// markdown replaces the winner outright.
export function describeSource(source: string): string {
  switch (source) {
    case "SITE_PRICE":
      return "This shop's own price"
    case "SITE_GROUP_PRICE":
      return "A price for a group of shops"
    case "TIER_PRICE":
      return "A tier price"
    case "COMPANY_PRICE":
      return "The company price"
    case "MARKDOWN":
      return "Clearance"
    default:
      return source
  }
}

/// The short word for the same thing, for a cell rather than a sentence.
export function sourceWord(source: string): string {
  switch (source) {
    case "SITE_PRICE":
      return "Shop"
    case "SITE_GROUP_PRICE":
      return "Group"
    case "TIER_PRICE":
      return "Tier"
    case "COMPANY_PRICE":
      return "Company"
    case "MARKDOWN":
      return "Clearance"
    default:
      return source
  }
}

/// Who a candidate was written for.
export function describeLevel(level: PriceLevel | undefined): string {
  if (level === undefined) return "—"
  switch (level.level) {
    case "SITE":
      return level.site_id
    case "SITE_GROUP":
      return `${count(level.site_ids.length)} shops`
    case "COMPANY":
      return "Every shop"
    default:
      return "—"
  }
}

// ── a promotion, read out loud ─────────────────────────────────────────────
//
// A rule arrives as `pricing_engine::Rule`, handed back whole and typed from
// the generated contract. The three defaults below are the engine's own —
// `RuleScope::default()` is unscoped and open to everyone, `Conditions` demands
// nothing, `Caps` limits nothing — and they exist because the contract types
// all three as always present while `canonical()` on the server passes an
// UNPARSEABLE document through untouched. That row is rare and it is the one
// worth seeing; without these three reads it would throw inside a table cell
// and take the whole list down, fifteen legible promotions replaced by an
// error because one was published in March.

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

export function scopeOf(rule: Rule): RuleScope {
  return rule.scope ?? NO_SCOPE
}

export function conditionsOf(rule: Rule): Conditions {
  return rule.conditions ?? NO_CONDITIONS
}

export function capsOf(rule: Rule): Caps {
  return rule.caps ?? NO_CAPS
}

/// What a rule matches, in four words.
export function describeScope(rule: Rule): string {
  const on = scopeOf(rule).applicability
  if (on === null) return "Everything"
  switch (on.on) {
    case "SKU":
      return on.sku_codes.length === 1
        ? on.sku_codes[0]
        : `${count(on.sku_codes.length)} products`
    case "ARTICLE":
      return on.article_codes.length === 1
        ? on.article_codes[0]
        : `${count(on.article_codes.length)} styles`
    case "DIVISION":
      return on.divisions.length === 1
        ? on.divisions[0]
        : `${count(on.divisions.length)} divisions`
    case "TAG":
      return on.tags.length === 1
        ? `Tagged ${on.tags[0]}`
        : `${count(on.tags.length)} tags`
    case "WHOLE_CART":
      return "The whole basket"
    default:
      return "Everything"
  }
}

/// What it does when it applies.
export function describeEffect(effect: Effect | undefined): string {
  if (effect === undefined) return "—"
  switch (effect.kind) {
    case "PERCENT":
      return `${percent(effect.bps)} off${effect.compound ? ", compounding" : ""}`
    case "AMOUNT":
      return `Rp ${amount(effect.amount.minor)} off the basket`
    case "FIXED_UNIT_PRICE":
      return `Rp ${amount(effect.unit_price.minor)} each`
    case "FREE_ITEM":
      // Refused on publish today, so it can only be read out of a book written
      // before that gate existed. Still said properly rather than left blank.
      return effect.every_matched_quantity
        ? `${count(effect.quantity)} free per ${count(effect.every_matched_quantity)}`
        : `${count(effect.quantity)} free`
    case "EARN_POINTS":
      return effect.mode === "SPEND_RATE"
        ? `1 point per Rp ${amount(effect.spend_per_point.minor)}`
        : `${count(effect.points)} point${effect.points === 1 ? "" : "s"}`
    default:
      return "—"
  }
}

/// Who it is for. Two answers and not three: the engine's `CustomerScope` has
/// `EVERYONE` and `MEMBERS` and no tier arm at all, so a tier reading here
/// would name something that cannot be written.
export function membersOnly(rule: Rule): boolean {
  return scopeOf(rule).customers?.who === "MEMBERS"
}

/// A rule's terms, in the shape a shopper meets an offer in.
///
/// Split in two, and the split is the point. `clauses` are terms — things a
/// shopper could be told and would have to satisfy. `hidden` are true and
/// invisible: nobody at the counter is told the offer stopped because a number
/// in the centre ran out.
///
/// **Not a calculator.** The console this replaces previewed a rule by working
/// it against a sample product, which answers a question the author already
/// knows. What nobody can hold in their head is the COMBINATION — eight fields
/// spread down a form, three of them conditions that must all hold before any
/// of it happens, one of them a code without which none of it does. A promotion
/// that never fires is nearly always a combination nobody read back.
export function termsOf(rule: Rule): {
  readonly clauses: readonly string[]
  readonly hidden: readonly string[]
} {
  const scope = scopeOf(rule)
  const conditions = conditionsOf(rule)
  const caps = capsOf(rule)
  const on = scope.applicability
  const cart = on === null || on.on === "WHOLE_CART"
  const least = conditions.min_quantity
  const spend = conditions.min_amount.minor

  const clauses = [
    appliesTo(rule),
    membersOnly(rule) &&
      "The shopper has to be identified at the till as a member.",
    window_(conditions.effective_from, conditions.effective_to),
    // Both thresholds are summed over the lines the rule MATCHED, not over the
    // basket — `check_conditions` in `engine.rs` adds up the matched lines
    // alone. Said as "the basket has to reach Rp 150.000", a rule scoped to two
    // divisions promises something it does not do: a million rupiah of footwear
    // does not open a menswear offer. Whole-cart is the one scope where matched
    // IS the basket, and only there is the shorter sentence true.
    least > 0 &&
      (cart
        ? `The basket has to hold at least ${count(least)} items.`
        : `At least ${count(least)} of the items it applies to have to be in the basket.`),
    spend > 0 &&
      (cart
        ? `The basket has to reach Rp ${amount(spend)}.`
        : `Those items have to come to Rp ${amount(spend)} between them — the rest of the basket does not count towards it.`),
    rule.coupon_code !== null &&
      rule.coupon_code !== "" &&
      `The code ${rule.coupon_code} has to be presented at the till.`,
    // Said as the engine behaves rather than as the word suggests: `ALONE` is
    // "applies on its own, but loses to a better combination". No control
    // writes it, which is why an offer nobody realised was exclusive is easy to
    // publish.
    rule.stacking === "ALONE"
      ? "It applies on its own — never added to another offer — and the till uses it only when it beats every other combination."
      : rule.stacking === "EXCLUSIVE"
        ? "If it applies, nothing else does."
        : "It combines with every other offer that also shares.",
  ]

  const hidden = [
    caps.budget !== null &&
      `it stops once Rp ${amount(caps.budget.minor)} has been given away`,
    caps.max_uses !== null && `it stops after ${count(caps.max_uses)} baskets`,
    rule.priority > 0 &&
      `it is ranked ${count(rule.priority)} where two offers cannot both apply`,
  ]

  return { clauses: kept(clauses), hidden: kept(hidden) }
}

function kept(lines: readonly (string | false)[]): readonly string[] {
  return lines.filter((line): line is string => Boolean(line))
}

function window_(from: string | null, to: string | null): string {
  if (from !== null && to !== null) {
    return `It runs from ${day(from)} to ${day(to)}, both days included.`
  }
  if (from !== null) return `It runs from ${day(from)}, with no end date.`
  if (to !== null) return `It runs until the end of ${day(to)}.`
  return "It starts the moment it is published and does not stop on its own."
}

/// What a rule matches, in the words its scope promised.
///
/// Each arm says the thing that distinguishes it from the one above — an
/// article carries its colourways and sizes with it, a SKU does not — because
/// "it applies to Kemeja Katun" is the clause somebody reads without noticing
/// they scoped it to one size.
function appliesTo(rule: Rule): string | false {
  const on = scopeOf(rule).applicability
  if (on === null || on.on === "WHOLE_CART") {
    return "It applies to the sale itself, not to any particular item."
  }
  switch (on.on) {
    case "ARTICLE":
      if (on.article_codes.length === 0) return false
      return `It applies to ${oxford(on.article_codes)} — every colourway and every size of ${on.article_codes.length === 1 ? "it" : "them"}.`
    case "SKU":
      if (on.sku_codes.length === 0) return false
      return `It applies to ${oxford(on.sku_codes)} and nothing else — that colourway in that size, not the whole style.`
    case "DIVISION":
      if (on.divisions.length === 0) return false
      return `It applies to everything filed under ${oxford(on.divisions)}.`
    case "TAG":
      if (on.tags.length === 0) return false
      return `It applies to anything tagged ${oxford(on.tags)}, however it is filed.`
    default:
      return false
  }
}

/// A list of names as a sentence, capped so a term does not become a paragraph.
///
/// The cap is what keeps a rule scoped to forty styles readable as one clause.
function oxford(names: readonly string[], most = 3): string {
  if (names.length === 0) return ""
  if (names.length === 1) return names[0]
  if (names.length <= most) {
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  }
  return `${names.slice(0, most).join(", ")} and ${count(names.length - most)} more`
}

// ── statuses ───────────────────────────────────────────────────────────────

type Tone = "neutral" | "ok" | "warn" | "bad" | "info"

/// `RuleStatus` — `DRAFT | ACTIVE | PAUSED | EXPIRED`, from the engine.
export function ruleStatus(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "ACTIVE":
      return { label: "Live", tone: "ok" }
    case "PAUSED":
      return { label: "Paused", tone: "warn" }
    case "DRAFT":
      return { label: "Draft", tone: "neutral" }
    case "EXPIRED":
      return { label: "Expired", tone: "neutral" }
    default:
      return { label: status, tone: "neutral" }
  }
}

/// The six a campaign actually has, from the `commercial_campaign.status` check
/// constraint. Kept whole rather than folded to four: "cancelled" and "expired"
/// are different endings and only one of them was somebody's decision.
export function campaignStatus(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "ACTIVE":
      return { label: "Live", tone: "ok" }
    case "SCHEDULED":
      return { label: "Scheduled", tone: "info" }
    case "PAUSED":
      return { label: "Paused", tone: "warn" }
    case "DRAFT":
      return { label: "Draft", tone: "neutral" }
    case "EXPIRED":
      return { label: "Expired", tone: "neutral" }
    case "CANCELLED":
      return { label: "Cancelled", tone: "bad" }
    default:
      return { label: status, tone: "neutral" }
  }
}

/// Live, spent, stopped. `expired` is deliberately not among them: a card past
/// its date is still ACTIVE with a balance on it — what changed is the clock,
/// not the record — so it is drawn as a SECOND mark. Folding the two would mean
/// a card could be un-expired by editing a status, which is exactly backwards.
export function voucherStatus(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "ACTIVE":
      return { label: "Live", tone: "ok" }
    case "SPENT":
      return { label: "Spent", tone: "neutral" }
    case "VOIDED":
      return { label: "Stopped", tone: "bad" }
    default:
      return { label: status, tone: "neutral" }
  }
}

/// The three kinds of voucher, and why the shop cares which it is: the
/// accounting differs at the moment of issue.
export function voucherKind(kind: string): string {
  switch (kind) {
    case "GIFT_CARD":
      return "Gift card"
    case "REFUND":
      return "Refund"
    case "GOODWILL":
      return "Goodwill"
    default:
      return kind
  }
}

export function movementKind(kind: string): string {
  switch (kind) {
    case "ISSUE":
      return "Issued"
    case "REDEEM":
      return "Spent"
    case "VOID":
      return "Written off"
    default:
      return kind
  }
}

// ── proportions ────────────────────────────────────────────────────────────

/// Basis points as a person reads them.
///
/// A ratio, never money. Every amount on these screens is drawn from the
/// integer minor units the server sent; this exists so a PROPORTION can be said
/// in one word without a float ever touching a price.
export function percent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`
}

/// How much of a budget has been spent, as 0–1.
///
/// `null` for an unlimited budget, which is not zero and must never be drawn as
/// a full meter — nor as an empty one, which reads as "plenty left" when the
/// honest answer is "there is no line to cross".
export function consumed(
  spentMinor: number,
  budgetMinor: number | null,
): number | null {
  if (budgetMinor === null || budgetMinor <= 0) return null
  return spentMinor / budgetMinor
}

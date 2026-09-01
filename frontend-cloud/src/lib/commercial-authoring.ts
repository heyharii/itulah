import { node } from "@/lib/api"
import type { CommercialChannel } from "@/lib/commercial"
import { parseMoneyToMinor } from "@/lib/money"

/// Writing a price book.
///
/// The reading half of commercial lives in `commercial.ts`; this is the half
/// that authors. It is separate because the two have different failure modes
/// and different readers: a screen that shows a wrong price is embarrassing,
/// and a screen that WRITES a wrong price charges thirty shops for it until
/// somebody notices.
///
/// Shapes transcribed from `CreateCommercialPublicationRequest` in
/// `backend/src/cloud/application/mod.rs`, and validated against
/// `validate_publication_request` in `cloud/postgres/commercial.rs`. Nothing
/// checks them at build time — see the note at the top of `commercial.ts`.
///
/// # What the server refuses, and why it is repeated here
///
/// The rules below are enforced server-side and always will be; the copies in
/// this file exist so an author is told at the keyboard rather than after
/// pressing Save. Where they disagree, the server wins — these are a courtesy,
/// never the guard.

/// The cascade a price is written at.
///
/// One level per price, never two: the server refuses a row claiming to be both
/// a shop price and a group price, because there would be no single right
/// reading and picking one silently is how a till and the centre come to
/// disagree.
///
/// `TIER` is deliberately absent. The engine understands it, the schema holds
/// it, and no customer carries one — so a tier price would publish, dispatch,
/// and never match anybody. The server refuses it for exactly that reason.
export type PriceLevel = "COMPANY" | "SITE_GROUP" | "SITE"

export interface OfferRuleInput {
  readonly sku_id: string
  readonly sku_code?: string | null
  readonly site_id?: string | null
  readonly site_ids?: readonly string[] | null
  readonly channel: CommercialChannel
  readonly currency: string
  readonly unit_price_minor: number
  readonly tax_category: string
  readonly posting_class?: string | null
}

export interface TaxRuleInput {
  readonly tax_category: string
  readonly rate_bps: number
  readonly tax_inclusive: boolean
}

/// A clearance price that REPLACES the base for the goods it names.
///
/// Not a discount on top of one — that is a promotion. The distinction is the
/// one thing about this model worth learning: a markdown is the new price of
/// the shirt, and promotions come off whatever the shirt now costs.
export interface MarkdownInput {
  readonly markdown_id: string
  readonly sku_code?: string | null
  readonly article_code?: string | null
  readonly site_id?: string | null
  readonly site_ids?: readonly string[] | null
  readonly replacement_unit_price_minor: number
  readonly priority: number
  readonly effective_from: string
  readonly effective_to?: string | null
}

export interface CouponInput {
  readonly code: string
  readonly rule_id: string
  readonly active: boolean
  readonly customer_id?: string | null
  readonly valid_from?: string | null
  readonly valid_to?: string | null
  readonly max_uses?: number | null
}

export interface CampaignInput {
  readonly campaign_id: string
  readonly name: string
  readonly status: "ACTIVE" | "PAUSED" | "ENDED"
  readonly valid_from?: string | null
  readonly valid_to?: string | null
  readonly budget_minor?: number | null
  readonly max_uses?: number | null
  readonly max_uses_per_customer?: number | null
}

/// What a promotion matches.
///
/// The engine is never told how a SKU code is built — it is handed the article
/// and the division on the cart line by the caller who owns that format. A
/// pricing engine that parses SKU codes is one that breaks when they change.
export type ApplicabilityInput =
  | { readonly on: "SKU"; readonly sku_codes: readonly string[] }
  | { readonly on: "ARTICLE"; readonly article_codes: readonly string[] }
  | { readonly on: "DIVISION"; readonly divisions: readonly string[] }
  | { readonly on: "TAG"; readonly tags: readonly string[] }
  | { readonly on: "WHOLE_CART" }

/// What a promotion does.
///
/// A closed set rather than a bag of optional fields, matching
/// `pricing_engine::Effect`: a rule that takes a percentage off cannot also be
/// carrying half a free-item effect, because there is nowhere to put one.
///
/// `MARGIN` is absent for the same reason `TIER` is: no cart line carries a
/// cost, so a margin rule would never fire.
export type EffectInput =
  | { readonly kind: "PERCENT"; readonly bps: number; readonly compound: boolean }
  | { readonly kind: "AMOUNT"; readonly amount: number }
  | { readonly kind: "FIXED_UNIT_PRICE"; readonly unit_price: number }
  | {
      readonly kind: "FREE_ITEM"
      readonly sku_code: string | null
      readonly quantity: number
      readonly every_matched_quantity: number | null
      readonly after_matched_quantity: number
      readonly unit_price: number
    }
  | {
      readonly kind: "EARN_POINTS"
      readonly mode: "SPEND_RATE" | "FIXED_POINTS" | "POINTS_PER_QUANTITY"
      readonly spend_per_point?: number
      readonly points?: number
    }

export interface RuleInput {
  readonly rule_id: string
  readonly campaign_id?: string | null
  readonly name: string
  readonly status: "ACTIVE" | "PAUSED" | "ARCHIVED"
  readonly scope: {
    readonly applicability: ApplicabilityInput | null
    readonly excluded_sku_codes: readonly string[]
    readonly site_ids: readonly string[]
    readonly channels: readonly string[]
    readonly customers: { readonly who: "EVERYONE" | "MEMBERS" }
    readonly effect_on?: ApplicabilityInput | null
  }
  readonly conditions: {
    readonly min_quantity: number
    readonly max_quantity?: number | null
    readonly min_amount: number
    readonly max_amount?: number | null
    readonly effective_from?: string | null
    readonly effective_to?: string | null
    readonly days: { readonly iso_weekdays: readonly number[] }
    readonly time_window?: { readonly from_minute: number; readonly to_minute: number } | null
  }
  readonly effect: EffectInput
  readonly coupon_code?: string | null
  readonly max_discount?: number | null
  readonly caps: {
    readonly budget?: number | null
    readonly max_uses?: number | null
    readonly max_uses_per_customer?: number | null
  }
  readonly priority: number
  readonly stacking: "STACKABLE" | "EXCLUSIVE"
  readonly advisory: boolean
  readonly earn_basis?: "POST_MARKDOWN_PRE_DISCOUNT" | "POST_DISCOUNT_NET" | "ORIGINAL"
  readonly max_points?: number | null
}

export interface CreatePriceBookRequest {
  readonly version: number
  readonly name: string
  readonly effective_from: string
  readonly effective_to: string | null
  readonly tax_rules: readonly TaxRuleInput[]
  readonly offer_rules: readonly OfferRuleInput[]
  readonly markdowns: readonly MarkdownInput[]
  readonly rules: readonly RuleInput[]
  readonly coupons: readonly CouponInput[]
  readonly campaigns: readonly CampaignInput[]
  readonly actor_id: string
  readonly idempotency_key: string
}

export interface CreatedPriceBook {
  readonly publication_id: string
  readonly version: number
  readonly status: string
  readonly offer_count: number
  readonly markdown_count: number
  readonly rule_count: number
  readonly coupon_count: number
  readonly campaign_count: number
}

/// Write the book. It is a DRAFT until somebody publishes it.
///
/// Two steps rather than one because they are two decisions: writing a price is
/// a merchandiser's, and sending it to thirty tills is somebody's to approve.
/// Publishing is where the dispatch happens, in the same transaction.
export function createPriceBook(
  request: CreatePriceBookRequest,
  signal?: AbortSignal,
): Promise<CreatedPriceBook> {
  return node.post<CreatedPriceBook>("/api/v1/commercial/publications", request, { signal })
}

/// A book carries no tax, because this business does not charge any.
///
/// The field is not optional server-side when a book sets prices — an offer
/// names a tax category and the category has to exist — so one zero-rated,
/// tax-inclusive class is sent and the author is never asked about it. Nothing
/// downstream divides a price into net and tax: the shops do not model it at
/// all, and the centre's split would be zero either way.
export const NO_TAX: TaxRuleInput = {
  tax_category: "STANDARD",
  rate_bps: 0,
  tax_inclusive: true,
}

// ---------------------------------------------------------------------------
// The draft a person is editing
// ---------------------------------------------------------------------------

/// What the screen holds while somebody is still typing.
///
/// Deliberately not the wire shapes. Money is a string here because a half-typed
/// price is a real state and `NaN` is not a number anybody meant; the level is
/// one field rather than three mutually-exclusive ones, because the server
/// refuses a row that names two and a form that can express the refusal is a
/// form that produces it.
///
/// `key` is a local identity for React and never leaves this file's converters.
/// Rows have no server id until the book is saved, and keying on array position
/// makes a deleted row take its neighbour's text with it.

export interface PriceDraft {
  key: string
  sku_id: string
  sku_code: string
  article_name: string
  /// What it costs today, so the author can see what they are changing. Null
  /// when no published book has ever named it.
  current_minor: number | null
  price: string
  level: PriceLevel
  site_id: string
  site_ids: string[]
  channel: CommercialChannel
}

export interface MarkdownDraft {
  key: string
  /// A markdown names one product or a whole style, never neither — that would
  /// be a markdown on the entire shop, and both the centre and every shop
  /// refuse it.
  target: "SKU" | "ARTICLE"
  sku_code: string
  article_code: string
  label: string
  current_minor: number | null
  price: string
  level: PriceLevel
  site_id: string
  site_ids: string[]
  from: string
  to: string
}

export interface PromotionDraft {
  key: string
  rule_id: string
  name: string
  campaign_id: string
  matches: "SKU" | "ARTICLE" | "DIVISION" | "TAG" | "WHOLE_CART"
  /// Comma-separated as typed. Split on save, because a person pasting a list
  /// of codes should not have to press Add between each one.
  targets: string
  effect: "PERCENT" | "AMOUNT" | "FIXED_UNIT_PRICE" | "FREE_ITEM" | "EARN_POINTS"
  percent: string
  amount: string
  freeSku: string
  freeQuantity: string
  freeEveryMatched: string
  pointsMode: "SPEND_RATE" | "FIXED_POINTS" | "POINTS_PER_QUANTITY"
  pointsValue: string
  minQuantity: string
  minAmount: string
  from: string
  to: string
  weekdays: number[]
  couponCode: string
  siteIds: string[]
  budget: string
  maxUses: string
  maxDiscount: string
  priority: string
  stacking: "STACKABLE" | "EXCLUSIVE"
  membersOnly: boolean
}

export interface CampaignDraft {
  key: string
  campaign_id: string
  name: string
  status: "ACTIVE" | "PAUSED" | "ENDED"
  from: string
  to: string
  budget: string
  maxUses: string
  maxUsesPerCustomer: string
}

export interface CouponDraft {
  key: string
  code: string
  rule_id: string
  active: boolean
  maxUses: string
  from: string
  to: string
}

/// Rupiah as typed → minor units. Empty and unreadable both become null, and
/// the caller decides which of those is an error.
///
/// `parseMoneyToMinor` rather than a parser of its own: it already knows that a
/// dot in "200.000" is a thousands separator in Indonesian and not a decimal
/// point, and a second parser that got that wrong would take two hundred
/// thousand rupiah for two hundred.
export function minorOf(text: string): number | null {
  return parseMoneyToMinor(text)
}

/// A promotion's id, assigned when the promotion is created and never
/// recomputed.
///
/// It used to be derived from the name at save time, and that was a bug with a
/// quiet failure: a coupon points at a promotion BY id, so renaming the
/// promotion after attaching a coupon changed the id out from under it and the
/// server refused the whole book — "coupon unlocks a promotion this publication
/// does not define" — naming a rule the author had never typed.
///
/// The suffix is random rather than sequential because ids outlive their book:
/// usage is counted per rule id across every publication, so two books both
/// starting at R1 would pool their totals into one number that describes
/// neither promotion.
export function newRuleId(): string {
  return `R-${crypto.randomUUID().slice(0, 6).toUpperCase()}`
}

function count(text: string): number | null {
  const value = Number(text.trim())
  return text.trim() !== "" && Number.isSafeInteger(value) && value > 0 ? value : null
}

/// A date as the browser's `datetime-local` gives it → an instant the server
/// will accept. Empty means unbounded, which is a real answer and not a gap.
export function instantOf(text: string): string | null {
  if (text.trim() === "") return null
  const at = new Date(text)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

function targetsOf(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter((value) => value !== "")
}

function scopeSites(level: PriceLevel, siteId: string, siteIds: string[]) {
  return {
    site_id: level === "SITE" && siteId !== "" ? siteId : null,
    site_ids: level === "SITE_GROUP" && siteIds.length > 0 ? siteIds : null,
  }
}

export function toOfferRules(drafts: readonly PriceDraft[]): OfferRuleInput[] {
  return drafts.flatMap((draft) => {
    const minor = minorOf(draft.price)
    if (draft.sku_id === "" || minor === null) return []
    return [
      {
        sku_id: draft.sku_id,
        sku_code: draft.sku_code,
        ...scopeSites(draft.level, draft.site_id, draft.site_ids),
        channel: draft.channel,
        currency: "IDR",
        unit_price_minor: minor,
        tax_category: NO_TAX.tax_category,
      },
    ]
  })
}

export function toMarkdowns(drafts: readonly MarkdownDraft[]): MarkdownInput[] {
  return drafts.flatMap((draft, index) => {
    const minor = minorOf(draft.price)
    const names =
      draft.target === "SKU" ? draft.sku_code.trim() : draft.article_code.trim()
    if (names === "" || minor === null) return []
    return [
      {
        // Readable rather than a UUID: this id is what a usage report and a
        // receipt investigation show, and "MD-KEM001-3" answers a question that
        // a random string does not.
        markdown_id: `MD-${names}-${index + 1}`.toUpperCase(),
        sku_code: draft.target === "SKU" ? names : null,
        article_code: draft.target === "ARTICLE" ? names : null,
        ...scopeSites(draft.level, draft.site_id, draft.site_ids),
        replacement_unit_price_minor: minor,
        priority: 0,
        effective_from: instantOf(draft.from) ?? new Date().toISOString(),
        effective_to: instantOf(draft.to),
      },
    ]
  })
}

function applicabilityOf(draft: PromotionDraft): ApplicabilityInput | null {
  const values = targetsOf(draft.targets)
  switch (draft.matches) {
    case "SKU":
      return values.length > 0 ? { on: "SKU", sku_codes: values } : null
    case "ARTICLE":
      return values.length > 0 ? { on: "ARTICLE", article_codes: values } : null
    case "DIVISION":
      return values.length > 0 ? { on: "DIVISION", divisions: values } : null
    case "TAG":
      return values.length > 0 ? { on: "TAG", tags: values } : null
    case "WHOLE_CART":
      return { on: "WHOLE_CART" }
  }
}

function effectOf(draft: PromotionDraft): EffectInput | null {
  switch (draft.effect) {
    case "PERCENT": {
      const percent = Number(draft.percent)
      if (draft.percent.trim() === "" || !Number.isFinite(percent) || percent <= 0) {
        return null
      }
      // Basis points, so 12.5% survives the trip. A percentage stored as a
      // percentage forces a rounding decision nobody wrote down.
      return { kind: "PERCENT", bps: Math.round(percent * 100), compound: false }
    }
    case "AMOUNT": {
      const minor = minorOf(draft.amount)
      return minor === null ? null : { kind: "AMOUNT", amount: minor }
    }
    case "FIXED_UNIT_PRICE": {
      const minor = minorOf(draft.amount)
      return minor === null ? null : { kind: "FIXED_UNIT_PRICE", unit_price: minor }
    }
    case "FREE_ITEM": {
      const quantity = count(draft.freeQuantity)
      if (quantity === null) return null
      return {
        kind: "FREE_ITEM",
        sku_code: draft.freeSku.trim() === "" ? null : draft.freeSku.trim(),
        quantity,
        every_matched_quantity: count(draft.freeEveryMatched),
        after_matched_quantity: 0,
        unit_price: 0,
      }
    }
    case "EARN_POINTS": {
      if (draft.pointsMode === "SPEND_RATE") {
        const minor = minorOf(draft.pointsValue)
        return minor === null
          ? null
          : { kind: "EARN_POINTS", mode: "SPEND_RATE", spend_per_point: minor }
      }
      const points = count(draft.pointsValue)
      return points === null
        ? null
        : { kind: "EARN_POINTS", mode: draft.pointsMode, points }
    }
  }
}

/// What is still missing before a promotion could be saved.
///
/// Returned as sentences rather than a boolean so the screen can say which
/// field, next to that field. A promotion refused by the server after Save is
/// a promotion whose author has already left the page.
export function promotionProblems(draft: PromotionDraft): string[] {
  const problems: string[] = []
  if (draft.name.trim() === "") problems.push("Give it a name.")
  if (draft.rule_id.trim() === "") problems.push("Give it a code.")
  if (applicabilityOf(draft) === null) {
    problems.push("Say what it applies to.")
  }
  if (effectOf(draft) === null) problems.push("Say what it takes off.")
  return problems
}

export function toRules(drafts: readonly PromotionDraft[]): RuleInput[] {
  return drafts.flatMap((draft) => {
    const applicability = applicabilityOf(draft)
    const effect = effectOf(draft)
    if (
      applicability === null ||
      effect === null ||
      draft.name.trim() === "" ||
      draft.rule_id.trim() === ""
    ) {
      return []
    }
    return [
      {
        rule_id: draft.rule_id.trim(),
        campaign_id: draft.campaign_id.trim() === "" ? null : draft.campaign_id.trim(),
        name: draft.name.trim(),
        status: "ACTIVE",
        scope: {
          applicability,
          excluded_sku_codes: [],
          site_ids: draft.siteIds,
          channels: [],
          customers: { who: draft.membersOnly ? "MEMBERS" : "EVERYONE" },
        },
        conditions: {
          min_quantity: count(draft.minQuantity) ?? 0,
          min_amount: minorOf(draft.minAmount) ?? 0,
          effective_from: instantOf(draft.from),
          effective_to: instantOf(draft.to),
          days: { iso_weekdays: draft.weekdays },
          time_window: null,
        },
        effect,
        coupon_code: draft.couponCode.trim() === "" ? null : draft.couponCode.trim(),
        max_discount: minorOf(draft.maxDiscount),
        caps: {
          budget: minorOf(draft.budget),
          max_uses: count(draft.maxUses),
          max_uses_per_customer: null,
        },
        priority: Number(draft.priority) || 0,
        stacking: draft.stacking,
        advisory: false,
      },
    ]
  })
}

export function toCampaigns(drafts: readonly CampaignDraft[]): CampaignInput[] {
  return drafts.flatMap((draft) => {
    if (draft.campaign_id.trim() === "" || draft.name.trim() === "") return []
    return [
      {
        campaign_id: draft.campaign_id.trim(),
        name: draft.name.trim(),
        status: draft.status,
        valid_from: instantOf(draft.from),
        valid_to: instantOf(draft.to),
        budget_minor: minorOf(draft.budget),
        max_uses: count(draft.maxUses),
        max_uses_per_customer: count(draft.maxUsesPerCustomer),
      },
    ]
  })
}

export function toCoupons(drafts: readonly CouponDraft[]): CouponInput[] {
  return drafts.flatMap((draft) => {
    if (draft.code.trim() === "" || draft.rule_id.trim() === "") return []
    return [
      {
        code: draft.code.trim().toUpperCase(),
        rule_id: draft.rule_id.trim(),
        active: draft.active,
        customer_id: null,
        valid_from: instantOf(draft.from),
        valid_to: instantOf(draft.to),
        max_uses: count(draft.maxUses),
      },
    ]
  })
}

/**
 * Response contracts for commercial — the Go cloud-hub described in
 * `api.ts` and `writes.ts`. See `docs/recipe-response-contracts.md` for the
 * strictness rules this file follows, and `src/lib/api/contract.ts` for why a
 * mismatch here does not throw in production.
 *
 * Money on this hub is a plain integer, and the whole hub is single-currency
 * (IDR, per the header comment in `api.ts`) — no payload in this domain ever
 * carries a currency field to be explicit *about*, so "explicit currency"
 * here means: every money field is `z.number().int()`, never a bare
 * `z.number()`, and the IDR assumption is written down once, here, rather
 * than re-guessed at each field.
 *
 * Two boundaries live in this one file:
 *
 *  - **Wire** schemas match `writes.ts`'s per-row GET/PUT contracts. These
 *    are the `api.get<Type>` casts the recipe calls population 1 — the type
 *    now comes *from* the schema, so the hand-written interfaces are gone.
 *  - **Row** schemas match the raw objects `api.ts`'s defensive mappers
 *    read (`campaignFromApi`, `promotionFromApi`, …). These feed
 *    `checkContract` after the envelope is unwrapped; the mapper functions
 *    themselves are untouched.
 */

import { z } from "zod"

/* ── shared enums ─────────────────────────────────────────────────────
 * These four are the only enums in the domain the UI actually switches on:
 * each has its own closed `{value, label}[]` picker *and* an onChange zod
 * validator in forms.tsx that already hard-codes the same literal set. An
 * unrecognized value would not crash, but it would land in a form with no
 * option selected and fail the picker's own validator — that is the
 * "unknown status renders undefined" failure the recipe means. Every other
 * enum-shaped field in this domain (`status`, `kind`, `apply_on`, `effect`,
 * `customer_scope`, `earn_mode`, `earn_basis`, voucher `type`/`status`, …)
 * is already typed as a plain `string` in `writes.ts` and `api.ts` — the
 * codebase already chose to display rather than switch on those, so their
 * schemas stay `z.string()` below.
 */

export const MarkdownTypeWire = z.enum(["fixed", "amount", "percentage"])
export type MarkdownTypeWire = z.infer<typeof MarkdownTypeWire>

export const MarkdownStatusWire = z.enum([
  "draft",
  "scheduled",
  "active",
  "expired",
  "cancelled",
])
export type MarkdownStatusWire = z.infer<typeof MarkdownStatusWire>

export const CampaignStatusWire = z.enum([
  "draft",
  "scheduled",
  "active",
  "completed",
  "cancelled",
])
export type CampaignStatusWire = z.infer<typeof CampaignStatusWire>

export const VoucherTypeWire = z.enum([
  "percent_off",
  "fixed_amount",
  "free_item",
  "points_exchange",
])
export type VoucherTypeWire = z.infer<typeof VoucherTypeWire>

/* Go slices marshal a nil/omitted slice as `null`, not `[]` — `api.ts`'s own
 * `listFromPayload` says as much for `/v1/masterdata/locations`, and
 * `writes.ts` already falls back with `current.store_ids ?? []` / `?? []` in
 * more than one retire path. Folding here means every consumer gets a real
 * array without having to guess whether this endpoint is one of the ones
 * that nils it. */
const stringArray = z
  .array(z.string())
  .nullish()
  .transform((value) => value ?? [])

/* ── writes.ts: the per-row authoring boundary ────────────────────────── */

/**
 * `internal/pricingengine.Rule`, in full. PUT replaces the row, so every
 * field the hub can hold is here — see the docstring on `PricingRuleWire`
 * in `writes.ts` for why. `status`, `kind`, `apply_on`, `effect`,
 * `customer_scope`, `earn_mode` and `earn_basis` stay `z.string()`: they are
 * plain strings on the hub too, not Go enum types, and the sheet's own
 * `Option[]` pickers already tolerate a value outside their list without
 * failing (see the shared-enum note above).
 */
export const PricingRuleWire = z.object({
  id: z.string(),
  campaign_id: z.string(),
  name: z.string(),
  status: z.string(),
  kind: z.string(),
  apply_on: z.string(),
  skus: stringArray,
  article_ids: stringArray,
  divisions: stringArray,
  tags: stringArray,
  excluded_skus: stringArray,
  store_ids: stringArray,
  store_groups: stringArray,
  channels: stringArray,
  customer_scope: z.string(),
  tier_ids: stringArray,
  other_apply_on: z.string(),
  other_skus: stringArray,
  other_article_ids: stringArray,
  other_divisions: stringArray,
  other_tags: stringArray,
  min_qty: z.number(),
  max_qty: z.number(),
  // Order-value thresholds gating the rule, not a discount — still money.
  min_amount: z.number().int(),
  max_amount: z.number().int(),
  valid_from: z.string().nullable(),
  valid_to: z.string().nullable(),
  days_of_week: z.number(),
  time_from: z.number(),
  time_to: z.number(),
  coupon_id: z.string(),
  is_cumulative: z.boolean(),
  advisory: z.boolean(),
  effect: z.string(),
  // A ratio (hundredths of a percent), not money.
  percent_bps: z.number(),
  amount: z.number().int(),
  fixed_price: z.number().int(),
  margin_bps: z.number(),
  max_discount: z.number().int(),
  compound: z.boolean(),
  free_sku: z.string(),
  same_item: z.boolean(),
  free_qty: z.number(),
  recurse_for: z.number(),
  recursion_over: z.number(),
  round_free_qty: z.boolean(),
  free_item_price: z.number().int(),
  priority: z.number(),
  exclusive: z.boolean(),
  stack_with_other_rules: z.boolean(),
  stack_with_voucher: z.boolean(),
  stack_with_points: z.boolean(),
  stack_with_employee: z.boolean(),
  max_uses: z.number(),
  usage_count: z.number(),
  budget: z.number().int(),
  budget_used: z.number().int(),
  // A usage cap, counted like `max_uses` — not a money amount.
  per_customer_max: z.number(),
  earn_mode: z.string(),
  // Rupiah spent per loyalty point earned — money.
  spend_per_point: z.number().int(),
  // A point count, not money.
  earn_points: z.number(),
  earn_basis: z.string(),
  exclude_markdown_items: z.boolean(),
  // Loyalty-point caps and budgets — points, not money.
  earn_cap_per_rule: z.number(),
  earn_cap_per_txn: z.number(),
  earn_budget_points: z.number(),
  earn_budget_used: z.number(),
})
export type PricingRuleWire = z.infer<typeof PricingRuleWire>

/**
 * `commercial.PriceList`. No store/tier scope on the hub's columns — see
 * `writes.ts` — so there is nothing to model here beyond identity and the
 * two flags.
 */
export const PriceListWire = z.object({
  list_id: z.string(),
  name: z.string(),
  description: z.string(),
  is_default: z.boolean(),
  is_active: z.boolean(),
})
export type PriceListWire = z.infer<typeof PriceListWire>

/**
 * `commercial.PriceEntry`. `article_id` stays optional to match the hub,
 * which only requires a SKU on an entry.
 */
export const PriceEntryWire = z.object({
  entry_id: z.string(),
  list_id: z.string(),
  sku: z.string(),
  article_id: z.string().optional(),
  base_price: z.number().int(),
  sale_price: z.number().int().nullish(),
  cost_price: z.number().int().nullish(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  priority: z.number(),
  is_active: z.boolean(),
})
export type PriceEntryWire = z.infer<typeof PriceEntryWire>

/**
 * `commercial.Markdown`. `markdown_value` is deliberately not `.int()`:
 * it is a `decimal.Decimal` on the hub and arrives as a JSON string — see
 * `docs/money-contract.md` — and depending on `markdown_type` it holds
 * either a money amount or a basis-point ratio, so there is no single
 * numeric contract to hold it to without guessing which one it is this row.
 */
export const MarkdownWire = z.object({
  markdown_id: z.string(),
  name: z.string(),
  sku: z.string(),
  article_id: z.string(),
  list_id: z.string(),
  original_price: z.number().int(),
  markdown_price: z.number().int(),
  markdown_type: MarkdownTypeWire,
  markdown_value: z.union([z.number(), z.string()]),
  start_date: z.string(),
  end_date: z.string(),
  store_ids: stringArray,
  reason: z.string(),
  status: MarkdownStatusWire,
})
export type MarkdownWire = z.infer<typeof MarkdownWire>

/**
 * `commercial.Campaign`. `budget` is a `*money.Money` on the hub — omitted
 * or null both mean "uncapped", which `.nullish()` carries through exactly
 * rather than collapsing to zero.
 */
export const CampaignWire = z.object({
  campaign_id: z.string(),
  name: z.string(),
  description: z.string(),
  theme: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  status: CampaignStatusWire,
  promo_ids: stringArray,
  store_ids: stringArray,
  budget: z.number().int().nullish(),
})
export type CampaignWire = z.infer<typeof CampaignWire>

/**
 * The voucher route, projected by hand rather than marshalled from a Go
 * struct — the one camelCase corner of the hub (see `writes.ts`). `type`
 * and `status` stay `z.string()`: this projection does not even claim the
 * closed set `VoucherTypeWire` describes for the *draft* side.
 */
export const VoucherWire = z.object({
  id: z.string(),
  code: z.string(),
  type: z.string(),
  status: z.string(),
  expiryDate: z.string(),
})
export type VoucherWire = z.infer<typeof VoucherWire>

/** The envelope `GET /v1/commercial/vouchers` answers with. */
export const VoucherListEnvelope = z.object({
  items: z.array(VoucherWire).nullish(),
})
export type VoucherListEnvelope = z.infer<typeof VoucherListEnvelope>

/* ── api.ts: raw rows behind the defensive mappers ────────────────────── */

/**
 * The row `campaignFromApi` reads. Loose everywhere the mapper is already
 * loose (`text(raw.name, id)` tolerates a missing name); `campaign_id` is
 * checked because a row without one is silently dropped from the list, which
 * is exactly the kind of loss `checkContract` exists to surface.
 */
export const CampaignRow = z.object({
  campaign_id: z.string(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  theme: z.string().nullish(),
  status: z.string().nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  budget: z.number().int().nullish(),
  budget_used: z.number().int().nullish(),
  store_ids: stringArray,
  promo_ids: stringArray,
  kpis: z
    .object({
      // Incremental revenue attributed to the campaign — money.
      sales_lift: z.number().int().nullish(),
      transactions: z.number().nullish(),
      discount_given: z.number().int().nullish(),
      // Return on ad/discount spend — a ratio, not money.
      roas: z.number().nullish(),
      participation_pct: z.number().nullish(),
    })
    .nullish(),
})
export type CampaignRow = z.infer<typeof CampaignRow>

export const PromotionRow = z.object({
  promo_id: z.string(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  status: z.string().nullish(),
  promo_type: z.string().nullish(),
  priority: z.number().nullish(),
  stackable: z.boolean().nullish(),
  store_ids: stringArray,
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  max_uses: z.number().int().nullish(),
  usage_count: z.number().nullish(),
  rules: z
    .object({
      // `money.Bps`, not a whole percent — see `promotionFromApi`.
      discount_percent: z.number().nullish(),
      discount_amount: z.number().int().nullish(),
      buy_qty: z.number().nullish(),
      get_qty: z.number().nullish(),
      included_skus: stringArray,
    })
    .nullish(),
})
export type PromotionRow = z.infer<typeof PromotionRow>

/** One value of the `code`-keyed coupon map `/v1/pricing-engine/coupons`
 * answers with — `couponFromApi` reads the same fields off each. */
export const CouponRow = z.object({
  code: z.string(),
  name: z.string().nullish(),
  kind: z.string().nullish(),
  rule_id: z.string().nullish(),
  campaign_id: z.string().nullish(),
  member_id: z.string().nullish(),
  valid_from: z.string().nullish(),
  valid_to: z.string().nullish(),
  max_uses: z.number().nullish(),
  used: z.number().nullish(),
  require_online: z.boolean().nullish(),
  status: z.string().nullish(),
})
export type CouponRow = z.infer<typeof CouponRow>

/**
 * The row `voucherFromApi` reads — the same hand-projected, camelCase
 * corner as `VoucherWire` above, but this is the *list* route, which
 * carries the full value fields the single-row route does not.
 */
export const VoucherRow = z.object({
  id: z.string(),
  code: z.string(),
  type: z.string().nullish(),
  voucherType: z.string().nullish(),
  discountPct: z.number().nullish(),
  valueIdr: z.number().int().nullish(),
  minSpend: z.number().int().nullish(),
  // A loyalty-points figure, not currency, despite sitting beside money
  // fields on this row.
  pointsValue: z.number().nullish(),
  redeemableViaLoyalty: z.boolean().nullish(),
  singleUse: z.boolean().nullish(),
  redeemedCount: z.number().nullish(),
  expiryDate: z.string().nullish(),
  issuedToCustomerId: z.string().nullish(),
  issuedToCustomerName: z.string().nullish(),
  initialValue: z.number().int().nullish(),
  balance: z.number().int().nullish(),
  status: z.string().nullish(),
})
export type VoucherRow = z.infer<typeof VoucherRow>

export const PriceEntryRow = z.object({
  entry_id: z.string(),
  sku: z.string().nullish(),
  article_id: z.string().nullish(),
  base_price: z.number().int().nullish(),
  sale_price: z.number().int().nullish(),
  list_id: z.string().nullish(),
  cost_price: z.number().int().nullish(),
  priority: z.number().nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  is_active: z.boolean().nullish(),
})
export type PriceEntryRow = z.infer<typeof PriceEntryRow>

export const PriceListRow = z.object({
  list_id: z.string(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  is_default: z.boolean().nullish(),
  is_active: z.boolean().nullish(),
})
export type PriceListRow = z.infer<typeof PriceListRow>

export const MarkdownRow = z.object({
  markdown_id: z.string(),
  sku: z.string().nullish(),
  article_id: z.string().nullish(),
  name: z.string().nullish(),
  list_id: z.string().nullish(),
  original_price: z.number().int().nullish(),
  markdown_price: z.number().int().nullish(),
  markdown_type: z.string().nullish(),
  // A decimal string on the wire — see `MarkdownWire` above.
  markdown_value: z.union([z.number(), z.string()]).nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  store_ids: stringArray,
  reason: z.string().nullish(),
  status: z.string().nullish(),
})
export type MarkdownRow = z.infer<typeof MarkdownRow>

export const PricingRuleRow = z.object({
  id: z.string(),
  campaign_id: z.string().nullish(),
  name: z.string().nullish(),
  status: z.string().nullish(),
  kind: z.string().nullish(),
  apply_on: z.string().nullish(),
  skus: stringArray,
  article_ids: stringArray,
  divisions: stringArray,
  tags: stringArray,
  store_ids: stringArray,
  store_groups: stringArray,
  channels: stringArray,
  customer_scope: z.string().nullish(),
  tier_ids: stringArray,
  min_qty: z.number().nullish(),
  max_qty: z.number().nullish(),
  min_amount: z.number().int().nullish(),
  max_amount: z.number().int().nullish(),
  valid_from: z.string().nullish(),
  valid_to: z.string().nullish(),
  coupon_id: z.string().nullish(),
  effect: z.string().nullish(),
  percent_bps: z.number().nullish(),
  amount: z.number().int().nullish(),
  fixed_price: z.number().int().nullish(),
  free_sku: z.string().nullish(),
  free_qty: z.number().nullish(),
  priority: z.number().nullish(),
  exclusive: z.boolean().nullish(),
  stack_with_other_rules: z.boolean().nullish(),
  max_uses: z.number().nullish(),
  usage_count: z.number().nullish(),
  budget: z.number().int().nullish(),
  budget_used: z.number().int().nullish(),
})
export type PricingRuleRow = z.infer<typeof PricingRuleRow>

/** A row off `/v1/masterdata/locations`, scoped by `storeFromApi`. */
export const StoreRow = z.object({
  location_id: z.string(),
  code: z.string().nullish(),
  name: z.string().nullish(),
  location_type: z.string().nullish(),
  is_active: z.boolean().nullish(),
})
export type StoreRow = z.infer<typeof StoreRow>

export const DivisionRow = z.object({
  id: z.string(),
  name: z.string().nullish(),
})
export type DivisionRow = z.infer<typeof DivisionRow>

/** A tier off the loyalty-program config's own `tiers` array. */
export const TierRow = z.object({
  tier_id: z.string(),
  name: z.string().nullish(),
  level: z.number().nullish(),
})
export type TierRow = z.infer<typeof TierRow>

export const ReturnPolicyRow = z.object({
  policy_id: z.string().nullish(),
  id: z.string().nullish(),
  name: z.string().nullish(),
  scope: z.string().nullish(),
  days: z.number().nullish(),
})
export type ReturnPolicyRow = z.infer<typeof ReturnPolicyRow>

/**
 * `/v1/masterdata/items/enriched` — the SKU master doubling as the
 * catalogue, per the docstring on `CommercialArticle` in `api.ts`.
 */
export const ArticleRow = z.object({
  sku: z.string(),
  category_id: z.string().nullish(),
  division_id: z.string().nullish(),
  name: z.string().nullish(),
  status: z.string().nullish(),
  default_image_url: z.string().nullish(),
  sell_price: z.number().int().nullish(),
})
export type ArticleRow = z.infer<typeof ArticleRow>

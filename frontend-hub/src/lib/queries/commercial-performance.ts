import { node } from "@/lib/api"

/// Performa: what the offers did, as opposed to what the book says they do.
///
/// The rest of `commercial.ts` reads the book — what a shop will be charged,
/// which rules are live, what a campaign is allowed to spend. These three reads
/// come from the sale facts instead, which is the only place a windowed,
/// per-shop answer exists: the usage counters the centre keeps are exact and
/// have no window, so they can say a rule spent four million and never say
/// whether that was last week or last March.
///
/// These shapes are hand-written, the same exception `commercial.ts` makes and
/// for the same reason: the handlers build their bodies with `json!()` in
/// `cloud/postgres/performance.rs` rather than serialising a struct, so ts-rs
/// has nothing to generate from and nothing checks these interfaces against the
/// server at build time. They are transcribed from those literals — if a field
/// moves, this file is where it goes stale.
///
/// Money is in minor units and stays an integer. Nothing here divides: the
/// return-per-rupiah tile the screen draws is `basket_revenue_minor` over
/// `benefit_minor`, and it is computed in the component that draws it, because
/// it is a ratio rather than money and rounding it server-side would put a
/// float among a page of exact integers.

// ── how to read every number below ─────────────────────────────────────────

/// How revenue was attributed to an offer.
///
/// `BASKET` means the whole basket counts as the offer's revenue whenever the
/// offer fired on it, even if it only discounted one item of three. The centre
/// records promotions as `(sale_id, rule_id)` and never recorded which lines
/// matched, so this is the only attribution available today. It is the standard
/// measure — "influenced revenue" — and it overstates.
///
/// It is a field rather than an assumption so that the day the edge starts
/// reporting matched lines, the number changing is a visible change on the
/// screen and not a silent one.
export type Attribution = "BASKET"

/// What every performance response opens with: what was asked, and how to read
/// the answer.
export interface PerformanceEnvelope {
  readonly attribution: Attribution
  /// When the server computed this. Not the end of the window — a window can
  /// close in the future, and a chart labelled with `to` would claim to know
  /// about sales that have not happened.
  readonly as_of: string
  readonly from: string
  readonly to: string
  /// The start of the window of equal length immediately before `from`, which
  /// is what every `previous` block below was measured over. Carried rather
  /// than recomputed, so the label on a delta is the period it came from.
  readonly previous_from: string
  readonly site_id: string | null
}

/// The aggregates every promotion key reports, over one window.
///
/// The same five numbers appear at the top level of a row and again inside its
/// `previous`, which is what makes a delta a subtraction rather than a second
/// request.
export interface PromotionTotals {
  /// What the offer took off the tills. `SUM(edge_sale_promotion.benefit_minor)`.
  readonly benefit_minor: number
  /// Baskets, not promotion rows. A campaign whose two rules both fired on one
  /// basket counts that basket once.
  readonly sale_count: number
  /// The whole of every basket the offer touched — see `Attribution`.
  readonly basket_revenue_minor: number
  /// Distinct shoppers the till could name. Anonymous sales are counted in
  /// `sale_count` and in revenue, and in nobody here.
  readonly customer_count: number
  /// Of those, the ones whose first purchase ANYWHERE, ever, falls inside this
  /// window. Not filtered by shop on purpose: somebody who has shopped with us
  /// for years is not a new customer because this is their first visit to this
  /// branch.
  readonly new_customer_count: number
}

/// One day of trading, as a sparkline wants it.
export interface PerformancePoint {
  /// A UTC calendar day, `YYYY-MM-DD`. Bucketed in UTC rather than in the
  /// server's local zone so the same window gives the same buckets wherever it
  /// is asked from.
  readonly day: string
  readonly benefit_minor: number
  readonly sale_count: number
  readonly basket_revenue_minor: number
}

/// The row shape shared by campaigns, rules and coupons: what it did now, what
/// it did before, and the shape of the days in between.
export interface PromotionPerformance extends PromotionTotals {
  /// The campaign id, rule id or coupon code. Present on every row under a
  /// stable name, so a table component can key rows without knowing which of
  /// the three lists it was handed.
  readonly key: string
  readonly previous: PromotionTotals
  /// Empty when nothing sold in the window. Never null.
  readonly series: readonly PerformancePoint[]
  /// Which published book the description on this row came out of, and `null`
  /// when no published book declares this key at all — a shop still charging
  /// against a book the centre has replaced. When it is null, every descriptive
  /// field on the row is null too and only the measured numbers are real.
  readonly publication_version: number | null
}

// ── campaigns ──────────────────────────────────────────────────────────────

/// A superset of the four states the old screen drew. Straight from the
/// `commercial_campaign.status` check constraint.
export type CampaignStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "ACTIVE"
  | "PAUSED"
  | "EXPIRED"
  | "CANCELLED"

export interface CampaignPerformance extends PromotionPerformance {
  readonly campaign_id: string
  readonly name: string | null
  readonly status: CampaignStatus | null
  /// For the whole window, not per day — there is no daily budget. Null means
  /// unlimited, which is not the same as zero and must not draw an empty meter.
  readonly budget_minor: number | null
  readonly max_uses: number | null
  readonly max_uses_per_customer: number | null
  readonly valid_from: string | null
  readonly valid_to: string | null
}

/// Every campaign that either took money in the window or is declared by the
/// newest published book.
///
/// There is deliberately no fleet total. Summing the rows would double-count
/// every basket two campaigns both touched, and a total that is wrong in a way
/// nobody can see is worse than no total at all.
export interface CampaignPerformanceReport extends PerformanceEnvelope {
  readonly campaigns: readonly CampaignPerformance[]
}

// ── rules and coupons ──────────────────────────────────────────────────────

export interface RulePerformance extends PromotionPerformance {
  readonly rule_id: string
  readonly name: string | null
  readonly status: string | null
  readonly priority: number | null
  /// The envelope this rule sits in, when it has one. A rule is live only when
  /// both it and its campaign are, so a paused campaign explains a rule that
  /// stopped earning without the rule itself changing.
  readonly campaign_id: string | null
  readonly budget_minor: number | null
  readonly max_uses: number | null
}

export interface CouponPerformance extends PromotionPerformance {
  readonly coupon_code: string
  /// A coupon is a gate on a rule, never an offer of its own, so the rule it
  /// unlocks is the first thing to show beside it.
  readonly rule_id: string | null
  readonly active: boolean | null
  /// Set when the coupon was issued to one shopper.
  readonly customer_id: string | null
  readonly valid_from: string | null
  readonly valid_to: string | null
  readonly max_uses: number | null
}

/// Both lists in one response because they are one screen. A coupon discounts
/// nothing itself — it unlocks a rule — so a coupon's takings and its rule's
/// takings are read together or misread apart.
///
/// The two lists overlap on purpose: a sale on `HEMAT10` appears under the
/// coupon AND under the rule it unlocked. Adding them together double-counts.
export interface RulePerformanceReport extends PerformanceEnvelope {
  readonly rules: readonly RulePerformance[]
  readonly coupons: readonly CouponPerformance[]
}

// ── pricelist ──────────────────────────────────────────────────────────────

/// One price a product actually sold at, and how much went out at it.
///
/// Grouped by the price CHARGED rather than the price currently published,
/// because the question is what happened. A size that sold forty at full price
/// and sixty on clearance is two entries, and averaging them would hide the one
/// fact the report exists to show.
export interface PriceBandPerformance {
  readonly unit_price_minor: number
  /// Null from a shop that sold with no book in force. Null rather than
  /// `COMPANY_PRICE`: "no book said so" and "the company price said so" are
  /// different facts. `describeSource()` in `commercial.ts` names the rest.
  readonly price_source: string | null
  readonly publication_version: number | null
  readonly units: number
  readonly revenue_minor: number
}

export interface SkuPerformance {
  readonly sku_code: string
  readonly color: string | null
  readonly size: string | null
  readonly units: number
  readonly revenue_minor: number
  /// Stock the fleet can still sell — operational places in a normal state,
  /// narrowed to one shop when `site_id` was given. Zero rather than null when
  /// the projection holds nothing: it carries a row for every place holding
  /// stock and nothing for the rest.
  readonly on_hand: number
  readonly prices: readonly PriceBandPerformance[]
}

/// One style: what its products sold for, how many are left, and what the last
/// order paid for them.
///
/// Margin is not here, on purpose. `cost_unit_minor` is an ARTICLE-level number
/// — a purchase order names a style, not a size — so a per-size margin would
/// divide a real number by an assumption. Subtract the two if you must, and say
/// on screen that the cost is per style.
export interface PricelistPerformanceReport extends PerformanceEnvelope {
  readonly article_code: string
  readonly article_name: string
  readonly division_code: string | null
  /// Always `"ARTICLE_LATEST_PO"` today. A field rather than a comment so that
  /// a better cost basis — a weighted average, a landed cost — arrives as a
  /// value the screen can read and label.
  readonly cost_basis: "ARTICLE_LATEST_PO"
  /// The unit price on the most recent issued or closed purchase order for the
  /// style. Null when nothing was ever ordered, which is not zero.
  readonly cost_unit_minor: number | null
  readonly cost_source: { readonly po_number: string; readonly ordered_at: string } | null
  /// Totals across the style, for the window.
  readonly units: number
  readonly revenue_minor: number
  readonly on_hand: number
  readonly skus: readonly SkuPerformance[]
}

// ── the filter bar ─────────────────────────────────────────────────────────

/// The three parameters all three reads share, so one filter bar carries across
/// the three Performa tabs and a link to a period is a link to the same period
/// in each.
///
/// Everything is optional: the server defaults to the last thirty days, which
/// is what a merchandiser means by "how is it going".
export interface PerformanceScope {
  readonly from?: string | null
  readonly to?: string | null
  readonly siteId?: string | null
}

function scopeParams(scope: PerformanceScope): URLSearchParams {
  const params = new URLSearchParams()
  if (scope.from) params.set("from", scope.from)
  if (scope.to) params.set("to", scope.to)
  if (scope.siteId) params.set("site_id", scope.siteId)
  return params
}

// ── keys ───────────────────────────────────────────────────────────────────

/// Keys live beside the function that fetches them, and share the `commercial`
/// namespace so signing out drops these answers with the rest of the module's
/// by prefix.
///
/// The window is part of every key because a different window is a different
/// question with a different answer — and because two tabs open on two periods
/// must not overwrite each other's cache entry.
export const performanceKeys = {
  all: ["commercial", "performance"] as const,
  campaigns: (scope: PerformanceScope) =>
    [
      "commercial",
      "performance",
      "campaigns",
      scope.from ?? "default",
      scope.to ?? "now",
      scope.siteId ?? "all",
    ] as const,
  rules: (scope: PerformanceScope) =>
    [
      "commercial",
      "performance",
      "rules",
      scope.from ?? "default",
      scope.to ?? "now",
      scope.siteId ?? "all",
    ] as const,
  pricelist: (articleCode: string, scope: PerformanceScope) =>
    [
      "commercial",
      "performance",
      "pricelist",
      articleCode,
      scope.from ?? "default",
      scope.to ?? "now",
      scope.siteId ?? "all",
    ] as const,
}

// ── reads ──────────────────────────────────────────────────────────────────

export function campaignPerformance(
  scope: PerformanceScope,
  signal?: AbortSignal
): Promise<CampaignPerformanceReport> {
  const params = scopeParams(scope)
  return node.get<CampaignPerformanceReport>(
    `/api/v1/commercial/performance/campaigns?${params.toString()}`,
    { signal }
  )
}

export function rulePerformance(
  scope: PerformanceScope,
  signal?: AbortSignal
): Promise<RulePerformanceReport> {
  const params = scopeParams(scope)
  return node.get<RulePerformanceReport>(
    `/api/v1/commercial/performance/rules?${params.toString()}`,
    { signal }
  )
}

/// One style at a time. There is no fleet-wide version of this read: without an
/// article it would be the whole sales ledger rather than a pricing question.
export function pricelistPerformance(
  articleCode: string,
  scope: PerformanceScope,
  signal?: AbortSignal
): Promise<PricelistPerformanceReport> {
  const params = scopeParams(scope)
  params.set("article_code", articleCode)
  return node.get<PricelistPerformanceReport>(
    `/api/v1/commercial/performance/pricelist?${params.toString()}`,
    { signal }
  )
}

import type {
  CampaignFacets,
  PromotionFacets,
  CampaignActivityInput,
  CampaignActivityRow,
  CampaignBaselineView,
  CampaignBreachRow,
  CampaignGuardrailInput,
  CampaignGuardrailReading,
  CampaignGuardrailRow,
  CampaignOutcomeView,
  CampaignPerDayView,
  CampaignPlanInput,
  CampaignPlanView,
  CampaignReadingView,
  CampaignScopeEntry,
  CampaignScopeView,
  CampaignTargetInput,
  CampaignTargetScore,
  CampaignWindowView,
  ChangeKind,
  GuardrailCheckReport,
  PriceHistory,
  Rule,
  RuleStatus,
} from "@itulah/contract"
import { infiniteQueryOptions } from "@tanstack/react-query"

import type { Filter } from "@/lib/filters"

import { node } from "@/lib/api"

/// Commercial is pricing, and nothing else.
///
/// The centre owns price books, markdowns, promotions and coupons; it does not
/// own stock, tax authority or the sale. Everything below reads or writes one
/// of the `/api/v1/commercial/*` routes in `cloud/http/mod.rs`.
///
/// These shapes are hand-written, the same exception `procurement.ts` makes and
/// for the same reason: the handlers build their bodies with `json!()` in
/// `cloud/postgres/commercial.rs` rather than serialising a struct, so ts-rs
/// has nothing to generate from and nothing checks these interfaces against the
/// server at build time. They are transcribed from those literals — if a field
/// moves, this file is where it goes stale, and it is the first place to look
/// when a column reads `undefined`.
///
/// Money is in minor units everywhere and stays an integer until `money()`
/// draws it. The one arithmetic allowed on it here is integer subtraction of
/// two minor amounts (budget less spend), which is exact; anything that would
/// need a float is asked of the server instead.

export type CommercialChannel = "STORE" | "ONLINE" | "MARKETPLACE"

export const CHANNELS: readonly CommercialChannel[] = [
  "STORE",
  "ONLINE",
  "MARKETPLACE",
]

export type PublicationStatus = "DRAFT" | "PUBLISHED"

/// The cascade, narrowest first, and then the two things that replace it.
///
/// This is `pricing_engine::PriceSource`, and there is exactly one spelling of
/// it on the wire: `PriceSource::as_str()`, which a Rust test holds equal to
/// the serialised form. It used to be two — a shop rendered `COMPANY_PRICE`
/// while the centre rendered `CompanyPrice` — and a screen reading one showed a
/// blank badge against the other node.
export type PriceSource =
  | "SITE_PRICE"
  | "SITE_GROUP_PRICE"
  | "TIER_PRICE"
  | "COMPANY_PRICE"
  | "MARKDOWN"
  | "MANUAL_OVERRIDE"

/// The words a merchandiser would use for each rung.
///
/// The default arm is load-bearing and getting more so: `TIER_PRICE` and
/// `MANUAL_OVERRIDE` are on their way out of the engine, and a rung this build
/// has not been told about has to render as the word the server sent rather
/// than as a blank badge. Nothing written since reaches for either name.
export function describeSource(source: string): string {
  switch (source) {
    case "SITE_PRICE":
      return "Store price"
    case "SITE_GROUP_PRICE":
      return "Group price"
    case "TIER_PRICE":
      return "Member tier"
    case "COMPANY_PRICE":
      return "Company price"
    case "MARKDOWN":
      return "Sale price"
    case "MANUAL_OVERRIDE":
      return "Typed in"
    default:
      // A rung this build has not been told about is passed through rather
      // than guessed at: a price whose origin we cannot name is not a company
      // price.
      return source
  }
}

// ── the books ──────────────────────────────────────────────────────────────

/// One price book on the list.
///
/// `offer_count` is the number of price rules it carries, which is not the
/// number of products a shop can sell: a book is a list of changes, not a full
/// replacement, and anything it does not mention keeps the price the last book
/// gave it. See the publish check in `cloud/postgres/commercial.rs`.
export interface PriceBook {
  readonly id: string
  readonly version: number
  readonly name: string
  readonly status: PublicationStatus
  readonly effective_from: string
  readonly effective_to: string | null
  readonly created_by: string
  readonly created_at: string
  readonly published_by: string | null
  readonly published_at: string | null
  readonly offer_count: number
}

export interface BookPriceRule {
  readonly sku_code: string
  readonly article_code: string
  readonly article_name: string
  readonly site_id: string | null
  readonly site_ids: readonly string[] | null
  readonly tier: string | null
  readonly channel: CommercialChannel
  readonly sellable: boolean | null
  readonly currency: string
  readonly unit_price_minor: number
  readonly tax_category: string
}

export interface BookMarkdown {
  readonly markdown_id: string
  readonly sku_code: string | null
  readonly article_code: string | null
  readonly site_id: string | null
  readonly site_ids: readonly string[] | null
  readonly tier: string | null
  readonly replacement_unit_price_minor: number
  readonly priority: number
  readonly effective_from: string
  readonly effective_to: string | null
}

export interface BookRule {
  readonly rule_id: string
  readonly name: string
  readonly status: string
  readonly priority: number
  /// The rule as the engine serialised it, handed back whole.
  ///
  /// Typed as the generated `Rule` rather than as `unknown`: this one field is
  /// **not** hand-transcribed, because the handler stores and returns
  /// `pricing_engine::Rule`'s own serialisation and ts-rs generates that type
  /// from the same struct. A second reading of it here would be a second
  /// opinion about what a promotion does; taking the generated type is how the
  /// screen renders the engine's answer rather than its own.
  readonly definition: Rule
}

export interface BookCoupon {
  readonly code: string
  readonly rule_id: string
  readonly active: boolean
  readonly customer_id: string | null
  readonly valid_from: string | null
  readonly valid_to: string | null
  readonly max_uses: number | null
}

export interface BookCampaign {
  readonly campaign_id: string
  readonly name: string
  readonly status: string
  readonly valid_from: string | null
  readonly valid_to: string | null
  readonly budget_minor: number | null
  readonly max_uses: number | null
  readonly max_uses_per_customer: number | null
  /// The shops it runs in. `null` or empty is everywhere.
  ///
  /// A shared CONSTRAINT rather than a default: a rule inside the campaign runs
  /// where BOTH lists allow, so six here cannot be widened back to thirteen by
  /// a rule naming thirteen. The till enforces it beside the campaign's window,
  /// which binds the same way.
  readonly site_ids: readonly string[] | null
  /// The poster a shop puts in front of a shopper.
  ///
  /// The only part of a price book a customer is meant to read, and the only
  /// part that stays editable after publication — a banner is not a price, and
  /// a typo in one must be fixable without cutting a new book.
  readonly image_url: string | null
  readonly headline: string | null
  readonly terms: string | null
}

export interface BookTaxRule {
  readonly tax_category: string
  readonly rate_bps: number
  readonly tax_inclusive: boolean
}

/// Who has put this book into service. "Published" and "in force" are
/// different things, and this is the difference.
export interface BookActivation {
  readonly origin_id: string
  readonly site_id: string | null
  readonly activated_at: string
  readonly reported_at: string
  readonly price_rule_count: number
}

/// Deliberately not `PriceBook & {…}`: the detail handler's `json!` literal
/// carries no `offer_count`, and inheriting one would put a field on the type
/// that is always `undefined` at runtime.
export interface PriceBookDetail {
  readonly id: string
  readonly version: number
  readonly name: string
  readonly status: PublicationStatus
  readonly effective_from: string
  readonly effective_to: string | null
  readonly created_by: string
  readonly created_at: string
  readonly published_by: string | null
  readonly published_at: string | null
  readonly tax_rules: readonly BookTaxRule[]
  readonly price_rules: readonly BookPriceRule[]
  readonly markdowns: readonly BookMarkdown[]
  readonly rules: readonly BookRule[]
  readonly coupons: readonly BookCoupon[]
  readonly campaigns: readonly BookCampaign[]
  readonly activated_by: readonly BookActivation[]
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
  /// One shop, or every shop when it is absent. A Pricelist cell is one article
  /// at one shop, so the cell editor always names one.
  readonly site_id?: string | null
  readonly replacement_unit_price_minor: number
  readonly priority: number
  readonly effective_from: string
  readonly effective_to?: string | null
  /// The days and the hours it is actually down, read in the shop's own time.
  ///
  /// Absent means all day, every day, which is what every price drop meant
  /// before one could be scheduled. Present is a flash sale: one row that comes
  /// on at noon and goes off at two, rather than one row per slot.
  ///
  /// A price that switches off mid-afternoon is a price that disagrees with the
  /// ticket stapled to the garment for the rest of the day. The system will not
  /// make that decision for anybody, and the sheet says so where it is set.
  readonly iso_weekdays?: readonly number[]
  readonly from_minute?: number | null
  readonly to_minute?: number | null
}

/// A base price. Keyed by `sku_id` and not by a code, which is the whole reason
/// fixed-price editing is not wired up yet: `article-prices` answers in styles
/// and carries no product ids, so a Pricelist cell cannot name the rows the
/// server would need. See the Pricelist screen and §6.1 of the brief.
export interface OfferRuleInput {
  readonly sku_id: string
  readonly site_id?: string | null
  readonly site_ids?: readonly string[] | null
  readonly channel: CommercialChannel
  readonly sellable: boolean
  readonly currency: string
  readonly unit_price_minor: number
  readonly tax_category: string
}

export interface TaxRuleInput {
  readonly tax_category: string
  readonly rate_bps: number
  readonly tax_inclusive: boolean
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
  readonly status: string
  readonly valid_from?: string | null
  readonly valid_to?: string | null
  readonly budget_minor?: number | null
  readonly max_uses?: number | null
  /// What the shop floor shows. `headline` is what a shopper reads when the
  /// campaign's own name is a filing code; `terms` is the small print.
  readonly image_url?: string | null
  readonly headline?: string | null
  readonly terms?: string | null
  /// The shops it runs in. Absent or empty is everywhere — so omitting this
  /// when restating a campaign WIDENS it to the whole fleet. See `campaignFor`
  /// in the promotions screen for why that is not a theoretical hazard.
  readonly site_ids?: readonly string[]
}

/// Stop a campaign, restart it, or move its dates — and tell every shop.
///
/// `PATCH /api/v1/commercial/campaigns/{id}`, and it is the ONLY thing about a
/// published campaign that may change. Everything else in a book is frozen; a
/// status is the lever the business pulls, and until this endpoint existed
/// pulling it changed Postgres and nothing at any counter — a shop learned a
/// campaign's status only from the publication that carried it, and books are
/// seasonal.
///
/// The dispatch happens server-side in the same call, so a pause is on its way
/// to the fleet before this resolves.
/// `setCampaignStatus` below is the one caller of it.

/// One publication, as the command that writes it.
///
/// Every list is sent, empty ones included, and two of them have to be:
/// `tax_rules` and `offer_rules` are plain `Vec` fields on the server's request
/// struct with no `#[serde(default)]`, so a body that omits them is refused at
/// deserialisation — `422 missing field 'tax_rules'`, before any validator
/// runs. Sending `[]` is not noise; it is the difference between a book that
/// writes and one that never reaches the handler.
///
/// The server then refuses two shapes on purpose: a book that changes nothing
/// at all, and tax rules on a book that sets no prices — they would categorise
/// nothing. A book of markdowns therefore sends `tax_rules: []`, and a book
/// that sets prices must send at least one.
export interface CreatePriceBookRequest {
  readonly version: number
  readonly name: string
  readonly effective_from: string
  readonly effective_to: string | null
  /// What kind of change this is. Markdown and Clearance look identical in
  /// the data, so it is said at publish or not at all; left out, the server
  /// files the book as Unclassified.
  readonly change_type?: Exclude<ChangeKind, "UNCLASSIFIED">
  readonly tax_rules: readonly TaxRuleInput[]
  readonly offer_rules: readonly OfferRuleInput[]
  readonly markdowns: readonly MarkdownInput[]
  /// Promotions, as the engine's own rule documents. Sent whole rather than
  /// field by field, so the browser never becomes a second author of rule
  /// semantics.
  readonly rules: readonly Rule[]
  readonly coupons: readonly CouponInput[]
  readonly campaigns: readonly CampaignInput[]
  readonly actor_id: string
  readonly idempotency_key: string
}

/// The empty book — every list present, nothing in any of them.
///
/// Spread over, rather than restated at each call site: the two required lists
/// are exactly the ones a caller forgets, and the failure is a 422 that names a
/// field nobody meant to leave out.
export const NOTHING_TO_PUBLISH = {
  tax_rules: [],
  offer_rules: [],
  markdowns: [],
  rules: [],
  coupons: [],
  campaigns: [],
} as const satisfies Pick<
  CreatePriceBookRequest,
  "tax_rules" | "offer_rules" | "markdowns" | "rules" | "coupons" | "campaigns"
>

export interface CreatedPriceBook {
  readonly id: string
  readonly version: number
  readonly name: string
  readonly status: PublicationStatus
  readonly tax_rule_count: number
  readonly offer_rule_count: number
  readonly effective_from: string
  readonly effective_to: string | null
}

/// What the server says once a book is published.
///
/// `delivered_to` is the list of shop origins the book was queued for, in the
/// same transaction that published it. An empty list is the interesting case:
/// the book is published and no till will ever see it.
export interface PublishReceipt {
  readonly id: string
  readonly version: number
  readonly status: PublicationStatus
  readonly offer_rule_count: number
  readonly published_at: string
  readonly delivered_to: readonly string[]
}

// ── what a shop is charging ────────────────────────────────────────────────

/// One product, at the price that shop's own till will ring it up at.
///
/// Answered by the shared pricing engine rather than by SQL of its own, which
/// is the whole reason this can be trusted: before that, the centre read
/// `commercial_price_rule` and knew nothing about clearance, so a shirt on
/// markdown showed here at list price while the counter charged the sale price.
///
/// Promotions are deliberately absent. They are statements about a basket —
/// "buy two, get twenty per cent" is not this product's price, and a shelf edge
/// advertising it would promise a number the counter will not honour for one
/// item.
export interface ShelfPrice {
  readonly sku_id: string | null
  readonly sku_code: string
  readonly article_code: string
  readonly article_name: string
  /// The book this price came out of.
  readonly version: number
  readonly sellable: boolean
  readonly currency: string
  /// What is charged.
  readonly unit_price_minor: number
  /// What it would have been without the markdown. Equal to `unit_price_minor`
  /// when nothing was marked down.
  readonly base_unit_price_minor: number
  readonly price_source: string
  readonly markdown_id: string | null
  readonly tax_category: string
}

export interface ShelfPrices {
  readonly site_id: string
  readonly channel: CommercialChannel
  readonly as_of: string
  readonly item_count: number
  readonly items: readonly ShelfPrice[]
}

/// One product resolved on its own — the engine over a basket of one.
export interface ResolvedOffer {
  readonly sku_id: string
  readonly sku_code: string
  readonly site_id: string
  readonly channel: CommercialChannel
  readonly version: number
  readonly sellable: boolean
  readonly currency: string
  readonly unit_price_minor: number
  readonly base_unit_price_minor: number
  readonly price_source: string
  readonly markdown_id: string | null
  readonly tax_category: string
  readonly as_of: string
}

export interface PriceScope {
  readonly siteId: string
  readonly channel: CommercialChannel
  /// The instant to price at. Omitted means now.
  ///
  /// Passed to the engine as an argument rather than read from a clock, so
  /// asking what a shop will charge on the first morning of a campaign is the
  /// same code path as asking what it charges right now.
  readonly at?: string
}

/// Whether a markdown is actually taking money off this price.
///
/// Read from the two amounts rather than from `price_source`, because they can
/// disagree honestly: a markdown authored at or above the base price wins the
/// cascade and charges the same money, and calling that "marked down" would
/// send somebody looking for a discount that is not there.
export function isMarkedDown(row: {
  unit_price_minor: number
  base_unit_price_minor: number
}): boolean {
  return row.unit_price_minor < row.base_unit_price_minor
}

/// How far off, in basis points of the original.
///
/// A ratio, not an amount: no money is derived from this, so the division is
/// safe. The two prices themselves are only ever shown as the integers the
/// server sent.
export function markdownDepthBps(row: {
  unit_price_minor: number
  base_unit_price_minor: number
}): number {
  if (row.base_unit_price_minor <= 0) return 0
  const off = row.base_unit_price_minor - row.unit_price_minor
  return Math.round((off / row.base_unit_price_minor) * 10_000)
}

// ── how it is going out there ──────────────────────────────────────────────

/// One shop, and the price book it is actually charging from.
///
/// Reported by the shop itself, in the transaction that put the book into
/// service — never ticked off by hand, so the two cannot disagree.
export interface ShopActivation {
  readonly origin_id: string
  readonly label: string | null
  readonly site_id: string | null
  /// `null` when this shop has never activated any book. That is the row worth
  /// looking at, and the one an "activations" list would leave out entirely.
  readonly version: number | null
  readonly book_name: string | null
  /// The shop's own clock: since when it has been charging these prices.
  readonly activated_at: string | null
  /// The centre's clock: when it found out. The gap is the number to watch.
  readonly reported_at: string | null
  /// How much of the book arrived, so a truncated delivery shows as a number
  /// rather than as a wrong price weeks later.
  readonly price_rule_count: number | null
  /// How many published books this shop has not taken up. `null` when it has
  /// never taken up any — "infinitely behind" is not a number.
  readonly behind_by: number | null
  readonly has_ever_activated: boolean
}

export interface Fleet {
  readonly newest_published_version: number | null
  readonly shop_count: number
  readonly items: readonly ShopActivation[]
}

/// What one promotion has given away, against what it was allowed to.
///
/// The count is an observation and changes with every sale; the limit is a
/// decision and is frozen with the price book that declared it. They live in
/// different places for that reason and are joined by the server.
export interface PromotionUsage {
  readonly kind: "RULE" | "CAMPAIGN" | "COUPON"
  readonly key: string
  readonly name: string | null
  readonly uses: number
  readonly spent_minor: number
  /// `null` is unlimited — which is not zero, and must never be drawn as a
  /// full bar.
  readonly budget_minor: number | null
  readonly max_uses: number | null
  readonly customer_count: number
  readonly first_used_at: string
  readonly last_used_at: string
}

export interface UsageReceipt {
  readonly command_id: string
  readonly sent_to: readonly string[]
  readonly counted_at: string
}

// ── pricing a basket nobody is buying ──────────────────────────────────────

export interface SimulateLine {
  readonly sku_code: string
  readonly quantity: number
  readonly manual_unit_price_minor?: number | null
}

export interface SimulateRequest {
  readonly site_id: string
  readonly channel: CommercialChannel
  readonly at?: string
  readonly lines: readonly SimulateLine[]
  readonly coupon_codes?: readonly string[]
  readonly customer_id?: string | null
  readonly customer_tier?: string | null
}

export interface PricedLine {
  readonly sku_code: string
  readonly quantity: number
  readonly price_source: string
  readonly base_unit_price_minor: number
  readonly unit_price_minor: number
  readonly line_total_minor: number
  /// The split of `line_total`: what the shop earns and what it collects for
  /// the state. Computed once in the engine — dividing again here would give a
  /// second answer on the rounding.
  readonly net_ex_tax_minor: number
  readonly tax_minor: number
  readonly tax_category: string
  readonly publication_version: number
  readonly markdown_id: string | null
}

export interface AppliedRule {
  readonly rule_id: string
  readonly campaign_id: string | null
  readonly name: string
  readonly coupon_code: string | null
  readonly benefit_minor: number
}

/// A promotion that could have applied and did not, with the engine's own
/// words for why.
///
/// The explanation comes from Rust — `RejectionReason::describe()` — rather
/// than a lookup table kept beside it here. A second copy of these strings in
/// the browser goes stale the day a reason is added, and the symptom would be
/// a blank cell on the one screen whose job is to explain.
export interface RejectedRule {
  readonly rule_id: string
  readonly name: string
  readonly reason: string
  readonly explanation: string
  readonly would_have_saved_minor: number | null
}

export interface FreeLine {
  readonly sku_code: string
  readonly quantity: number
  readonly unit_price_minor: number
  readonly granted_by_rule_id: string
  readonly value_minor: number
}

export interface LinePoints {
  readonly line: number
  readonly points: number
}

export interface EarnAward {
  readonly rule_id: string
  readonly name: string
  readonly points: number
  readonly basis_amount_minor: number
  /// Which line earned which points, by its index in the basket as sent.
  readonly line_points: readonly LinePoints[]
}

export interface SimulateResult {
  readonly site_id: string
  readonly channel: CommercialChannel
  readonly as_of: string
  /// A fingerprint of this decision. The same basket, against the same book, at
  /// the same instant, gives the same id on any machine.
  readonly trace_id: string
  readonly publication_version: number
  readonly currency: string
  readonly lines: readonly PricedLine[]
  readonly free_lines: readonly FreeLine[]
  readonly applied_rules: readonly AppliedRule[]
  readonly rejected_rules: readonly RejectedRule[]
  readonly earn_awards: readonly EarnAward[]
  readonly points_earned: number
  readonly discount_total_minor: number
  readonly total_minor: number
  /// The goods without tax, the tax, and what actually has to be settled.
  /// `amount_due` equals `total` for a tax-inclusive book and exceeds it for an
  /// exclusive one — showing only `total` cannot tell the two apart.
  readonly net_ex_tax_minor: number
  readonly tax_total_minor: number
  readonly amount_due_minor: number
}

/// What one shop has charged for one product, and what moved it.
///
/// The Pricelist answers "why this price" — the cascade with its losers, as of
/// now. This answers "why did it move", which is the question somebody asks
/// when a shelf edge and a customer's memory disagree.
///
/// Generated from Rust, unlike most of this file: the handler serialises a
/// struct rather than building a `json!()` literal, so ts-rs has something to
/// generate from and there is nothing to transcribe by hand.
export const priceHistoryKeys = {
  all: ["price-history"] as const,
  of: (sku: string, site: string, channel: CommercialChannel) =>
    ["price-history", sku, site, channel] as const,
}

export function priceHistory(
  skuCode: string,
  siteId: string,
  channel: CommercialChannel,
  signal?: AbortSignal
): Promise<PriceHistory> {
  const query = new URLSearchParams({
    sku_code: skuCode,
    site_id: siteId,
    channel,
  })
  return node.get<PriceHistory>(
    `/api/v1/commercial/price-history?${query.toString()}`,
    { signal }
  )
}

// ── keys ───────────────────────────────────────────────────────────────────

/// Keys live beside the function that fetches them. The first segment is the
/// domain namespace, so signing out drops the whole module's answers by prefix
/// without naming every key.
export const commercialKeys = {
  all: ["commercial"] as const,
  books: () => ["commercial", "publications"] as const,
  book: (id: string) => ["commercial", "publications", id] as const,
  prices: (scope: PriceScope) =>
    [
      "commercial",
      "offers",
      scope.siteId,
      scope.channel,
      scope.at ?? "now",
    ] as const,
  price: (skuId: string, scope: PriceScope) =>
    [
      "commercial",
      "offers",
      "resolve",
      skuId,
      scope.siteId,
      scope.channel,
      scope.at ?? "now",
    ] as const,
  /// One piece of one SKU at one store, priced the way the till prices it —
  /// promotions and campaigns included — for a walk-in shopper or a member.
  /// Under `offers` so whatever refreshes the shelf prices refreshes this.
  tillCheck: (
    siteId: string,
    channel: CommercialChannel,
    skuCode: string,
    member: boolean
  ) =>
    [
      "commercial",
      "offers",
      "till",
      siteId,
      channel,
      skuCode,
      member ? "member" : "walk-in",
    ] as const,
  usage: () => ["commercial", "usage"] as const,
  fleet: () => ["commercial", "activation"] as const,
  /// Every promotion, coupon and campaign the fleet is carrying, gathered from
  /// the books. One key for the three of them because it is one read — see
  /// `promotionCatalogue`.
  catalogue: () => ["commercial", "catalogue"] as const,
  /// The campaigns alone, for a screen that wants the posters and not the
  /// rules underneath them. A key of its own rather than a slice of
  /// `catalogue()`: that entry is four requests, and a caller that only needs
  /// this one should not pull three it will not read.
  campaigns: () => ["commercial", "campaigns"] as const,
  /// The Promotions list, a page at a time. The search, the filters and the
  /// sort are in the key because the SERVER applies them: two scopes are two
  /// answers. Under `["commercial", "rules"]` so one invalidation reaches every
  /// scope, the single-rule reads and the offer counts alike.
  rules: (scope: PromotionListScope) =>
    ["commercial", "rules", "pages", scope] as const,
  /// One promotion, for a sheet opened on a rule the loaded pages do not hold.
  rule: (ruleId: string) => ["commercial", "rules", "one", ruleId] as const,
  /// The offers filed under each campaign, counted by the server — the
  /// `campaign` facet of the rules list.
  offerCounts: () => ["commercial", "rules", "counts"] as const,
  /// Every promotion filed under one campaign, for that campaign's sheet.
  campaignRules: (campaignId: string) =>
    ["commercial", "rules", "campaign", campaignId] as const,
  /// The Campaigns list, a page at a time. Under `campaigns()` so the
  /// invalidation that refreshes the Overview's read refreshes this too.
  campaignPages: (scope: CampaignListScope) =>
    ["commercial", "campaigns", "pages", scope] as const,
  /// One campaign, for a sheet or a chip naming one the pages do not hold.
  campaign: (campaignId: string) =>
    ["commercial", "campaigns", "one", campaignId] as const,
  /// Article-level prices. The channel and the moment are part of the key
  /// because a different question has a different answer.
  articlePrices: (
    channel: string,
    at: string | null,
    scope?: ArticlePriceScope
  ) =>
    // The narrowing belongs in the key. It is the server that applies it, so
    // two different filters are two different answers — keyed without it they
    // would share one cache entry and the second filter would show the first
    // one's rows until something else invalidated them.
    ["commercial", "article-prices", channel, at, scope ?? null] as const,
  /// The product picker's search. Keyed by the words typed, so backspacing
  /// re-uses the answer it already had — and by the cap, because two callers
  /// asking the same question with different ceilings are asking for different
  /// answers, and sharing one entry hands the narrower one a list it thinks is
  /// complete.
  products: (query: string, limit: number) =>
    ["commercial", "products", query, limit] as const,
  /// The products of exactly these styles. Sorted, because the set is the
  /// question and the order the grid happened to list them in is not.
  productsByArticles: (codes: readonly string[], limit: number) =>
    ["commercial", "products", "articles", [...codes].sort(), limit] as const,
}

// ── reads ──────────────────────────────────────────────────────────────────

export function listPriceBooks(signal?: AbortSignal): Promise<PriceBook[]> {
  return node
    .get<{ items: PriceBook[] }>("/api/v1/commercial/publications", { signal })
    .then((body) => body.items)
}

export function priceBookDetail(
  id: string,
  signal?: AbortSignal
): Promise<PriceBookDetail> {
  return node.get<PriceBookDetail>(
    `/api/v1/commercial/publications/${encodeURIComponent(id)}`,
    { signal }
  )
}

export function shelfPrices(
  scope: PriceScope,
  signal?: AbortSignal
): Promise<ShelfPrices> {
  const params = new URLSearchParams({
    site_id: scope.siteId,
    channel: scope.channel,
  })
  if (scope.at) params.set("at", scope.at)
  return node.get<ShelfPrices>(
    `/api/v1/commercial/offers?${params.toString()}`,
    { signal }
  )
}

/// One product, priced on its own.
///
/// It answers the same question as one row of `shelfPrices` — the engine over a
/// basket of one — and is asked again when somebody opens a row, because this
/// is the call that says what the till would charge for that product at that
/// instant. Asking it rather than trusting the row is the point: the two agree,
/// and being able to see them agree is what makes the list believable.
export function resolveOffer(
  skuId: string,
  scope: PriceScope,
  signal?: AbortSignal
): Promise<ResolvedOffer> {
  const params = new URLSearchParams({
    sku_id: skuId,
    site_id: scope.siteId,
    channel: scope.channel,
  })
  if (scope.at) params.set("at", scope.at)
  return node.get<ResolvedOffer>(
    `/api/v1/commercial/offers/resolve?${params.toString()}`,
    { signal }
  )
}

export function commercialUsage(
  signal?: AbortSignal
): Promise<PromotionUsage[]> {
  return node
    .get<{ items: PromotionUsage[] }>("/api/v1/commercial/usage", { signal })
    .then((body) => body.items)
}

export function commercialFleet(signal?: AbortSignal): Promise<Fleet> {
  return node.get<Fleet>("/api/v1/commercial/activation", { signal })
}

// ── every promotion the fleet is carrying ──────────────────────────────────

/// The book a promotion arrived in, and how far that book has actually got.
///
/// Carried beside every rule, coupon and campaign rather than fetched again by
/// the screen: "which shops have this offer" is a property of the book that
/// delivered it, and asking a second endpoint for it is how two readings of the
/// same fact come to disagree.
export interface CarriedBy {
  readonly id: string
  readonly version: number
  readonly name: string
  readonly effective_from: string
  readonly effective_to: string | null
  readonly activated_by: readonly BookActivation[]
}

export interface PromotionRow {
  readonly rule_id: string
  readonly name: string
  /// The column the server keeps beside the document, which is what its own
  /// queries read. `definition.status` is the engine's copy of the same thing.
  readonly status: string
  readonly priority: number
  readonly definition: Rule
  readonly book: CarriedBy
}

export interface CouponRow {
  readonly coupon: BookCoupon
  readonly book: CarriedBy
}

export interface CampaignRow {
  readonly campaign: BookCampaign
  readonly book: CarriedBy
}

export interface PromotionCatalogue {
  readonly rules: readonly PromotionRow[]
  readonly coupons: readonly CouponRow[]
  readonly campaigns: readonly CampaignRow[]
  /// How many published books the answer was drawn from. Not a cost any more —
  /// the server counts them — but still the honest denominator: "no promotions,
  /// from twelve books" and "no promotions, from none" mean opposite things.
  readonly book_count: number
  /// The number a new book has to carry to win. Every write on these screens
  /// needs it, and it is one `max()` over the same list.
  readonly next_version: number
}

/// One row as the three catalogue endpoints shape it: the object itself, plus
/// the book that carried it, flattened into the same record.
interface CarriedRow {
  readonly publication_id: string
  readonly version: number
  readonly book_name: string
  readonly effective_from: string
  readonly effective_to: string | null
  readonly activated_by: readonly BookActivation[]
}

function carriedBy(row: CarriedRow): CarriedBy {
  return {
    id: row.publication_id,
    version: row.version,
    name: row.book_name,
    effective_from: row.effective_from,
    effective_to: row.effective_to,
    activated_by: row.activated_by,
  }
}

/// How many rules and how many campaigns one catalogue read carries — the
/// server's ceiling for one request (`MAX_LIMIT` in `postgres/catalogue.rs`).
///
/// The Promotions and Campaigns LISTS no longer read this way: they page with
/// `promotionPage` / `campaignPage` and scroll. What still reads one capped
/// request is a supporting lookup — the campaign picker, the Overview's
/// posters, Vouchers' catalogue — where a list of campaigns is a menu rather
/// than the thing being browsed.
export const CATALOGUE_PAGE = 500

/// Every promotion, coupon and campaign the fleet is actually carrying.
///
/// Four requests, flat, where this used to be one plus one per published book.
/// The de-duplication that used to happen here — newest publication wins per
/// key — now happens in SQL, in `cloud/postgres/catalogue.rs`, which mirrors
/// `load_rules` / `load_coupons` / `load_campaigns` in `pricing.rs`. That is
/// the point of the move, not the round trips: the rule about which of two
/// statements of a promotion is live belongs beside the code a shop resolves it
/// with, not in a browser that has to be told.
///
/// `listPriceBooks` stays in the set for one reason — `next_version`, the number
/// a new book has to carry to win. Every write on these screens needs it and it
/// is one `max()` over that list; the catalogue rows only know the books that
/// happen to declare an offer.
export async function promotionCatalogue(
  signal?: AbortSignal
): Promise<PromotionCatalogue> {
  const [books, ruleRows, couponRows, campaignRows] = await Promise.all([
    listPriceBooks(signal),
    // Rules and campaigns answer in an envelope now — `rows` beside a cursor, a
    // total and facet counts — the shape `GET /finance/money` set. This screen
    // has no pager, so it asks for the server's ceiling in one request and
    // reads `rows`; a screen that wants to page reads `next_cursor` instead.
    // Coupons are still a bare list, deliberately: a coupon is read under the
    // promotion it unlocks rather than browsed.
    node.get<{ rows: (BookRule & CarriedRow)[]; book_count: number }>(
      `/api/v1/commercial/rules?limit=${CATALOGUE_PAGE}`,
      { signal }
    ),
    node.get<{ items: (BookCoupon & CarriedRow)[]; book_count: number }>(
      "/api/v1/commercial/coupons",
      { signal }
    ),
    node.get<{ rows: (BookCampaign & CarriedRow)[]; book_count: number }>(
      `/api/v1/commercial/campaigns?limit=${CATALOGUE_PAGE}`,
      { signal }
    ),
  ])

  return {
    rules: ruleRows.rows.map((row) => ({
      rule_id: row.rule_id,
      name: row.name,
      status: row.status,
      priority: row.priority,
      definition: row.definition,
      book: carriedBy(row),
    })),
    coupons: couponRows.items.map((row) => ({
      coupon: {
        code: row.code,
        rule_id: row.rule_id,
        active: row.active,
        customer_id: row.customer_id,
        valid_from: row.valid_from,
        valid_to: row.valid_to,
        max_uses: row.max_uses,
      },
      book: carriedBy(row),
    })),
    campaigns: campaignRows.rows.map((row) => ({
      campaign: {
        campaign_id: row.campaign_id,
        name: row.name,
        status: row.status,
        valid_from: row.valid_from,
        valid_to: row.valid_to,
        budget_minor: row.budget_minor,
        max_uses: row.max_uses,
        max_uses_per_customer: row.max_uses_per_customer ?? null,
        // The shopper-facing half, and the only half that is still editable
        // after the book is published.
        image_url: row.image_url ?? null,
        headline: row.headline ?? null,
        terms: row.terms ?? null,
        // The shops it runs in. `null` from a node that predates the column,
        // and `null` means everywhere — which is what those books meant.
        site_ids: row.site_ids ?? null,
      },
      book: carriedBy(row),
    })),
    book_count: ruleRows.book_count,
    next_version:
      books.reduce((highest, book) => Math.max(highest, book.version), 0) + 1,
  }
}

/// Every campaign the fleet is carrying, and nothing else.
///
/// The same endpoint `promotionCatalogue` reads, called on its own. Campaigns
/// are de-duplicated in SQL — newest publication wins per `campaign_id`, the
/// rule `load_campaigns` applies in `pricing.rs` — so a caller gets one row per
/// campaign and never has to decide which of four books is the live statement
/// of the Eid sale.
///
/// It exists because the presentation half of a campaign — banner, headline,
/// small print — is only in the BOOK. The performance report knows what a
/// campaign earned and has never heard of its poster.
export async function campaignCatalogue(
  signal?: AbortSignal
): Promise<readonly CampaignRow[]> {
  const body = await node.get<{
    rows: (BookCampaign & CarriedRow)[]
    book_count: number
  }>(`/api/v1/commercial/campaigns?limit=${CATALOGUE_PAGE}`, { signal })
  return body.rows.map(campaignRowOf)
}

/// One campaign row as the catalogue endpoints shape it, as the screens read
/// it. Every field, for the reason `asInput` in the Campaigns screen gives: a
/// campaign is restated from this row, and a field missing here is written as
/// absent there.
function campaignRowOf(row: BookCampaign & CarriedRow): CampaignRow {
  return {
    campaign: {
      campaign_id: row.campaign_id,
      name: row.name,
      status: row.status,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      budget_minor: row.budget_minor,
      max_uses: row.max_uses,
      max_uses_per_customer: row.max_uses_per_customer ?? null,
      image_url: row.image_url ?? null,
      headline: row.headline ?? null,
      terms: row.terms ?? null,
      site_ids: row.site_ids ?? null,
    },
    book: carriedBy(row),
  }
}

function promotionRowOf(row: BookRule & CarriedRow): PromotionRow {
  return {
    rule_id: row.rule_id,
    name: row.name,
    status: row.status,
    priority: row.priority,
    definition: row.definition,
    book: carriedBy(row),
  }
}

/// The number a new book has to carry to win: one past the highest ever
/// written. Every write on the Promotions and Campaigns screens needs it.
export function nextBookVersion(books: readonly PriceBook[]): number {
  return books.reduce((highest, book) => Math.max(highest, book.version), 0) + 1
}

// ── the Promotions and Campaigns lists, a page at a time ───────────────────

/// The orders `GET /commercial/rules` names. Anything else is the house order,
/// by rule id — see `PromotionScope::sort` in `postgres/catalogue.rs`.
export type PromotionSort =
  | "rule_id"
  | "name"
  | "status"
  | "priority"
  | "campaign"
  | "book"
  /// Times used — the Usage column's number. Zero for a rule never fired.
  | "usage"
  /// Shops carrying the book it came in.
  | "stores"
  /// The rule's own window; an open end sorts as ±infinity.
  | "starts"
  | "ends"

/// An inclusive whole-number band, either end optional. `{ max: 0 }` is
/// "none at all".
export interface Band {
  readonly min?: number
  readonly max?: number
}

/// What the Promotions list is narrowed and ordered by — all of it applied by
/// the server, so a search finds a promotion that is not on a loaded page.
export interface PromotionListScope {
  /// Rule id, name or coupon code.
  readonly q?: string
  /// Stored statuses to keep (`ACTIVE`, `PAUSED`, …). Empty is every status.
  readonly statuses?: readonly string[]
  /// Campaign ids to keep. Empty is every campaign, and no campaign.
  readonly campaigns?: readonly string[]
  /// Phases to keep — `ACTIVE`, `PAUSED`, `SCHEDULED`, `ENDED` — read by the
  /// server from the status AND the dates at its business clock
  /// (`PROMOTION_PHASE` in `postgres/catalogue.rs`, a copy of `phaseOf`).
  readonly phases?: readonly string[]
  /// How many times it has been used, inclusive.
  readonly used?: Band
  /// How many shops carry its book, inclusive.
  readonly stores?: Band
  readonly sort?: PromotionSort
  readonly desc?: boolean
}

/// A page of promotions: the `GET /finance/money` envelope.
export interface PromotionListPage {
  readonly rows: readonly PromotionRow[]
  /// Pass back as `cursor`; `null` on the last page.
  readonly next_cursor: string | null
  /// Every promotion the search and the filters match, not just this page.
  readonly total: number
  readonly book_count: number
  /// `statuses` and `campaigns` are counted over what the SEARCH leaves,
  /// ignoring the filters — "Paused 4" means there are four paused
  /// promotions, not four among those already narrowed to paused. `phases`
  /// are counted over every filter except the phase, so each tab's number is
  /// what clicking it shows.
  readonly facets: PromotionFacets
}

/// The orders `GET /commercial/campaigns` names.
export type CampaignSort =
  | "campaign_id"
  | "name"
  | "status"
  | "starts"
  | "ends"
  | "budget"
  /// The "Budget used" meter's share, spent ÷ budget. Unlimited sorts last
  /// in either direction.
  | "budget_used"
  | "offers"
  | "stores"
  | "book"

export interface CampaignListScope {
  /// Campaign id or name.
  readonly q?: string
  readonly statuses?: readonly string[]
  /// Status codes read against the dates at the server's clock: an `ACTIVE`
  /// campaign past its end is `EXPIRED`, one before its start `SCHEDULED`.
  readonly phases?: readonly string[]
  /// Objective codes, plus `none` (not stated) and `stated` (any).
  readonly objectives?: readonly string[]
  /// How many promotions are filed under it, inclusive.
  readonly offers?: Band
  /// How many shops carry its book, inclusive.
  readonly stores?: Band
  /// The Jakarta day its window ends, `YYYY-MM-DD`, inclusive — and `open`
  /// for "has no end" (`true`) or "has one" (`false`).
  readonly ends?: {
    readonly from?: string
    readonly to?: string
    readonly open?: boolean
  }
  readonly sort?: CampaignSort
  readonly desc?: boolean
}

export interface CampaignListPage {
  readonly rows: readonly CampaignRow[]
  readonly next_cursor: string | null
  readonly total: number
  readonly book_count: number
  readonly facets: CampaignFacets
}

/// A page request: the scope, where the last page stopped, and how many.
type Paged<T> = T & { readonly cursor?: string; readonly limit?: number }

function listQuery(
  scope: Paged<{
    q?: string
    statuses?: readonly string[]
    campaigns?: readonly string[]
    phases?: readonly string[]
    objectives?: readonly string[]
    used?: Band
    stores?: Band
    offers?: Band
    ends?: CampaignListScope["ends"]
    sort?: string
    desc?: boolean
  }>
): string {
  const params = new URLSearchParams()
  const q = scope.q?.trim() ?? ""
  if (q !== "") params.set("q", q)
  // Repeated rather than comma-joined: the server takes both, and a campaign
  // id is free text that may one day carry a comma.
  for (const one of scope.statuses ?? []) params.append("status", one)
  for (const one of scope.campaigns ?? []) params.append("campaign", one)
  for (const one of scope.phases ?? []) params.append("phase", one)
  for (const one of scope.objectives ?? []) params.append("objective", one)
  const band = (name: string, held: Band | undefined) => {
    if (held?.min !== undefined) params.set(`${name}_min`, String(held.min))
    if (held?.max !== undefined) params.set(`${name}_max`, String(held.max))
  }
  band("used", scope.used)
  band("stores", scope.stores)
  band("offers", scope.offers)
  if (scope.ends?.from !== undefined) params.set("ends_from", scope.ends.from)
  if (scope.ends?.to !== undefined) params.set("ends_to", scope.ends.to)
  if (scope.ends?.open !== undefined)
    params.set("ends", scope.ends.open ? "open" : "set")
  if (scope.sort !== undefined) params.set("sort", scope.sort)
  if (scope.desc === true) params.set("dir", "desc")
  if (scope.cursor !== undefined) params.set("cursor", scope.cursor)
  if (scope.limit !== undefined) params.set("limit", String(scope.limit))
  const text = params.toString()
  return text === "" ? "" : `?${text}`
}

/// One page of promotions, searched, filtered and sorted by the server.
export async function promotionPage(
  scope: Paged<PromotionListScope>,
  signal?: AbortSignal
): Promise<PromotionListPage> {
  const body = await node.get<{
    rows: (BookRule & CarriedRow)[]
    next_cursor?: string | null
    total: number
    book_count: number
    facets: PromotionFacets
  }>(`/api/v1/commercial/rules${listQuery(scope)}`, { signal })
  return {
    rows: body.rows.map(promotionRowOf),
    next_cursor: body.next_cursor ?? null,
    total: body.total,
    book_count: body.book_count,
    facets: body.facets,
  }
}

/// One page of campaigns, searched, filtered and sorted by the server.
export async function campaignPage(
  scope: Paged<CampaignListScope>,
  signal?: AbortSignal
): Promise<CampaignListPage> {
  const body = await node.get<{
    rows: (BookCampaign & CarriedRow)[]
    next_cursor?: string | null
    total: number
    book_count: number
    facets: CampaignFacets
  }>(`/api/v1/commercial/campaigns${listQuery(scope)}`, { signal })
  return {
    rows: body.rows.map(campaignRowOf),
    next_cursor: body.next_cursor ?? null,
    total: body.total,
    book_count: body.book_count,
    facets: body.facets,
  }
}

/// One promotion by its rule id, or `null` when no published book declares it.
///
/// There is no `GET /commercial/rules/{id}`: this is the list's own search,
/// asked for the id and matched exactly, paging on until it is found. The
/// search is a substring match over id, name and coupon code, so the exact
/// row is usually on the first page and the loop is a guard, not a crawl.
export async function promotionById(
  ruleId: string,
  signal?: AbortSignal
): Promise<PromotionRow | null> {
  let cursor: string | undefined
  do {
    const page = await promotionPage(
      { q: ruleId, sort: "rule_id", limit: CATALOGUE_PAGE, cursor },
      signal
    )
    const found = page.rows.find((row) => row.rule_id === ruleId)
    if (found !== undefined) return found
    cursor = page.next_cursor ?? undefined
  } while (cursor !== undefined)
  return null
}

/// One campaign by its id, or `null`. The same bargain as `promotionById`.
export async function campaignById(
  campaignId: string,
  signal?: AbortSignal
): Promise<CampaignRow | null> {
  let cursor: string | undefined
  do {
    const page = await campaignPage(
      { q: campaignId, sort: "campaign_id", limit: CATALOGUE_PAGE, cursor },
      signal
    )
    const found = page.rows.find(
      (row) => row.campaign.campaign_id === campaignId
    )
    if (found !== undefined) return found
    cursor = page.next_cursor ?? undefined
  } while (cursor !== undefined)
  return null
}

/// Every promotion filed under one campaign — the Campaign sheet's Offers tab.
/// Filtered by the server; paged to the end, because a campaign's offers are
/// a handful and the sheet lists them all.
export async function campaignOffers(
  campaignId: string,
  signal?: AbortSignal
): Promise<readonly PromotionRow[]> {
  const rows: PromotionRow[] = []
  let cursor: string | undefined
  do {
    const page = await promotionPage(
      { campaigns: [campaignId], limit: CATALOGUE_PAGE, cursor },
      signal
    )
    rows.push(...page.rows)
    cursor = page.next_cursor ?? undefined
  } while (cursor !== undefined)
  return rows
}

/// How many promotions each campaign holds, counted by the server over every
/// promotion — one row's worth of request for the whole count.
export async function offerCounts(
  signal?: AbortSignal
): Promise<ReadonlyMap<string, number>> {
  const page = await promotionPage({ limit: 1 }, signal)
  return new Map(page.facets.campaigns.map((one) => [one.value, one.count]))
}

/// How many rows one page of Promotions, or of Campaigns, asks for.
export const PROMOTION_PAGE = 100
export const CAMPAIGN_PAGE = 100

/// The Promotions list, a page at a time. The screen and its prefetcher
/// (`screens/commercial/prefetch.ts`) both ask through this, so the key and the
/// request cannot drift apart.
export const promotionPagesQuery = (scope: PromotionListScope) =>
  infiniteQueryOptions({
    queryKey: commercialKeys.rules(scope),
    queryFn: ({ signal, pageParam }) =>
      promotionPage(
        {
          ...scope,
          limit: PROMOTION_PAGE,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

/// The Campaigns list, a page at a time; shared the same way.
export const campaignPagesQuery = (scope: CampaignListScope) =>
  infiniteQueryOptions({
    queryKey: commercialKeys.campaignPages(scope),
    queryFn: ({ signal, pageParam }) =>
      campaignPage(
        {
          ...scope,
          limit: CAMPAIGN_PAGE,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

// ── writes ─────────────────────────────────────────────────────────────────

/// Write the book. It is a DRAFT until somebody publishes it.
///
/// Two steps rather than one because they are two decisions: writing a price is
/// a merchandiser's, and sending it to thirty tills is somebody's to approve.
///
/// The idempotency key travels in the body, not the header — this family of
/// routes takes `actor_id` and `idempotency_key` as fields of the command, and
/// the server digests the whole request under that key so a retried Save
/// returns the first answer rather than writing a second book.
export function createPriceBook(
  request: CreatePriceBookRequest,
  signal?: AbortSignal
): Promise<CreatedPriceBook> {
  return node.post<CreatedPriceBook>(
    "/api/v1/commercial/publications",
    request,
    { signal }
  )
}

/// Approve a draft, and send it to every shop.
///
/// Publishing is not a status change. The server dispatches the book to each
/// STORE origin inside the publishing transaction, so either the book is
/// published and on its way to the whole fleet or neither happened — which is
/// why this returns who it reached rather than just "ok".
export function publishPriceBook(
  id: string,
  actorId: string,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<PublishReceipt> {
  return node.post<PublishReceipt>(
    `/api/v1/commercial/publications/${encodeURIComponent(id)}/publish`,
    { actor_id: actorId, idempotency_key: idempotencyKey },
    { signal }
  )
}

/// The book was written and then not published.
///
/// Its own error type because it is its own outcome, and the one the two-step
/// exists to make visible: a draft now exists, numbered, holding the changes
/// somebody typed, and no till has heard about it. Swallowing this into "save
/// failed" would send them to write it again — and the second attempt would be
/// refused, because the number it wants is already taken by the book that did
/// get written.
export class BookWrittenNotPublished extends Error {
  /// The draft that now exists. Declared and assigned rather than written as a
  /// constructor parameter property: this project builds with
  /// `erasableSyntaxOnly`, so the only TypeScript allowed is the kind that
  /// disappears when the types are stripped, and a parameter property emits
  /// code.
  readonly book: CreatedPriceBook

  constructor(book: CreatedPriceBook, cause: unknown) {
    const said =
      cause instanceof Error ? cause.message : "the server could not be reached"
    super(
      `Book v${book.version} “${book.name}” was written but not published: ${said} It is a draft, so nothing has changed at any till yet.`,
      { cause }
    )
    this.name = "BookWrittenNotPublished"
    this.book = book
  }
}

/// Write a book and put it into service, as one act.
///
/// Two calls, because they are two decisions — writing a price is a
/// merchandiser's and sending it to thirty tills is somebody's to approve — and
/// one function, because on these screens the person doing both is the same
/// person and a draft nobody meant to leave behind is worse than a click saved.
/// The failure *between* them is not flattened away: see the error above.
export async function writeAndPublish(
  request: CreatePriceBookRequest,
  signal?: AbortSignal
): Promise<PublishReceipt> {
  const created = await createPriceBook(request, signal)
  try {
    // A **different** key for the second half, derived from the first so both
    // are stable across a retry. `command_deduplication` is keyed by the
    // idempotency key alone — the command type is stored beside it and
    // compared, not part of the key — so reusing one key for the two calls
    // does not make them idempotent, it makes the second one a
    // `409 idempotency key was already used with a different command`. The
    // book gets written and never published, every time.
    return await publishPriceBook(
      created.id,
      request.actor_id,
      `${request.idempotency_key}:publish`,
      signal
    )
  } catch (error) {
    throw new BookWrittenNotPublished(created, error)
  }
}

/// Pause or resume one promotion — the whole of the live/paused switch.
///
/// **There is no status route on the cloud node.** `RuleStatus` and
/// `CampaignStatus` are engine concepts written once, when a book is created,
/// and nothing amends them afterwards. A shop holds its own copy, delivered by
/// the book dispatch, so a status flip that only changed a row at the centre
/// would stop a promotion at head office and leave it running at every till.
///
/// So the switch publishes a one-line book restating the rule with its new
/// status. That is not a workaround so much as the model taken at its word:
/// `load_rules` reads `DISTINCT ON (rule_id) … ORDER BY version DESC`, so the
/// newest book naming a rule *is* the rule. The flip is versioned, dispatched
/// and auditable, and it needs nothing built.
///
/// **When `PATCH /api/v1/commercial/rules/{id}/status` lands, this function and
/// `setCampaignStatus` below are the only two places that change.** Nothing
/// else in the module knows how a status is written — that is why the toggle
/// goes through here rather than composing a book at the call site.
export function setRuleStatus(
  input: {
    readonly rule: Rule
    readonly status: RuleStatus
    /// The campaign the rule names, restated alongside it. Required, because
    /// the server refuses a book whose rule names a campaign that same book
    /// does not define — a rule dispatched without its campaign is an offer no
    /// till can ever apply.
    readonly campaign: CampaignInput | null
    readonly version: number
    readonly actorId: string
    readonly idempotencyKey: string
  },
  signal?: AbortSignal
): Promise<PublishReceipt> {
  const verb =
    input.status === "ACTIVE"
      ? "Resume"
      : input.status === "EXPIRED"
        ? "End"
        : "Pause"
  return writeAndPublish(
    {
      ...NOTHING_TO_PUBLISH,
      version: input.version,
      name: `${verb} ${input.rule.name}`,
      effective_from: new Date().toISOString(),
      effective_to: null,
      rules: [{ ...input.rule, status: input.status }],
      campaigns: input.campaign === null ? [] : [input.campaign],
      actor_id: input.actorId,
      idempotency_key: input.idempotencyKey,
    },
    signal
  )
}

/// The same switch, one level up. Pausing a campaign pauses every rule inside
/// it — a rule is live only when both it and its campaign are — which is what
/// somebody means by "stop the Eid promo", and is the reason this exists
/// rather than six visits to `setRuleStatus`.
///
/// **It no longer publishes a book.** It used to, because the node had no
/// status route, and the cost of that workaround was real in two ways: pausing
/// a promotion burned a price-book version, and — worse — the shops learned
/// about it only if that book reached them, which is the very thing a pause
/// cannot afford to depend on. `PATCH /commercial/campaigns/{id}` writes the
/// status and dispatches it on the switch lane in one call, and it is what
/// stops a campaign's markdowns as well as its rules.
export function setCampaignStatus(
  input: {
    readonly campaign: CampaignInput
    readonly status: string
    readonly actorId: string
    /// The poster, when this call is editing it. Omitted fields are left
    /// alone by the server, so a pause never blanks a banner.
    readonly headline?: string
    readonly image_url?: string
    readonly terms?: string
  },
  signal?: AbortSignal
): Promise<unknown> {
  return node.patch<unknown>(
    `/api/v1/commercial/campaigns/${encodeURIComponent(input.campaign.campaign_id)}`,
    {
      actor_id: input.actorId,
      status: input.status,
      headline: input.headline,
      image_url: input.image_url,
      terms: input.terms,
    },
    { signal }
  )
}

/// Send every shop the running totals of what promotions have cost.
///
/// A shop enforces a budget from the last count it received, so what it knows
/// is always behind — a budget is a brake, not a gate, and the figure that must
/// not be exceeded is the one at the centre. Sending this often is what keeps
/// the brake close to the truth.
export function publishUsageToFleet(
  actorId: string,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<UsageReceipt> {
  return node.post<UsageReceipt>(
    "/api/v1/commercial/usage/publish",
    { actor_id: actorId, idempotency_key: idempotencyKey },
    { signal }
  )
}

// ── the hard cap ──────────────────────────────────────────────────────────

/// One shop's allowance under a split limit, beside what it has used.
///
/// `own_*` is what the centre has counted; the shop's own figure is ahead of
/// it by whatever it has not uploaded yet, which is why a grant is never
/// taken back.
export interface ShopAllowance {
  readonly origin_id: string
  readonly label: string | null
  readonly site_id: string | null
  readonly budget_granted: number | null
  readonly uses_granted: number | null
  readonly own_uses: number
  readonly own_spent_minor: number
}

/// A promotion's or campaign's limit, split between the shops — or not.
export interface CapAllocation {
  readonly kind: "RULE" | "CAMPAIGN"
  readonly key: string
  readonly enabled: boolean
  readonly budget_minor: number | null
  readonly max_uses: number | null
  /// What has never been granted to any shop, per measure.
  readonly budget_pool: number | null
  readonly uses_pool: number | null
  readonly shops: readonly ShopAllowance[]
  readonly updated_by: string | null
  readonly updated_at: string | null
}

export const allocationKeys = {
  one: (kind: CapAllocation["kind"], key: string) =>
    ["commercial", "allocation", kind, key] as const,
}

export function capAllocation(
  kind: CapAllocation["kind"],
  key: string,
  signal?: AbortSignal
): Promise<CapAllocation> {
  return node.get<CapAllocation>(
    `/api/v1/commercial/allocations/${kind}/${encodeURIComponent(key)}`,
    { signal }
  )
}

/// Switch the split on or off. The shops are sent their allowances (or told
/// to drop them) in the same call.
export function setCapAllocation(
  kind: CapAllocation["kind"],
  key: string,
  enabled: boolean
): Promise<CapAllocation> {
  return node.put<CapAllocation>(
    `/api/v1/commercial/allocations/${kind}/${encodeURIComponent(key)}`,
    { enabled }
  )
}

/// Price a basket without selling it.
///
/// A POST that writes nothing: no sale, no usage count, no reservation. It is
/// the same call a till makes, so what it says is what a till would charge —
/// not an approximation built for a preview.
///
/// The Pricelist's cell sheet asks it for "At the till": one piece of each
/// SKU, for a walk-in shopper and for a member, which is the only place the
/// pricelist, the sale price and the promotions are added up into what a
/// customer pays.
export function simulate(
  request: SimulateRequest,
  signal?: AbortSignal
): Promise<SimulateResult> {
  return node.post<SimulateResult>("/api/v1/commercial/simulate", request, {
    signal,
  })
}

// ── typing money in ────────────────────────────────────────────────────────

/// A price somebody typed, as minor units, or `null` if it is not one yet.
///
/// IDR has no minor unit in practice, so what is typed is whole rupiah and the
/// conversion is a parse rather than a multiply — which is the point: no float
/// touches a price on the way in any more than on the way out. Anything with a
/// fractional part is refused rather than rounded, because rounding somebody's
/// price for them is how a book ships a number nobody chose.
export function minorOf(text: string): number | null {
  const cleaned = text.replace(/[\s.,]/g, "")
  if (cleaned === "" || !/^\d+$/.test(cleaned)) return null
  const parsed = Number(cleaned)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/// An instant a person typed into a `datetime-local` box, as the server wants
/// it. The box has no timezone; the browser's own is the honest reading of what
/// somebody sitting in front of it meant.
/// Minutes since local midnight, from a `<input type="time">`.
///
/// The engine counts a schedule in minutes rather than in a clock string,
/// because a window may wrap past midnight — 22:00 to 02:00 is a late-night
/// sale and not an error — and comparing wrapped clock strings is where that
/// stops working.
///
/// Empty is `null`, which the server reads as "no hours given". It never
/// becomes 0, which would be midnight and a real instruction.
export function minutesOf(value: string): number | null {
  const [hours, minutes] = value.split(":")
  const h = Number.parseInt(hours ?? "", 10)
  const m = Number.parseInt(minutes ?? "", 10)
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

export function instantOf(value: string): string | null {
  if (value.trim() === "") return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

// ---------------------------------------------------------------------------
// Article-level prices, and the product picker.
//
// Both are built with `json!()` in `cloud/postgres/commercial.rs`, so ts-rs has
// nothing to generate from and these are transcribed. If a column moves, this
// is where it goes stale.

/// Which rung of the cascade a price was authored on.
///
/// `pricing_engine::PriceLevel`, flattened into the candidate by serde, so it
/// arrives as an object with a `level` tag and not as a string. It was
/// transcribed here as `applies_to: string` and every reading of it was
/// therefore `"[object Object]"` — the failure this file's header warns about,
/// caught by reading `price.rs` rather than by anything at build time.
export type PriceLevel =
  | { readonly level: "COMPANY" }
  | { readonly level: "SITE_GROUP"; readonly site_ids: readonly string[] }
  | { readonly level: "SITE"; readonly site_id: string }

/// Who a candidate was written for, in words.
export function describeLevel(level: PriceLevel): string {
  switch (level.level) {
    case "SITE":
      return level.site_id
    case "SITE_GROUP":
      return `${level.site_ids.length} stores`
    default:
      return "Every store"
  }
}

/// One distinct amount inside a range, and which products carry it.
///
/// A style can be priced per size, so a rung of the cascade covers a range
/// rather than a number — and somebody eventually has to ask which size is the
/// expensive one. The server answers that from the same rung it drew the range
/// from, so the detail can never disagree with the summary above it.
export interface ArticlePricePoint {
  readonly unit_price_minor: number
  readonly sku_codes: readonly string[]
  /// How many of those products this amount actually wins.
  readonly in_force_for: number
}

/// What one shop charges for one article, as a stack of rules in the order the
/// engine applied them. The rank is the engine's, not a sort key.
export interface ArticlePriceRule {
  readonly rank: number
  readonly source: string
  readonly applies_to: PriceLevel
  readonly markdown_id: string | null
  readonly currency: string
  readonly publication_version: number
  readonly min_unit_price_minor: number
  readonly max_unit_price_minor: number
  readonly sku_count: number
  /// How many of the style's products this candidate actually wins — a count,
  /// not a sentence. A shop price on one size beats the company price on that
  /// size alone, and the company row is then in force for the rest.
  readonly in_force_for: number
  readonly points: readonly ArticlePricePoint[]
  readonly effective_from: string
  readonly effective_to: string | null
}

export interface ArticlePriceShop {
  readonly site_id: string
  readonly label: string | null
  readonly stack: readonly ArticlePriceRule[]
  /// What the till takes for one piece, promotions counted — only when the
  /// page was asked for with `final`. Optional because a server that predates
  /// the final view sends no such field.
  readonly final_price?: FinalPrice | null
}

/// One article at one shop as a walk-in shopper pays for it: each SKU priced
/// as a basket of one, no coupon, no member.
export interface FinalPrice {
  readonly min_unit_price_minor: number
  readonly max_unit_price_minor: number
  /// How many different amounts the SKUs come to.
  readonly distinct: number
  /// The promotions that came off at least one SKU, and their campaigns.
  readonly promotions: readonly string[]
  readonly campaigns: readonly string[]
}

/// One article across every shop — the view that answers "is this priced the
/// same everywhere", which a per-SKU list cannot.
export interface ArticlePriceRow {
  readonly article_code: string
  readonly article_name: string | null
  readonly image_url: string | null
  readonly division_code: string | null
  readonly tags: readonly string[]
  readonly sku_count: number
  /// What one piece cost, for the markup: the newest receipt's cost, else the
  /// newest purchase order's price. Optional for a server that predates it.
  readonly unit_cost_minor?: number | null
  readonly cost_from?: "RECEIVED" | "PURCHASE_ORDER" | null
  readonly shops: readonly ArticlePriceShop[]
}

/// Markup over cost in basis points — the procurement screens' definition,
/// (price − cost) / cost, so a PO's 60% and the pricelist's 60% are one
/// number. `null` when either side is missing or the cost is nought.
export function markupBps(
  priceMinor: number | null | undefined,
  costMinor: number | null | undefined
): number | null {
  if (priceMinor == null || costMinor == null || costMinor <= 0) return null
  return Math.round(((priceMinor - costMinor) * 10000) / costMinor)
}

/// One column of the matrix, and the evidence behind it.
///
/// UI-001 §2: the prices under a shop's name come from **the version that shop
/// has activated**, not from the newest book head office published. So the
/// column has to carry which version that is — a heading with only a name
/// invites the reader to assume the numbers under it are what the till is
/// charging, and for a shop that has confirmed nothing that is the one claim
/// the estate cannot make.
export interface PricelistShop {
  readonly site_id: string
  readonly label: string | null
  /// The newest version this shop has reported putting into service.
  ///
  /// `null` is a shop that has confirmed nothing, and its column is empty —
  /// §3's last row: "Belum terkonfirmasi / harga aktif tidak tersedia; jangan
  /// fallback diam-diam ke latest HO."
  readonly active_version: number | null
  /// A book head office has published over the top which this shop has not
  /// switched to. **Beside the price, never instead of it** — §3: "Active store
  /// price tetap utama; badge publication baru/pending."
  ///
  /// Scoped to the page: a newer book that reprices nothing on screen is not
  /// reported, because a badge that always shows is a badge nobody reads.
  readonly pending_publication: {
    readonly version: number
    readonly name: string
    readonly effective_from: string
    readonly published_by: string | null
    readonly published_at: string | null
    /// How many products on this page it would reprice.
    readonly affects_skus: number
  } | null
}

export interface ArticlePrices {
  readonly channel: string
  readonly as_of: string
  readonly shops: readonly PricelistShop[]
  readonly rows: readonly ArticlePriceRow[]
  /// Opaque. Pass it back as `cursor` for the next page; absent means this was
  /// the last one. A short page is NOT the end when a price bound is set — the
  /// server prices a page and then drops what falls outside the bound — so this
  /// is the only honest signal that there is nothing more.
  readonly next_cursor: string | null
  /// How many styles match, against how many came back — so the screen can say
  /// it is showing a slice rather than implying it is showing everything.
  readonly total: number
  /// What the search left, for the filter pickers — counted over what the
  /// search matched but ignoring the boxes already ticked, so ticking a second
  /// one shows what it would add rather than reading zero.
  readonly facets?: {
    readonly divisions: readonly FacetCount[]
    readonly tags: readonly FacetCount[]
  }
}

/// One option and how many styles carry it. Shaped like `FilterSpec.counted`
/// on purpose, so `facets.divisions` assigns straight into a field's spec.
export interface FacetCount {
  readonly value: string
  /// What to draw when it differs from the value — a division's or a tag's own
  /// name, resolved by the server from the master it lives in. Null when the
  /// value is already the label.
  readonly label?: string | null
  readonly count: number
}

/// How the pricelist is narrowed.
///
/// Every field is answered by the SERVER. That is not an optimisation detail
/// worth hiding: pricing is styles times shops, so five hundred styles across
/// thirteen shops is seconds of work and megabytes of answer, and a filter the
/// browser applied afterwards would have paid for all of it. Narrowing here is
/// what makes the screen answer at all.
export interface ArticlePriceScope {
  readonly q?: string
  readonly divisions?: readonly string[]
  readonly tags?: readonly string[]
  readonly minPrice?: number
  readonly maxPrice?: number
  /// Also price every style the way the till does, promotions and campaigns
  /// counted, into each shop's `final_price`. Part of the scope so it is part
  /// of the cache key: the two views are two answers.
  readonly final?: boolean
}

export function articlePrices(
  options: {
    channel?: string
    at?: string
    limit?: number
    /// Opaque, from a previous answer's `next_cursor`. Absent asks for the
    /// first page.
    cursor?: string
  } & ArticlePriceScope = {},
  signal?: AbortSignal
): Promise<ArticlePrices> {
  const params = new URLSearchParams()
  if (options.channel) params.set("channel", options.channel)
  if (options.at) params.set("at", options.at)
  // Only when the caller names one. This used to force 200, and 200 is the
  // page size that made this the slowest read in the system — its cost is
  // fixed per REQUEST (each shop's whole price book was fetched to price the
  // styles on the page), so a big page paid that cost once for many rows and a
  // caller who wanted a small page paid it anyway. The server's own default is
  // tuned against its measured budget; overriding it from here is how that
  // tuning gets quietly undone.
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  if (options.cursor) params.set("cursor", options.cursor)
  if (options.q) params.set("q", options.q)
  // Left off entirely when empty rather than sent blank: `?divisions=` is a
  // list holding one empty string, which matches no division and would empty
  // the screen on a filter nobody set.
  if (options.divisions?.length)
    params.set("divisions", options.divisions.join(","))
  if (options.tags?.length) params.set("tags", options.tags.join(","))
  if (options.minPrice !== undefined)
    params.set("min_price", String(options.minPrice))
  if (options.maxPrice !== undefined)
    params.set("max_price", String(options.maxPrice))
  if (options.final) params.set("final", "true")
  return node.get<ArticlePrices>(
    `/api/v1/commercial/article-prices?${params.toString()}`,
    { signal }
  )
}

/// The filter bar's clauses as the request they mean.
///
/// The operator list each field offers is cut to what this endpoint can
/// answer — see the fields declared in `pricelist.tsx` — so there is no case
/// here for an operator a chip could show and the server could not honour.
export function priceScopeFromFilters(
  filters: readonly Filter[]
): ArticlePriceScope {
  const scope: {
    -readonly [K in keyof ArticlePriceScope]: ArticlePriceScope[K]
  } = {}
  for (const { column, operator, values } of filters) {
    if (values.length === 0) continue
    if (column === "division" && operator === "isAnyOf")
      scope.divisions = values
    else if (column === "tag" && operator === "includesAnyOf")
      scope.tags = values
    else if (column === "price") {
      // Sent as typed. `unit_price_minor` is whole rupiah despite its name, so
      // a bound needs no conversion — and scaling it by a hundred, which the
      // name invites, is the mistake that already cost seven other columns.
      const at = (index: number) => {
        const parsed = Number(values[index])
        return Number.isFinite(parsed) ? Math.round(parsed) : undefined
      }
      if (operator === "gte") scope.minPrice = at(0)
      else if (operator === "lte") scope.maxPrice = at(0)
    }
  }
  return scope
}

/// The pricelist, a page at a time, as of now. Shared by the Pricelist screen
/// and its prefetcher so the key and the request cannot drift apart.
export const articlePricesPagesQuery = (
  channel: CommercialChannel,
  scope: ArticlePriceScope
) =>
  infiniteQueryOptions({
    queryKey: commercialKeys.articlePrices(channel, null, scope),
    queryFn: ({ pageParam, signal }) =>
      articlePrices({ channel, cursor: pageParam, ...scope }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

/// A sellable thing, for the pickers that author prices and promotions.
export interface CommercialProduct {
  readonly sku_id: string
  readonly sku_code: string
  readonly color: string | null
  readonly size: string | null
  readonly article_code: string
  readonly article_name: string | null
  readonly division_code: string | null
  readonly image_url: string | null
  /// The price the picker shows beside the name — what it currently sells for,
  /// not what the rule being written will make it.
  readonly unit_price_minor: number | null
}

/// Server-side search, because the catalogue is far too large to hold in a
/// picker: the endpoint takes `q` and answers a capped list.
export function commercialProducts(
  query: string,
  limit = 50,
  signal?: AbortSignal
): Promise<readonly CommercialProduct[]> {
  const params = new URLSearchParams()
  if (query.trim() !== "") params.set("q", query.trim())
  params.set("limit", String(limit))
  return node
    .get<{ items: CommercialProduct[] }>(
      `/api/v1/commercial/products?${params.toString()}`,
      { signal }
    )
    .then((body) => body.items)
}

/// Every product of exactly these styles, in one read. `q` is one ILIKE
/// substring, so a list of styles through it was a request per style and a
/// prefix dragging its neighbours in; `article_codes` matches whole codes.
/// Each code is encoded on its own so the commas between them stay commas.
export function commercialProductsByArticles(
  codes: readonly string[],
  limit = 500,
  signal?: AbortSignal
): Promise<readonly CommercialProduct[]> {
  const joined = codes.map((code) => encodeURIComponent(code)).join(",")
  return node
    .get<{ items: CommercialProduct[] }>(
      `/api/v1/commercial/products?article_codes=${joined}&limit=${limit}`,
      { signal }
    )
    .then((body) => body.items)
}

// ── why a campaign exists ──────────────────────────────────────────────────
//
// Everything above reads the price book: what a shop will charge, which offers
// are live, what a campaign may spend. None of it says WHY, which is what made
// a campaign hard to tell from a folder of promotions.
//
// These read a table that is NOT in any book — see migration 0161. A till has
// no use for "clear seasonal inventory", and putting it in a publication would
// mean repricing thirteen shops to move a goal from 75% to 80%.

/// What a campaign is for, how we will know, and where the line is.
export interface CampaignIntent {
  readonly campaign_id: string
  readonly objective: string
  readonly success_metric: string
  readonly target_direction: "AT_LEAST" | "AT_MOST"
  /// Read according to `success_metric`: money is minor units, counts are
  /// whole, and `SELL_THROUGH` is BASIS POINTS — 8000 is 80%. The unit is never
  /// stored beside it because the metric already decides it.
  readonly target_value: number
  /// The campaign this one is read against — a CAMPAIGN, not a period.
  ///
  /// "Versus the previous thirty days" is the wrong question for the campaigns
  /// this shop runs: Eid moves about eleven days earlier each year, so the
  /// month before it is ordinary trading and the same dates last year were not
  /// Eid. Which Eid is the precedent for this one is a judgement, and
  /// this is where it is recorded.
  readonly baseline_campaign_id: string | null
  readonly notes: string | null
  readonly updated_at: string
  readonly updated_by: string
}

export interface CampaignIntentInput {
  readonly objective: string
  readonly success_metric: string
  readonly target_direction: "AT_LEAST" | "AT_MOST"
  readonly target_value: number
  readonly baseline_campaign_id?: string | null
  readonly notes?: string | null
  readonly updated_by: string
}

/// One article's share of a campaign's stock question.
export interface SellThroughArticle {
  readonly article_code: string
  readonly name: string | null
  readonly units_sold: number
  readonly on_hand: number
  /// `null` when the style sold nothing and holds nothing — which is not 0%.
  readonly sell_through_bps: number | null
}

export interface SellThrough {
  readonly campaign_id: string
  /// When the SHELF was read, which is not the end of the window: the stock
  /// projection holds no history, so a finished campaign is scored against
  /// today's shelf. For a running one — which is when anybody asks — that is
  /// exactly right.
  readonly as_of: string
  readonly from: string
  readonly to: string
  readonly scope: {
    readonly rules: number
    /// Offers that apply to the whole basket, or to something this build cannot
    /// read. One of them is why a campaign has no sell-through, and the screen
    /// has to be able to say which.
    readonly unscoped_rules: number
    readonly articles: number
  }
  readonly units_sold: number
  readonly on_hand: number
  /// `null` when the campaign names no product at all. Not zero: zero would
  /// read as "nothing sold", and the truth is there is nothing to measure.
  readonly sell_through_bps: number | null
  readonly articles: readonly SellThroughArticle[]
}

export const intentKeys = {
  all: ["commercial", "intent"] as const,
  list: () => ["commercial", "intent", "all"] as const,
  one: (campaignId: string) => ["commercial", "intent", campaignId] as const,
  sellThrough: (campaignId: string, scope: { from?: string; to?: string }) =>
    [
      "commercial",
      "sell-through",
      campaignId,
      scope.from ?? "default",
      scope.to ?? "now",
    ] as const,
}

/// `null` where nobody has stated one — a 200, not a 404.
///
/// "This campaign has no objective" is the finding rather than an error: it is
/// precisely the campaign somebody should be asked to justify or delete.
export function campaignIntent(
  campaignId: string,
  signal?: AbortSignal
): Promise<CampaignIntent | null> {
  return node.get<CampaignIntent | null>(
    `/api/v1/commercial/campaigns/${encodeURIComponent(campaignId)}/intent`,
    { signal }
  )
}

/// Every stated intent in one read, for the list that shows a column of them.
export function campaignIntents(
  signal?: AbortSignal
): Promise<readonly CampaignIntent[]> {
  return node
    .get<{ items: CampaignIntent[] }>("/api/v1/commercial/campaign-intents", {
      signal,
    })
    .then((body) => body.items)
}

/// State it, or restate it. An upsert: a second save is somebody changing their
/// mind about the target, not declaring a second objective.
export function saveCampaignIntent(
  campaignId: string,
  input: CampaignIntentInput,
  signal?: AbortSignal
): Promise<CampaignIntent> {
  return node.put<CampaignIntent>(
    `/api/v1/commercial/campaigns/${encodeURIComponent(campaignId)}/intent`,
    input,
    { signal }
  )
}

export function deleteCampaignIntent(
  campaignId: string,
  signal?: AbortSignal
): Promise<{ deleted: number }> {
  return node.delete<{ deleted: number }>(
    `/api/v1/commercial/campaigns/${encodeURIComponent(campaignId)}/intent`,
    { signal }
  )
}

/// How much of what a campaign set out to shift has shifted.
///
/// Its own read rather than a field on the performance aggregate: it needs the
/// stock projection as well as the tills, and it is asked about ONE campaign —
/// there is no fleet-wide version of "did this clear".
export function campaignSellThrough(
  campaignId: string,
  scope: { from?: string | null; to?: string | null; siteId?: string | null },
  signal?: AbortSignal
): Promise<SellThrough> {
  const params = new URLSearchParams()
  if (scope.from) params.set("from", scope.from)
  if (scope.to) params.set("to", scope.to)
  if (scope.siteId) params.set("site_id", scope.siteId)
  return node.get<SellThrough>(
    `/api/v1/commercial/campaigns/${encodeURIComponent(campaignId)}/sell-through?${params.toString()}`,
    { signal }
  )
}

// ── the campaign as an initiative ───────────────────────────────────────────

/// The one corner of this file whose shapes are NOT hand-written.
///
/// The header above explains why the rest are: those handlers build their
/// bodies with `json!()`, so there is no struct for ts-rs to read. These
/// routes — `/plan`, `/outcome`, `/target`, `/guardrail-check` — serialise
/// typed structs from `cloud/postgres/campaigns.rs`, so their types are
/// GENERATED and imported here rather than transcribed. A field that moves on
/// the server breaks this file at build time instead of reading `undefined` in
/// a panel, which is what the transcribed half still risks.
export type {
  CampaignActivityInput,
  CampaignActivityRow,
  CampaignBaselineView,
  CampaignBreachRow,
  CampaignGuardrailInput,
  CampaignGuardrailReading,
  CampaignGuardrailRow,
  CampaignOutcomeView,
  CampaignPerDayView,
  CampaignPlanInput,
  CampaignPlanView,
  CampaignReadingView,
  CampaignScopeEntry,
  CampaignScopeView,
  CampaignTargetInput,
  CampaignTargetScore,
  CampaignWindowView,
  GuardrailCheckReport,
}

export const campaignKeys = {
  all: ["commercial", "campaign"] as const,
  plan: (campaignId: string) =>
    ["commercial", "campaign", campaignId, "plan"] as const,
  /// The outcome is keyed by the campaign and the shop and by NO window: the
  /// window is the campaign's own and the server resolves it. A key carrying
  /// dates would cache one campaign's score under the header's filter and
  /// redraw it every time somebody changed the tiles above.
  outcome: (campaignId: string, siteId?: string | null) =>
    ["commercial", "campaign", campaignId, "outcome", siteId ?? "all"] as const,
}

export function campaignPlan(
  campaignId: string,
  signal?: AbortSignal
): Promise<CampaignPlanView> {
  return node.get<CampaignPlanView>(
    `/api/v1/commercial/campaigns/${encodeURIComponent(campaignId)}/plan`,
    { signal }
  )
}

/// Restate the reach and the rails, whole. Both are documents: six shops and
/// two limits are one decision, and patching a shop out of a list is how half a
/// decision gets written.
export function saveCampaignPlan(
  campaignId: string,
  input: CampaignPlanInput,
  signal?: AbortSignal
): Promise<CampaignPlanView> {
  return node.put<CampaignPlanView>(
    `/api/v1/commercial/campaigns/${encodeURIComponent(campaignId)}/plan`,
    input,
    { signal }
  )
}

/// Add something the campaign runs, or restate it. The id is minted by the
/// caller so a retried request writes one poster rather than two.
export function saveCampaignActivity(
  campaignId: string,
  activityId: string,
  input: CampaignActivityInput,
  signal?: AbortSignal
): Promise<CampaignActivityRow> {
  return node.put<CampaignActivityRow>(
    `/api/v1/commercial/campaigns/${encodeURIComponent(campaignId)}/activities/${encodeURIComponent(activityId)}`,
    input,
    { signal }
  )
}

export function deleteCampaignActivity(
  campaignId: string,
  activityId: string,
  signal?: AbortSignal
): Promise<{ deleted: number }> {
  return node.delete<{ deleted: number }>(
    `/api/v1/commercial/campaigns/${encodeURIComponent(campaignId)}/activities/${encodeURIComponent(activityId)}`,
    { signal }
  )
}

/// One campaign, scored — over its OWN window, against the campaign it was
/// meant to beat, with the day counts normalised by the server.
export function campaignOutcome(
  campaignId: string,
  siteId?: string | null,
  signal?: AbortSignal
): Promise<CampaignOutcomeView> {
  const query = siteId ? `?site_id=${encodeURIComponent(siteId)}` : ""
  return node.get<CampaignOutcomeView>(
    `/api/v1/commercial/campaigns/${encodeURIComponent(campaignId)}/outcome${query}`,
    { signal }
  )
}

/// Say what the line is measured against. Writes two columns and no others:
/// the objective route owns the rest of the row, so a target cannot revert
/// because two requests crossed.
export function saveCampaignTarget(
  campaignId: string,
  input: CampaignTargetInput,
  signal?: AbortSignal
): Promise<{
  readonly campaign_id: string
  readonly target_model: string
  readonly target_value: number
  readonly target_value_upper: number | null
}> {
  return node.put(
    `/api/v1/commercial/campaigns/${encodeURIComponent(campaignId)}/target`,
    input,
    { signal }
  )
}

/// Measure every rail now, record what has been crossed, and stop the campaign
/// where a rail says to.
///
/// A write, and the only one on this surface that can reach a shop — through
/// `switch_campaign`, which dispatches the pause. Never called on a render.
export function checkCampaignGuardrails(
  campaignId: string,
  signal?: AbortSignal
): Promise<GuardrailCheckReport> {
  return node.post<GuardrailCheckReport>(
    `/api/v1/commercial/campaigns/${encodeURIComponent(campaignId)}/guardrail-check`,
    {},
    { signal }
  )
}

export function acknowledgeCampaignBreach(
  campaignId: string,
  breachId: string,
  signal?: AbortSignal
): Promise<CampaignBreachRow> {
  return node.post<CampaignBreachRow>(
    `/api/v1/commercial/campaigns/${encodeURIComponent(campaignId)}/breaches/${encodeURIComponent(breachId)}`,
    {},
    { signal }
  )
}

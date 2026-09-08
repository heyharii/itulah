import type { Rule, RuleStatus } from "@itulah/contract"

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
      return "This shop"
    case "SITE_GROUP_PRICE":
      return "Shop group"
    case "TIER_PRICE":
      return "Member tier"
    case "COMPANY_PRICE":
      return "Company"
    case "MARKDOWN":
      return "Markdown"
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

export interface EarnAward {
  readonly rule_id: string
  readonly name: string
  readonly points: number
  readonly basis_amount_minor: number
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
  usage: () => ["commercial", "usage"] as const,
  fleet: () => ["commercial", "activation"] as const,
  /// Every promotion, coupon and campaign the fleet is carrying, gathered from
  /// the books. One key for the three of them because it is one read — see
  /// `promotionCatalogue`.
  catalogue: () => ["commercial", "catalogue"] as const,
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
    node.get<{ items: (BookRule & CarriedRow)[]; book_count: number }>(
      "/api/v1/commercial/rules",
      { signal }
    ),
    node.get<{ items: (BookCoupon & CarriedRow)[]; book_count: number }>(
      "/api/v1/commercial/coupons",
      { signal }
    ),
    node.get<{ items: (BookCampaign & CarriedRow)[]; book_count: number }>(
      "/api/v1/commercial/campaigns",
      { signal }
    ),
  ])

  return {
    rules: ruleRows.items.map((row) => ({
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
    campaigns: campaignRows.items.map((row) => ({
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
      },
      book: carriedBy(row),
    })),
    book_count: ruleRows.book_count,
    next_version:
      books.reduce((highest, book) => Math.max(highest, book.version), 0) + 1,
  }
}

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
  const verb = input.status === "ACTIVE" ? "Resume" : "Pause"
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
/// somebody means by "stop the Lebaran promo", and is the reason this exists
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

/// Price a basket without selling it.
///
/// A POST that writes nothing: no sale, no usage count, no reservation. It is
/// the same call a till makes, so what it says is what a till would charge —
/// not an approximation built for a preview. It is a `useMutation` on the
/// screen for that reason rather than a query: nothing is cached, because
/// nothing was recorded.
///
/// **No screen calls this today.** The basket simulator was the only place the
/// engine's `rejected_rules` explanations were visible, and the owner removed
/// it with the rest of the seven menus. The function is kept rather than
/// deleted because the endpoint has not gone anywhere and the explanations are
/// the best answer to "why did the promotion not come off" that this system
/// has — a "Try it" button inside the promotion form is where it belongs when
/// somebody wants it back.
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
      return `${level.site_ids.length} shops`
    default:
      return "Every shop"
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
  readonly shops: readonly ArticlePriceShop[]
}

export interface ArticlePrices {
  readonly channel: string
  readonly as_of: string
  readonly shops: readonly {
    readonly site_id: string
    readonly label: string | null
  }[]
  readonly article_count: number
  /// How many articles exist, against how many came back — so the screen can
  /// say it is showing a slice rather than implying it is showing everything.
  readonly total_article_count: number
  /// What the whole catalogue holds, for the filter pickers — counted over
  /// everything rather than over what came back, so ticking a second box shows
  /// what it would add rather than reading zero.
  readonly facets?: {
    readonly divisions: readonly FacetCount[]
    readonly tags: readonly FacetCount[]
  }
  readonly items: readonly ArticlePriceRow[]
}

/// One option and how many styles carry it. Shaped like `FilterSpec.counted`
/// on purpose, so `facets.divisions` assigns straight into a field's spec.
export interface FacetCount {
  readonly value: string
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
}

export function articlePrices(
  options: {
    channel?: string
    at?: string
    limit?: number
  } & ArticlePriceScope = {},
  signal?: AbortSignal
): Promise<ArticlePrices> {
  const params = new URLSearchParams()
  if (options.channel) params.set("channel", options.channel)
  if (options.at) params.set("at", options.at)
  params.set("limit", String(options.limit ?? 200))
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

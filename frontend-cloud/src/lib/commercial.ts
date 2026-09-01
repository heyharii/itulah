import { node } from "@/lib/api"
import { money } from "@/lib/money"

/// Commercial is pricing, and nothing else.
///
/// The centre owns price books, markdowns, promotions and coupons; it does not
/// own stock, tax authority or the sale. Everything here reads or writes one of
/// four routes in `cloud/http/mod.rs`:
///
/// - `GET  /api/v1/commercial/publications`         — the books, headers only
/// - `POST /api/v1/commercial/publications/{id}/publish`
/// - `GET  /api/v1/commercial/offers`               — a shop's whole priced range
/// - `GET  /api/v1/commercial/offers/resolve`       — one product, priced
///
/// These shapes are hand-written, the same exception `purchase-orders.ts`
/// makes and for the same reason: the handlers build their bodies with
/// `json!()` in `cloud/postgres/commercial.rs` rather than serialising a
/// struct, so `ts-rs` has nothing to generate from and nothing checks these
/// interfaces against the server at build time. They are transcribed from
/// those literals — if a field moves, this file is where it goes stale, and it
/// is the first place to look when a column reads `undefined`.

export type CommercialChannel = "STORE" | "ONLINE" | "MARKETPLACE"

export const CHANNELS: readonly CommercialChannel[] = [
  "STORE",
  "ONLINE",
  "MARKETPLACE",
]

export type PublicationStatus = "DRAFT" | "PUBLISHED"

// ---------------------------------------------------------------------------
// Where a price came from
// ---------------------------------------------------------------------------

/// The cascade, narrowest first, and then the two things that replace it.
///
/// This is `pricing_engine::PriceSource`, and there is now exactly one spelling
/// of it: `PriceSource::as_str()` in the engine crate, which a test holds equal
/// to the serialised form. It used to be two — a shop rendered `COMPANY_PRICE`
/// through a private helper while the centre rendered `CompanyPrice` through
/// `Debug` — and a screen reading one of them showed a blank badge against the
/// other node.
export type PriceSource =
  | "SITE_PRICE"
  | "SITE_GROUP_PRICE"
  | "TIER_PRICE"
  | "COMPANY_PRICE"
  | "MARKDOWN"
  | "MANUAL_OVERRIDE"

/// The old centre spelling, still accepted.
///
/// Not left in out of caution about the past: a rolling deploy puts this
/// bundle in a browser before the node behind it restarts, and for those
/// minutes the centre is still answering `CompanyPrice`. Eight lines here is
/// cheaper than a deploy order that has to be remembered.
const SOURCE_BY_DEBUG_NAME: Readonly<Record<string, PriceSource>> = {
  SitePrice: "SITE_PRICE",
  SiteGroupPrice: "SITE_GROUP_PRICE",
  TierPrice: "TIER_PRICE",
  CompanyPrice: "COMPANY_PRICE",
  Markdown: "MARKDOWN",
  ManualOverride: "MANUAL_OVERRIDE",
}

export function priceSource(raw: string): PriceSource {
  const known = SOURCE_BY_DEBUG_NAME[raw]
  if (known !== undefined) return known
  // Already the one spelling, or a variant this build has not been told about.
  // Either way it is passed through rather than guessed at: a price whose
  // origin we cannot name is not a company price.
  return raw as PriceSource
}

/// The words a merchandiser would use for each level.
export function describeSource(source: PriceSource): string {
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
      return source
  }
}

// ---------------------------------------------------------------------------
// The books
// ---------------------------------------------------------------------------

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

/// What the server says once a book is published.
///
/// `delivered_to` is the list of shop origins the book was queued for, in the
/// same transaction that published it. An empty list is the interesting case:
/// the book is published and no till will ever see it, because no STORE origin
/// is registered or none of them was in scope.
export interface PublishReceipt {
  readonly id: string
  readonly version: number
  readonly status: PublicationStatus
  readonly offer_rule_count: number
  readonly published_at: string
  readonly delivered_to: readonly string[]
}

export const priceBooksKey = () => ["commercial", "publications"] as const

export function listPriceBooks(signal?: AbortSignal): Promise<PriceBook[]> {
  return node
    .get<{ items: PriceBook[] }>("/api/v1/commercial/publications", { signal })
    .then((body) => body.items)
}

/// Approve a draft, and send it to every shop.
///
/// Publishing is not a status change. The server dispatches the book to each
/// STORE origin inside the publishing transaction, so either the book is
/// published and on its way to the whole fleet or neither happened — which is
/// why this returns who it reached rather than just "ok".
///
/// The key is the caller's and is held across retries: a double-clicked Publish
/// publishes once and gets the same receipt twice.
export function publishPriceBook(
  id: string,
  actorId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<PublishReceipt> {
  return node.post<PublishReceipt>(
    `/api/v1/commercial/publications/${id}/publish`,
    { actor_id: actorId, idempotency_key: idempotencyKey },
    { signal },
  )
}

// ---------------------------------------------------------------------------
// What a shop is charging
// ---------------------------------------------------------------------------

/// One product, at the price that shop's own till will ring it up at.
///
/// Answered by the shared pricing engine rather than by SQL of its own, which
/// is the whole reason this screen can be trusted: before that, the centre read
/// `commercial_price_rule` and knew nothing about clearance, so a shirt on
/// markdown showed here at list price while the counter charged the sale price.
///
/// Promotions are deliberately absent. They are statements about a basket —
/// "buy two, get twenty per cent" is not this product's price, and a shelf edge
/// that advertised it would promise a number the counter will not honour for
/// one item.
export interface ShelfPrice {
  readonly sku_id: string | null
  readonly sku_code: string
  readonly article_code: string
  readonly article_name: string
  /// The book this price came out of.
  readonly version: number
  /// Always true, and not a field to gate anything on: the engine drops
  /// anything unsellable from the catalogue before it is priced, so this only
  /// ever describes rows that are here. What it cannot tell you is the
  /// interesting case — a product that is *not* sellable at this shop is
  /// simply absent from the list.
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

export interface ShelfScope {
  readonly siteId: string
  readonly channel: CommercialChannel
  /// The instant to price at. Omitted means now.
  ///
  /// Passed to the engine as an argument rather than read from a clock, so
  /// asking what a shop will charge on the first morning of a campaign is the
  /// same code path as asking what it charges right now.
  readonly at?: string
}

export const shelfPricesKey = (scope: ShelfScope) =>
  ["commercial", "offers", scope.siteId, scope.channel, scope.at ?? "now"] as const

export function shelfPrices(
  scope: ShelfScope,
  signal?: AbortSignal,
): Promise<ShelfPrices> {
  const params = new URLSearchParams({
    site_id: scope.siteId,
    channel: scope.channel,
  })
  if (scope.at !== undefined && scope.at !== "") params.set("at", scope.at)
  return node.get<ShelfPrices>(`/api/v1/commercial/offers?${params.toString()}`, {
    signal,
  })
}

/// `GET /api/v1/commercial/offers/resolve` is deliberately not wrapped here.
///
/// It answers the same question as one row of `shelfPrices` — the engine over a
/// basket of one — and adds only the ability to pin a specific publication.
/// Nothing on this surface needs that yet, and a wrapper nobody calls is a
/// wrapper that goes stale beside a `json!` literal nothing checks it against.
/// When a "why is this price what it is" panel wants to ask about one book,
/// this is the route: `sku_id`, `site_id`, `channel`, `at`, `publication_id`.

// ---------------------------------------------------------------------------
// Reading the rows
// ---------------------------------------------------------------------------

/// Whether a markdown is actually taking money off this price.
///
/// Read from the two amounts rather than from `price_source`, because they can
/// disagree honestly: a markdown authored at or above the base price wins the
/// cascade and charges the same money, and calling that "marked down" on a
/// screen would send somebody looking for a discount that is not there.
export function isMarkedDown(row: ShelfPrice): boolean {
  return row.unit_price_minor < row.base_unit_price_minor
}

/// How far off, in basis points of the original.
export function markdownDepthBps(row: ShelfPrice): number {
  if (row.base_unit_price_minor <= 0) return 0
  const off = row.base_unit_price_minor - row.unit_price_minor
  return Math.round((off / row.base_unit_price_minor) * 10_000)
}

/// An instant a person typed into a `datetime-local` box, as the server wants
/// it. The box has no timezone; the browser's own is the honest reading of what
/// somebody sitting in front of it meant.
export function localInstantToIso(value: string): string | undefined {
  if (value.trim() === "") return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

// ---------------------------------------------------------------------------
// How it is going out there
// ---------------------------------------------------------------------------

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

export const fleetKey = () => ["commercial", "activation"] as const

export function commercialFleet(signal?: AbortSignal): Promise<Fleet> {
  return node.get<Fleet>("/api/v1/commercial/activation", { signal })
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

export const usageKey = () => ["commercial", "usage"] as const

export function commercialUsage(signal?: AbortSignal): Promise<PromotionUsage[]> {
  return node
    .get<{ items: PromotionUsage[] }>("/api/v1/commercial/usage", { signal })
    .then((body) => body.items)
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
  signal?: AbortSignal,
): Promise<{ readonly command_id: string; readonly sent_to: readonly string[] }> {
  return node.post("/api/v1/commercial/usage/publish", {
    actor_id: actorId,
    idempotency_key: idempotencyKey,
  }, { signal })
}

// ---------------------------------------------------------------------------
// What one book says
// ---------------------------------------------------------------------------

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
  /// The rule as the engine serialised it, handed back whole. Rendered as the
  /// document it is rather than field by field: the shape belongs to the engine
  /// and a second reading of it here would be a second opinion about what a
  /// promotion does.
  readonly definition: unknown
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
}

export interface BookActivation {
  readonly origin_id: string
  readonly site_id: string | null
  readonly activated_at: string
  readonly reported_at: string
  readonly price_rule_count: number
}

export interface PriceBookDetail extends PriceBook {
  readonly tax_rules: readonly {
    readonly tax_category: string
    readonly rate_bps: number
    readonly tax_inclusive: boolean
  }[]
  readonly price_rules: readonly BookPriceRule[]
  readonly markdowns: readonly BookMarkdown[]
  readonly rules: readonly BookRule[]
  readonly coupons: readonly BookCoupon[]
  readonly campaigns: readonly BookCampaign[]
  /// Who has put this book into service. "Published" and "in force" are
  /// different things, and this is the difference.
  readonly activated_by: readonly BookActivation[]
}

export const priceBookKey = (id: string) => ["commercial", "publications", id] as const

export function priceBookDetail(
  id: string,
  signal?: AbortSignal,
): Promise<PriceBookDetail> {
  return node.get<PriceBookDetail>(`/api/v1/commercial/publications/${id}`, { signal })
}

// ---------------------------------------------------------------------------
// Pricing a basket nobody is buying
// ---------------------------------------------------------------------------

export interface SimulateLine {
  readonly sku_code: string
  readonly quantity: number
  readonly manual_unit_price_minor?: number
}

export interface SimulateRequest {
  readonly site_id: string
  readonly channel: CommercialChannel
  readonly at?: string
  readonly lines: readonly SimulateLine[]
  readonly coupon_codes?: readonly string[]
  readonly customer_id?: string
  readonly customer_tier?: string
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

/// A promotion that could have applied and did not, with the engine's own words
/// for why.
///
/// The explanation comes from Rust — `RejectionReason::describe()` — rather
/// than a lookup table kept beside it here. A second copy of these strings in
/// the browser is a second copy that goes stale the day a reason is added, and
/// the symptom would be a blank cell on the one screen whose job is to explain.
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
  readonly earn_awards: readonly {
    readonly rule_id: string
    readonly name: string
    readonly points: number
    readonly basis_amount_minor: number
  }[]
  readonly points_earned: number
  readonly discount_total_minor: number
  readonly total_minor: number
}

/// Price a basket without selling it.
///
/// A POST that writes nothing: no sale, no usage count, no reservation. It is
/// the same call a till makes, so what it says is what a till would charge —
/// not an approximation built for a preview.
export function simulate(
  request: SimulateRequest,
  signal?: AbortSignal,
): Promise<SimulateResult> {
  return node.post<SimulateResult>("/api/v1/commercial/simulate", request, { signal })
}

// ---------------------------------------------------------------------------
// Styles, shops, and the whole cascade
// ---------------------------------------------------------------------------

/// Who a price is for. The four levels, narrowest last.
///
/// The engine's own `PriceLevel`, sent structured rather than pre-rendered so
/// a screen can style a tier price differently from a shop price without the
/// server deciding how it reads.
export type PriceLevel =
  | { readonly level: "COMPANY" }
  | { readonly level: "TIER"; readonly tier: string }
  | { readonly level: "SITE_GROUP"; readonly site_ids: readonly string[] }
  | { readonly level: "SITE"; readonly site_id: string }

/// One rung of the cascade for one style at one shop.
///
/// A style is several products and they need not agree — a shirt priced per
/// size is one rung covering a range — so a rung carries both ends and says how
/// many products it covers.
export interface PriceRung {
  /// The engine's own ordering. 0 is the rung that would be consulted first.
  readonly rank: number
  readonly source: string
  readonly applies_to: PriceLevel
  readonly markdown_id: string | null
  readonly currency: string
  readonly publication_version: number
  readonly min_unit_price_minor: number
  readonly max_unit_price_minor: number
  readonly sku_count: number
  /// How many of this style's products this rung actually wins — not always
  /// all of them. A shop price on one size beats the company price on that size
  /// alone, and the company rung is then in force for the rest. A boolean would
  /// have to pick one of those and be wrong about the other.
  readonly in_force_for: number
}

export interface ShopPrices {
  readonly site_id: string
  readonly label: string
  readonly stack: readonly PriceRung[]
}

export interface ArticlePrices {
  readonly article_code: string
  readonly article_name: string
  readonly image_url: string | null
  readonly division_code: string | null
  readonly tags: readonly string[]
  readonly sku_count: number
  /// Shops where this style has no price at all are absent, not zero: no price
  /// is not a price, and a shop that cannot sell a thing should not appear to
  /// sell it for nothing.
  readonly shops: readonly ShopPrices[]
}

export interface ArticlePricePage {
  readonly channel: CommercialChannel
  readonly as_of: string
  readonly shops: readonly { readonly site_id: string; readonly label: string }[]
  readonly article_count: number
  readonly items: readonly ArticlePrices[]
}

export interface ArticlePriceScope {
  readonly channel: CommercialChannel
  readonly at?: string
  readonly limit?: number
}

export const articlePricesKey = (scope: ArticlePriceScope) =>
  ["commercial", "article-prices", scope.channel, scope.at ?? "now", scope.limit ?? 200] as const

export function articlePrices(
  scope: ArticlePriceScope,
  signal?: AbortSignal,
): Promise<ArticlePricePage> {
  const params = new URLSearchParams({ channel: scope.channel })
  if (scope.at !== undefined && scope.at !== "") params.set("at", scope.at)
  if (scope.limit !== undefined) params.set("limit", String(scope.limit))
  return node.get<ArticlePricePage>(
    `/api/v1/commercial/article-prices?${params.toString()}`,
    { signal },
  )
}

/// Who a rung applies to, in words.
export function describeLevel(level: PriceLevel): string {
  switch (level.level) {
    case "SITE":
      return level.site_id
    case "SITE_GROUP":
      return `${level.site_ids.length} shops`
    case "TIER":
      return `tier ${level.tier}`
    default:
      return "every shop"
  }
}

/// The price of a rung, as one number or as a range.
///
/// A style priced per size genuinely has two ends, and showing only the cheaper
/// one would say the large costs what the small costs.
export function rungPrice(rung: PriceRung): string {
  const low = money(rung.min_unit_price_minor, rung.currency)
  if (rung.min_unit_price_minor === rung.max_unit_price_minor) return low
  return `${low} – ${money(rung.max_unit_price_minor, rung.currency)}`
}

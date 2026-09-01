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
  /// The rule as the engine serialised it, handed back whole. A second reading
  /// of it here would be a second opinion about what a promotion does.
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
  readonly replacement_unit_price_minor: number
  readonly priority: number
  readonly effective_from: string
  readonly effective_to?: string | null
}

/// What this app can author today: a book of markdowns.
///
/// The server accepts far more in one publication — base prices with their tax
/// categories, promotion rules, coupons and campaigns — and refuses a book that
/// changes nothing at all. Markdowns are the whole of the authoring surface
/// here because they are the change a merchandiser makes weekly and the only
/// one that needs no product picker: a markdown names a style or a product by
/// its code. `tax_rules` is deliberately absent and must stay absent — the
/// server refuses tax rules on a book that sets no prices, because they would
/// categorise nothing.
export interface CreatePriceBookRequest {
  readonly version: number
  readonly name: string
  readonly effective_from: string
  readonly effective_to: string | null
  readonly markdowns: readonly MarkdownInput[]
  readonly actor_id: string
  readonly idempotency_key: string
}

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
  /// Article-level prices. The channel and the moment are part of the key
  /// because a different question has a different answer.
  articlePrices: (channel: string, at: string | null) =>
    ["commercial", "article-prices", channel, at] as const,
  /// The product picker's search. Keyed by the words typed, so backspacing
  /// re-uses the answer it already had.
  products: (query: string) => ["commercial", "products", query] as const,
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

/// What one shop charges for one article, as a stack of rules in the order the
/// engine applied them. The rank is the engine's, not a sort key.
export interface ArticlePriceRule {
  readonly rank: number
  readonly source: string
  readonly applies_to: string
  readonly markdown_id: string | null
  readonly currency: string
  readonly publication_version: number | null
  readonly min_unit_price_minor: number
  readonly max_unit_price_minor: number
  readonly sku_count: number
  readonly in_force_for: string | null
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
  readonly items: readonly ArticlePriceRow[]
}

export function articlePrices(
  options: { channel?: string; at?: string; limit?: number } = {},
  signal?: AbortSignal
): Promise<ArticlePrices> {
  const params = new URLSearchParams()
  if (options.channel) params.set("channel", options.channel)
  if (options.at) params.set("at", options.at)
  params.set("limit", String(options.limit ?? 200))
  return node.get<ArticlePrices>(
    `/api/v1/commercial/article-prices?${params.toString()}`,
    { signal }
  )
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

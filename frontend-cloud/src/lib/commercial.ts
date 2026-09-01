import { node } from "@/lib/api"

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
/// This is `pricing_engine::PriceSource`, and it arrives spelled two different
/// ways depending on which node answered. The centre writes it with
/// `format!("{:?}", source)` — Rust's `Debug`, so `CompanyPrice`. A shop writes
/// it through `source_name()` in `edge/pricing.rs` — so `COMPANY_PRICE`. One
/// concept, two spellings, and a screen that reads only one of them shows a
/// blank badge on the node it did not expect.
///
/// Normalised here rather than anywhere further in, so the rest of the surface
/// only ever sees one set of words. The right fix is on the Rust side — one
/// rendering of one enum — and until then this is where the two meet.
export type PriceSource =
  | "SITE_PRICE"
  | "SITE_GROUP_PRICE"
  | "TIER_PRICE"
  | "COMPANY_PRICE"
  | "MARKDOWN"
  | "MANUAL_OVERRIDE"

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
  // Already in the shop's spelling, or a variant this build has not been told
  // about. Either way it is passed through rather than guessed at: a price
  // whose origin we cannot name is not a company price.
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

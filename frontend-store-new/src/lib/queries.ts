import { node } from "@/lib/api"
import type {
  CatalogRow,
  MovementView,
  SkuStock,
  StoreInboundCountRequest,
  StoreInboundDetail,
  StoreInboundList,
  StoreOffers,
} from "@itulah/contract"

/// Every read this till makes, and the key it is cached under.
///
/// One file rather than the console's nine: this surface has seven store
/// endpoints plus a handful of shared ones, and splitting them by domain would
/// be filing for its own sake. The rule the console keeps is kept here — the
/// key lives beside the fetch function, and the first segment is a namespace so
/// signing out can drop a family of answers by prefix.
///
/// The types that come through `@itulah/contract` are generated from the Rust
/// and are checked at build time. The envelopes below are not: `edge/http.rs`
/// builds several of these responses with `json!` and `edge/reports.rs` answers
/// from a plain `Serialize` struct, so nothing generates them. They are
/// hand-written against those two files, and this is where they go stale.

// ─────────────────────────────────────────────────────────────────────────────
// The shop's own shelf, priced

/// `GET /api/v1/store/catalog` — `edge/http.rs::store_catalog`.
export interface Catalogue {
  readonly site_id: string
  readonly channel: string
  readonly as_of: string
  /// False when no price book has ever reached this shop. Not the same as an
  /// empty catalogue, and the difference is what somebody needs to be told:
  /// `false` is a sync problem, `true` with no items is a merchandising one.
  readonly has_price_book: boolean
  readonly publication_version: number | null
  readonly currency: string
  readonly item_count: number
  readonly limit: number
  readonly next_cursor: string | null
  readonly items: readonly CatalogRow[]
}

export const catalogueKey = () => ["catalogue"] as const

/// The whole resident book, in pages, joined here.
///
/// Fetched whole rather than searched server-side on every keystroke, because
/// the point of this screen is that it answers with the line down: a search
/// that needs the node for each letter is a search that stops working the
/// moment the shop most needs it. The node caps a page at its own limit, so
/// this follows `next_cursor` until it runs out.
export async function fetchCatalogue(signal?: AbortSignal): Promise<Catalogue> {
  let cursor: string | null = null
  let first: Catalogue | null = null
  const items: CatalogRow[] = []
  // The page summary is folded across pages, not taken from the first one.
  //
  // `store_catalog` computes `has_price_book`, `publication_version` and
  // `currency` **per page**, from that page's rows — and `store_catalog_page`
  // drops SKUs the engine could not price while still advancing the cursor past
  // them. So a shop whose first five hundred SKUs happen to be unpriced answers
  // page 1 with no items and `has_price_book: false`, and a reader that trusted
  // page 1 would put "this shop has never received a price book" in front of a
  // cashier whose shop plainly has one.
  let hasBook = false
  let version: number | null = null
  let currency: string | null = null

  // A shop's range is thousands of rows, not tens of thousands, and the pages
  // are the node's own size. The bound is a guard against a cursor that never
  // terminates, not an expected limit.
  for (let page = 0; page < 200; page += 1) {
    const parameters = new URLSearchParams({ limit: "500" })
    if (cursor !== null) parameters.set("cursor", cursor)
    const answer: Catalogue = await node.get<Catalogue>(
      `/api/v1/store/catalog?${parameters.toString()}`,
      { signal },
    )
    first ??= answer
    items.push(...answer.items)
    hasBook ||= answer.has_price_book
    if (answer.publication_version !== null) {
      version = Math.max(
        version ?? answer.publication_version,
        answer.publication_version,
      )
    }
    if (currency === null && answer.items.length > 0) currency = answer.currency
    cursor = answer.next_cursor
    if (cursor === null) break
  }

  return {
    site_id: first?.site_id ?? "",
    channel: first?.channel ?? "STORE",
    as_of: first?.as_of ?? new Date().toISOString(),
    has_price_book: hasBook,
    publication_version: version,
    currency: currency ?? first?.currency ?? "IDR",
    item_count: items.length,
    limit: first?.limit ?? 0,
    next_cursor: null,
    items,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// What the shop is offering

/// Everything under one prefix, so a fresh price book can drop the lot.
export const offersKey = () => ["offers"] as const

/// `GET /api/v1/store/offers` — `edge/http.rs::store_offers`.
///
/// Generated, unlike the catalogue envelope above it: the handler serialises
/// `StoreOffers` rather than assembling a `json!`, so this one cannot go stale
/// behind the Rust.
///
/// Why the till needs it at all: a markdown is a price and is therefore already
/// in the catalogue, but a promotion is a thing that happens to a *basket* —
/// "buy two get one", "20% off menswear over 500rb" — and no shelf edge can
/// show it. Six offers can be published, delivered and resident at a shop with
/// nothing on any screen saying the shop holds them.
export function fetchOffers(signal?: AbortSignal): Promise<StoreOffers> {
  return node.get<StoreOffers>("/api/v1/store/offers", { signal })
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock, as this node owns it

/// One row of `GET /api/v1/inventory/pools`.
///
/// Declared field by field rather than extended from the generated
/// `PoolBalance`, and the difference matters: the handler presents a balance
/// rather than serialising one — `edge/http.rs::present_pools` writes the pool
/// under `"id"`, not `PoolBalance`'s `pool_id`. Inheriting the generated type
/// would put a field on this interface that the wire never sends, and the first
/// screen to reach for it would read `undefined` with the compiler's blessing.
///
/// The Edge answers with more than a shop reads — the sync provenance columns
/// are only ever non-null on the centre's own aggregation — so only what this
/// app draws is named.
export interface PoolRow {
  readonly id: string
  readonly site_id: string
  readonly group: string
  readonly pool_code: string
  readonly label: string
  readonly display_order: number
  readonly is_rollup: boolean
  /// `Stock = On Hand + Allotted + Missing`, as the node states it.
  readonly stock: number
  readonly allotted: number | null
  readonly on_hand: number
  readonly missing: number
}

export interface PoolsAnswer {
  readonly as_of: string
  readonly inventory_equation: string
  readonly items: readonly PoolRow[]
}

/// Everything this node says about its own stock, under one prefix.
///
/// Named so a write can invalidate the family rather than guessing at the
/// `limit` a ledger screen happened to ask for. Receiving a garment, moving one
/// and selling one all change the balances *and* the ledger — that is the whole
/// namespace, genuinely, and PATTERN.md asks for a prefix invalidation to say
/// so out loud rather than be inferred.
export const inventoryKey = () => ["inventory"] as const

export const poolsKey = () => ["inventory", "pools"] as const

export function fetchPools(signal?: AbortSignal): Promise<PoolsAnswer> {
  return node.get<PoolsAnswer>("/api/v1/inventory/pools", { signal })
}

/// Every SKU's spendable units here, split floor / warehouse.
export const skuStockKey = () => ["inventory", "sku-stock"] as const

export function fetchSkuStock(signal?: AbortSignal): Promise<SkuStock> {
  return node.get<SkuStock>("/api/v1/inventory/sku-stock", { signal })
}

export const movementsKey = (limit: number) =>
  ["inventory", "movements", limit] as const

/// The ledger, newest first. Capped by the node at 500.
export async function fetchMovements(
  limit: number,
  signal?: AbortSignal,
): Promise<readonly MovementView[]> {
  const answer = await node.get<{ items: MovementView[] }>(
    `/api/v1/inventory/movements?limit=${Math.trunc(limit)}`,
    { signal },
  )
  return answer.items
}

// ─────────────────────────────────────────────────────────────────────────────
// Deliveries on their way here, and what arrived
//
// Mostly read: the list still polls on its own, because a count made from a
// handheld sweeping the stockroom (or another till in this shop) should show
// up here without anybody pressing anything. `receiveInboundByCount` below is
// this file's one write against a delivery — a blind count per SKU, with no
// reader required (owner, 29 Sep 2026).

/// Its own `inbound` namespace rather than under `inventory`: every move and
/// sale invalidates that prefix, and none of them changes a delivery.
export const inboundListKey = (status: InboundFilter) =>
  ["inbound", "list", status] as const

export const inboundDeliveryKey = (deliveryId: string) =>
  ["inbound", "delivery", deliveryId] as const

export type InboundFilter = "IN_TRANSIT" | "RECEIVED" | "ALL"

/// `GET /api/v1/store/inbound`. While a delivery is in transit its `result` is
/// null — the node keeps the packed quantities back until the count is in.
export function fetchInbound(
  status: InboundFilter,
  signal?: AbortSignal,
): Promise<StoreInboundList> {
  return node.get<StoreInboundList>(`/api/v1/store/inbound?status=${status}`, {
    signal,
  })
}

/// `GET /api/v1/store/inbound/{delivery_id}` — the delivery, and per SKU what
/// was packed against what the handheld counted. `lines` is empty in transit.
export function fetchInboundDelivery(
  deliveryId: string,
  signal?: AbortSignal,
): Promise<StoreInboundDetail> {
  return node.get<StoreInboundDetail>(
    `/api/v1/store/inbound/${encodeURIComponent(deliveryId)}`,
    { signal },
  )
}

/// `POST /api/v1/store/inbound/{delivery_id}/receive-count` — receive without
/// a reader (owner, 29 Sep 2026): a blind count per SKU, scanned or typed,
/// booked exactly as a handheld's sweep would be. This is the one write this
/// file makes against a delivery — see `receiveInboundByCount`'s caller in
/// `screens/stock/delivery-sheet.tsx` for why receiving no longer needs the
/// handheld.
export function receiveInboundByCount(
  deliveryId: string,
  request: StoreInboundCountRequest,
  signal?: AbortSignal,
): Promise<StoreInboundDetail> {
  return node.post<StoreInboundDetail>(
    `/api/v1/store/inbound/${encodeURIComponent(deliveryId)}/receive-count`,
    request,
    { signal },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// What this shop took
//
// Read from the shop's own SQLite, so they still answer with the link to the
// centre down — a manager closing up does not stop needing today's takings
// because a tunnel dropped. Deliberately thinner than the centre's reports:
// the edge `sale` row has no tax split. Voided sales are left out — migration
// 0024 opened `sale.status`, and the node filters them the same way the shift
// report does, so these takings and the drawer agree. Refunds are NOT netted
// off: these are takings, not revenue. See `backend/src/edge/reports.rs`.

export type Bucket = "day" | "week" | "month"

export interface SalesCell {
  /// The local date the bucket starts on. A week is named by its Monday — the
  /// same Monday the centre uses, because both read `crate::reporting`.
  readonly bucket_start: string
  readonly sales_count: number
  readonly units_sold: number
  readonly gross_minor: number
}

export interface SalesSeries {
  readonly site_id: string
  readonly from: string
  readonly to: string
  readonly bucket: string
  readonly utc_offset_minutes: number
  /// Every bucket in the span, including the ones nobody sold anything in.
  readonly buckets: readonly string[]
  readonly cells: readonly SalesCell[]
}

export interface Receipt {
  readonly id: string
  readonly total_minor: number
  readonly paid_minor: number
  readonly change_minor: number
  readonly line_count: number
  readonly units: number
  readonly actor_id: string
  readonly completed_at: string
}

export interface TenderTotal {
  /// `CASH` · `CARD` · `QRIS` · `OTHER`, as the node's schema constrains it.
  readonly method: string
  readonly amount_minor: number
  /// Tenders, not sales: one basket settled half on a card is two.
  readonly count: number
}

export interface SalesWindow {
  readonly site_id: string
  readonly from: string
  readonly to: string
  readonly utc_offset_minutes: number
  readonly sales: {
    readonly count: number
    readonly units_sold: number
    readonly gross_minor: number
    readonly paid_minor: number
    readonly change_minor: number
    /// Takings divided by completed sales, computed by the node so it cannot
    /// be divided by a count from somewhere else.
    readonly average_minor: number
  }
  /// What each form of payment took, largest first.
  readonly tenders: readonly TenderTotal[]
  /// What is expected in the drawer: cash taken, less the change given out of
  /// it. Only cash — a card settlement is chased through an acquirer, and
  /// counting it as banknotes reports a drawer short by the day's card takings.
  readonly cash_expected_minor: number
  readonly receipts: readonly Receipt[]
  readonly receipts_truncated: boolean
  readonly receipts_limit: number
}

/// This shop's trade, under one prefix — every window and every series. A
/// completed sale changes all of them at once, and none of the screens holding
/// them know which span they are showing.
export const salesKey = () => ["sales"] as const

export const windowKey = (from: string, to: string) =>
  ["sales", "window", from, to] as const

export function fetchWindow(
  span: { from: string; to: string },
  signal?: AbortSignal,
): Promise<SalesWindow> {
  const parameters = new URLSearchParams({
    from: span.from,
    to: span.to,
    utc_offset_minutes: String(localOffsetMinutes()),
  })
  return node.get<SalesWindow>(
    `/api/v1/store/reports/sales/window?${parameters.toString()}`,
    { signal },
  )
}

export const seriesKey = (from: string, to: string, bucket: Bucket) =>
  ["sales", "series", from, to, bucket] as const

export function fetchSeries(
  span: { from: string; to: string; bucket: Bucket },
  signal?: AbortSignal,
): Promise<SalesSeries> {
  const parameters = new URLSearchParams({
    from: span.from,
    to: span.to,
    bucket: span.bucket,
    utc_offset_minutes: String(localOffsetMinutes()),
  })
  return node.get<SalesSeries>(
    `/api/v1/store/reports/sales/series?${parameters.toString()}`,
    { signal },
  )
}

/// Which day a sale at 00:30 belongs to.
///
/// Sent explicitly rather than left to the node's default: the report buckets
/// by *local* day, and a shop trading past midnight in Jakarta would otherwise
/// see its late sales land on tomorrow. `getTimezoneOffset` counts the other
/// way round from everyone else, hence the negation.
function localOffsetMinutes(): number {
  return -new Date().getTimezoneOffset()
}

/// The last `days` days, ending today, as the two dates these endpoints take.
export function lastDays(days: number): { from: string; to: string } {
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - (days - 1))
  return { from: isoDay(start), to: isoDay(today) }
}

export function isoDay(when: Date): string {
  // Local, not UTC: `toISOString()` would move a shop in Jakarta back a day
  // for the first seven hours of every morning.
  const month = String(when.getMonth() + 1).padStart(2, "0")
  const day = String(when.getDate()).padStart(2, "0")
  return `${when.getFullYear()}-${month}-${day}`
}

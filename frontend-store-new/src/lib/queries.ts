import { queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"
import { ApiError, readError } from "@itulah/contract/client"
import type {
  CatalogRow,
  FinalUnitPrices,
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

/// The last **complete** book this session joined, and the generation the node
/// named when it served it. Module-level rather than localStorage-backed on
/// purpose: the book is thousands of rows, and the refetches a revalidation
/// saves — the price-drops minute poll, a price book landing, a screen
/// returning to focus — all happen inside one live session. Paying a
/// synchronous multi-megabyte `stringify` after every one of those to also
/// survive a reload trades real jank for a reload that already works.
let resident: { readonly etag: string; readonly book: Catalogue } | null = null

/// What the first page's answer was: either the resident book the node
/// confirmed untouched, or a fresh page with the generation that produced it.
type CatalogueHead =
  | { readonly resident: Catalogue }
  | { readonly fresh: Catalogue; readonly etag: string | undefined }

/// The first page, through `fetch` rather than the node client.
///
/// `node.get` answers with the parsed body and nothing else, and a 304's whole
/// value is in its headers — so the one request that may carry `If-None-Match`
/// travels the client's own transport by hand: same origin, the session
/// cookie (`node`'s base URL is empty — `lib/api.ts`), and nothing else, a GET
/// being safe and so owing no CSRF echo. Everything the client does to a
/// failure is done here too, so a refused or unreachable node reads exactly
/// as it does on every other call.
///
/// Returns `resident` when the node answered 304 — the held book stands and
/// nothing else need be asked. Only a first page ever goes through here, which
/// is also the only shape the node will answer 304 to (`edge/http.rs`: a
/// cursor or a search in the request and the body comes whole).
async function firstCataloguePage(
  signal?: AbortSignal,
): Promise<CatalogueHead> {
  const held = resident
  const headers: Record<string, string> = {}
  if (held !== null) headers["if-none-match"] = held.etag
  let response: Response
  try {
    response = await fetch("/api/v1/store/catalog?limit=500", {
      method: "GET",
      credentials: "include",
      headers,
      signal,
    })
  } catch (error) {
    // `reach` in the client does the same: a bare network failure is a 503,
    // not a TypeError for every screen to relearn.
    if (error instanceof TypeError) {
      throw new ApiError(
        503,
        "Can't reach the server. Check the connection and try again in a moment.",
      )
    }
    throw error
  }
  if (response.status === 304) {
    // A 304 is the answer to the etag this request sent, which is only ever
    // sent for a held book — a server saying otherwise has nothing it could
    // confirm, and reads as the error it is.
    if (held === null) throw await readError(response)
    return { resident: held.book }
  }
  if (!response.ok) throw await readError(response)
  return {
    fresh: (await response.json()) as Catalogue,
    // Absent only if something between here and the node stripped it — and an
    // etag that cannot be had is a book that cannot be revalidated, so the
    // caller files no generation for this one.
    etag: response.headers.get("etag") ?? undefined,
  }
}

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
  // The generation the first page was served under. Subsequent pages are the
  // same scan of the same generation, so only the first page names it.
  let etag: string | undefined

  // A shop's range is thousands of rows, not tens of thousands, and the pages
  // are the node's own size. The bound is a guard against a cursor that never
  // terminates, not an expected limit.
  for (let page = 0; page < 200; page += 1) {
    let answer: Catalogue
    if (cursor === null) {
      // The first page is the one that may be asked conditionally — and it is
      // asked through `fetch` even with no generation held, so that a book
      // that will be complete is joined to the generation it came from.
      const head = await firstCataloguePage(signal)
      if ("resident" in head) return head.resident
      answer = head.fresh
      etag = head.etag
    } else {
      const parameters = new URLSearchParams({ limit: "500", cursor })
      answer = await node.get<Catalogue>(
        `/api/v1/store/catalog?${parameters.toString()}`,
        { signal },
      )
    }
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

  const book: Catalogue = {
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

  // Only a book the cursor loop ran to the end becomes resident — the 200-page
  // guard above can leave a half-joined one, and a partial book evicting a
  // complete one would have the next conditional ask confirm a book the till
  // only half holds. A completed book with no generation named for it is
  // dropped from the cache rather than filed under the previous one: an etag
  // held without its book would be confirmed next time against a book the till
  // no longer has.
  if (cursor === null) {
    resident = etag === undefined ? null : { etag, book }
  }
  return book
}

/// The book, as every screen that reads it asks for it — and as the route's
/// prefetcher does (`src/prefetch/catalogue.ts`), so a warmed answer is the
/// one the screen would have fetched. Screens add their own poll on top.
export const catalogueQuery = () =>
  queryOptions({
    queryKey: catalogueKey(),
    queryFn: ({ signal }) => fetchCatalogue(signal),
  })

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

export const offersQuery = () =>
  queryOptions({
    queryKey: offersKey(),
    queryFn: ({ signal }) => fetchOffers(signal),
  })

/// Under the catalogue's key, so whatever refreshes the book refreshes these.
export const finalPricesKey = () => ["catalogue", "final-prices"] as const

/// `GET /api/v1/store/final-prices` — `edge/http.rs::store_final_prices`.
///
/// What one piece costs a walk-in shopper this minute, after the promotions
/// that reach a single piece — the counter's own answer, so the catalogue
/// quotes what the till then charges. Only the SKUs a promotion brings down;
/// every other SKU costs its catalogue price.
export function fetchFinalPrices(
  signal?: AbortSignal,
): Promise<FinalUnitPrices> {
  return node.get<FinalUnitPrices>("/api/v1/store/final-prices", { signal })
}

export const finalPricesQuery = () =>
  queryOptions({
    queryKey: finalPricesKey(),
    queryFn: ({ signal }) => fetchFinalPrices(signal),
    // A node that does not serve it yet costs the promotions their place in
    // the price, never an error over the range — asking again changes nothing.
    retry: false,
  })

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

export const poolsQuery = () =>
  queryOptions({
    queryKey: poolsKey(),
    queryFn: ({ signal }) => fetchPools(signal),
  })

/// Every SKU's spendable units here, split floor / warehouse.
export const skuStockKey = () => ["inventory", "sku-stock"] as const

export function fetchSkuStock(signal?: AbortSignal): Promise<SkuStock> {
  return node.get<SkuStock>("/api/v1/inventory/sku-stock", { signal })
}

export const skuStockQuery = () =>
  queryOptions({
    queryKey: skuStockKey(),
    queryFn: ({ signal }) => fetchSkuStock(signal),
  })

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

export const movementsQuery = (limit: number) =>
  queryOptions({
    queryKey: movementsKey(limit),
    queryFn: ({ signal }) => fetchMovements(limit, signal),
  })

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

/// One day's takings, as Sales and Reconciliation both read them. Never
/// fresh: a drawer open all day moves with every sale, so a screen coming
/// back asks again.
export const dayTakingsQuery = (day: string) =>
  queryOptions({
    queryKey: windowKey(day, day),
    queryFn: ({ signal }) => fetchWindow({ from: day, to: day }, signal),
    staleTime: 0,
  })

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

import { node } from "@/lib/api"
import type {
  CustomerTransactionDetail,
  CustomerTransactionPage,
  PaymentMethod,
} from "@itulah/contract"

/// The till, the refund desk, and one member's own history.
///
/// Two different kinds of type live in this file and the difference matters.
///
///  * The **customer** reads are generated: `cloud/http/customer.rs` returns
///    `Json<CustomerTransactionPage>` and `Json<CustomerTransactionDetail>`
///    from real structs, so `@itulah/contract` has them and the compiler
///    checks this app against the server.
///  * The **sales** and **returns** reads are not. `cloud/postgres/sales.rs`,
///    `returns.rs` and `receipts.rs` assemble their answers with `json!()`,
///    so ts-rs has nothing to generate from and the interfaces below are
///    transcribed from those literals by hand. Nothing verifies them at build
///    time — if a column reads `undefined` on a screen, this file is the first
///    place to look, and the `json!` block it was copied from is named above
///    each one.
///
/// Money is in minor units everywhere and stays that way until `money()` draws
/// it.

// ---- Sales -------------------------------------------------------------

/// One sale on the list. Transcribed from the `json!` in
/// `postgres/sales.rs::list_sales`.
export interface SaleRow {
  readonly id: string
  readonly sale_number: string
  readonly site_id: string
  readonly channel: string
  /// `OPEN` · `COMPLETED` · `VOIDED`.
  readonly status: string
  readonly commercial_version: number
  readonly currency: string
  readonly total_minor: number
  readonly paid_minor: number
  readonly change_minor: number
  /// Set when completion moved the goods; null on an open or voided sale.
  readonly movement_group_id: string | null
  readonly created_at: string
  readonly completed_at: string | null
}

/// One line of a sale. A line is one physical garment, not a quantity of a
/// SKU: `sale_line` is unique on (sale, subject) because the till scanned a
/// tag rather than a barcode.
export interface SaleLine {
  readonly id: string
  readonly subject_id: string
  readonly epc: string
  readonly sku_id: string
  readonly sku_code: string
  readonly quantity: number
  readonly unit_price_minor: number
  readonly net_minor: number
  readonly tax_minor: number
  readonly total_minor: number
  readonly currency: string
  readonly tax_category: string
  readonly tax_rate_bps: number
  readonly tax_inclusive: boolean
  readonly commercial_publication_id: string
  readonly commercial_version: number
  readonly price_snapshot_digest: string
  readonly added_at: string
}

export interface SalePayment {
  readonly id: string
  readonly method: string
  readonly amount_minor: number
  /// For whoever reconciles this against a bank statement — an acquirer, an
  /// approval code. Never an instrument.
  readonly reference: string | null
  readonly actor_id: string
  readonly recorded_at: string
}

/// One sale, whole. Transcribed from `postgres/sales.rs::get_sale`.
export interface SaleDetail {
  readonly id: string
  readonly sale_number: string
  readonly site_id: string
  readonly channel: string
  readonly status: string
  readonly commercial_publication_id: string
  readonly commercial_version: number
  readonly currency: string
  readonly net_minor: number
  readonly tax_minor: number
  readonly total_minor: number
  readonly paid_minor: number
  readonly change_minor: number
  readonly movement_group_id: string | null
  readonly actor_id: string
  readonly created_at: string
  readonly completed_at: string | null
  readonly voided_at: string | null
  readonly lines: readonly SaleLine[]
  readonly payments: readonly SalePayment[]
}

// ---- The receipt -------------------------------------------------------

export interface ReceiptLine {
  readonly sale_line_id: string
  readonly sku_code: string
  readonly article_name: string
  readonly epc: string | null
  readonly quantity: number
  readonly unit_price_minor: number
  readonly total_minor: number
  /// Whether some later return document names this line.
  readonly returned: boolean
}

/// A tax band as it was actually charged — the sum of the per-line stored tax,
/// not a recomputation over the subtotal.
export interface ReceiptTaxBand {
  readonly category: string
  readonly rate_bps: number
  readonly inclusive: boolean
  readonly net_minor: number
  readonly tax_minor: number
}

/// A reprint, rebuilt from the durable rows every time rather than cached as
/// text. Transcribed from `postgres/receipts.rs::build_receipt`. Only a
/// COMPLETED sale has one; the server answers 409 for anything else.
export interface Receipt {
  readonly sale_id: string
  readonly sale_number: string
  readonly site: { readonly id: string; readonly name: string }
  readonly channel: string
  readonly currency: string
  readonly cashier: string
  readonly created_at: string
  readonly completed_at: string | null
  readonly lines: readonly ReceiptLine[]
  readonly totals: {
    readonly net_minor: number
    readonly tax_minor: number
    readonly total_minor: number
    readonly paid_minor: number
    readonly change_minor: number
    readonly refunded_minor: number
  }
  readonly tax_summary: readonly ReceiptTaxBand[]
  /// The server's own sentence about how the tax was arrived at.
  readonly tax_note: string
  readonly payments: readonly {
    readonly method: string
    readonly amount_minor: number
    readonly reference: string | null
  }[]
  readonly returns: readonly {
    readonly return_number: string
    readonly refund_total_minor: number
    readonly reason: string
    readonly created_at: string
  }[]
}

// ---- Returns -----------------------------------------------------------

/// One return on the refund desk's list. From `returns.rs::list_sale_returns`.
export interface ReturnRow {
  readonly id: string
  readonly return_number: string
  readonly sale_id: string
  readonly sale_number: string
  readonly site_id: string
  readonly reason: string
  readonly refund_total_minor: number
  readonly actor_id: string
  readonly created_at: string
}

export interface ReturnLine {
  readonly id: string
  readonly sale_line_id: string
  readonly sku_code: string
  readonly article_name: string
  readonly epc: string | null
  readonly quantity: number
  readonly refund_minor: number
  /// TRUE put the garment back on the store floor as sellable stock; FALSE
  /// sent it to the store's reject pool.
  readonly restock: boolean
}

export interface ReturnDetail extends ReturnRow {
  readonly movement_group_id: string
  readonly lines: readonly ReturnLine[]
  readonly refunds: readonly {
    readonly method: string
    readonly amount_minor: number
    readonly reference: string | null
  }[]
}

// ---- Keys --------------------------------------------------------------

/// `sale` and `sales` are deliberately different first-level names rather than
/// nested, so invalidating the list after a write cannot silently also drop
/// every open record's detail — and dropping both, when a write really does
/// change both, is then something a caller has to say out loud.
export const storeopsKeys = {
  all: ["storeops"] as const,
  /// Every filtered sales list at once — what a write that changes a sale's
  /// status has to drop, because the row moves between the status tabs.
  salesAll: () => ["storeops", "sales"] as const,
  sales: (status?: string, siteId?: string) =>
    ["storeops", "sales", status ?? "any", siteId ?? "all"] as const,
  sale: (id: string) => ["storeops", "sale", id] as const,
  receipt: (id: string) => ["storeops", "sale", id, "receipt"] as const,
  returns: () => ["storeops", "returns"] as const,
  /// The pricing view of one sale. A separate key from `sale`: same record,
  /// different question, and the screens ask them at different moments.
  shopSale: (id: string) => ["storeops", "shop-sales", id] as const,
  saleReturn: (id: string) => ["storeops", "return", id] as const,
  customerHistory: (customerId: string) =>
    ["storeops", "customer", customerId, "transactions"] as const,
  customerTransaction: (customerId: string, saleId: string) =>
    ["storeops", "customer", customerId, "transactions", saleId] as const,
}

// ---- Reads -------------------------------------------------------------

export interface SaleFilter {
  readonly siteId?: string
  /// `OPEN` · `COMPLETED` · `VOIDED`. The server upper-cases whatever arrives.
  readonly status?: string
  /// Clamped to 1..500 by the server; 100 when omitted.
  readonly limit?: number
}

function search(params: Readonly<Record<string, string | number | undefined>>) {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(name, String(value))
  }
  const text = query.toString()
  return text === "" ? "" : `?${text}`
}

export function listSales(filter: SaleFilter, signal?: AbortSignal) {
  return node
    .get<{ items: SaleRow[]; limit: number }>(
      `/api/v1/sales${search({
        site_id: filter.siteId,
        status: filter.status,
        limit: filter.limit,
      })}`,
      { signal }
    )
    .then((body) => body.items)
}

export function saleDetail(id: string, signal?: AbortSignal) {
  return node.get<SaleDetail>(`/api/v1/sales/${id}`, { signal })
}

export function saleReceipt(id: string, signal?: AbortSignal) {
  return node.get<Receipt>(`/api/v1/sales/${id}/receipt`, { signal })
}

/// One value the refund list can be narrowed by, and what those refunds came
/// to. Counted over what the search leaves, ignoring the filters applied.
export interface ReturnFacet {
  readonly value: string
  readonly label: string | null
  readonly count: number
  readonly refund_total_minor: number
}

export interface ReturnFacets {
  readonly sites: readonly ReturnFacet[]
  readonly reasons: readonly ReturnFacet[]
}

/// A page of refunds, and the shape of everything it was drawn from.
///
/// This replaced `{ items, limit }`. Echoing the ceiling back told a caller
/// what it had asked for, which it already knew, and never whether the answer
/// was all of them — `total` and `refund_total_minor` are over the whole
/// matched set, not this page.
export interface ReturnList {
  readonly rows: readonly ReturnRow[]
  readonly next_cursor: string | null
  readonly total: number
  readonly refund_total_minor: number
  readonly facets: ReturnFacets
}

export function listReturns(
  filter: {
    readonly siteId?: string
    readonly q?: string
    readonly reason?: string
    readonly sort?: "at" | "number" | "refund" | "site"
    readonly dir?: "asc" | "desc"
    readonly cursor?: string
    readonly limit?: number
  },
  signal?: AbortSignal
) {
  return node.get<ReturnList>(
    `/api/v1/returns${search({
      site_id: filter.siteId,
      q: filter.q,
      reason: filter.reason,
      sort: filter.sort,
      dir: filter.dir,
      cursor: filter.cursor,
      limit: filter.limit,
    })}`,
    { signal }
  )
}

export function returnDetail(id: string, signal?: AbortSignal) {
  return node.get<ReturnDetail>(`/api/v1/returns/${id}`, { signal })
}

/// A member's purchases, newest first.
///
/// Paged by cursor rather than offset because history grows at the newest end:
/// a sale landing between two requests would shift every offset by one and the
/// reader would see a purchase twice, or not at all. Pass the previous page's
/// `next_before_*` back to get the one behind it.
export function customerTransactions(
  customerId: string,
  cursor: {
    readonly beforeOccurredAt?: string | null
    readonly beforeSaleId?: string | null
    readonly limit?: number
  },
  signal?: AbortSignal
) {
  return node.get<CustomerTransactionPage>(
    `/api/v1/customer/${encodeURIComponent(customerId)}/transactions${search({
      limit: cursor.limit,
      before_occurred_at: cursor.beforeOccurredAt ?? undefined,
      before_sale_id: cursor.beforeSaleId ?? undefined,
    })}`,
    { signal }
  )
}

export function customerTransaction(
  customerId: string,
  saleId: string,
  signal?: AbortSignal
) {
  return node.get<CustomerTransactionDetail>(
    `/api/v1/customer/${encodeURIComponent(customerId)}/transactions/${saleId}`,
    { signal }
  )
}

// ---- Writes ------------------------------------------------------------

/// Every write below is idempotent at the server, and the key is the caller's
/// rather than generated here on the way out.
///
/// That is the whole point of it: the server stores the first answer against
/// the key and replays it, so a double-clicked Complete settles one sale and
/// receives the same receipt twice. A key minted inside these functions would
/// be a new one per click and would settle it twice. The key travels in the
/// body because that is where the server reads it (`CommandRequest`), and in
/// the `Idempotency-Key` header because that is this app's convention for a
/// write that must not be applied twice — the two are the same string.

function idempotent(key: string, signal?: AbortSignal) {
  return { signal, headers: { "Idempotency-Key": key } }
}

/// Open a till. STORE channel and a store site are the only combination the
/// server accepts; it refuses anything else rather than guessing.
export function createSale(
  request: {
    readonly site_id: string
    readonly actor_id: string
    readonly idempotency_key: string
  },
  signal?: AbortSignal
) {
  return node.post<SaleDetail>(
    "/api/v1/sales",
    { ...request, channel: "STORE" },
    idempotent(request.idempotency_key, signal)
  )
}

/// Scan one garment onto an open sale. Quantity is always 1: this path sells
/// tagged units, and the server refuses anything else.
export function addSaleLine(
  saleId: string,
  request: {
    readonly epc: string
    readonly actor_id: string
    readonly idempotency_key: string
  },
  signal?: AbortSignal
) {
  return node.post<{ sale_id: string; line_id: string }>(
    `/api/v1/sales/${saleId}/lines`,
    { ...request, quantity: 1 },
    idempotent(request.idempotency_key, signal)
  )
}

/// Record one tender. A sale is settled by a LIST of these — half on a card
/// and half in cash is an ordinary basket — so this appends rather than sets.
export function addSalePayment(
  saleId: string,
  request: {
    readonly method: PaymentMethod
    readonly amount_minor: number
    readonly reference: string | null
    readonly actor_id: string
    readonly idempotency_key: string
  },
  signal?: AbortSignal
) {
  return node.post<{ sale_id: string; payment_id: string }>(
    `/api/v1/sales/${saleId}/payments`,
    request,
    idempotent(request.idempotency_key, signal)
  )
}

/// Settle the sale: it moves the goods off the store floor in the same
/// transaction, so this is the point of no return.
export function completeSale(
  saleId: string,
  request: {
    readonly actor_id: string
    readonly idempotency_key: string
  },
  signal?: AbortSignal
) {
  return node.post<{ id: string; status: string; change_minor: number }>(
    `/api/v1/sales/${saleId}/complete`,
    request,
    idempotent(request.idempotency_key, signal)
  )
}

/// Abandon an open sale. Only an OPEN sale can be voided — a completed one is
/// immutable and is unwound by a return instead.
export function voidSale(
  saleId: string,
  request: {
    readonly actor_id: string
    readonly idempotency_key: string
  },
  signal?: AbortSignal
) {
  return node.post<{ id: string; status: string }>(
    `/api/v1/sales/${saleId}/void`,
    request,
    idempotent(request.idempotency_key, signal)
  )
}

/// Take goods back against a completed sale.
///
/// Its own document, never an edit of the sale: `restock` on each line decides
/// whether the garment returns to the floor as sellable or goes to the store's
/// reject pool, and the refund tenders are recorded separately from how the
/// sale was originally paid.
export function createSaleReturn(
  saleId: string,
  request: {
    readonly lines: readonly {
      readonly sale_line_id: string
      readonly restock: boolean
    }[]
    readonly refunds: readonly {
      readonly method: PaymentMethod
      readonly amount_minor: number
      readonly reference: string | null
    }[]
    readonly reason: string
    readonly actor_id: string
    readonly idempotency_key: string
  },
  signal?: AbortSignal
) {
  return node.post<ReturnDetail>(
    `/api/v1/sales/${saleId}/returns`,
    request,
    idempotent(request.idempotency_key, signal)
  )
}

/// One sale as the till recorded it, with the pricing behind each line.
///
/// This is a different read from `saleDetail`: that one answers "what was
/// sold", this one answers "why was it that price" — it carries the price
/// source, the publication version each line was rung at, and the promotions
/// that took money off. Built with `json!()` in `cloud/postgres/sales.rs`, so
/// it is transcribed rather than generated.
export interface ShopSaleLine {
  readonly sku_code: string
  readonly article_code: string | null
  /// From the catalogue, not from the sale: a receipt records what was sold and
  /// for how much, and a garment's name is not part of that record. A product
  /// since deleted simply has no name to show.
  readonly article_name: string | null
  readonly quantity: number
  readonly unit_price_minor: number
  readonly line_total_minor: number
  /// Which rung of the cascade set this price.
  readonly price_source: string | null
  /// Which published book the till was on when it rang this line. A shop still
  /// on an older version prices from what it last received, and this is where
  /// that shows.
  readonly publication_version: number | null
}

export interface ShopSale {
  readonly sale_id: string
  readonly site_id: string
  readonly actor_id: string | null
  readonly occurred_at: string
  readonly received_at: string | null
  readonly currency: string
  readonly total_minor: number
  readonly paid_minor: number
  readonly change_minor: number
  readonly discount_total_minor: number
  readonly points_earned: number
  readonly pricing_trace_id: string | null
  readonly customer_id: string | null
  readonly lines: readonly ShopSaleLine[]
  readonly promotions: readonly {
    readonly rule_id: string | null
    readonly name: string | null
    readonly amount_minor: number
  }[]
}

export function shopSaleDetail(id: string, signal?: AbortSignal) {
  return node.get<ShopSale>(`/api/v1/shop-sales/${id}`, { signal })
}

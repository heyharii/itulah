import { node } from "@/lib/api"
import type { CatalogPurchaseOrderRequest } from "@itulah/contract"

/// The purchase-order reads are hand-written, and that is a real difference
/// from everything else in `@itulah/contract`.
///
/// `GET /api/v1/purchase-orders` and `.../{id}` are built with `json!()` in
/// `cloud/postgres/sync.rs` rather than serialised from a struct, so ts-rs has
/// nothing to generate from and these interfaces cannot be checked against the
/// server at build time. They are transcribed from the two `json!` literals —
/// if a field moves, this file is where it goes stale, so it is the first place
/// to look when a column reads `undefined`.

/// One order on the buyer's list, with its outstanding position.
export interface PurchaseOrderRow {
  readonly purchase_order_id: string
  readonly po_number: string
  readonly supplier_id: string
  readonly supplier_name: string | null
  readonly destination_site_id: string
  readonly order_status: string
  readonly currency: string
  readonly issued_at: string | null
  /// Ordered minus cancelled — what the order still expects.
  readonly expected_stock_units: number
  /// Summed from the DC's goods receipts on every read, never stored.
  readonly received_stock_units: number
  readonly outstanding_stock_units: number
  readonly fully_received: boolean
}

export interface PurchaseOrderLine {
  readonly po_line_id: string
  readonly line_number: number
  readonly unit_price_minor: number
  /// What was committed to.
  readonly ordered_value_minor: number
  /// What is owed, derived from receipts. A line that arrived short shows both.
  readonly payable_minor: number
  readonly article_code: string
  readonly article_name: string
  readonly division_code: string | null
  readonly tags: readonly string[]
  readonly ordered_quantity: number
  readonly cancelled_quantity: number
  readonly expected_stock_units: number
  readonly received_quantity: number
  readonly outstanding_stock_units: number
  /// Set when the buyer stopped waiting. The shortfall is still reported:
  /// "settled" and "arrived" are not the same thing.
  readonly closed_short_units: number | null
  readonly closed_short_by: string | null
  readonly closed_short_reason: string | null
  readonly line_status: string
}

export interface PurchaseOrderDetail {
  readonly purchase_order_id: string
  readonly po_number: string
  readonly supplier_id: string
  readonly supplier_name: string | null
  readonly destination_site_id: string
  readonly origin_kind: string
  readonly order_status: string
  readonly currency: string
  readonly created_by: string
  readonly issued_at: string | null
  readonly activation_command_id: string | null
  readonly fully_received: boolean
  readonly payable_minor: number
  readonly lines: readonly PurchaseOrderLine[]
}

/// What the server says after it raises the order: the order exists here, and
/// the activation command is on its way to the node that will receive it.
export interface CatalogPurchaseOrderReceipt {
  readonly purchase_order_id: string
  readonly po_number: string
  readonly supplier_id: string
  readonly supplier_code: string
  readonly destination_site_id: string
  readonly activation_command_id: string
  readonly sent_to_origin: string
}

/// A node that can be shipped to, as the sync register knows it.
export interface Origin {
  readonly origin_id: string
  readonly label: string | null
  readonly site_id: string | null
  readonly node_role: string | null
  readonly active_generation: number
  readonly inventory_enabled: boolean
  readonly created_at: string
  readonly rotated_at: string | null
}

/// A page of the order book, and the shape of everything it was drawn from.
export interface PurchaseOrderPage {
  readonly rows: PurchaseOrderRow[]
  readonly next_cursor: string | null
  /// Every order the scope matches, not just this page.
  readonly total: number
}

export function listPurchaseOrders(signal?: AbortSignal): Promise<PurchaseOrderRow[]> {
  return node
    .get<PurchaseOrderPage>("/api/v1/purchase-orders", { signal })
    .then((body) => body.rows)
}

export function purchaseOrderDetail(
  id: string,
  signal?: AbortSignal,
): Promise<PurchaseOrderDetail> {
  return node.get<PurchaseOrderDetail>(`/api/v1/purchase-orders/${id}`, { signal })
}

/// Raise an order against the supplier's catalogue.
///
/// Prices are not sent: the server snapshots each line from the supplier item
/// it names, so a buyer cannot order at a price the catalogue does not hold.
/// The idempotency key is the caller's, held across retries — a double-clicked
/// Create raises one order and gets the same receipt twice.
export function createCatalogPurchaseOrder(
  request: CatalogPurchaseOrderRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<CatalogPurchaseOrderReceipt> {
  return node.post<CatalogPurchaseOrderReceipt>("/api/v1/purchase-orders/catalog", request, {
    signal,
    headers: { "idempotency-key": idempotencyKey },
  })
}

/// Where an order can be delivered.
///
/// The destinations are the sync origins that actually carry stock — a Cloud
/// row is the centre itself and cannot receive a delivery, and a node with
/// inventory switched off has nowhere to put one.
export function listDestinations(signal?: AbortSignal): Promise<Origin[]> {
  return node
    .get<{ items: Origin[] }>("/api/v1/sync/origins", { signal })
    .then((body) =>
      body.items.filter(
        (origin) =>
          origin.inventory_enabled &&
          origin.site_id !== null &&
          origin.node_role !== "CLOUD",
      ),
    )
}

// ---------------------------------------------------------------------------
// The two things a buyer does to an order after raising it.
//
// Both routes existed on the server long before any screen offered them, which
// is its own kind of bug: a line nobody can close short waits forever, and an
// amendment queue nobody can see is a delivery blocked on an answer that will
// never come.

/// A supplier billed a different price than the order says, and the DC that
/// took the delivery is asking head office what to do about it.
///
/// The ordered price is captured by the server when the request arrives, not
/// sent up by the warehouse — the DC was never told what the order cost, so it
/// could not have quoted it. Both sides are stored so a later reader can see
/// the gap without reconstructing what the order said at the time.
export interface PriceAmendment {
  readonly request_id: string
  readonly po_number: string
  readonly po_line_id: string
  /// Which node took the delivery and raised the question.
  readonly origin_id: string
  readonly count_id: string
  readonly article_code: string
  readonly article_name: string
  readonly ordered_price_minor: number
  readonly invoiced_price_minor: number
  /// Invoiced minus ordered. Negative means the supplier billed LESS than
  /// agreed, which is still a disagreement worth answering.
  readonly difference_minor: number
  readonly note: string
  readonly requested_by: string
  readonly requested_at: string
}

/// `Approved` changes the order's price to the invoice and tells the DC in one
/// step; `Rejected` leaves the order alone and records the disagreement. Spelled
/// exactly as the Rust enum serialises it — no `rename_all`, so the variant
/// names go on the wire as they are written.
export type PriceAmendmentOutcome = "Approved" | "Rejected"

/// A page of the buyer's inbox, and how deep the pile actually is.
export interface PriceAmendmentPage {
  readonly rows: PriceAmendment[]
  readonly next_cursor: string | null
  /// Every question still waiting, not just this page. This is what a badge
  /// wants: counting the array makes a pile deeper than a page advertise
  /// itself as exactly one page deep.
  readonly total: number
}

export function pendingPriceAmendments(signal?: AbortSignal): Promise<PriceAmendment[]> {
  return node
    .get<PriceAmendmentPage>("/api/v1/purchase-price-amendments", { signal })
    .then((body) => body.rows)
}

/// The same read, keeping the count the navigation badge prints.
export function priceAmendmentPage(signal?: AbortSignal): Promise<PriceAmendmentPage> {
  return node.get<PriceAmendmentPage>("/api/v1/purchase-price-amendments", { signal })
}

export function decidePriceAmendment(
  requestId: string,
  outcome: PriceAmendmentOutcome,
  decidedBy: string,
  note: string | null,
): Promise<unknown> {
  return node.post(`/api/v1/purchase-price-amendments/${requestId}/decide`, {
    outcome,
    decided_by: decidedBy,
    note,
  })
}

/// Stop waiting for the rest of a line.
///
/// 100 of 300 arrived and the buyer decides the other 200 are not coming. The
/// shortfall stays on the record — "settled" and "arrived" are not the same
/// thing — but the line stops counting as outstanding, so the order can be
/// finished. The server refuses a second attempt on a line already closed.
export function closePurchaseLineShort(
  poLineId: string,
  closedBy: string,
  reason: string,
): Promise<unknown> {
  return node.post(`/api/v1/purchase-order-lines/${poLineId}/close-short`, {
    closed_by: closedBy,
    reason,
  })
}

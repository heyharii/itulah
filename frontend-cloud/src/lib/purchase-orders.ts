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

export function listPurchaseOrders(signal?: AbortSignal): Promise<PurchaseOrderRow[]> {
  return node
    .get<{ items: PurchaseOrderRow[] }>("/api/v1/purchase-orders", { signal })
    .then((body) => body.items)
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

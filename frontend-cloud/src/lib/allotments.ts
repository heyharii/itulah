import { node } from "@/lib/api"
import type { Pool } from "@/lib/pools"

/// The Allotment reads and writes are hand-written, like the purchase-order
/// ones and for the same reason.
///
/// Every route under `/api/v1/inventory/allotments` answers with a `json!()`
/// literal built in `backend/src/cloud/postgres/allotments.rs` rather than a
/// serialised struct, so ts-rs generates nothing for them and `@itulah/contract`
/// cannot check these shapes at build time. They are transcribed from those
/// literals — if a field moves, this file is where it goes stale, so it is the
/// first place to look when a column reads `undefined`.

/// What the Allotment is for. The three are not variations on a theme: each
/// has its own legal source pool and its own legal destination, checked by
/// `validate_create_line` on the server.
export type AllotmentType = "TO_STORE" | "RETURN_TO_DC" | "RETURN_TO_SUPPLIER"

export type DestinationType = "STORE" | "DC" | "SUPPLIER"

/// `ACTIVE` — allotted, nothing picked. `IN_PROGRESS` — something picked.
/// `DC_COMPLETED` — the DC is done with it but the Store has not signed for it.
/// `COMPLETED` — received. `CANCELLED` — released without a pick.
/// `REJECTED` — the DC refused the activation.
export type AllotmentStatus =
  | "ACTIVE"
  | "IN_PROGRESS"
  | "DC_COMPLETED"
  | "COMPLETED"
  | "CANCELLED"
  | "REJECTED"

/// How a command sent to an edge node is getting on. `PENDING` means nobody at
/// the warehouse has answered yet, and that is the state in which an Allotment
/// exists here but nowhere else.
export type EdgeApplicationStatus = "PENDING" | "ACCEPTED" | "REJECTED"

/// What the DC did with a cancellation request. `PARTIALLY_APPLIED` is the
/// honest case worth showing: some of it was already picked and could not be
/// taken back.
export type EdgeCancellationStatus =
  | "PENDING"
  | "APPLIED"
  | "PARTIALLY_APPLIED"
  | "REJECTED"

/// One Allotment on the list, summed across its lines.
///
/// `accepted` rather than `quantity` is the number everything else is measured
/// against: an Allotment owned by a DC counts as nothing until that DC accepts
/// it, so an allotment of 300 that the warehouse has not answered has 300
/// ordered and 0 accepted, and 0 is what can be picked.
export interface AllotmentRow {
  readonly id: string
  readonly allotment_number: string
  readonly type: AllotmentType
  readonly status: AllotmentStatus
  readonly edge_cancellation_status: EdgeCancellationStatus | null
  readonly total_quantity: number
  readonly total_accepted_quantity: number
  readonly total_picked_quantity: number
  readonly total_packed_quantity: number
  readonly total_shipment_quantity: number
  readonly total_dispatched_quantity: number
  readonly total_in_transit_quantity: number
  readonly total_received_quantity: number
  readonly total_cancelled_quantity: number
  /// Accepted minus picked minus cancelled: what is still reserved and has not
  /// moved. This is the number that holds stock out of everybody else's reach.
  readonly remaining_quantity: number
  readonly created_by: string
  readonly notes: string | null
  readonly created_at: string
  readonly updated_at: string
}

/// Every destination, across every Allotment — not only the ones on the list.
///
/// The server computes this over the whole table rather than over the filtered
/// rows, so it answers "what is owed to this store" rather than "what is owed
/// on the screen". Worth knowing before reading it as a total of the table.
export interface DestinationRollup {
  readonly destination_type: DestinationType
  readonly destination_id: string
  readonly destination_name: string | null
  readonly total_quantity: number
  readonly total_accepted_quantity: number
  readonly total_picked_quantity: number
  readonly total_packed_quantity: number
  readonly total_shipment_quantity: number
  readonly total_dispatched_quantity: number
  readonly total_in_transit_quantity: number
  readonly total_received_quantity: number
  readonly total_cancelled_quantity: number
  readonly remaining_quantity: number
}

/// An SKU promised out of a pool that does not hold it.
///
/// On Hand is Stock minus Allotted, so a negative On Hand means the Allotments
/// standing against this pool add up to more than the goods in it. The server
/// reports it rather than preventing it: allotting is a promise, and the
/// warehouse is allowed to find out it cannot keep one.
export interface AllotmentShortage {
  readonly sku_id: string
  readonly sku_code: string
  readonly article_code: string
  readonly article_name: string
  readonly stock_qty: number
  readonly allotted_qty: number
  readonly on_hand_qty: number
  readonly missing_qty: number
  readonly shortage_qty: number
}

export interface AllotmentList {
  readonly items: readonly AllotmentRow[]
  readonly limit: number
  readonly by_destination: readonly DestinationRollup[]
  readonly shortages: readonly AllotmentShortage[]
}

/// The list, scoped to one Store, with the same body plus a per-SKU summary.
export interface StoreAllotmentList extends AllotmentList {
  readonly destination_type: "STORE"
  readonly destination_id: string
  readonly destination_name: string
  readonly sku_summary: readonly StoreSkuSummary[]
}

export interface StoreSkuSummary {
  readonly sku_id: string
  readonly sku_code: string
  readonly quantity: number
  readonly accepted_quantity: number
  readonly picked_quantity: number
  readonly packed_quantity: number
  readonly shipment_quantity: number
  readonly dispatched_quantity: number
  readonly in_transit_quantity: number
  readonly received_quantity: number
  readonly cancelled_quantity: number
  readonly remaining_quantity: number
}

/// One EPC that arrived at the Store and was matched back to this line.
///
/// Individual tags rather than a count, because the count is a projection and
/// this is the evidence under it. The detail reports both and says whether they
/// agree.
export interface ReceivedTag {
  readonly epc: string
  readonly sku_code: string
  readonly koli_id: string
  readonly source_dc_id: string | null
  readonly destination_store_id: string
  readonly shipment_reference: string | null
  readonly receipt_id: string | null
  readonly receipt_event_id: string
  readonly in_transit_event_id: string
  readonly receipt_movement_group_id: string
  readonly in_transit_movement_group_id: string
  readonly received_at: string
  readonly matched_at: string
}

export interface AllotmentLine {
  readonly id: string
  readonly source_site_id: string
  readonly source_pool_id: string
  readonly destination_type: DestinationType
  readonly destination_id: string
  readonly sku_id: string
  readonly sku_code: string
  readonly article_code: string
  readonly article_name: string
  readonly quantity: number
  readonly accepted_quantity: number
  readonly picked_quantity: number
  readonly packed_quantity: number
  readonly shipment_quantity: number
  readonly dispatched_quantity: number
  readonly in_transit_quantity: number
  readonly received_quantity: number
  readonly cancelled_quantity: number
  readonly remaining_allotted: number
  readonly cancellation_requested_quantity: number | null
  readonly cancellation_actual_cancelled_quantity: number | null
  /// What the DC could not cancel because it had already been picked.
  readonly cancellation_blocked_picked_quantity: number | null
  readonly received_breakdown_quantity: number
  /// False when the received count and the matched tags disagree. Shown rather
  /// than reconciled here: the two numbers coming apart is the finding.
  readonly received_projection_consistent: boolean
  readonly received_breakdown: readonly ReceivedTag[]
}

export interface AllotmentEvent {
  readonly id: string
  readonly sequence: number
  readonly event_type: string
  readonly sku_id: string | null
  readonly source_site_id: string | null
  readonly source_pool_id: string | null
  readonly destination_type: DestinationType | null
  readonly destination_id: string | null
  readonly quantity: number
  /// How this event changed what is still reserved. Negative releases it.
  readonly remaining_delta: number
  readonly movement_group_id: string | null
  readonly reference_type: string | null
  readonly reference_id: string | null
  readonly actor_id: string
  readonly details: Record<string, unknown>
  readonly occurred_at: string
  readonly recorded_at: string
}

export interface AllotmentMovement {
  readonly movement_id: string
  readonly movement_group_id: string
  readonly subject_id: string
  readonly quantity: number
  readonly from: string
  readonly to: string
  readonly cause: string
  readonly reference_type: string | null
  readonly reference_id: string | null
  readonly allotment_line_id: string | null
  readonly allotment_id: string
  readonly destination_type: DestinationType | null
  readonly destination_id: string | null
  readonly actor_id: string
  readonly occurred_at: string
  readonly recorded_at: string
}

export interface AllotmentCancellation {
  readonly cancellation_id: string
  readonly command_id: string | null
  readonly status: EdgeCancellationStatus | null
  readonly result_id: string | null
  readonly requested_by: string
  readonly reason: string
  readonly requested_at: string
  readonly received_at: string | null
  readonly outcome: "APPLIED" | "PARTIALLY_APPLIED" | "REJECTED" | null
  readonly result_reason: string | null
  readonly applied_at: string | null
  readonly requested_quantity: number
  readonly cancelled_quantity: number | null
  readonly blocked_picked_quantity: number | null
  readonly lines: readonly {
    readonly allotment_line_id: string
    readonly requested_quantity: number
    readonly cancelled_quantity: number | null
    readonly blocked_picked_quantity: number | null
  }[]
}

export interface AllotmentDetail {
  readonly id: string
  readonly allotment_number: string
  readonly type: AllotmentType
  readonly status: AllotmentStatus
  readonly created_by: string
  readonly notes: string | null
  readonly created_at: string
  readonly updated_at: string
  readonly cancelled_at: string | null
  readonly activation_command_id: string | null
  /// Set when a DC owns this Allotment: the command went out to that node and
  /// the picking happens there, not here. Null means the centre itself is the
  /// one that moves the stock.
  readonly activation_target_origin_id: string | null
  readonly edge_application_status: EdgeApplicationStatus | null
  readonly edge_application_result_id: string | null
  readonly edge_application_received_at: string | null
  readonly cancellation_id: string | null
  readonly cancellation_command_id: string | null
  readonly edge_cancellation_status: EdgeCancellationStatus | null
  readonly edge_cancellation_result_id: string | null
  readonly edge_cancellation_received_at: string | null
  readonly cancellation: AllotmentCancellation | null
  readonly total_quantity: number
  readonly total_accepted_quantity: number
  readonly total_picked_quantity: number
  readonly total_packed_quantity: number
  readonly total_shipment_quantity: number
  readonly total_dispatched_quantity: number
  readonly total_in_transit_quantity: number
  readonly total_received_quantity: number
  readonly total_received_breakdown_quantity: number
  readonly received_projection_consistent: boolean
  readonly total_cancelled_quantity: number
  readonly remaining_allotted: number
  readonly remaining_quantity: number
  readonly lines: readonly AllotmentLine[]
  readonly events: readonly AllotmentEvent[]
  readonly movements: readonly AllotmentMovement[]
}

/// What one pool can still promise, per SKU.
///
/// `on_hand_qty` is Stock minus Allotted — the goods nobody has spoken for. It
/// is the number a new Allotment eats into, and it can be negative, which is
/// the shortage above.
export interface AvailabilityItem {
  readonly sku_id: string
  readonly sku_code: string
  readonly article_id: string
  readonly article_code: string
  readonly article_name: string
  /// What the article IS, carried here rather than fetched per row: the
  /// allotment screen groups by article and shows it the way the catalogue
  /// does — a photograph, a division and its tags.
  readonly division_code: string | null
  readonly image_url: string | null
  readonly tags: readonly string[]
  /// Every order this article has arrived on, so the grid can be narrowed to
  /// one delivery. Several, not one: an article ordered again is the same
  /// article, and the second order brought in real stock too.
  readonly purchase_order_ids: readonly string[]
  readonly colour: string | null
  readonly size: string | null
  readonly stock_qty: number
  readonly allotted_qty: number
  readonly on_hand_qty: number
  readonly missing_qty: number
}

export interface Availability {
  readonly source_site_id: string
  readonly source_pool_id: string
  readonly source_pool_label: string
  readonly source_place_id: string
  readonly as_of: string
  readonly stock_qty: number
  readonly allotted_qty: number
  readonly on_hand_qty: number
  readonly missing_qty: number
  readonly inventory_equation: string
  readonly limit: number
  readonly next_cursor: string | null
  readonly items: readonly AvailabilityItem[]
}

export interface AllotmentQuery {
  readonly type?: AllotmentType
  readonly status?: AllotmentStatus
  readonly source_pool_id?: string
  readonly destination_id?: string
  readonly limit?: number
}

export interface CreateAllotmentLine {
  readonly source_site_id: string
  readonly source_pool_id: string
  readonly destination_type: DestinationType
  readonly destination_id: string
  readonly sku_id: string
  readonly quantity: number
}

/// The three writes all carry their own idempotency key in the body rather than
/// in a header — unlike the purchase-order routes, which take the header. The
/// server stores the key with a digest of the request and replays its first
/// answer, so a retried create cannot allot the same goods twice.
export interface CreateAllotmentRequest {
  readonly type: AllotmentType
  readonly lines: readonly CreateAllotmentLine[]
  readonly notes: string | null
  readonly actor_id: string
  readonly idempotency_key: string
}

export interface CancelAllotmentRequest {
  readonly reason: string
  readonly actor_id: string
  readonly idempotency_key: string
}

function search(query: AllotmentQuery): string {
  const parameters = new URLSearchParams()
  if (query.type !== undefined) parameters.set("type", query.type)
  if (query.status !== undefined) parameters.set("status", query.status)
  if (query.source_pool_id !== undefined) parameters.set("source_pool_id", query.source_pool_id)
  if (query.destination_id !== undefined) parameters.set("destination_id", query.destination_id)
  if (query.limit !== undefined) parameters.set("limit", String(query.limit))
  const text = parameters.toString()
  return text === "" ? "" : `?${text}`
}

/// The cache key for the list, in one place.
///
/// The nav badge and the list screen ask for the same unfiltered page, and they
/// must ask for it under the same key or the browser fetches it twice — this
/// read carries an availability projection with it and is not cheap.
export const allotmentListKey = (destination = "") =>
  ["allotments", { destination }] as const

export function listAllotments(
  query: AllotmentQuery = {},
  signal?: AbortSignal,
): Promise<AllotmentList> {
  return node.get<AllotmentList>(`/api/v1/inventory/allotments${search(query)}`, { signal })
}

export function allotmentDetail(id: string, signal?: AbortSignal): Promise<AllotmentDetail> {
  return node.get<AllotmentDetail>(`/api/v1/inventory/allotments/${id}`, { signal })
}

export function storeAllotments(
  storeId: string,
  signal?: AbortSignal,
): Promise<StoreAllotmentList> {
  return node.get<StoreAllotmentList>(
    `/api/v1/inventory/allotments/by-store/${storeId}`,
    { signal },
  )
}

export function availability(
  sourcePoolId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<Availability> {
  const parameters = new URLSearchParams({ source_pool_id: sourcePoolId, limit: "100" })
  if (cursor !== undefined) parameters.set("cursor", cursor)
  return node.get<Availability>(
    `/api/v1/inventory/availability?${parameters.toString()}`,
    { signal },
  )
}

/// Raise the Allotment. The answer is the created header, and — when a DC owns
/// it — the id of the command now on its way to that node.
export function createAllotment(request: CreateAllotmentRequest): Promise<AllotmentDetail> {
  return node.post<AllotmentDetail>("/api/v1/inventory/allotments", request)
}

/// Release what is still reserved.
///
/// Whole-allotment, not per line: the server cancels every line's remaining
/// quantity. On a DC-owned Allotment it does not cancel anything itself — it
/// asks, the answer comes back `PENDING`, and what was already picked is
/// reported afterwards as blocked.
export function cancelAllotment(
  id: string,
  request: CancelAllotmentRequest,
): Promise<Record<string, unknown>> {
  return node.post(`/api/v1/inventory/allotments/${id}/cancel`, request)
}

// `POST /api/v1/inventory/allotments/{id}/execute` is deliberately not wrapped
// here. Picking is the warehouse's act, done on the DC surface against the
// activation command this Allotment sends there; the centre raising a movement
// nobody made would be inventing stock history. The route only accepts an
// Allotment no DC owns at all, which is a topology to fix rather than a button
// to press.

// ---------------------------------------------------------------------------
// What the server will accept, said here so a person is not offered a choice it
// is certain to refuse.
//
// Transcribed from `validate_create_line` in
// `backend/src/cloud/postgres/allotments.rs` and `is_dc_fulfillment_source_for`
// in `backend/src/edge/domain/inventory/place.rs`. The server remains the one
// that decides — when these disagree, its refusal is what the screen shows.

/// The Gudang pools goods may be fulfilled out of. Not the outbound leaves
/// (`PICKED`, `PACKED`, `SHIPMENT`, `LOADED`, `IN_TRANSIT`): goods already
/// picked for a store are spoken for and cannot be promised to another.
const DC_FULFILLMENT_POOL_CODES = new Set([
  "UNIDENTIFIED",
  "UNTAGGED",
  "WAREHOUSE",
  "PICKING",
  "DC_REJECT",
  "STORE_REJECT",
])

/// A Store's own three pools, which are what it can send back to the Gudang.
const STORE_RETURN_POOL_CODES = new Set(["WAREHOUSE", "FLOOR", "REJECT"])

/// The single pool a supplier return may leave from, named literally in the
/// server's check.
const SUPPLIER_RETURN_POOL_ID = "dc.reject.dc"

export function sourcePoolsFor(type: AllotmentType, pools: readonly Pool[]): Pool[] {
  const placements = pools.filter((pool) => !pool.is_rollup)
  switch (type) {
    case "TO_STORE":
      // `HO`, not `DC`: since 0353 the warehouse's site is kind head office,
      // and the server refuses a TO_STORE line sourced anywhere else.
      return placements.filter(
        (pool) => pool.site_kind === "HO" && DC_FULFILLMENT_POOL_CODES.has(pool.pool_code),
      )
    case "RETURN_TO_DC":
      return placements.filter(
        (pool) => pool.site_kind === "STORE" && STORE_RETURN_POOL_CODES.has(pool.pool_code),
      )
    case "RETURN_TO_SUPPLIER":
      return placements.filter((pool) => pool.id === SUPPLIER_RETURN_POOL_ID)
  }
}

/// Where an Allotment of this kind may go.
///
/// Two of the three have exactly one answer and no choice to offer: everything
/// returned goes to the Gudang, and everything sent back to a supplier goes to
/// the one external place the ledger has for suppliers.
///
/// TODO(0603): head office is the site of kind `HO`, never an id, so the
/// `destination_id` below must be read (the fleet pools carry `site_kind`, and
/// the server resolves the destination type from the site's own row) rather
/// than named `dc`. Left literal only because this function is handed no rows
/// to read it from.
export function fixedDestinationFor(
  type: AllotmentType,
): { destination_type: DestinationType; destination_id: string } | null {
  switch (type) {
    case "TO_STORE":
      return null
    case "RETURN_TO_DC":
      return { destination_type: "DC", destination_id: "dc" }
    case "RETURN_TO_SUPPLIER":
      return { destination_type: "SUPPLIER", destination_id: "external/supplier" }
  }
}

export const ALLOTMENT_TYPES: readonly AllotmentType[] = [
  "TO_STORE",
  "RETURN_TO_DC",
  "RETURN_TO_SUPPLIER",
]

export const ALLOTMENT_STATUSES: readonly AllotmentStatus[] = [
  "ACTIVE",
  "IN_PROGRESS",
  "DC_COMPLETED",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
]

/// A word a person can read, for a wire value written for a machine.
///
/// `DC` is the wire's word for the Gudang — the head office warehouse — so a
/// person reads "Gudang", which is what CONTEXT.md calls the place.
export function humanise(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => (word === "dc" ? "Gudang" : word))
    .join(" ")
    .replace(/^./, (first) => first.toUpperCase())
}

/// The road from allotted to arrived, in the order goods actually travel it.
///
/// Each stage counts pieces that have reached at least that far, so the numbers
/// only ever fall from left to right — and where they fall is where the goods
/// currently are.
export const STAGES = [
  { key: "accepted", label: "Accepted" },
  { key: "picked", label: "Picked" },
  { key: "packed", label: "Packed" },
  { key: "shipment", label: "Shipment" },
  { key: "dispatched", label: "Dispatched" },
  { key: "in_transit", label: "In transit" },
  { key: "received", label: "Received" },
] as const

export type StageKey = (typeof STAGES)[number]["key"]

export function rowStage(row: AllotmentRow, stage: StageKey): number {
  switch (stage) {
    case "accepted":
      return row.total_accepted_quantity
    case "picked":
      return row.total_picked_quantity
    case "packed":
      return row.total_packed_quantity
    case "shipment":
      return row.total_shipment_quantity
    case "dispatched":
      return row.total_dispatched_quantity
    case "in_transit":
      return row.total_in_transit_quantity
    case "received":
      return row.total_received_quantity
  }
}

export function detailStage(detail: AllotmentDetail, stage: StageKey): number {
  switch (stage) {
    case "accepted":
      return detail.total_accepted_quantity
    case "picked":
      return detail.total_picked_quantity
    case "packed":
      return detail.total_packed_quantity
    case "shipment":
      return detail.total_shipment_quantity
    case "dispatched":
      return detail.total_dispatched_quantity
    case "in_transit":
      return detail.total_in_transit_quantity
    case "received":
      return detail.total_received_quantity
  }
}

export function lineStage(line: AllotmentLine, stage: StageKey): number {
  switch (stage) {
    case "accepted":
      return line.accepted_quantity
    case "picked":
      return line.picked_quantity
    case "packed":
      return line.packed_quantity
    case "shipment":
      return line.shipment_quantity
    case "dispatched":
      return line.dispatched_quantity
    case "in_transit":
      return line.in_transit_quantity
    case "received":
      return line.received_quantity
  }
}

/// Split a per-article promise across that article's SKUs.
///
/// The allotment screen is read and filled in by article — a photograph, a
/// division, a row of stores — but an allotment line names a SKU, because a
/// SKU is what the warehouse picks and what the ledger moves. Something has to
/// decide which sizes make up "forty of this shirt to Store 03", and doing it
/// here rather than on the server keeps that decision visible: the numbers it
/// produces are shown on the expanded rows and can be overridden one by one.
///
/// Weight is what each SKU actually has on hand, so the split follows the
/// stock rather than dividing evenly into sizes the warehouse cannot supply.
/// When nothing is on hand the split is even — the promise still stands, and
/// the pool reads short, which is the honest outcome rather than a refusal.
export function spread(total: number, weights: readonly number[]): number[] {
  const count = weights.length
  if (count === 0 || total <= 0) {
    return new Array<number>(count).fill(0)
  }
  const positive = weights.map((weight) => (weight > 0 ? weight : 0))
  const sum = positive.reduce((running, weight) => running + weight, 0)
  const shares =
    sum > 0
      ? positive.map((weight) => (weight / sum) * total)
      : positive.map(() => total / count)
  const given = shares.map(Math.floor)
  // Largest remainder: the pieces integer division dropped go to the SKUs that
  // came closest to earning them, so the parts always add back up to the whole.
  let left = total - given.reduce((running, piece) => running + piece, 0)
  const order = shares
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((first, second) => second.remainder - first.remainder)
  for (const { index } of order) {
    if (left <= 0) break
    given[index] += 1
    left -= 1
  }
  return given
}

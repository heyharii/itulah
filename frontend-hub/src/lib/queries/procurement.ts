import { ApiError } from "@itulah/contract/client"
import type {
  AddToBasketRequest,
  BasketLine,
  CatalogPurchaseOrderRequest,
  CatalogueVocabulary,
  CreateSupplierItemRequest,
  CreateSupplierRequest,
  PurchaseDestination,
  SourcingPage,
  Supplier,
  SupplierItem,
  SupplierStatus,
  UpdateSupplierRequest,
} from "@itulah/contract"

import { node } from "@/lib/api"

/// Purchasing reads and writes, and the keys they are held under.
///
/// Most of this file is typed from `@itulah/contract`, which is generated from
/// the Rust structs the server actually serialises. The exceptions are marked
/// where they appear: a handful of purchasing routes answer with `json!()`
/// literals rather than a struct, so ts-rs has nothing to generate from and
/// those interfaces cannot be checked against the server at build time. They
/// are transcribed from the literal — if a field moves, this file is where it
/// goes stale, and it is the first place to look when a column reads
/// `undefined`.

// ---------------------------------------------------------------------------
// Purchase orders — hand-written, from the `json!()` literals in
// `cloud/postgres/sync.rs`.

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

/// What the server says after it raises an order from the catalogue: the order
/// exists here, and the activation command is on its way to the node that will
/// receive it. The three money figures are returned so the screen that raised
/// the order can show what the supplier will invoice without recomputing it
/// and risking a different answer.
export interface CatalogPurchaseOrderReceipt {
  readonly purchase_order_id: string
  readonly po_number: string
  readonly supplier_id: string
  readonly supplier_code: string
  readonly destination_site_id: string
  readonly activation_command_id: string
  readonly sent_to_origin: string
  readonly gross_minor: number
  readonly discount_minor: number
  readonly net_minor: number
}

/// An order raised line by line rather than from the catalogue. `origin_kind`
/// is `SOURCING` or `DIRECT` and the server refuses anything else.
export interface DirectPurchaseLine {
  readonly article_code: string
  readonly article_name: string
  readonly ordered_quantity: number
  readonly unit_price_minor: number
  readonly image_url?: string | null
  readonly division_code?: string | null
  readonly tags?: readonly string[]
  readonly promised_date?: string | null
}

export interface DirectPurchaseOrder {
  readonly po_number: string
  readonly supplier_id: string
  readonly supplier_name?: string | null
  readonly destination_site_id: string
  readonly origin_kind: "SOURCING" | "DIRECT"
  readonly currency: string
  readonly notes?: string | null
  readonly created_by: string
  readonly lines: readonly DirectPurchaseLine[]
}

export interface DirectPurchaseOrderReceipt {
  readonly purchase_order_id: string
  readonly po_number: string
  readonly destination_site_id: string
  readonly activation_command_id: string
  readonly sent_to_origin: string
}

// ---------------------------------------------------------------------------
// Price amendments — hand-written, from `pending_price_amendments`.

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

/// Spelled exactly as the Rust enum serialises it — no `rename_all`, so the
/// variant names go on the wire as they are written.
export type PriceAmendmentOutcome = "Approved" | "Rejected"

// ---------------------------------------------------------------------------
// Article setups — hand-written, from `cloud/postgres/tagging.rs`.

/// A delivery counted and accepted but not yet given an identity. What it
/// carries is the SUPPLIER's code and the buyer's own wording: presets for the
/// setup form, never decisions.
export interface UnidentifiedReceipt {
  readonly receipt_line_id: string
  readonly receipt_number: string
  readonly supplier_id: string
  readonly invoice_number: string | null
  readonly quantity: number
  readonly verified_at: string
  readonly supplier_article_code: string
  readonly article_name: string
  readonly division_code: string | null
  readonly tags: readonly string[]
  readonly image_url: string | null
  readonly site_id: string
  readonly po_number: string
}

export interface SetupSessionRow {
  readonly session_id: string
  readonly receipt_line_id: string
  readonly article_code: string
  readonly article_name: string
  readonly division_code: string
  readonly receipt_quantity: number
  /// What the variants add up to. Short of `receipt_quantity` means somebody
  /// has not finished splitting the delivery, which is the decision metric.
  readonly declared_quantity: number
  readonly destination_site_id: string
  readonly status: string
  readonly created_by: string
  readonly created_at: string
}

/// One variant of an article: a colourway in a size, with the serial range its
/// tags are drawn from.
export interface SetupVariant {
  readonly sku_code: string
  readonly colour_digit: string
  readonly colour_label: string
  readonly size_code: string
  readonly size_label: string
  readonly quantity: number
  readonly serial_from: number
  readonly serial_to: number
  readonly qr_payload: string
  readonly base_price_minor: number
}

export interface SetupSession {
  readonly session_id: string
  readonly receipt_line_id: string
  readonly article_code: string
  readonly supplier_article_code: string | null
  readonly article_name: string
  readonly division_code: string
  readonly tags: readonly string[]
  readonly currency: string
  readonly receipt_quantity: number
  readonly site_id: string
  readonly status: string
  readonly created_by: string
  readonly created_at: string
  readonly issued_at: string | null
  readonly tagged_at: string | null
  readonly job: {
    readonly job_id: string
    readonly status: string | null
    readonly confirmed_by: string | null
    readonly confirmed_at: string | null
  } | null
  readonly variants: readonly SetupVariant[]
  /// Only on the answer to an issue: the job the mint produced and the command
  /// carrying it to the warehouse that will tag the goods.
  readonly tagging_job_id?: string
  readonly tagging_command_id?: string
}

// ---------------------------------------------------------------------------
// Catalogue imagery — hand-written, from `cloud/media.rs`.

/// Where an image is, and for how long that answer is good for.
export interface ImageLocation {
  readonly key: string
  readonly url: string
  /// `null` when the bucket has a public URL; seconds otherwise.
  readonly expires_in_seconds: number | null
}

export interface ImageUploadTicket {
  readonly upload: ImageLocation
  readonly method: string
  readonly content_type: string
}

// ---------------------------------------------------------------------------
// Supplier items — the update request is the one supplier shape ts-rs does not
// export, because `NullablePatch` has no generated form. Absent leaves a field
// alone, `null` clears it, a value sets it.

export interface UpdateSupplierItemRequest {
  readonly supplier_item_code?: string | null
  readonly name?: string | null
  readonly description?: string | null
  readonly image_url?: string | null
  readonly unit_price_minor?: number | null
  readonly currency?: string | null
  readonly internal_article_code?: string | null
  readonly division_code?: string | null
  /// Absent leaves tags alone; present REPLACES them, so an empty list means
  /// "remove every tag".
  readonly tags?: readonly string[] | null
}

/// One page of a supplier's own catalogue.
export interface SupplierItemPage {
  readonly items: readonly SupplierItem[]
  readonly limit: number
  readonly next_cursor: string | null
}

/// What a sourcing screen asks for. Every facet is a set: a buyer looking at
/// kids and footwear is looking at both, not at the intersection of the two,
/// which is empty.
export interface SourcingScope {
  readonly q?: string
  readonly status?: SupplierStatus
  readonly supplierIds?: readonly string[]
  readonly divisionCodes?: readonly string[]
  readonly tagCodes?: readonly string[]
  readonly priceMin?: number
  readonly priceMax?: number
  readonly limit?: number
  /// From a previous page's `next_cursor`.
  readonly cursor?: string
}

// ---------------------------------------------------------------------------

/// Keys live beside the function that fetches them. The first segment is the
/// domain namespace, so signing out can drop a whole module's answers by
/// prefix without naming every key.
///
/// The nesting is deliberate rather than decorative: `supplier(id)` is a
/// prefix of `supplierCatalogue(id)`, so activating a supplier — which changes
/// both the record and what its items are offered as — invalidates the two
/// with one call and does not have to remember the second.
export const procurementKeys = {
  all: ["procurement"] as const,
  orders: () => ["procurement", "purchase-orders"] as const,
  order: (id: string) => ["procurement", "purchase-orders", id] as const,
  destinations: () => ["procurement", "purchase-destinations"] as const,
  suppliers: () => ["procurement", "suppliers"] as const,
  supplier: (id: string) => ["procurement", "suppliers", id] as const,
  /// A supplier's own catalogue, under the supplier it belongs to.
  supplierCatalogue: (id: string) =>
    ["procurement", "suppliers", id, "items"] as const,
  supplierItems: () => ["procurement", "supplier-items"] as const,
  supplierItem: (id: string) => ["procurement", "supplier-items", id] as const,
  /// The sourcing search. The scope is part of the key because a different
  /// question has a different answer.
  sourcing: (scope: SourcingScope) =>
    ["procurement", "supplier-items", "sourcing", scope] as const,
  amendments: () => ["procurement", "price-amendments"] as const,
  vocabulary: () => ["procurement", "catalogue", "vocabulary"] as const,
  basket: () => ["procurement", "sourcing-basket"] as const,
  setups: () => ["procurement", "article-setups"] as const,
  unidentified: () =>
    ["procurement", "article-setups", "unidentified"] as const,
  setup: (id: string) => ["procurement", "article-setups", id] as const,
  itemImage: (supplierCode: string, itemCode: string) =>
    ["procurement", "catalogue", "item-image", supplierCode, itemCode] as const,
  articleImage: (articleCode: string, colour: string) =>
    ["procurement", "catalogue", "article-image", articleCode, colour] as const,
}

/// The headers a supplier write carries.
///
/// `Idempotency-Key` is the caller's and is held across retries: the server
/// stores it with a digest of the request and replays its first answer, so a
/// double-clicked Save writes once. `If-Match` is the record's `version` as a
/// strong quoted ETag — the server refuses a write against a version somebody
/// else has already moved past, which is how two buyers editing one supplier
/// stop being a silent last-write-wins.
function guarded(
  idempotencyKey: string,
  version?: number
): Record<string, string> {
  const headers: Record<string, string> = {
    "Idempotency-Key": idempotencyKey,
  }
  if (version !== undefined) headers["If-Match"] = `"${version}"`
  return headers
}

// ---------------------------------------------------------------------------
// Purchase orders

export function listPurchaseOrders(signal?: AbortSignal) {
  return node
    .get<{ items: PurchaseOrderRow[] }>("/api/v1/purchase-orders", { signal })
    .then((body) => body.items)
}

export function purchaseOrderDetail(id: string, signal?: AbortSignal) {
  return node.get<PurchaseOrderDetail>(`/api/v1/purchase-orders/${id}`, {
    signal,
  })
}

/// Where a delivery can go.
///
/// Deliberately not `/api/v1/sync/origins`, which is Admin-only: knowing which
/// nodes exist is administration, and a Supervisor raising an order was
/// getting a 403 on a list of site names. This route answers the purchasing
/// question directly and carries a bare array, not an envelope.
export function purchaseDestinations(signal?: AbortSignal) {
  return node.get<PurchaseDestination[]>("/api/v1/purchase-destinations", {
    signal,
  })
}

/// Raise an order against the supplier's catalogue.
///
/// Prices are not sent: the server snapshots each line from the supplier item
/// it names, so a buyer cannot order at a price the catalogue does not hold.
/// The idempotency key is the caller's and is held across retries — a
/// double-clicked Create raises one order and gets the same receipt twice.
export function createCatalogPurchaseOrder(
  request: CatalogPurchaseOrderRequest,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<CatalogPurchaseOrderReceipt>(
    "/api/v1/purchase-orders/catalog",
    request,
    { signal, headers: { "Idempotency-Key": idempotencyKey } }
  )
}

/// Raise an order line by line, for goods no supplier catalogue carries.
///
/// The server takes no idempotency key here — it is the older route, and the
/// PO number is the thing that has to be unique. A repeated number is refused
/// rather than silently making a second order.
export function raiseDirectPurchaseOrder(
  request: DirectPurchaseOrder,
  signal?: AbortSignal
) {
  return node.post<DirectPurchaseOrderReceipt>(
    "/api/v1/purchase-orders",
    request,
    { signal }
  )
}

/// Stop waiting for the rest of a line. The shortfall stays on the record:
/// "settled" and "arrived" are not the same thing, and the report that tells a
/// buyer which supplier under-delivers depends on the difference.
export function closeLineShort(
  lineId: string,
  closedBy: string,
  reason: string,
  signal?: AbortSignal
) {
  return node.post(
    `/api/v1/purchase-order-lines/${lineId}/close-short`,
    { closed_by: closedBy, reason },
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Price amendments

export function pendingPriceAmendments(signal?: AbortSignal) {
  return node
    .get<{ pending: number; items: PriceAmendment[] }>(
      "/api/v1/purchase-price-amendments",
      { signal }
    )
    .then((body) => body.items)
}

/// Answer one. Approving changes the order's price to the invoice and tells
/// the DC in one step; rejecting leaves the order alone and records the
/// disagreement, which is the only place a supplier who repeatedly bills above
/// the agreed price leaves a trail.
export function decidePriceAmendment(
  requestId: string,
  outcome: PriceAmendmentOutcome,
  decidedBy: string,
  note: string | null,
  signal?: AbortSignal
) {
  return node.post(
    `/api/v1/purchase-price-amendments/${requestId}/decide`,
    { outcome, decided_by: decidedBy, note },
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Suppliers

export function listSuppliers(status?: SupplierStatus, signal?: AbortSignal) {
  const query = status === undefined ? "" : `?status=${status}`
  return node.get<Supplier[]>(`/api/v1/suppliers${query}`, { signal })
}

export function supplierDetail(id: string, signal?: AbortSignal) {
  return node.get<Supplier>(`/api/v1/suppliers/${id}`, { signal })
}

export function createSupplier(
  request: CreateSupplierRequest,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<Supplier>("/api/v1/suppliers", request, {
    signal,
    headers: guarded(idempotencyKey),
  })
}

export function updateSupplier(
  id: string,
  request: UpdateSupplierRequest,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.request<Supplier>("PATCH", `/api/v1/suppliers/${id}`, request, {
    signal,
    headers: guarded(idempotencyKey, version),
  })
}

/// Activate or retire a supplier. Two routes on the server, one function here:
/// the caller is choosing a status, and spelling it as a status rather than as
/// two verbs is what lets one row action read from the record it is acting on.
export function setSupplierStatus(
  id: string,
  status: SupplierStatus,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  const verb = status === "ACTIVE" ? "activate" : "deactivate"
  return node.post<Supplier>(
    `/api/v1/suppliers/${id}/${verb}`,
    {},
    { signal, headers: guarded(idempotencyKey, version) }
  )
}

// ---------------------------------------------------------------------------
// Supplier items

/// One supplier's catalogue, a page at a time.
export function supplierCatalogue(
  supplierId: string,
  options: { status?: SupplierStatus; cursor?: string; limit?: number } = {},
  signal?: AbortSignal
) {
  const params = new URLSearchParams()
  if (options.status !== undefined) params.set("status", options.status)
  if (options.cursor !== undefined) params.set("cursor", options.cursor)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  const query = params.toString()
  return node.get<SupplierItemPage>(
    `/api/v1/suppliers/${supplierId}/items${query === "" ? "" : `?${query}`}`,
    { signal }
  )
}

export function createSupplierItem(
  supplierId: string,
  request: CreateSupplierItemRequest,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<SupplierItem>(
    `/api/v1/suppliers/${supplierId}/items`,
    request,
    { signal, headers: guarded(idempotencyKey) }
  )
}

export function supplierItemDetail(id: string, signal?: AbortSignal) {
  return node.get<SupplierItem>(`/api/v1/supplier-items/${id}`, { signal })
}

export function updateSupplierItem(
  id: string,
  request: UpdateSupplierItemRequest,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.request<SupplierItem>(
    "PATCH",
    `/api/v1/supplier-items/${id}`,
    request,
    { signal, headers: guarded(idempotencyKey, version) }
  )
}

export function setSupplierItemStatus(
  id: string,
  status: SupplierStatus,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  const verb = status === "ACTIVE" ? "activate" : "deactivate"
  return node.post<SupplierItem>(
    `/api/v1/supplier-items/${id}/${verb}`,
    {},
    { signal, headers: guarded(idempotencyKey, version) }
  )
}

/// Everything on offer, across every supplier — one page, plus what the rest
/// of the catalogue contains.
///
/// The facets come back counted over everything the text search matches, not
/// over the page and not over the current selection: choosing a division must
/// not make the other divisions read zero, because a facet list is how a buyer
/// sees what else is there.
export function searchSupplierItems(
  scope: SourcingScope = {},
  signal?: AbortSignal
) {
  const params = new URLSearchParams()
  if (scope.q !== undefined && scope.q.trim() !== "")
    params.set("q", scope.q.trim())
  if (scope.status !== undefined) params.set("status", scope.status)
  // Comma-separated rather than repeated keys: that is what the browser's own
  // filter state serialises to, and a second encoding for the same idea is a
  // second thing to get wrong.
  if (scope.supplierIds?.length)
    params.set("supplier_id", scope.supplierIds.join(","))
  if (scope.divisionCodes?.length)
    params.set("division", scope.divisionCodes.join(","))
  if (scope.tagCodes?.length) params.set("tags", scope.tagCodes.join(","))
  if (scope.priceMin !== undefined)
    params.set("price_min", String(scope.priceMin))
  if (scope.priceMax !== undefined)
    params.set("price_max", String(scope.priceMax))
  if (scope.limit !== undefined) params.set("limit", String(scope.limit))
  if (scope.cursor !== undefined) params.set("cursor", scope.cursor)
  const query = params.toString()
  return node.get<SourcingPage>(
    `/api/v1/supplier-items${query === "" ? "" : `?${query}`}`,
    { signal }
  )
}

/// The words the catalogue may be described with, so a screen can show
/// "Kaus Kaki" where the database says `KAUS_KAKI` — and still filter by the
/// code, which is the thing that does not change when somebody edits a label.
export function catalogueVocabulary(signal?: AbortSignal) {
  return node.get<CatalogueVocabulary>("/api/v1/catalogue/vocabulary", {
    signal,
  })
}

// ---------------------------------------------------------------------------
// The basket
//
// Every route is scoped to the caller by the session and nothing else, so no
// path here names a user: there is no shape of request that reads or empties
// somebody else's basket.

export function readBasket(signal?: AbortSignal) {
  return node.get<BasketLine[]>("/api/v1/sourcing-basket", { signal })
}

export function addToBasket(request: AddToBasketRequest, signal?: AbortSignal) {
  return node.post<BasketLine>("/api/v1/sourcing-basket", request, { signal })
}

/// Say exactly how many. Zero takes the line out and answers 204, which the
/// client reads back as `undefined` — there is no line left to describe.
export function setBasketQuantity(
  supplierItemId: string,
  quantity: number,
  signal?: AbortSignal
) {
  return node.request<BasketLine | undefined>(
    "PATCH",
    `/api/v1/sourcing-basket/${supplierItemId}`,
    { quantity },
    { signal }
  )
}

/// A POST rather than a DELETE because the server's CORS layer permits GET,
/// POST and PATCH, and widening it for one route would loosen every route.
export function removeFromBasket(supplierItemId: string, signal?: AbortSignal) {
  return node.post<void>(
    `/api/v1/sourcing-basket/${supplierItemId}/remove`,
    {},
    { signal }
  )
}

export function clearBasket(signal?: AbortSignal) {
  return node.post<void>("/api/v1/sourcing-basket/clear", {}, { signal })
}

// ---------------------------------------------------------------------------
// Article setups

/// Head office's queue: sessions opened and not yet issued.
export function listSetupSessions(signal?: AbortSignal) {
  return node
    .get<{ items: SetupSessionRow[] }>("/api/v1/article-setups", { signal })
    .then((body) => body.items)
}

/// Deliveries counted and accepted but not yet worked out.
export function unidentifiedReceipts(signal?: AbortSignal) {
  return node
    .get<{ items: UnidentifiedReceipt[] }>(
      "/api/v1/article-setups/unidentified",
      { signal }
    )
    .then((body) => body.items)
}

export function setupSessionDetail(id: string, signal?: AbortSignal) {
  return node.get<SetupSession>(`/api/v1/article-setups/${id}`, { signal })
}

/// Mint the article, its SKUs and their EPCs, and send the tagging job down.
/// All of it commits together: a serial range drawn and not sent is a hole in
/// the numbering that nothing will ever fill — which is exactly why this write
/// must not be applied twice, and carries a key that says so.
export function issueSetupSession(
  id: string,
  issuedBy: string,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<SetupSession>(
    `/api/v1/article-setups/${id}/issue`,
    { issued_by: issuedBy },
    { signal, headers: { "Idempotency-Key": idempotencyKey } }
  )
}

/// Mint an article code for a product new to the catalogue.
///
/// Ordinarily a setup session mints its own; this exists for the case where a
/// buyer wants the code in hand before the goods arrive. It draws from a
/// sequence, so a repeated call is a code nobody will ever use — hence the
/// key, held across retries.
export function mintArticleCode(idempotencyKey: string, signal?: AbortSignal) {
  return node.post<{ article_code: string }>(
    "/api/v1/article-codes",
    {},
    { signal, headers: { "Idempotency-Key": idempotencyKey } }
  )
}

// ---------------------------------------------------------------------------
// Catalogue imagery
//
// A missing photograph answers 404, which is an answer and not a failure: an
// item nobody has shot yet is ordinary. These resolve to `null` so a screen
// says "no photograph" instead of showing the error state.

async function imageOrNothing(
  path: string,
  signal?: AbortSignal
): Promise<ImageLocation | null> {
  try {
    return await node.get<ImageLocation>(path, { signal })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/// Keyed by OUR article code and a colour digit. Photographs are per colourway,
/// not per SKU: every size of the red shirt is the same red shirt.
export function articleImage(
  articleCode: string,
  colour: string,
  signal?: AbortSignal
) {
  return imageOrNothing(
    `/api/v1/catalogue/articles/${articleCode}/colours/${colour}/image`,
    signal
  )
}

/// Keyed by the SUPPLIER's own numbering, which is not an identity here — two
/// suppliers reuse each other's codes — so it lives under its own prefix and
/// is never derived from an article code.
export function supplierItemImage(
  supplierCode: string,
  itemCode: string,
  signal?: AbortSignal
) {
  return imageOrNothing(
    `/api/v1/catalogue/suppliers/${supplierCode}/items/${itemCode}/image`,
    signal
  )
}

/// Put a photograph on a colourway.
///
/// Two steps, on purpose: the node hands out a URL that authorises this one
/// key for an hour, and the bytes then go straight to the bucket. The
/// credential never leaves the server and the image never transits it — which
/// is why the second call is a bare `fetch` rather than `node`: it is not
/// addressed to the node at all.
export async function uploadArticleImage(
  articleCode: string,
  colour: string,
  file: Blob,
  signal?: AbortSignal
): Promise<ImageLocation> {
  const ticket = await node.post<ImageUploadTicket>(
    `/api/v1/catalogue/articles/${articleCode}/colours/${colour}/image/upload-url`,
    {},
    { signal }
  )
  const response = await fetch(ticket.upload.url, {
    method: ticket.method,
    body: file,
    headers: { "content-type": ticket.content_type },
    signal,
  })
  if (!response.ok) {
    throw new ApiError(
      response.status,
      `The image store refused the upload (${response.status}).`
    )
  }
  return ticket.upload
}

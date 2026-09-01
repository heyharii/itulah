/*
 * Purchase orders' backend boundary for the Go procurement API
 * (`github.com/retailos/backbone`, mounted at `/api/v1/procurement`).
 *
 * The UI keeps a small display model while this adapter owns the mapping to
 * `/api/v1/procurement/pos`; it never stages an in-memory selection or invents
 * a second purchase-order authority in the browser.
 *
 * ── The lifecycle this file mirrors ──────────────────────────────────────────
 * The Go domain models exactly three states (`POStatus` in
 * internal/cloud/procurement/types.go):
 *
 *     active ──┬── POST /pos/{id}/cancel        ──▶ cancelled
 *              └── POST /pos/{id}/close-partial ──▶ closed
 *
 * There is no draft, no submit and no approval. A PO is created straight into
 * `active` — the service comments that "a PO has no draft stage — it is issued
 * to the supplier on creation" — and both `closed` and `cancelled` are
 * terminal: the handlers reject any further transition. `POST /pos/{id}/send`
 * exists but is explicitly *not* a state change ("status stays active — send is
 * a repeatable action"), so it is not a lifecycle step.
 *
 * The "draft" in this app is therefore a browser-side composer: lines are
 * edited in the draft screen and the order reaches the backend already active.
 */

import { ApiError, api, checkContract, useDomainQuery } from "@/lib/api"
import { poQueries } from "@/components/po/queries"
import type { PoLine, PoStatus, PurchaseOrder } from "@/components/commerce/store"
import { PurchaseOrderRow } from "./contracts"

const ROUTE = "/v1/procurement/pos"

/**
 * Every procurement write goes through the Go `requireActor`, which reads the
 * JWT claims and then falls back to `X-Performed-By`. The API-key middleware
 * only mints synthetic claims with an empty UserID, and the Vite dev proxy
 * injects `X-User-ID`/`X-Actor-ID` but not `X-Performed-By` — so without this
 * header the backend answers 401 "authentication required" on every mutation.
 */
const ACTOR_HEADERS = { "X-Performed-By": "slowdown-web" }

/**
 * How a status reads and the colour that carries it. Shared, because the
 * Buying nav lists the same three states down its left edge that the order
 * table stamps on every row — they must not drift apart.
 */
export const PO_STATUS_META: Record<PoStatus, { label: string; hue: string }> = {
  draft: { label: "Draft", hue: "var(--ink-4)" },
  "in-review": { label: "In review", hue: "var(--honey)" },
  approved: { label: "Approved", hue: "var(--accent)" },
  sent: { label: "Sent", hue: "var(--grass)" },
  active: { label: "Active", hue: "var(--accent)" },
  closed: { label: "Closed", hue: "var(--grass)" },
  cancelled: { label: "Cancelled", hue: "var(--ember)" },
}

/**
 * The only states procurement actually stores. The display union still carries
 * the older draft/review values, but no order coming back from the API can be
 * in one, so the nav offers these three and nothing that cannot exist.
 */
export const PO_LIFECYCLE: PoStatus[] = ["active", "closed", "cancelled"]

const str = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback

const num = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "string" ? Number(value) : value
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** How much of the order has physically arrived, per the backend's own rollup. */
export type PoReceivedStatus = "none" | "partial" | "complete"

/**
 * The rows the index renders; the detail sheet fetches the full order.
 *
 * These aggregates exist only on the list projection (`poListFromSQL`). The
 * single-PO handler returns the bare header plus its items and leaves
 * supplier_name, the rollups and subtotal_amount empty — which is why the index
 * keeps the summary alongside the order rather than recomputing from a detail.
 */
export interface PurchaseOrderSummary {
  id: string
  number: string
  supplierId: string | null
  /** Resolved by the list SQL; the detail endpoint leaves this blank. */
  supplierName: string
  deliveryDate: string
  status: PoStatus
  lineCount: number
  totalUnits: number
  receivedUnits: number
  receivedStatus: PoReceivedStatus
  isOverdue: boolean
  destinationName: string
  total: number
  currency: string
}

function receivedStatus(value: unknown): PoReceivedStatus {
  const raw = str(value).toLowerCase()
  return raw === "partial" || raw === "complete" ? raw : "none"
}

function toSummary(order: PurchaseOrder, raw: unknown): PurchaseOrderSummary {
  const row = (raw ?? {}) as Record<string, unknown>
  return {
    id: order.id,
    number: order.number,
    supplierId: order.supplierId,
    supplierName: str(row.supplier_name) || str(row.supplier_code),
    deliveryDate: order.deliveryDate,
    status: order.status,
    lineCount: num(row.lines_count, order.lines.length),
    totalUnits: num(
      row.ordered_qty,
      order.lines.reduce((sum, line) => sum + (line.quantity ?? 0), 0)
    ),
    receivedUnits: num(row.received_qty),
    receivedStatus: receivedStatus(row.received_status),
    isOverdue: row.is_overdue === true,
    destinationName: str(row.destination_name),
    total: num(row.total_amount),
    currency: str(row.currency, "IDR"),
  }
}

export interface PurchaseOrderList {
  orders: PurchaseOrder[]
  summaries: PurchaseOrderSummary[]
  total: number
}

function toLine(raw: unknown, orderId: string, index: number): PoLine {
  const row = (raw ?? {}) as Record<string, unknown>
  return {
    id: str(row.item_id, `${orderId}-line-${index + 1}`),
    // A sourcing-item UUID is the only browser product identity that is safe
    // to resolve back to the sourcing catalogue. A legacy SKU is not that ID.
    productId: (str(row.sourcing_item_id) || null) as PoLine["productId"],
    sourcingItemId: str(row.sourcing_item_id) || undefined,
    name: str(row.name) || undefined,
    quantity: num(row.ordered_qty, 1),
    unitPrice: num(row.unit_price),
    division: str(row.division_id),
    tags: list(row.tags).map((tag) => str(tag)).filter(Boolean),
    photoUrls: list(row.photo_urls).map((url) => str(url)).filter(Boolean),
  } as PoLine
}

function dateOnly(value: unknown): string {
  const raw = str(value)
  if (!raw) return ""
  // The Go API returns RFC3339 timestamps for time.Time fields. Preserve a
  // date-only value as-is so the draft/detail screen remains deterministic.
  return raw.length >= 10 ? raw.slice(0, 10) : raw
}

/**
 * The backend's whole status vocabulary. Anything else is a row this UI does
 * not understand, so it reads as active rather than being invented into a state
 * the API would never accept a transition for.
 */
function poStatus(value: unknown): PoStatus {
  switch (str(value).toLowerCase()) {
    case "closed":
      return "closed"
    case "cancelled":
    case "canceled":
      return "cancelled"
    default:
      return "active"
  }
}

function toOrder(raw: unknown): PurchaseOrder {
  const row = (raw ?? {}) as Record<string, unknown>
  const id = str(row.po_id)
  return {
    id,
    number: str(row.po_number) || id,
    supplierId: str(row.supplier_id) || null,
    deliveryDate: dateOnly(row.expected_date),
    /* The Go store never persists a per-line discount_percent — SavePO folds
     * the discount into line_total and writes no discount column — so the
     * header discount_amount always reads back as 0. The display model carries
     * no order discount for a loaded PO rather than showing a fabricated one. */
    discountKind: "none",
    discountValue: 0,
    status: poStatus(row.status),
    lines: list(row.items).map((line, index) => toLine(line, id || "po", index)),
    createdAt: Date.parse(str(row.created_at ?? row.order_date)) || Date.now(),
    reviewNote: str(row.notes) || undefined,
  }
}

/* ── Read ───────────────────────────────────────────────────────────────── */

export interface PurchaseOrderQuery {
  /** `active` | `closed` | `cancelled`; omitted means every status. */
  status?: PoStatus
  limit?: number
}

export async function fetchPurchaseOrders(
  query: PurchaseOrderQuery = {},
  signal?: AbortSignal
): Promise<PurchaseOrderList> {
  const params = new URLSearchParams({
    limit: String(query.limit ?? 200),
    sort_by: "created_at",
    order: "desc",
  })
  if (query.status) params.set("status", query.status)

  const payload = await api.get<unknown>(`${ROUTE}?${params}`, signal ? { signal } : undefined)
  const body = (payload ?? {}) as Record<string, unknown>
  const rows = list(body.items)
  checkContract(PurchaseOrderRow, rows, ROUTE)
  const orders = rows.map(toOrder)
  return {
    orders,
    summaries: orders.map((order, index) => toSummary(order, rows[index])),
    total: num(body.total, orders.length),
  }
}

export function usePurchaseOrdersResource(query: PurchaseOrderQuery = {}) {
  return useDomainQuery(poQueries.list(query))
}

export async function fetchPurchaseOrder(id: string, signal?: AbortSignal) {
  const payload = await api.get<unknown>(
    `${ROUTE}/${encodeURIComponent(id)}`,
    signal ? { signal } : undefined
  )
  // A single order, not a list — checkContract still wants an array, and a
  // dynamic-id path would defeat its own once-per-endpoint report gate, so
  // this reports under the route template rather than the resolved id.
  checkContract(PurchaseOrderRow, [payload], `${ROUTE}/{id}`)
  return toOrder(payload)
}

/**
 * The order the URL says is open. `id` comes straight out of the route's
 * search params, so a reload or a Back lands on the same order.
 */
export function usePurchaseOrder(id: string | null) {
  return useDomainQuery(poQueries.detail(id))
}

/* ── Create ─────────────────────────────────────────────────────────────── */

/**
 * One line of `POST /pos`. The create DTO is deliberately not the read shape:
 * it takes `quantity` where every read path returns `ordered_qty`.
 *
 * `photo_urls` (min 1) and `tags` (min 1) are hard 400s in the Go validator,
 * and `division_id` must name a row in `master_divisions`.
 */
export interface PurchaseOrderLineInput {
  sourcing_item_id: string
  name: string
  quantity: number
  unit_price: number
  photo_urls: string[]
  division_id: string
  tags: string[]
  tags_per_unit?: number
  discount_percent?: number
}

/** The command accepted by the Go `POST /api/v1/procurement/pos` endpoint. */
export interface PurchaseOrderWriteInput {
  idempotencyKey: string
  supplier_id: string
  delivery_to: string
  currency?: string
  /** `yyyy-mm-dd`; the backend rejects a date before today. */
  expected_arrival?: string | null
  notes?: string | null
  items: PurchaseOrderLineInput[]
}

/**
 * `CreatePO` saves the purchase order and *then* queues the DC's
 * `receiving.expectation` command, outside the PO's transaction. When the
 * target DC has no HMAC secret configured that queue write fails and the
 * handler answers 400 — but the purchase order has already been committed.
 *
 * The command id in that message is built as `CMD-{po_id}-{unix}`, so it names
 * the order that really was created. Recovering it is what keeps the screen
 * honest: the alternative is telling the buyer their PO failed while it sits in
 * the list. Replaying the same `Idempotency-Key` returns this same cached 400
 * rather than creating a second order, so the recovery cannot duplicate a PO.
 */
const EXPECTATION_FAILURE = /persist receiving\.expectation: command CMD-(.+)-\d+:/

function committedPoIdFrom(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 400) return null
  const body = (error.body ?? {}) as Record<string, unknown>
  return EXPECTATION_FAILURE.exec(`${str(body.detail)} ${error.message}`)?.[1] ?? null
}

export async function createPurchaseOrder(
  input: PurchaseOrderWriteInput,
  signal?: AbortSignal
): Promise<PurchaseOrder> {
  if (!input.idempotencyKey.trim()) throw new Error("An idempotency key is required to create a purchase order")
  if (!input.supplier_id.trim()) throw new Error("A supplier is required to create a purchase order")
  if (!input.delivery_to.trim()) throw new Error("A delivery location is required to create a purchase order")
  if (!input.items.length) throw new Error("At least one purchase-order line is required")

  const body = {
    supplier_id: input.supplier_id,
    expected_delivery: input.expected_arrival ?? "",
    delivery_to: input.delivery_to,
    currency: input.currency?.trim() || "IDR",
    notes: input.notes?.trim() || "",
    items: input.items.map((item) => ({
      ...(item.sourcing_item_id ? { sourcing_item_id: item.sourcing_item_id } : {}),
      name: item.name,
      quantity: item.quantity,
      // Procurement money is INTEGER IDR throughout the Go domain; never send
      // the browser's floating-point display value as a decimal.
      unit_price: Math.round(item.unit_price),
      photo_urls: item.photo_urls,
      tags_per_unit: item.tags_per_unit ?? 1,
      division_id: item.division_id,
      tags: item.tags,
      ...(item.discount_percent === undefined ? {} : { discount_percent: item.discount_percent }),
    })),
  }

  try {
    const payload = await api.post<unknown>(ROUTE, body, {
      headers: { ...ACTOR_HEADERS, "Idempotency-Key": input.idempotencyKey },
      ...(signal ? { signal } : {}),
    })
    return toOrder(payload)
  } catch (error: unknown) {
    const committed = committedPoIdFrom(error)
    if (!committed) throw error
    return fetchPurchaseOrder(committed, signal)
  }
}

/* ── Lifecycle transitions ──────────────────────────────────────────────── */

async function transition(
  id: string,
  action: "cancel" | "close-partial",
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<PurchaseOrder> {
  const payload = await api.post<unknown>(
    `${ROUTE}/${encodeURIComponent(id)}/${action}`,
    body,
    { headers: ACTOR_HEADERS, ...(signal ? { signal } : {}) }
  )
  return toOrder(payload)
}

/**
 * `active → cancelled`. The handler answers 409 for an order that is already
 * closed or cancelled, so this is only ever offered on an active PO.
 */
export function cancelPurchaseOrder(id: string, signal?: AbortSignal) {
  return transition(id, "cancel", {}, signal)
}

/**
 * `active → closed`. The route is named "close-partial" because its purpose is
 * closing an order that will never be fully received, but the service applies
 * it to any active PO. The reason is recorded on the mutation log, not on the
 * order, so it never reads back from the API.
 */
export function closePurchaseOrder(id: string, reason: string, signal?: AbortSignal) {
  return transition(id, "close-partial", { reason }, signal)
}

export interface PurchaseOrderCloseInput {
  id: string
  reason: string
}

/**
 * Re-publishes the `receiving.expectation` command to the delivery DC and
 * returns `{purchase_order, command}`. Deliberately not surfaced as an action:
 * the Go service leaves the status untouched, and it shares the command-queue
 * dependency that makes create report a false failure, so on a hub with no DC
 * HMAC secret configured it can only ever error while changing nothing.
 */
export async function sendPurchaseOrder(id: string, signal?: AbortSignal): Promise<PurchaseOrder> {
  const payload = await api.post<unknown>(
    `${ROUTE}/${encodeURIComponent(id)}/send`,
    {},
    { headers: ACTOR_HEADERS, ...(signal ? { signal } : {}) }
  )
  const body = (payload ?? {}) as Record<string, unknown>
  return toOrder(body.purchase_order ?? payload)
}

/* ── Update ─────────────────────────────────────────────────────────────── */

/**
 * `PUT /pos/{id}` takes the full read shape — `items[].ordered_qty`, not the
 * create DTO's `quantity` — and recomputes every money field server-side,
 * force-preserving created_at, created_by, order_date and status.
 *
 * It is unreachable in practice. `CreatePO` registers each new order with the
 * ERP lifecycle kernel as `Submitted`, and `UpdatePO` calls `AssertEditable`,
 * which permits `Draft` only. Every PO this app creates therefore answers 400
 * "is submitted — immutable; cancel and amend instead". The call is written
 * down here so the contract lives where the next reader will look, but no
 * screen offers an edit action: lines are edited in the draft composer before
 * the order exists, and a mistake afterwards is resolved by cancelling.
 */
export interface PurchaseOrderUpdateInput {
  id: string
  supplier_id: string
  delivery_to: string
  currency?: string
  expected_date?: string | null
  notes?: string | null
  items: {
    item_id?: string
    sourcing_item_id?: string
    name: string
    ordered_qty: number
    unit_price: number
    discount_percent?: number
    photo_urls: string[]
    division_id: string
    tags: string[]
    tags_per_unit?: number
  }[]
}

export async function updatePurchaseOrder(
  input: PurchaseOrderUpdateInput,
  signal?: AbortSignal
): Promise<PurchaseOrder> {
  const payload = await api.put<unknown>(
    `${ROUTE}/${encodeURIComponent(input.id)}`,
    {
      supplier_id: input.supplier_id,
      delivery_to: input.delivery_to,
      currency: input.currency?.trim() || "IDR",
      ...(input.expected_date ? { expected_date: `${input.expected_date}T00:00:00Z` } : {}),
      notes: input.notes?.trim() || "",
      items: input.items.map((item) => ({
        ...(item.item_id ? { item_id: item.item_id } : {}),
        ...(item.sourcing_item_id ? { sourcing_item_id: item.sourcing_item_id } : {}),
        name: item.name,
        ordered_qty: item.ordered_qty,
        unit_price: Math.round(item.unit_price),
        discount_percent: item.discount_percent ?? 0,
        photo_urls: item.photo_urls,
        division_id: item.division_id,
        tags: item.tags,
        tags_per_unit: item.tags_per_unit ?? 1,
      })),
    },
    { headers: ACTOR_HEADERS, ...(signal ? { signal } : {}) }
  )
  return toOrder(payload)
}

/*
 * Inventory read adapter for the Go cloud-hub (`github.com/retailos/backbone`).
 *
 * cloud-hub serves inventory as a relational read model: `inventory_balances`
 * for position, `inventory_movements` for the ledger, `inventory_bins` for the
 * pools inside a location, and `master_locations` for the estate. The pool
 * projection is a separate, explicitly-staged authority that reports its own
 * readiness rather than aliasing the signed ledger.
 *
 * This module is the read-only boundary between those routes and the screen's
 * view models. It normalises Go's envelopes, never invents stock, and reports
 * what the API withholds instead of filling it in.
 */

import {
  type Bucket,
  type BucketKind,
  type InvLocation,
  type MissingEvent,
  type MissingStatus,
  type MissingUnit,
  type MoveKind,
  type Movement,
  type Size,
  type SkuRow,
} from "@/components/inventory/data"
import type { z } from "zod"
import { dayKey } from "@/lib/day"
import { api, checkContract, qs, useDomainQuery, type ApiResource } from "@/lib/api"
import { inventoryQueries } from "./queries"
import {
  BalanceRow,
  BinRow,
  CycleCountRow,
  CycleCountVarianceItemRow,
  CycleCountVariancePayload,
  DcOperationRow,
  InboundReturnLineRow,
  InboundReturnRow,
  LocationRow,
  MovementRow,
  PoolStatusPayload,
  ProblemItemRow,
  ReceivingBatchRow,
} from "./contracts"

export interface InventorySnapshot {
  locations: InvLocation[]
  rows: SkuRow[]
  movements: Movement[]
  missing: MissingUnit[]
  fetchedAt: string
  /** Which durable read model supplied the snapshot. */
  authority: "legacy" | "pool"
  /** Explicit state of the pool read-model rollout. */
  projection: InventoryProjection
  /** Optional read-model warnings; core balance failures still reject. */
  warnings: string[]
}

export type InventoryProjectionMode =
  "disabled" | "shadow" | "active" | "unknown"

export interface InventoryProjection {
  installed: boolean
  ready: boolean
  mode: InventoryProjectionMode
  authority: "legacy" | "pool"
  reason?: string
}

export interface InventoryCountRow {
  id: string
  sku: string
  binId?: string
  expectedQty: number
  countedQty: number
}

export interface InventoryCountResult {
  adjustmentId: string
  posted: unknown
  changedLines: number
}

/** A row returned by cloud-hub's HO cycle-count read model. */
export interface CycleCountOperation {
  id: string
  initiatedBy: string
  scope: string
  targetStoreIds: string[]
  sampleStrategy: string
  sampleSize: number
  skus: string[]
  status: string
  scheduledFor?: string
  startedAt?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface CycleCountVarianceItem {
  id: string
  cycleId: string
  sku: string
  locationId: string
  binId: string
  expectedQty: number
  countedQty?: number
  variance?: number
  countedBy: string
  countedAt?: string
  notes: string
}

export interface CycleCountVariance {
  cycleId: string
  totalItems: number
  countedItems: number
  items: CycleCountVarianceItem[]
}

/** A row projected from DC edge events; this is read-only by design. */
export interface DcOperation {
  dcId: string
  operationType: string
  entityId: string
  status: string
  destination: string
  itemCount: number
  verified?: boolean
  missingCount: number
  lastEventType: string
  occurredAt: string
  updatedAt: string
}

/** A HO receiving/inventory-processing batch from cloud-hub's live queue. */
export interface HoReceivingBatch {
  id: string
  poId: string
  grnId: string
  supplierId: string
  stage: number
  totalUnits: number
  metaComplete: boolean
  boundCount: number
  printBatchId: string
  hppTotal: number
  createdAt: string
  updatedAt: string
  closedAt?: string
  closedBy: string
}

/** An inbound store return waiting for HO inspection/disposition. */
export interface InboundReturnOperation {
  id: string
  returnNumber: string
  storeId: string
  reason: string
  status: string
  itemsCount: number
  receivedBy: string
  receivedAt: string
  inspectorNotes: string
  totalValue: string
  createdAt: string
  updatedAt: string
}

export interface InboundReturnDetail extends InboundReturnOperation {
  items: Array<{
    id: string
    returnId: string
    sku: string
    name: string
    qty: number
    condition: string
    disposition: string
    dispositionNotes: string
  }>
}

export interface InboundReturnInspectionItem {
  id: string
  sku: string
  name?: string
  qty: number
  condition?: string
  disposition: string
  dispositionNotes?: string
}

export interface InboundReturnInspection {
  /** cloud-hub defaults an omitted status to "inspected". */
  status?: string
  rejectionReason?: string
  inspectorNotes?: string
  items: InboundReturnInspectionItem[]
}

export interface InventoryOperationsSnapshot {
  cycleCounts: CycleCountOperation[] | null
  dcOperations: DcOperation[] | null
  receivingBatches: HoReceivingBatch[] | null
  inboundReturns: InboundReturnOperation[] | null
  errors: Partial<
    Record<
      "cycleCounts" | "dcOperations" | "receivingBatches" | "inboundReturns",
      string
    >
  >
  fetchedAt: string
}

/** The operations read, in the shape every screen already reads. */
export type InventoryOperationsResource = ApiResource<InventoryOperationsSnapshot>

/** The whole-estate inventory read. */
export type InventoryResource = ApiResource<InventorySnapshot>

const EMPTY_SNAPSHOT: InventorySnapshot = {
  locations: [],
  rows: [],
  movements: [],
  missing: [],
  fetchedAt: "",
  authority: "legacy",
  projection: {
    installed: false,
    ready: false,
    mode: "unknown",
    authority: "legacy",
    reason: "not_loaded",
  },
  warnings: [],
}

/* cloud-hub pages by limit/offset on every collection used here. One page is
 * read and truncation is reported rather than silently shown as the estate. */
const HUB_PAGE_SIZE = 200

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null

function arrayFrom<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) return payload as T[]
  const record = asRecord(payload)
  return record && Array.isArray(record[key]) ? (record[key] as T[]) : []
}

function numberFrom(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function stringFrom(value: unknown, fallback = ""): string {
  return typeof value === "string"
    ? value
    : value == null
      ? fallback
      : String(value)
}

function optionalInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined
  const parsed = numberFrom(value, Number.NaN)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined
}

function stringsFrom(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => stringFrom(entry)) : []
}

/** RFC3339 (or a bare date) to the plain YYYY-MM-DD key the screens key on. */
function dayFrom(value: unknown): string {
  const raw = stringFrom(value)
  if (!raw) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? raw.slice(0, 10) : dayKey(parsed)
}

/** The clock part of a timestamp, for the ledger's second column. */
function timeFrom(value: unknown, fallback = ""): string {
  const raw = stringFrom(value)
  if (!raw) return fallback
  if (/^\d{2}:\d{2}/.test(raw)) return raw.slice(0, 5)
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return fallback
  return parsed.toTimeString().slice(0, 5)
}

async function getJson(path: string, signal: AbortSignal): Promise<unknown> {
  // The shared client, so inventory reads carry the same credentials and the
  // same error semantics as sourcing and procurement.
  return api.get<unknown>(path, { signal })
}

/* ---------------------------------------------------------------------------
 * Locations, bins, and the buckets the screen draws.
 *
 * cloud-hub has no "bucket" vocabulary. It has `inventory_bins`, whose
 * `bin_type` is a closed set (display, backroom, available, reject, staging,
 * in_transit, system). Each bin becomes one bucket, named as the backend names
 * it, so nothing on the screen is a label this adapter made up.
 */

interface BinPlacement {
  kind: BucketKind
  countable: boolean
}

const BIN_PLACEMENT: Record<string, BinPlacement> = {
  display: { kind: "sales", countable: true },
  backroom: { kind: "stock", countable: true },
  available: { kind: "warehouse", countable: true },
  reject: { kind: "reject", countable: true },
  // Staging and transit are work in motion; a physical count of them is not a
  // meaningful operation, so the count action stays closed on those buckets.
  staging: { kind: "staging", countable: false },
  in_transit: { kind: "transit", countable: false },
  system: { kind: "stock", countable: false },
}

function binPlacement(binType: string): BinPlacement {
  return BIN_PLACEMENT[binType] ?? { kind: "warehouse", countable: true }
}

function locationKind(locationType: string): InvLocation["kind"] {
  return locationType.toLowerCase() === "store" ? "store" : "dc"
}

function locationRegion(locationType: string): string {
  const type = locationType.toLowerCase()
  if (type === "store") return "Store"
  if (type === "hq") return "Head office"
  return "Distribution"
}

interface ApiLocation {
  location_id?: unknown
  code?: unknown
  name?: unknown
  location_type?: unknown
  is_active?: unknown
}

interface ApiBin {
  id?: unknown
  warehouse_id?: unknown
  code?: unknown
  type?: unknown
  name?: unknown
  is_system?: unknown
  status?: unknown
}

interface ApiBalance {
  sku?: unknown
  name?: unknown
  location_id?: unknown
  location_name?: unknown
  bin_id?: unknown
  qty_on_hand?: unknown
  qty_reserved?: unknown
  qty_available?: unknown
  unit_cost?: unknown
  total_value?: unknown
  updated_at?: unknown
}

interface ApiMovement {
  id?: unknown
  date?: unknown
  time?: unknown
  item_id?: unknown
  item_name?: unknown
  warehouse_id?: unknown
  warehouse_name?: unknown
  voucher_type?: unknown
  voucher_no?: unknown
  qty_in?: unknown
  qty_out?: unknown
  balance?: unknown
  unit_cost?: unknown
  total_cost?: unknown
  performed_by?: unknown
  notes?: unknown
}

interface ApiProblemItem {
  id?: unknown
  store_id?: unknown
  sku?: unknown
  source_type?: unknown
  source_ref?: unknown
  expected_qty?: unknown
  counted_qty?: unknown
  variance_qty?: unknown
  direction?: unknown
  status?: unknown
  notes?: unknown
  created_at?: unknown
  updated_at?: unknown
  resolved_by?: unknown
  resolved_at?: unknown
  resolution?: unknown
}

/** cloud-hub's `voucher_type` vocabulary, mapped onto the ledger's kinds. */
function movementKind(voucherType: string): MoveKind {
  const type = voucherType.toLowerCase()
  if (type.includes("receipt") || type.includes("receive") || type.includes("grn")) {
    return "receive"
  }
  if (type.includes("dispatch") || type.includes("delivery") || type.includes("ship")) {
    return "dispatch"
  }
  if (type.includes("transfer")) return "transfer"
  if (type.includes("sale") || type.includes("pos") || type.includes("invoice")) {
    return "sale"
  }
  if (type.includes("return")) return "return"
  if (type.includes("count") || type.includes("opname")) return "count"
  if (type.includes("writeoff") || type.includes("write_off") || type.includes("shrink")) {
    return "write-off"
  }
  return "correction"
}

async function readPage<T>(
  path: string,
  key: string,
  signal: AbortSignal,
  params: Record<string, string | number> = {},
  rowSchema?: z.ZodTypeAny
): Promise<{ items: T[]; total?: number; truncated: boolean }> {
  const payload = await getJson(
    `${path}${qs({ limit: HUB_PAGE_SIZE, ...params })}`,
    signal
  )
  const items = arrayFrom<T>(payload, key)
  if (rowSchema) checkContract(rowSchema, items, path)
  const record = asRecord(payload)
  const total =
    record && typeof record.total === "number" && Number.isFinite(record.total)
      ? record.total
      : undefined
  return { items, total, truncated: total !== undefined && total > items.length }
}

function parseProjection(payload: unknown): InventoryProjection {
  const record = asRecord(payload)
  if (!record) {
    return {
      installed: false,
      ready: false,
      mode: "unknown",
      authority: "legacy",
      reason: "unreadable_pool_status",
    }
  }
  const mode = stringFrom(record.mode)
  const authority = stringFrom(record.authority) === "pool" ? "pool" : "legacy"
  const reason = stringFrom(record.reason)
  return {
    installed: record.installed === true,
    ready: record.ready === true,
    mode:
      mode === "disabled" || mode === "shadow" || mode === "active"
        ? mode
        : "unknown",
    authority,
    ...(reason ? { reason } : {}),
  }
}

function buildSnapshot(
  locationRows: ApiLocation[],
  bins: ApiBin[],
  balances: ApiBalance[],
  movementRows: ApiMovement[],
  problems: ApiProblemItem[],
  projection: InventoryProjection,
  warnings: string[]
): InventorySnapshot {
  const locationIndex = new Map<
    string,
    { name: string; kind: InvLocation["kind"]; region: string }
  >()
  for (const location of locationRows) {
    const id = stringFrom(location.location_id)
    if (!id) continue
    const type = stringFrom(location.location_type)
    locationIndex.set(id, {
      name: stringFrom(location.name, stringFrom(location.code, id)),
      kind: locationKind(type),
      region: locationRegion(type),
    })
  }

  /* One bucket per bin. `bin_id` on a balance row is the bin's own id, so the
   * bucket id is the bin id and the two line up without a lookup table. */
  const bucketsByLocation = new Map<string, Map<string, Bucket>>()
  const bucketOfBin = new Map<string, { locationId: string; bucketId: string }>()
  for (const bin of bins) {
    const id = stringFrom(bin.id)
    const locationId = stringFrom(bin.warehouse_id)
    if (!id || !locationId) continue
    if (stringFrom(bin.status) === "inactive") continue
    const placement = binPlacement(stringFrom(bin.type))
    const bucket: Bucket = {
      id,
      name: stringFrom(bin.name, stringFrom(bin.code, id)),
      kind: placement.kind,
      countable: placement.countable,
    }
    const perLocation = bucketsByLocation.get(locationId) ?? new Map()
    perLocation.set(id, bucket)
    bucketsByLocation.set(locationId, perLocation)
    bucketOfBin.set(id, { locationId, bucketId: id })
  }

  const rows: SkuRow[] = []
  const rowIndex = new Map<string, SkuRow>()
  for (const balance of balances) {
    const sku = stringFrom(balance.sku)
    if (!sku) continue
    const locationId = stringFrom(balance.location_id)
    const binId = stringFrom(balance.bin_id)
    const known = bucketOfBin.get(binId)
    const bucketId = known?.bucketId ?? binId ?? ""
    if (locationId && !locationIndex.has(locationId)) {
      locationIndex.set(locationId, {
        name: stringFrom(balance.location_name, locationId),
        kind: "dc",
        region: "Distribution",
      })
    }
    /* A balance can name a bin the bin list did not return (a deactivated bin,
     * or one past the first page). The bucket is still real, so it is added
     * from the balance rather than dropping the position off the screen. */
    if (binId && locationId && !bucketsByLocation.get(locationId)?.has(binId)) {
      const perLocation = bucketsByLocation.get(locationId) ?? new Map()
      perLocation.set(binId, {
        id: binId,
        name: binId,
        kind: "warehouse" as BucketKind,
        countable: true,
      })
      bucketsByLocation.set(locationId, perLocation)
    }

    const onHand = optionalInt(balance.qty_on_hand) ?? 0
    const available = optionalInt(balance.qty_available) ?? onHand
    const row: SkuRow = {
      id: `${locationId}:${bucketId}:${sku}`,
      locationId,
      ...(binId ? { binId } : {}),
      bucketId,
      stageId: bucketId,
      /* The balance read model is keyed by SKU. cloud-hub carries colour and
       * size on `master_items`, not on the balance, so neither is guessed
       * here: both fall back to the SKU's own identity. */
      productId: sku,
      colorwayId: sku,
      size: "M" as Size,
      name: stringFrom(balance.name, sku),
      stock: onHand,
      /* `qty_available` is on-hand less reservation — a book figure, not an
       * RFID sighting. The warning below says so rather than the column
       * implying evidence that was never collected. */
      observed: available,
      lastObserved: dayFrom(balance.updated_at),
      lastCount: null,
      lastCountKnown: false,
    }
    rows.push(row)
    rowIndex.set(`${locationId}:${sku}`, row)
  }

  if (rows.length > 0) {
    warnings.push(
      "Observed quantities repeat cloud-hub's available balance: the inventory read model exposes no RFID observation for a position."
    )
  }

  const movements: Movement[] = movementRows.map((entry, index) => {
    const qtyIn = optionalInt(entry.qty_in) ?? 0
    const qtyOut = optionalInt(entry.qty_out) ?? 0
    const voucherType = stringFrom(entry.voucher_type)
    const itemId = stringFrom(entry.item_id)
    const note = stringFrom(entry.notes)
    const voucherNo = stringFrom(entry.voucher_no)
    return {
      id: stringFrom(entry.id, `movement-${index}`),
      at: dayFrom(entry.date),
      time: timeFrom(entry.time),
      kind: movementKind(voucherType),
      productId: itemId,
      colorwayId: itemId,
      size: "M" as Size,
      name: stringFrom(entry.item_name, itemId),
      qty: qtyIn !== 0 ? qtyIn : qtyOut,
      locationId: stringFrom(entry.warehouse_id),
      /* cloud-hub's movement row is single-sided: it names the warehouse the
       * movement happened in, never a from/to pair and never a bin. */
      bucketId: "",
      by: stringFrom(entry.performed_by, "—"),
      ...(note || voucherNo
        ? { note: [voucherNo, note].filter(Boolean).join(" · ") }
        : {}),
    }
  })

  /* Missing units come from Problem Inventory — cloud-hub's blind-count
   * receiving variance queue. Only the short direction is a missing unit; an
   * overage is a different problem and is not shown as one. */
  const missing: MissingUnit[] = []
  for (const problem of problems) {
    const direction = stringFrom(problem.direction).toLowerCase()
    if (direction && direction !== "short" && direction !== "shortage") continue
    const id = stringFrom(problem.id)
    if (!id) continue
    const sku = stringFrom(problem.sku)
    const storeId = stringFrom(problem.store_id)
    const status = stringFrom(problem.status).toLowerCase()
    const resolution = stringFrom(problem.resolution).toLowerCase()
    const openedAt = dayFrom(problem.created_at)
    const resolvedAt = dayFrom(problem.resolved_at)
    const expectedQty = optionalInt(problem.expected_qty) ?? 0
    const countedQty = optionalInt(problem.counted_qty) ?? 0
    const varianceQty = optionalInt(problem.variance_qty) ?? 0

    const unitStatus: MissingStatus =
      status === "open" || status === ""
        ? "open"
        : resolution.includes("write") || resolution.includes("shrink")
          ? "written-off"
          : "found"

    const history: MissingEvent[] = [
      {
        at: openedAt,
        what: `Blind count short by ${varianceQty} — expected ${expectedQty}, counted ${countedQty}`,
        by: stringFrom(problem.source_type, "Receiving"),
      },
    ]
    const notes = stringFrom(problem.notes)
    if (notes) {
      history.push({ at: openedAt, what: notes, by: "Store team" })
    }
    if (resolvedAt) {
      history.push({
        at: resolvedAt,
        what: resolution ? `Resolved as ${resolution}` : "Resolved",
        by: stringFrom(problem.resolved_by, "HO"),
      })
    }

    const row = rowIndex.get(`${storeId}:${sku}`)
    missing.push({
      epc: id,
      rowId: row?.id ?? `${storeId}::${sku}`,
      productId: sku,
      colorwayId: sku,
      size: "M" as Size,
      locationId: storeId,
      bucketId: row?.bucketId ?? "",
      stageId: row?.stageId ?? "",
      locationName: locationIndex.get(storeId)?.name ?? storeId,
      name: row?.name ?? sku,
      expected: stringFrom(problem.source_ref, stringFrom(problem.source_type, "—")),
      lastObserved: dayFrom(problem.updated_at) || openedAt,
      status: unitStatus,
      history,
    })
  }

  const locations: InvLocation[] = [...bucketsByLocation.entries()]
    .map(([id, buckets]) => {
      const meta = locationIndex.get(id)
      return {
        id,
        name: meta?.name ?? id,
        kind: meta?.kind ?? "dc",
        region: meta?.region ?? "Distribution",
        buckets: [...buckets.values()],
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    locations,
    rows,
    movements,
    missing,
    fetchedAt: new Date().toISOString(),
    /* The pool projection reports its own readiness. While it is shadowed or
     * absent, `inventory_balances` remains the authority and the header says
     * exactly that instead of implying the projection is live. */
    authority: projection.authority,
    projection,
    warnings,
  }
}

export async function fetchInventory(
  signal: AbortSignal
): Promise<InventorySnapshot> {
  const warnings: string[] = []

  /* Balances are the authority for this screen and a failure to read them is a
   * failure of the screen. Everything else decorates it, so a refusal there is
   * degraded, not fatal, and is reported as a warning.
   *
   * That difference is in how the results are *handled*, not in when they are
   * *asked for*: none of the five decorations reads anything out of the balance
   * rows. Awaiting balances first cost a whole serial round trip — measured at
   * ~170ms against a local hub, and proportionally worse over a real network —
   * to buy nothing. All six go out together; the balance rejection is rethrown
   * below, so the fatal-vs-degraded contract is unchanged. */
  const [
    balanceResult,
    locationResult,
    binResult,
    movementResult,
    problemResult,
    poolResult,
  ] = await Promise.allSettled([
    readPage<ApiBalance>("/api/v1/inventory/balances", "items", signal, {}, BalanceRow),
    readPage<ApiLocation>(
      "/api/v1/masterdata/locations",
      "locations",
      signal,
      {},
      LocationRow
    ),
    getJson("/api/v1/inventory/bins", signal),
    readPage<ApiMovement>("/api/v1/inventory/movements", "items", signal, {}, MovementRow),
    getJson(`/api/v1/problem-inventory${qs({ limit: HUB_PAGE_SIZE })}`, signal),
    getJson("/api/v1/inventory/pool-status", signal),
  ])

  if (balanceResult.status === "rejected") throw balanceResult.reason
  const balances = balanceResult.value
  if (signal.aborted) {
    throw new DOMException("The request was cancelled", "AbortError")
  }

  if (balances.truncated) {
    warnings.push(
      `Only ${balances.items.length} of ${balances.total} balance rows were read; this screen takes one page of ${HUB_PAGE_SIZE}.`
    )
  }

  const locationRows =
    locationResult.status === "fulfilled" ? locationResult.value.items : []
  if (locationResult.status === "rejected") {
    warnings.push("Location names are unavailable; sites are shown by id.")
  }

  const bins =
    binResult.status === "fulfilled" ? arrayFrom<ApiBin>(binResult.value, "items") : []
  if (binResult.status === "fulfilled") {
    checkContract(BinRow, bins, "/api/v1/inventory/bins")
  }
  if (binResult.status === "rejected") {
    warnings.push(
      "Bins could not be read; pools are named by their bin id and none can be counted."
    )
  }

  const movementRows =
    movementResult.status === "fulfilled" ? movementResult.value.items : []
  if (movementResult.status === "rejected") {
    warnings.push("The movement feed is unavailable; the ledger is empty.")
  } else if (movementResult.value.truncated) {
    warnings.push(
      `Only ${movementRows.length} of ${movementResult.value.total} movements were read; the ledger shows the most recent page.`
    )
  }

  const problems =
    problemResult.status === "fulfilled"
      ? arrayFrom<ApiProblemItem>(problemResult.value, "items")
      : []
  if (problemResult.status === "fulfilled") {
    checkContract(ProblemItemRow, problems, "/api/v1/problem-inventory")
  }
  if (problemResult.status === "rejected") {
    warnings.push(
      "Problem Inventory is unavailable; missing units cannot be listed."
    )
  }

  if (poolResult.status === "fulfilled") {
    checkContract(PoolStatusPayload, [poolResult.value], "/api/v1/inventory/pool-status")
  }
  const projection =
    poolResult.status === "fulfilled"
      ? parseProjection(poolResult.value)
      : {
          installed: false,
          ready: false,
          mode: "unknown" as const,
          authority: "legacy" as const,
          reason: "pool_status_unreadable",
        }

  return buildSnapshot(
    locationRows,
    bins,
    balances.items,
    movementRows,
    problems,
    projection,
    warnings
  )
}

/* ---------------------------------------------------------------------------
 * The count sheet.
 *
 * cloud-hub has no single-shot "post a count" route. A physical count is a
 * manual inventory adjustment: a draft holding one line per changed SKU, then
 * a submit that either auto-posts or queues the entry for approval. Both steps
 * are performed here so the sheet posts the variance and nothing else; rows
 * whose counted quantity equals the book figure create no line at all.
 */
export async function submitInventoryCount(
  locationId: string,
  rows: InventoryCountRow[],
  signal?: AbortSignal
): Promise<InventoryCountResult> {
  const changed = rows.filter((row) => row.countedQty !== row.expectedQty)
  if (changed.length === 0) {
    throw new Error("Nothing to post: every counted quantity matches the book.")
  }
  const binId = changed.find((row) => row.binId)?.binId
  const options = signal ? { signal } : undefined

  const draft = await api.post<unknown>(
    "/api/v1/inventory/adjustments",
    {
      // entity_id is resolved by cloud-hub from the active finance entity when
      // the caller does not name one; this screen has no entity picker.
      posting_date: dayKey(new Date()),
      location_id: locationId,
      ...(binId ? { bin_id: binId } : {}),
      reason: "Physical count variance",
      source_module: "inventory_monitor",
      lines: changed.map((row, index) => {
        const delta = row.countedQty - row.expectedQty
        return {
          line_number: index + 1,
          sku: row.sku,
          quantity: delta,
          movement_type: delta > 0 ? "manual_found" : "manual_shrinkage",
          description: `Counted ${row.countedQty} against a book figure of ${row.expectedQty}`,
        }
      }),
    },
    options
  )
  const draftRecord = asRecord(draft)
  const adjustmentId = stringFrom(draftRecord?.id)
  if (!adjustmentId) {
    throw new Error("cloud-hub created no adjustment for this count.")
  }
  const posted = await api.post<unknown>(
    `/api/v1/inventory/adjustments/${encodeURIComponent(adjustmentId)}/submit`,
    undefined,
    options
  )
  return { adjustmentId, posted, changedLines: changed.length }
}

/* ---------------------------------------------------------------------------
 * Operations.
 */

function parseCycleCount(value: unknown): CycleCountOperation {
  const record = asRecord(value)
  if (!record) throw new Error("cloud-hub returned an invalid cycle count.")
  const id = stringFrom(record.id)
  if (!id) throw new Error("cloud-hub returned a cycle count without an id.")
  const scheduledFor = stringFrom(record.scheduled_for)
  const startedAt = stringFrom(record.started_at)
  const completedAt = stringFrom(record.completed_at)
  return {
    id,
    initiatedBy: stringFrom(record.initiated_by, "—"),
    scope: stringFrom(record.scope, "—"),
    targetStoreIds: stringsFrom(record.target_store_ids),
    sampleStrategy: stringFrom(record.sample_strategy, "—"),
    sampleSize: optionalInt(record.sample_size) ?? 0,
    skus: stringsFrom(record.skus),
    status: stringFrom(record.status, "unknown"),
    ...(scheduledFor ? { scheduledFor } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    createdAt: stringFrom(record.created_at),
    updatedAt: stringFrom(record.updated_at),
  }
}

function parseCycleCountItem(value: unknown): CycleCountVarianceItem {
  const record = asRecord(value)
  if (!record) throw new Error("cloud-hub returned an invalid variance line.")
  const countedQty = optionalInt(record.counted_qty)
  const variance = optionalInt(record.variance)
  const countedAt = stringFrom(record.counted_at)
  return {
    id: stringFrom(record.id),
    cycleId: stringFrom(record.cycle_id),
    sku: stringFrom(record.sku),
    locationId: stringFrom(record.location_id),
    binId: stringFrom(record.bin_id),
    expectedQty: optionalInt(record.expected_qty) ?? 0,
    ...(countedQty !== undefined ? { countedQty } : {}),
    ...(variance !== undefined ? { variance } : {}),
    countedBy: stringFrom(record.counted_by),
    ...(countedAt ? { countedAt } : {}),
    notes: stringFrom(record.notes),
  }
}

function parseReceivingBatch(value: unknown): HoReceivingBatch {
  const record = asRecord(value)
  if (!record) throw new Error("cloud-hub returned an invalid receiving batch.")
  const id = stringFrom(record.id)
  if (!id) throw new Error("cloud-hub returned a receiving batch without an id.")
  const closedAt = stringFrom(record.closed_at)
  return {
    id,
    poId: stringFrom(record.po_id, "—"),
    grnId: stringFrom(record.grn_id, "—"),
    supplierId: stringFrom(record.supplier_id, "—"),
    stage: optionalInt(record.stage) ?? 0,
    totalUnits: optionalInt(record.total_units) ?? 0,
    metaComplete: record.meta_complete === true,
    boundCount: optionalInt(record.bound_count) ?? 0,
    printBatchId: stringFrom(record.print_batch_id),
    hppTotal: numberFrom(record.hpp_total),
    createdAt: stringFrom(record.created_at),
    updatedAt: stringFrom(record.updated_at),
    ...(closedAt ? { closedAt } : {}),
    closedBy: stringFrom(record.closed_by),
  }
}

function parseDcOperation(value: unknown): DcOperation {
  const record = asRecord(value)
  if (!record) throw new Error("cloud-hub returned an invalid DC operation.")
  return {
    dcId: stringFrom(record.dc_id, "—"),
    operationType: stringFrom(record.operation_type),
    entityId: stringFrom(record.entity_id),
    status: stringFrom(record.status, "unknown"),
    destination: stringFrom(record.destination, "—"),
    itemCount: optionalInt(record.item_count) ?? 0,
    ...(typeof record.verified === "boolean"
      ? { verified: record.verified }
      : {}),
    missingCount: optionalInt(record.missing_count) ?? 0,
    lastEventType: stringFrom(record.last_event_type),
    occurredAt: stringFrom(record.occurred_at),
    updatedAt: stringFrom(record.updated_at),
  }
}

function parseInboundReturn(value: unknown): InboundReturnOperation {
  const record = asRecord(value)
  if (!record) throw new Error("cloud-hub returned an invalid return.")
  const id = stringFrom(record.id)
  if (!id) throw new Error("cloud-hub returned a return without an id.")
  return {
    id,
    returnNumber: stringFrom(record.return_number, id),
    storeId: stringFrom(record.store_id, "—"),
    reason: stringFrom(record.reason, "—"),
    status: stringFrom(record.status, "unknown"),
    itemsCount: optionalInt(record.items_count) ?? 0,
    receivedBy: stringFrom(record.received_by),
    receivedAt: stringFrom(record.received_at),
    inspectorNotes: stringFrom(record.inspector_notes),
    totalValue: stringFrom(record.total_value),
    createdAt: stringFrom(record.created_at),
    updatedAt: stringFrom(record.updated_at),
  }
}

/** Read the operations cloud-hub actually exposes; failures stay explicit. */
export async function fetchInventoryOperations(
  signal: AbortSignal
): Promise<InventoryOperationsSnapshot> {
  const requests = await Promise.allSettled([
    getJson(`/api/v1/cycle-counts${qs({ limit: HUB_PAGE_SIZE })}`, signal),
    getJson("/api/v1/ho-receiving/batches", signal),
    getJson(`/api/v1/returns/inbound${qs({ limit: HUB_PAGE_SIZE })}`, signal),
    /* The DC ops projection is one collection per operation type; the screen
     * shows them as one list, so all three are read and concatenated. */
    Promise.all(
      ["waves", "packing", "shipments"].map((kind) =>
        getJson(`/api/v1/dc-ops/${kind}${qs({ limit: HUB_PAGE_SIZE })}`, signal)
      )
    ),
  ])
  if (signal.aborted) {
    throw new DOMException("The request was cancelled", "AbortError")
  }

  const errors: InventoryOperationsSnapshot["errors"] = {}
  const read = (
    index: number,
    key: keyof InventoryOperationsSnapshot["errors"]
  ): unknown => {
    const result = requests[index]
    if (result.status === "fulfilled") return result.value
    errors[key] =
      result.reason instanceof Error ? result.reason.message : "Request failed."
    return null
  }

  const parseSlice = <T>(
    payload: unknown,
    key: string,
    parse: (value: unknown) => T,
    errorKey: keyof InventoryOperationsSnapshot["errors"],
    rowSchema: z.ZodTypeAny,
    path: string
  ): T[] | null => {
    if (payload === null) return null
    try {
      const rows = arrayFrom<unknown>(payload, key)
      checkContract(rowSchema, rows, path)
      return rows.map(parse)
    } catch (error: unknown) {
      errors[errorKey] =
        error instanceof Error ? error.message : "Invalid response."
      return null
    }
  }

  const cycleCounts = parseSlice(
    read(0, "cycleCounts"),
    "cycles",
    parseCycleCount,
    "cycleCounts",
    CycleCountRow,
    "/api/v1/cycle-counts"
  )
  const receivingBatches = parseSlice(
    read(1, "receivingBatches"),
    "items",
    parseReceivingBatch,
    "receivingBatches",
    ReceivingBatchRow,
    "/api/v1/ho-receiving/batches"
  )
  const inboundReturns = parseSlice(
    read(2, "inboundReturns"),
    "returns",
    parseInboundReturn,
    "inboundReturns",
    InboundReturnRow,
    "/api/v1/returns/inbound"
  )

  const dcPayload = read(3, "dcOperations")
  let dcOperations: DcOperation[] | null = null
  if (dcPayload !== null) {
    try {
      dcOperations = (dcPayload as unknown[]).flatMap((page) => {
        const rows = arrayFrom<unknown>(page, "items")
        checkContract(DcOperationRow, rows, "/api/v1/dc-ops")
        return rows.map(parseDcOperation)
      })
    } catch (error: unknown) {
      errors.dcOperations =
        error instanceof Error ? error.message : "Invalid response."
    }
  }

  if (
    cycleCounts === null &&
    receivingBatches === null &&
    inboundReturns === null &&
    dcOperations === null
  ) {
    const first = Object.values(errors)[0] ?? "No operations are available."
    throw new Error(first)
  }
  return {
    cycleCounts,
    dcOperations,
    receivingBatches,
    inboundReturns,
    errors,
    fetchedAt: new Date().toISOString(),
  }
}

export async function fetchCycleCountVariance(
  id: string,
  signal?: AbortSignal
): Promise<CycleCountVariance> {
  const path = `/api/v1/cycle-counts/${encodeURIComponent(id)}/variance-report`
  // Id-free label — see "Naming the path label" in the recipe.
  const label = "/api/v1/cycle-counts/:id/variance-report"
  const payload = await api.get<unknown>(path, signal ? { signal } : undefined)
  const record = asRecord(payload)
  if (!record) throw new Error("cloud-hub returned an invalid variance report.")
  checkContract(CycleCountVariancePayload, [record], label)
  const rawItems = arrayFrom<unknown>(record.items, "items")
  checkContract(CycleCountVarianceItemRow, rawItems, `${label}#items`)
  const items = rawItems.map(parseCycleCountItem)
  return {
    cycleId: stringFrom(record.cycle_id, id),
    totalItems: optionalInt(record.total_items) ?? items.length,
    countedItems: optionalInt(record.counted_items) ?? 0,
    items,
  }
}

export async function fetchInboundReturnDetail(
  id: string,
  signal?: AbortSignal
): Promise<InboundReturnDetail> {
  const path = `/api/v1/returns/inbound/${encodeURIComponent(id)}`
  // Id-free label — see "Naming the path label" in the recipe.
  const label = "/api/v1/returns/inbound/:id"
  const payload = await api.get<unknown>(path, signal ? { signal } : undefined)
  const record = asRecord(payload)
  if (!record) throw new Error("cloud-hub returned an invalid return detail.")
  checkContract(InboundReturnRow, [record], label)
  const rawItems = arrayFrom<unknown>(record.items, "items")
  checkContract(InboundReturnLineRow, rawItems, `${label}#items`)
  const base = parseInboundReturn(record)
  const items = rawItems.map(
    (value): InboundReturnDetail["items"][number] => {
      const line = asRecord(value)
      if (!line) throw new Error("cloud-hub returned an invalid return line.")
      return {
        id: stringFrom(line.id),
        returnId: stringFrom(line.return_id, id),
        sku: stringFrom(line.sku, "—"),
        name: stringFrom(line.name),
        qty: optionalInt(line.qty) ?? 0,
        condition: stringFrom(line.condition, "—"),
        disposition: stringFrom(line.disposition),
        dispositionNotes: stringFrom(line.disposition_notes),
      }
    }
  )
  return { ...base, items }
}

export async function scheduleInboundReturnPickup(
  id: string,
  signal?: AbortSignal
): Promise<unknown> {
  return api.post<unknown>(
    `/api/v1/returns/inbound/${encodeURIComponent(id)}/schedule-pickup`,
    undefined,
    signal ? { signal } : undefined
  )
}

export async function inspectInboundReturn(
  id: string,
  inspection: InboundReturnInspection,
  signal?: AbortSignal
): Promise<unknown> {
  return api.post<unknown>(
    `/api/v1/returns/inbound/${encodeURIComponent(id)}/inspect`,
    {
      ...(inspection.status ? { status: inspection.status } : {}),
      ...(inspection.rejectionReason
        ? { rejection_reason: inspection.rejectionReason }
        : {}),
      ...(inspection.inspectorNotes
        ? { inspector_notes: inspection.inspectorNotes }
        : {}),
      items: inspection.items.map((item) => ({
        id: item.id,
        sku: item.sku,
        ...(item.name ? { name: item.name } : {}),
        qty: item.qty,
        ...(item.condition ? { condition: item.condition } : {}),
        disposition: item.disposition,
        ...(item.dispositionNotes
          ? { disposition_notes: item.dispositionNotes }
          : {}),
      })),
    },
    signal ? { signal } : undefined
  )
}

export async function disposeInboundReturn(
  id: string,
  signal?: AbortSignal
): Promise<unknown> {
  return api.post<unknown>(
    `/api/v1/returns/inbound/${encodeURIComponent(id)}/dispose`,
    undefined,
    signal ? { signal } : undefined
  )
}

/* ---------------------------------------------------------------------------
 * Hooks.
 *
 * Every read below is keyed under ["inventory", ...] so a write can invalidate
 * exactly the slice it touched, and two screens asking for the same snapshot
 * share one request instead of racing each other.
 *
 * The writes themselves — submitInventoryCount, scheduleInboundReturnPickup,
 * inspectInboundReturn, disposeInboundReturn, above — are wrapped as
 * `useMutation`s in ./mutations.ts, which is where each one's cache effect is
 * declared. This module stays the read boundary; see docs/frontend-rules.md
 * §M1.
 */

/**
 * The estate-wide snapshot behind the monitor, missing, and ledger tabs.
 *
 * cloud-hub has no per-location balance route this screen can use, so the
 * request closes over nothing and the key carries no scope: the selected
 * location filters the one cached snapshot rather than refetching it.
 */
export function useInventoryData(): InventoryResource {
  return useDomainQuery(inventoryQueries.snapshot())
}

export function useInventoryOperations(
  enabled = true
): InventoryOperationsResource {
  return useDomainQuery({ ...inventoryQueries.operations(), enabled })
}

export function useCycleCountVariance(
  id: string | null
): ApiResource<CycleCountVariance> {
  return useDomainQuery(inventoryQueries.cycleCountVariance(id))
}

export function useInboundReturnDetail(
  id: string | null
): ApiResource<InboundReturnDetail> {
  return useDomainQuery(inventoryQueries.inboundReturn(id))
}

export { EMPTY_SNAPSHOT }

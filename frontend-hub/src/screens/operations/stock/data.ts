import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { weekday, sku as skuNumber } from "@/lib/format"
import { stockFleetQuery } from "@/lib/operations/queries"
import {
  allotmentDetail,
  inventoryKeys,
  listAllotments,
  poolAvailability,
  type AllotmentRow,
  type AvailabilityItem,
  type FleetPool,
} from "@/lib/queries/inventory"
import {
  listPurchaseOrders,
  listSuppliers,
  procurementKeys,
  purchaseReturns,
  unidentifiedReceipts,
} from "@/lib/queries/procurement"
import {
  SETTLE_LABEL,
  supplierReturnKeys,
  supplierReturns,
  type SupplierReturn,
} from "@/lib/queries/supplier-returns"
import { listTerms, vocabularyKeys } from "@/lib/queries/vocabulary"
import { supplierLabel } from "@/screens/procurement/supplier-format"

/// Ops › Stock, as one flat report (stock-options-prototype.html, option A).
///
/// Every number is read off an endpoint another screen already trusts:
///
/// - **On order** — the open purchase orders, outstanding pieces.
/// - **Unidentified** — receipts that arrived with no article set up yet.
/// - **Unallotted** — `WAREHOUSE` pool's on-hand; its divisions come from the
///   pool's availability (each SKU names its division).
/// - **Allotted** — Unpicked is the warehouse pool's allotted figure, split by
///   store from the allotment book's per-destination rollup; Picked, Packed and
///   Dispatch are the outbound leaf pools, each already per destination store.
/// - **Return stock** — the head-office pools that hold what each store sent
///   back (`STORE_REJECT`, kept per store of origin).
/// - **To supplier** — over-delivery from `purchase-returns`, and the returns
///   still at the warehouse from `supplier-returns`.
///
/// Reads the CLOUD, not the DC node (see `screens/operations/index.tsx`).

export type Stage = "unpicked" | "picked" | "packed" | "dispatch"

export const STAGES: readonly Stage[] = [
  "unpicked",
  "picked",
  "packed",
  "dispatch",
]

export const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  unpicked: "Unpicked",
  picked: "Picked",
  packed: "Packed",
  dispatch: "Dispatch",
}

/// What the pools say about one row: how many pieces were seen and when the
/// pool was last counted. Each is null when any pool behind the row has no
/// answer — a missing figure is never drawn as zero.
export interface Figure {
  readonly pcs: number
  readonly seen: number | null
  readonly counted: string | null
}

export interface StoreQty {
  readonly id: string
  readonly name: string
  readonly pcs: number
}

export interface OrderRow {
  readonly id: string
  readonly poNumber: string
  readonly supplier: string
  readonly due: string | null
  readonly pcs: number
}

/// The unidentified receipts of one purchase order: the PO, then its articles.
export interface UnidentifiedPo {
  readonly id: string
  readonly poNumber: string
  /// The order's id, when the order book knows it — what opens its sheet.
  readonly poId: string | null
  readonly supplier: string
  readonly pcs: number
  readonly lines: readonly { id: string; name: string; pcs: number }[]
}

export interface DivisionRow {
  readonly code: string
  readonly name: string
  readonly pcs: number
}

export interface OverDeliveryRow {
  readonly id: string
  readonly poId: string
  readonly poNumber: string
  readonly supplier: string
  readonly pcs: number
}

export interface ReturnRow {
  readonly id: string
  readonly number: string
  readonly supplier: string
  readonly settleBy: string
  readonly pcs: number
  readonly lines: readonly { name: string; code: string; pcs: number }[]
}

/// One article line in a sheet.
export interface ArticleLine {
  readonly key: string
  readonly name: string
  readonly code: string
  readonly pcs: number
  readonly store?: string
}

const NO_DIVISION = "Other"

const isWarehouse = (p: FleetPool) => p.site_kind !== "STORE"

/// A pool that counts: not a rollup, and not the stale Cloud row of a shelf an
/// Edge node now speaks for.
const counts = (p: FleetPool) =>
  !p.is_rollup && p.authority.included_in_fleet_total

const total = (list: readonly { pcs: number }[]) =>
  list.reduce((sum, one) => sum + one.pcs, 0)

function figure(pcs: number, pools: readonly FleetPool[]): Figure {
  const seen =
    pools.length > 0 && pools.every((p) => p.observed !== null)
      ? pools.reduce((sum, p) => sum + (p.observed ?? 0), 0)
      : null
  const dates = pools.map((p) => p.last_counted_at ?? null)
  const counted =
    pools.length > 0 && dates.every((d) => d !== null)
      ? ((dates as string[]).sort()[0] ?? null)
      : null
  return { pcs, seen, counted }
}

function variantName(item: AvailabilityItem): string {
  return [item.article_name, item.colour, item.size]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ")
}

/// The days a card has stood, counted from the allotment's last change.
export function days(iso: string): number {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return 0
  return Math.max(0, Math.floor((Date.now() - at) / 86_400_000))
}

export function due(iso: string | null): string {
  return weekday(iso)
}

/// The allotment book, once, for the whole screen — the same read the
/// allotment screens use.
function useBook() {
  return useQuery({
    queryKey: inventoryKeys.allotmentList("", ""),
    queryFn: ({ signal }) => listAllotments("", "", signal),
  })
}

export function useStock() {
  const pools = useQuery(stockFleetQuery())
  const orders = useQuery({
    queryKey: procurementKeys.orders({
      statuses: ["ACTIVE", "PARTIALLY_RECEIVED"],
    }),
    queryFn: ({ signal }) =>
      listPurchaseOrders(
        { statuses: ["ACTIVE", "PARTIALLY_RECEIVED"] },
        signal
      ),
  })
  const receipts = useQuery({
    queryKey: procurementKeys.unidentified(),
    queryFn: ({ signal }) => unidentifiedReceipts(signal),
  })
  // The whole order book and the supplier book, only to put a PO's id and a
  // supplier's name on a receipt that carries neither. Both are cached by the
  // screens that own them.
  const allOrders = useQuery({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders(undefined, signal),
    staleTime: 5 * 60 * 1000,
  })
  const suppliers = useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
    staleTime: 30 * 60 * 1000,
  })
  const over = useQuery({
    queryKey: procurementKeys.returns(),
    queryFn: ({ signal }) => purchaseReturns(undefined, signal),
  })
  const returned = useQuery({
    queryKey: supplierReturnKeys.list(),
    queryFn: ({ signal }) => supplierReturns(signal),
  })
  const divisions = useQuery({
    queryKey: vocabularyKeys.list("divisions"),
    queryFn: ({ signal }) => listTerms("divisions", signal),
  })
  const book = useBook()

  const fleet = useMemo(
    () => (pools.data?.items ?? []).filter(counts),
    [pools.data]
  )

  const warehouse = useMemo(
    () => fleet.filter((p) => isWarehouse(p) && p.pool_code === "WAREHOUSE"),
    [fleet]
  )
  const warehouseId = warehouse[0]?.id ?? ""
  const avail = useQuery({
    queryKey: inventoryKeys.poolAvailability(warehouseId),
    queryFn: ({ signal }) => poolAvailability(warehouseId, {}, signal),
    enabled: warehouseId !== "",
  })

  // A store's name is on its own pools; the outbound leaves sit at the warehouse
  // and only carry the store's id.
  const siteName = useMemo(() => {
    const names = new Map<string, string>()
    for (const p of pools.data?.items ?? [])
      if (p.site_name) names.set(p.site_id, p.site_name)
    return names
  }, [pools.data])
  const storeName = (id: string) => siteName.get(id) ?? id

  return useMemo(() => {
    // ── On order ──────────────────────────────────────────────────────────
    const onOrder: OrderRow[] = (orders.data ?? [])
      .filter((o) => o.outstanding_stock_units > 0)
      .map((o) => ({
        id: o.purchase_order_id,
        poNumber: o.po_number,
        supplier: supplierLabel(
          suppliers.data ?? [],
          o.supplier_id,
          o.supplier_name
        ),
        due: o.expected_arrival,
        pcs: o.outstanding_stock_units,
      }))
      .sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"))

    // ── Unidentified ──────────────────────────────────────────────────────
    const orderOf = new Map(
      (allOrders.data ?? []).map((o) => [o.po_number, o] as const)
    )
    const supplierOf = (code: string) =>
      supplierLabel(
        suppliers.data ?? [],
        (suppliers.data ?? []).find(
          (one) => one.supplier_code.toLowerCase() === code.toLowerCase()
        )?.supplier_code ?? code,
        code
      )
    const byReceiptPo = new Map<
      string,
      {
        id: string
        poNumber: string
        poId: string | null
        supplier: string
        pcs: number
        lines: { id: string; name: string; pcs: number }[]
      }
    >()
    for (const r of receipts.data ?? []) {
      const order = orderOf.get(r.po_number)
      const group = byReceiptPo.get(r.po_number) ?? {
        id: r.po_number,
        poNumber: r.po_number,
        poId: order?.purchase_order_id ?? null,
        supplier: order
          ? supplierLabel(
              suppliers.data ?? [],
              order.supplier_id,
              order.supplier_name
            )
          : supplierOf(r.supplier_id),
        pcs: 0,
        lines: [],
      }
      group.pcs += r.quantity
      group.lines.push({
        id: r.receipt_line_id,
        name: r.article_name,
        pcs: r.quantity,
      })
      byReceiptPo.set(r.po_number, group)
    }
    const unidentified: UnidentifiedPo[] = [...byReceiptPo.values()]
    const unidentifiedPools = fleet.filter(
      (p) => isWarehouse(p) && p.pool_code === "UNIDENTIFIED"
    )

    // ── Unallotted ────────────────────────────────────────────────────────
    const names = new Map(
      (divisions.data?.terms ?? []).map((t) => [t.code, t.label])
    )
    const stocked = (avail.data?.items ?? []).filter((i) => i.on_hand_qty > 0)
    const byDivision = new Map<string, DivisionRow>()
    const unallottedLines = new Map<string, ArticleLine[]>()
    for (const item of stocked) {
      const code = item.division_code ?? ""
      const prev = byDivision.get(code)
      byDivision.set(code, {
        code,
        name: code === "" ? NO_DIVISION : (names.get(code) ?? code),
        pcs: (prev?.pcs ?? 0) + item.on_hand_qty,
      })
      const list = unallottedLines.get(code) ?? []
      list.push({
        key: item.sku_id,
        name: variantName(item),
        code: item.sku_code,
        pcs: item.on_hand_qty,
      })
      unallottedLines.set(code, list)
    }
    const unallotted = {
      figure: figure(
        warehouse.reduce((sum, p) => sum + p.on_hand, 0),
        warehouse
      ),
      divisions: [...byDivision.values()].sort((a, b) => b.pcs - a.pcs),
      lines: unallottedLines,
    }

    // ── Allotted ──────────────────────────────────────────────────────────
    const leaves = fleet.filter(
      (p) => isWarehouse(p) && p.destination_store_id !== null
    )
    const leafStage = (codes: readonly string[]) =>
      leaves.filter((p) => codes.includes(p.pool_code))
    const perStore = (list: readonly FleetPool[]): StoreQty[] => {
      const by = new Map<string, number>()
      for (const p of list)
        by.set(
          p.destination_store_id!,
          (by.get(p.destination_store_id!) ?? 0) + p.on_hand
        )
      return [...by.entries()]
        .map(([id, pcs]) => ({ id, name: storeName(id), pcs }))
        .filter((s) => s.pcs > 0)
        .sort((a, b) => a.name.localeCompare(b.name))
    }
    const pickedPools = leafStage(["PICKED"])
    // Pieces picked off the shelf and standing in the pick area, not yet
    // packed for a store: pool role PICKING, no store of its own.
    const pickAreaPools = fleet.filter(
      (p) => isWarehouse(p) && p.pool_code === "PICKING"
    )
    const pickArea = {
      figure: figure(
        pickAreaPools.reduce((sum, p) => sum + p.on_hand, 0),
        pickAreaPools
      ),
      pools: pickAreaPools.map((p) => ({ id: p.id, name: p.label })),
    }
    const packedPools = leafStage(["PACKED"])
    const dispatchPools = leafStage(["SHIPMENT", "LOADED", "IN_TRANSIT"])
    const unpickedStores: StoreQty[] = (book.data?.by_destination ?? [])
      .filter((d) => d.destination_type === "STORE")
      .map((d) => ({
        id: d.destination_id,
        name: d.destination_name ?? storeName(d.destination_id),
        pcs: d.remaining_quantity,
      }))
      .filter((s) => s.pcs > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
    const stages: Record<Stage, { figure: Figure; stores: StoreQty[] }> = {
      unpicked: {
        // Allotted to a store and not yet picked: the warehouse pool's own
        // allotted figure; no pool of its own to count or see.
        figure: {
          pcs: warehouse.reduce((sum, p) => sum + (p.allotted ?? 0), 0),
          seen: null,
          counted: null,
        },
        stores: unpickedStores,
      },
      picked: {
        figure: figure(total(perStore(pickedPools)) + pickArea.figure.pcs, [
          ...pickedPools,
          ...pickAreaPools,
        ]),
        stores: perStore(pickedPools),
      },
      packed: {
        figure: figure(total(perStore(packedPools)), packedPools),
        stores: perStore(packedPools),
      },
      dispatch: {
        figure: figure(total(perStore(dispatchPools)), dispatchPools),
        stores: perStore(dispatchPools),
      },
    }
    const allotted = STAGES.reduce((sum, s) => sum + stages[s].figure.pcs, 0)

    // ── Return stock ──────────────────────────────────────────────────────
    const returnPools = fleet.filter(
      (p) =>
        isWarehouse(p) &&
        (p.pool_code === "STORE_REJECT" || p.pool_code === "RETURN")
    )
    const returnByStore = new Map<
      string,
      { name: string; pcs: number; poolIds: string[] }
    >()
    for (const p of returnPools) {
      const origin = p.store_origin_site_id ?? p.destination_store_id ?? p.id
      const prev = returnByStore.get(origin)
      returnByStore.set(origin, {
        name: siteName.get(origin) ?? p.label,
        pcs: (prev?.pcs ?? 0) + p.on_hand,
        poolIds: [...(prev?.poolIds ?? []), p.id],
      })
    }
    const returnStock = {
      figure: figure(
        returnPools.reduce((sum, p) => sum + p.on_hand, 0),
        returnPools
      ),
      stores: [...returnByStore.entries()]
        .map(([id, v]) => ({ id, ...v }))
        .filter((s) => s.pcs > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }

    // ── To supplier ───────────────────────────────────────────────────────
    const byPo = new Map<string, OverDeliveryRow>()
    for (const r of (over.data ?? []).filter((x) => x.status === "OPEN")) {
      const prev = byPo.get(r.purchase_order_id)
      byPo.set(r.purchase_order_id, {
        id: r.purchase_order_id,
        poId: r.purchase_order_id,
        poNumber: r.po_number,
        supplier: supplierLabel(
          suppliers.data ?? [],
          r.supplier_id,
          r.supplier_name
        ),
        pcs: (prev?.pcs ?? 0) + r.quantity,
      })
    }
    const overDelivery = [...byPo.values()]
    const returns: ReturnRow[] = (returned.data ?? [])
      .filter((r: SupplierReturn) => r.status === "TO_HAND_OVER")
      .map((r) => ({
        id: r.allotment_id,
        number: r.allotment_number,
        supplier: supplierLabel(
          suppliers.data ?? [],
          r.supplier_id,
          r.supplier_name
        ),
        settleBy: SETTLE_LABEL[r.settle_by],
        pcs: r.quantity,
        lines: r.lines.map((l) => ({
          name: l.article_name ?? skuNumber(l.sku_code),
          code: l.sku_code,
          pcs: l.quantity,
        })),
      }))

    const unidentifiedPcs = total(unidentified)
    const toSupplier = total(overDelivery) + total(returns)
    return {
      onOrder: { pcs: total(onOrder), rows: onOrder },
      unidentified: {
        figure: figure(unidentifiedPcs, unidentifiedPools),
        rows: unidentified,
      },
      unallotted,
      stages,
      pickArea,
      allotted,
      returnStock,
      overDelivery: { pcs: total(overDelivery), rows: overDelivery },
      returns: { pcs: total(returns), rows: returns },
      toSupplier,
      // The warehouse: everything in the building. On order has not arrived and
      // Missing has left the pools, so neither is in it.
      gudang:
        unidentifiedPcs +
        unallotted.figure.pcs +
        allotted +
        returnStock.figure.pcs +
        toSupplier,
    }
    // storeName reads siteName, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    orders.data,
    receipts.data,
    allOrders.data,
    suppliers.data,
    over.data,
    returned.data,
    divisions.data,
    avail.data,
    book.data,
    fleet,
    warehouse,
    siteName,
  ])
}

export type StockData = ReturnType<typeof useStock>

/// The fleet read gates the screen: nothing in the table can be drawn without
/// it, and every other read degrades to an empty section.
export function useStockStatus() {
  const pools = useQuery(stockFleetQuery())
  return {
    pending: pools.isPending,
    error: pools.isError ? pools.error : null,
    retry: () => void pools.refetch(),
  }
}

// ---------------------------------------------------------------------------
// Sheets: read only when one is open.
// ---------------------------------------------------------------------------

/// The articles in one or more pools, per store of origin.
export function usePoolLines(
  pools: readonly { id: string; name: string }[],
  enabled: boolean
) {
  const reads = useQueries({
    queries: pools.map((pool) => ({
      queryKey: inventoryKeys.poolAvailability(pool.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        poolAvailability(pool.id, {}, signal),
      enabled,
    })),
  })
  const lines: ArticleLine[] = []
  reads.forEach((read, at) => {
    for (const item of read.data?.items ?? [])
      if (item.on_hand_qty > 0)
        lines.push({
          key: pools[at]!.id + item.sku_id,
          name: variantName(item),
          code: item.sku_code,
          pcs: item.on_hand_qty,
          store: pools[at]!.name,
        })
  })
  return { lines, pending: reads.some((r) => r.isPending) && enabled }
}

/// One card on the outbound board's terms: an allotment's pieces for one
/// store, at one stage.
export interface OutboundCard {
  readonly key: string
  readonly stage: Stage
  readonly storeId: string
  readonly storeName: string
  readonly doc: string
  readonly pcs: number
  readonly days: number
}

const live = (row: AllotmentRow) =>
  row.type === "TO_STORE" &&
  row.fulfillment_status === "ACTIVE" &&
  row.remaining_quantity +
    row.to_pack_qty +
    row.at_packed_qty +
    row.at_shipment_qty +
    row.at_loaded_qty +
    row.at_in_transit_qty >
    0

/// The cards behind Allotted, from the allotment book: each live allotment is
/// opened (once, cached) and split by store and stage. The DC's own board is a
/// node read and this screen is not gated on the node, so the stage a card
/// stands at is the allotment's own stage reading, and its age is counted from
/// the allotment's last change.
export function useOutboundCards(enabled: boolean) {
  const book = useBook()
  const pools = useQuery(stockFleetQuery())
  const rows = useMemo(
    () => (enabled ? (book.data?.items ?? []).filter(live) : []),
    [enabled, book.data]
  )
  const details = useQueries({
    queries: rows.map((row) => ({
      queryKey: inventoryKeys.allotment(row.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        allotmentDetail(row.id, signal),
      staleTime: 30_000,
    })),
  })

  const cards = useMemo(() => {
    const names = new Map<string, string>()
    for (const p of pools.data?.items ?? [])
      if (p.site_name) names.set(p.site_id, p.site_name)
    const out: OutboundCard[] = []
    for (const detail of details.map((d) => d.data)) {
      if (!detail) continue
      const by = new Map<string, OutboundCard>()
      for (const line of detail.lines) {
        if (line.destination_type !== "STORE") continue
        const stages: Record<Stage, number> = {
          unpicked: line.remaining_allotted,
          picked: line.to_pack_qty,
          packed: line.at_packed_qty,
          dispatch:
            line.at_shipment_qty + line.at_loaded_qty + line.at_in_transit_qty,
        }
        for (const stage of STAGES) {
          if (stages[stage] <= 0) continue
          const key = `${detail.id}:${line.destination_id}:${stage}`
          const prev = by.get(key)
          by.set(key, {
            key,
            stage,
            storeId: line.destination_id,
            storeName:
              line.destination_name ??
              names.get(line.destination_id) ??
              line.destination_id,
            doc: detail.allotment_number,
            pcs: (prev?.pcs ?? 0) + stages[stage],
            days: days(detail.updated_at),
          })
        }
      }
      out.push(...by.values())
    }
    return out.sort((a, b) => b.days - a.days)
  }, [details, pools.data])

  return {
    cards,
    pending: enabled && (book.isPending || details.some((d) => d.isPending)),
  }
}

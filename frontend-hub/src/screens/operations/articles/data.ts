import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import {
  fleetPools,
  inventoryKeys,
  poolAvailability,
  type FleetPool,
} from "@/lib/queries/inventory"
import {
  listPurchaseOrders,
  procurementKeys,
  purchaseOrderDetail,
  purchaseReturns,
  unidentifiedReceipts,
} from "@/lib/queries/procurement"
import {
  supplierReturnKeys,
  supplierReturns,
} from "@/lib/queries/supplier-returns"
import { SHOW_MISSING } from "@/lib/features"
import { useMissingRows } from "@/screens/inventory/missing-data"
import { sku as skuNumber } from "@/lib/format"

/// Ops › Stock by article: every pool of Ops › Stock, read per SKU and folded
/// to one row per article.
///
/// The pool figures come from the same places `operations/stock/data.ts` reads
/// (that file is another hand's, so this one is read-only to it):
///
/// - **Unallotted / Unpicked** — the warehouse's `WAREHOUSE` pool, per SKU: what is
///   on hand beyond the promises, and the promised (allotted) figure.
/// - **Picked / Packed / Dispatch** — the outbound leaf pools, one per store.
/// - **Return stock** — the `STORE_REJECT` pools at the warehouse, per store of
///   origin.
/// - **To supplier** — open over-delivery returns and the supplier returns
///   still to hand over.
/// - **On order** — outstanding pieces on the lines of every open order.
/// - **Unidentified** — receipts that arrived with no article set up.
/// - **Missing** — the missing rows, by SKU.
///
/// A pool is read with `held`, so a leaf answers a few dozen rows rather than
/// the whole catalogue.

export type Col =
  | "order"
  | "unid"
  | "unal"
  | "unpicked"
  | "picked"
  | "packed"
  | "dispatch"
  | "retst"
  | "sup"
  | "total"
  | "missing"

/// Left to right, in the order the goods travel.
export const COLS: readonly { id: Col; label: string }[] = [
  { id: "order", label: "On order" },
  { id: "unid", label: "Unidentified" },
  { id: "unal", label: "Unallotted" },
  { id: "unpicked", label: "Unpicked" },
  { id: "picked", label: "Picked" },
  { id: "packed", label: "Packed" },
  { id: "dispatch", label: "Dispatch" },
  { id: "retst", label: "Return stock" },
  { id: "sup", label: "To supplier" },
  { id: "total", label: "Total" },
  // Hidden for now (SHOW_MISSING).
  ...(SHOW_MISSING ? [{ id: "missing" as const, label: "Missing" }] : []),
]

type PoolCol = Exclude<Col, "total">

/// What the Total adds up: everything in the building. On order has not
/// arrived and Missing has left the pools, so neither is in it.
const BUILDING: readonly PoolCol[] = [
  "unid",
  "unal",
  "unpicked",
  "picked",
  "packed",
  "dispatch",
  "retst",
  "sup",
]

/// One line of "where is it": a pool, the store or order it is at, the pieces.
export interface Place {
  readonly col: PoolCol
  readonly where: string
  /// The SKU (or the supplier's / order's article code) the pieces are of.
  readonly sku: string
  readonly pcs: number
  /// The order the pieces are on, when they are on one.
  readonly po: { readonly id: string | null; readonly number: string } | null
}

export interface ArticleRow {
  readonly key: string
  readonly name: string
  readonly code: string
  /// What the second line says: the SKU, or the code and how many SKUs.
  readonly second: string
  readonly v: Readonly<Record<Col, number>>
  readonly places: readonly Place[]
  /// Lower-cased name, codes, SKUs and order numbers — what a search reads.
  readonly haystack: string
}

const isWarehouse = (p: FleetPool) => p.site_kind !== "STORE"

/// A pool that counts: not a rollup, and not the stale Cloud row of a shelf an
/// Edge node now speaks for.
const counts = (p: FleetPool) =>
  !p.is_rollup && p.authority.included_in_fleet_total

/// A pool to read, and what it makes of what it holds.
interface Source {
  readonly pool: FleetPool
  readonly kind: "warehouse" | "picked" | "packed" | "dispatch" | "retst"
  readonly where: string
}

interface Draft {
  key: string
  name: string
  code: string
  skus: Set<string>
  pos: Set<string>
  extra: Set<string>
  v: Record<Col, number>
  places: Map<string, Place>
}

const blank = (): Record<Col, number> => ({
  order: 0,
  unid: 0,
  unal: 0,
  unpicked: 0,
  picked: 0,
  packed: 0,
  dispatch: 0,
  retst: 0,
  sup: 0,
  total: 0,
  missing: 0,
})

export function useArticles() {
  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })
  const open = useQuery({
    queryKey: procurementKeys.orders({
      statuses: ["ACTIVE", "PARTIALLY_RECEIVED"],
    }),
    queryFn: ({ signal }) =>
      listPurchaseOrders(
        { statuses: ["ACTIVE", "PARTIALLY_RECEIVED"] },
        signal
      ),
  })
  // The whole order book, only to put a number on an order id and an id on a
  // number. Cached by the screens that own it.
  const book = useQuery({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders(undefined, signal),
    staleTime: 5 * 60 * 1000,
  })
  const receipts = useQuery({
    queryKey: procurementKeys.unidentified(),
    queryFn: ({ signal }) => unidentifiedReceipts(signal),
  })
  const over = useQuery({
    queryKey: procurementKeys.returns(),
    queryFn: ({ signal }) => purchaseReturns(undefined, signal),
  })
  const returned = useQuery({
    queryKey: supplierReturnKeys.list(),
    queryFn: ({ signal }) => supplierReturns(signal),
  })
  const missing = useMissingRows()

  const siteName = useMemo(() => {
    const names = new Map<string, string>()
    for (const p of fleet.data?.items ?? [])
      if (p.site_name) names.set(p.site_id, p.site_name)
    return names
  }, [fleet.data])

  // The pools worth reading: the warehouse's shelf, and every leaf or reject pool
  // that holds anything.
  const sources = useMemo<Source[]>(() => {
    const out: Source[] = []
    const storeOf = (id: string) => siteName.get(id) ?? id
    for (const p of (fleet.data?.items ?? []).filter(counts)) {
      if (!isWarehouse(p)) continue
      if (p.pool_code === "WAREHOUSE") {
        out.push({
          pool: p,
          kind: "warehouse",
          where: p.site_name ?? p.label,
        })
        continue
      }
      if (p.stock + p.on_hand <= 0) continue
      if (p.pool_code === "STORE_REJECT" || p.pool_code === "RETURN") {
        const origin = p.store_origin_site_id ?? p.destination_store_id
        out.push({
          pool: p,
          kind: "retst",
          where: origin ? storeOf(origin) : p.label,
        })
        continue
      }
      if (p.destination_store_id === null) continue
      const where = storeOf(p.destination_store_id)
      if (p.pool_code === "PICKED") out.push({ pool: p, kind: "picked", where })
      else if (p.pool_code === "PACKED")
        out.push({ pool: p, kind: "packed", where })
      else if (["SHIPMENT", "LOADED", "IN_TRANSIT"].includes(p.pool_code))
        out.push({ pool: p, kind: "dispatch", where })
    }
    return out
  }, [fleet.data, siteName])

  const shelves = useQueries({
    queries: sources.map((s) => ({
      queryKey: inventoryKeys.poolAvailability(s.pool.id, true),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        poolAvailability(s.pool.id, { held: true }, signal),
    })),
  })

  // Every open order, opened once: its lines carry the article.
  const openIds = useMemo(
    () =>
      (open.data ?? [])
        .filter((o) => o.outstanding_stock_units > 0)
        .map((o) => o.purchase_order_id),
    [open.data]
  )
  const details = useQueries({
    queries: openIds.map((id) => ({
      queryKey: procurementKeys.order(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        purchaseOrderDetail(id, signal),
      staleTime: 30_000,
    })),
  })

  const reads = [fleet, open, book, receipts, over, returned, ...shelves]
  const pending =
    reads.some((r) => r.isPending) ||
    details.some((d) => d.isPending) ||
    (SHOW_MISSING && missing.query.isPending)
  const failed =
    reads.some((r) => r.isError) ||
    details.some((d) => d.isError) ||
    (SHOW_MISSING && missing.query.isError)

  // `useQueries` answers a new array every render; what changed is when each
  // read last landed.
  const shelfStamp = shelves.map((s) => s.dataUpdatedAt).join()
  const detailStamp = details.map((d) => d.dataUpdatedAt).join()

  const rows = useMemo<ArticleRow[]>(() => {
    const drafts = new Map<string, Draft>()
    const byId = new Map<string, string>()
    const bySku = new Map<string, string>()
    const byCode = new Map<string, string>()

    // The catalogue as the pools know it: article ids, SKUs, codes.
    for (const shelf of shelves)
      for (const item of shelf.data?.items ?? []) {
        byId.set(item.article_id, item.article_id)
        bySku.set(item.sku_code, item.article_id)
        byCode.set(item.article_code, item.article_id)
      }

    const poNumber = new Map(
      (book.data ?? []).map((o) => [o.purchase_order_id, o.po_number] as const)
    )
    const poId = new Map(
      (book.data ?? []).map((o) => [o.po_number, o.purchase_order_id] as const)
    )

    const draft = (key: string, name: string, code: string): Draft => {
      const had = drafts.get(key)
      if (had) return had
      const made: Draft = {
        key,
        name,
        code,
        skus: new Set(),
        pos: new Set(),
        extra: new Set(),
        v: blank(),
        places: new Map(),
      }
      drafts.set(key, made)
      return made
    }
    /// An article known to the pools by id, or by SKU or code; otherwise a row
    /// of its own, keyed by what it was called.
    const resolve = (
      name: string,
      parts: { id?: string; sku?: string; code?: string }
    ): Draft => {
      const known =
        (parts.id !== undefined ? byId.get(parts.id) : undefined) ??
        (parts.sku !== undefined ? bySku.get(parts.sku) : undefined) ??
        (parts.code !== undefined ? byCode.get(parts.code) : undefined)
      if (known !== undefined) return draft(known, name, parts.code ?? "")
      const own = parts.code ?? parts.sku ?? name
      return draft(
        `c:${own}`,
        name,
        parts.code ?? (parts.sku !== undefined ? skuNumber(parts.sku) : name)
      )
    }
    const put = (
      a: Draft,
      col: PoolCol,
      pcs: number,
      where: string,
      sku: string,
      po: Place["po"] = null
    ) => {
      if (pcs <= 0) return
      a.v[col] += pcs
      if (sku !== "") a.skus.add(sku)
      if (po) a.pos.add(po.number)
      const key = `${col}|${where}|${sku}|${po?.number ?? ""}`
      const had = a.places.get(key)
      a.places.set(key, {
        col,
        where,
        sku,
        po,
        pcs: (had?.pcs ?? 0) + pcs,
      })
    }

    // ── The pools, per SKU ────────────────────────────────────────────────
    shelves.forEach((shelf, at) => {
      const source = sources[at]
      if (!source) return
      for (const item of shelf.data?.items ?? []) {
        const held =
          source.kind === "warehouse"
            ? item.on_hand_qty > 0 || item.allotted_qty > 0
            : item.on_hand_qty > 0
        if (!held) continue
        const a = resolve(item.article_name, {
          id: item.article_id,
          sku: item.sku_code,
          code: item.article_code,
        })
        a.name = item.article_name
        a.code = item.article_code
        for (const id of item.purchase_order_ids) {
          const number = poNumber.get(id)
          if (number) a.pos.add(number)
        }
        if (source.kind === "warehouse") {
          put(a, "unal", item.on_hand_qty, source.where, item.sku_code)
          put(a, "unpicked", item.allotted_qty, source.where, item.sku_code)
        } else {
          const col: PoolCol =
            source.kind === "picked"
              ? "picked"
              : source.kind === "packed"
                ? "packed"
                : source.kind === "dispatch"
                  ? "dispatch"
                  : "retst"
          put(a, col, item.on_hand_qty, source.where, item.sku_code)
        }
      }
    })

    // ── On order ──────────────────────────────────────────────────────────
    for (const detail of details.map((d) => d.data)) {
      if (!detail) continue
      for (const line of detail.lines) {
        if (line.outstanding_stock_units <= 0) continue
        const a = resolve(line.article_name, { code: line.article_code })
        put(
          a,
          "order",
          line.outstanding_stock_units,
          detail.po_number,
          line.article_code,
          { id: detail.purchase_order_id, number: detail.po_number }
        )
      }
    }

    // ── Unidentified ──────────────────────────────────────────────────────
    for (const r of receipts.data ?? []) {
      const a = resolve(r.article_name, { code: r.supplier_article_code })
      put(a, "unid", r.quantity, r.po_number, r.supplier_article_code, {
        id: poId.get(r.po_number) ?? null,
        number: r.po_number,
      })
    }

    // ── To supplier ───────────────────────────────────────────────────────
    for (const r of (over.data ?? []).filter((x) => x.status === "OPEN"))
      for (const line of r.lines) {
        const a = resolve(line.article_name, { code: line.article_code })
        put(a, "sup", line.quantity, r.return_number, line.article_code, {
          id: r.purchase_order_id,
          number: r.po_number,
        })
      }
    for (const r of (returned.data ?? []).filter(
      (x) => x.status === "TO_HAND_OVER"
    ))
      for (const line of r.lines) {
        const a = resolve(line.article_name ?? line.sku_code, {
          sku: line.sku_code,
          code: line.article_code,
        })
        put(a, "sup", line.quantity, r.allotment_number, line.sku_code)
      }

    // ── Missing ───────────────────────────────────────────────────────────
    for (const row of missing.rows) {
      if (row.quantity <= 0) continue
      const sku = row.sku_code ?? row.epc ?? row.subject_id
      const a = resolve(row.article_name ?? sku, {
        sku: row.sku_code ?? undefined,
      })
      put(a, "missing", row.quantity, row.pool_label, sku)
    }

    const out: ArticleRow[] = []
    for (const a of drafts.values()) {
      const v = a.v
      v.total = BUILDING.reduce((sum, col) => sum + v[col], 0)
      const skus = [...a.skus]
      const second =
        skus.length === 1
          ? skus[0]!
          : skus.length > 1
            ? `${a.code} · ${skus.length} SKUs`
            : a.code
      out.push({
        key: a.key,
        name: a.name,
        code: a.code,
        second,
        v,
        places: [...a.places.values()],
        haystack: [a.name, a.code, ...skus, ...a.pos].join("\n").toLowerCase(),
      })
    }
    return out.sort(
      (x, y) => y.v.total - x.v.total || x.name.localeCompare(y.name)
    )
    // `shelves` and `details` are new arrays on every render; their data is
    // what the figures are made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sources,
    book.data,
    receipts.data,
    over.data,
    returned.data,
    missing.rows,
    shelfStamp,
    detailStamp,
  ])

  return {
    rows,
    pending,
    failed,
    fleetError: fleet.isError ? fleet.error : null,
    retry: () => void fleet.refetch(),
  }
}

import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Input, Select } from "@/components/ui/field"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { SHOW_MISSING } from "@/lib/features"
import { count, time, weekday } from "@/lib/format"
import {
  articleHistory,
  fleetPools,
  inventoryKeys,
} from "@/lib/queries/inventory"
import { cn } from "@/lib/utils"
import type { ArticleRow } from "@/screens/operations/articles/data"
import type { ArticleHistoryEvent } from "@itulah/contract"

/// The History of one article, newest first, grouped by day.
///
/// One source, read only when the dialog is open:
/// `GET /inventory/articles/{code}/history` — the order, the allotments and
/// every movement of the article's SKUs, whole, already grouped per movement
/// group and leg. A movement is named from its cause and the pools either side
/// of it; a movement that carries an order number is a goods receipt.

type Stage =
  | "ordered"
  | "received"
  | "tagged"
  | "allotted"
  | "picked"
  | "packed"
  | "dispatched"
  | "store"
  | "sold"
  | "returned"
  | "missing"
  | "found"
  | "off"
  | "other"

/// One dot per stage, in tokens.
const DOT: Record<Stage, string> = {
  ordered: "bg-faint",
  received: "bg-ok-fg",
  tagged: "bg-ok-fg",
  allotted: "bg-accent",
  picked: "bg-accent",
  packed: "bg-accent",
  dispatched: "bg-info",
  store: "bg-info",
  sold: "bg-ink",
  returned: "bg-mute",
  missing: "bg-warn-fg",
  found: "bg-ok-fg",
  off: "bg-bad-fg",
  other: "bg-faint",
}

interface Doc {
  readonly label: string
  readonly to?: string
  readonly sheet?: { key: "order" | "allotment" | "count"; value: string }
}

interface Entry {
  readonly key: string
  readonly at: string
  readonly stage: Stage
  readonly event: string
  readonly qty: number
  readonly doc: Doc | null
  readonly where: string
  /// The shop it concerns, for the filter.
  readonly store: string | null
  readonly epcs: readonly string[]
}

const poolOf = (placeId: string) => placeId.split(":")[0] ?? placeId
const stateOf = (placeId: string) => placeId.split(":")[1] ?? ""

/// What a movement is called, read from its cause and where it went.
function name(ev: ArticleHistoryEvent): {
  stage: Stage
  event: string
} | null {
  const cause = String(ev.cause ?? "").toUpperCase()
  const from = ev.from ?? ""
  const dest = ev.to ?? ""
  const to = poolOf(dest)
  switch (cause) {
    case "HANDED_OVER":
      return null
    case "IDENTIFICATION":
      return { stage: "received", event: "Identified" }
    case "TAGGING":
      return { stage: "tagged", event: "Tagged" }
    case "SALE":
      return { stage: "sold", event: "Sold" }
    case "CUSTOMER_RETURN":
      return { stage: "returned", event: "Customer return" }
    case "RETURN_TO_WAREHOUSE":
    case "RETURN_TO_DC":
      return { stage: "returned", event: "Returned to warehouse" }
    case "SUPPLIER_RETURN":
      return { stage: "returned", event: "Returned to supplier" }
    case "STORE_RECEIVE":
      return { stage: "store", event: "Received at store" }
    case "COUNT_SHORTAGE":
      return SHOW_MISSING ? { stage: "missing", event: "Missing" } : null
    case "FOUND":
      return { stage: "found", event: "Found" }
    case "CONFIRMED_LOST":
    case "DISPOSAL":
      return { stage: "off", event: "Written off" }
    case "COUNT_GAIN":
      return { stage: "found", event: "Count gain" }
    case "OPENING":
      return { stage: "received", event: "Opening stock" }
    case "PLACEMENT_CORRECTION":
      return { stage: "other", event: "Corrected" }
  }
  if (stateOf(dest) === "missing")
    return SHOW_MISSING ? { stage: "missing", event: "Missing" } : null
  if (from.startsWith("external/supplier"))
    return { stage: "received", event: "Received" }
  if (to.includes(".pending.")) return { stage: "received", event: "Received" }
  if (to.includes(".outbound.picking") || to.includes(".outbound.picked"))
    return { stage: "picked", event: "Picked" }
  if (to.includes(".outbound.packed"))
    return { stage: "packed", event: "Packed" }
  if (to.includes(".outbound.in-transit") || to.endsWith(".in_transit"))
    return { stage: "dispatched", event: "Dispatched" }
  if (to.includes(".outbound.shipment") || to.includes(".outbound.loaded"))
    return { stage: "dispatched", event: "Loaded" }
  if (to.endsWith(".floor") && poolOf(from).includes(".outbound."))
    return { stage: "store", event: "Received at store" }
  return { stage: "other", event: "Moved" }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i

/// The document an event hangs on: a link where a sheet exists for it,
/// otherwise nothing rather than a bare uuid.
function docOf(ev: ArticleHistoryEvent): Doc | null {
  if (ev.po_number && ev.purchase_order_id)
    return {
      label: ev.po_number,
      to: "/procurement/orders",
      sheet: { key: "order", value: ev.purchase_order_id },
    }
  if (ev.allotment_id)
    return {
      label: ev.allotment_number ?? "Allotment",
      to: "/inventory/allotments",
      sheet: { key: "allotment", value: ev.allotment_id },
    }
  if (ev.reference_type === "OFFICIAL_COUNT" && ev.reference_id)
    return {
      label: "Count",
      to: "/inventory/counts",
      sheet: { key: "count", value: ev.reference_id },
    }
  if (ev.reference_id && !UUID.test(ev.reference_id))
    return { label: ev.reference_id }
  return null
}

const hhmm = time
const dayKey = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
const dayHead = (iso: string) => weekday(iso)

export function History({ row }: { row: ArticleRow }) {
  const [store, setStore] = useState("")
  const [epc, setEpc] = useState("")

  const history = useQuery({
    queryKey: inventoryKeys.articleHistory(row.code),
    queryFn: ({ signal }) => articleHistory(row.code, signal),
    enabled: row.code !== "",
    staleTime: 30_000,
  })
  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const places = useMemo(() => {
    const names = new Map<string, string>()
    const pools = new Map<string, { where: string; store: string | null }>()
    for (const p of fleet.data?.items ?? [])
      if (p.site_name) names.set(p.site_id, p.site_name)
    for (const p of fleet.data?.items ?? []) {
      const shop =
        p.destination_store_id ?? (p.site_kind === "STORE" ? p.site_id : null)
      pools.set(p.id, {
        where: shop ? (names.get(shop) ?? shop) : (p.site_name ?? p.label),
        store: shop,
      })
    }
    return {
      names,
      of: (placeId: string) => {
        const id = poolOf(placeId)
        const hit = pools.get(id)
        if (hit) return hit
        const [site] = id.split(".")
        return { where: site ?? id, store: null }
      },
    }
  }, [fleet.data])

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = []
    ;(history.data?.events ?? []).forEach((ev, i) => {
      const base = {
        key: `${i}:${ev.at}`,
        at: ev.at,
        qty: ev.quantity,
        epcs: ev.epcs,
      }
      if (ev.kind === "ORDERED") {
        out.push({
          ...base,
          stage: "ordered",
          event: "Ordered",
          doc: docOf(ev),
          where: "",
          store: null,
        })
        return
      }
      if (ev.kind === "ALLOTTED" || ev.kind === "ALLOTMENT_CANCELLED") {
        const shop = ev.destination_id
        const shopName = shop ? (places.names.get(shop) ?? shop) : ""
        out.push({
          ...base,
          stage: "allotted",
          event:
            ev.kind === "ALLOTTED"
              ? shopName
                ? `Allotted → ${shopName}`
                : "Allotted"
              : "Allotment cancelled",
          doc: docOf(ev),
          where: "",
          store: shop,
        })
        return
      }
      const named = ev.po_number
        ? { stage: "received" as const, event: "Received" }
        : name(ev)
      if (named === null) return
      const from = ev.from ?? ""
      const to = ev.to ?? ""
      const at = named.stage === "sold" ? places.of(from) : places.of(to)
      out.push({
        ...base,
        stage: named.stage,
        event: named.event,
        doc: docOf(ev),
        where: at.where,
        store: ev.destination_id ?? at.store ?? places.of(from).store,
      })
    })
    return out
  }, [history.data, places])

  const stores = useMemo(() => {
    const seen = new Set<string>()
    for (const e of entries) if (e.store) seen.add(e.store)
    return [...seen]
      .map((id) => ({ id, name: places.names.get(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [entries, places])

  const hasEpc = entries.some((e) => e.epcs.length > 0)
  const typed = epc.trim().toLowerCase()

  const days = useMemo(() => {
    const filtered = entries
      .filter(
        (e) =>
          (store === "" || e.store === store) &&
          (typed === "" || e.epcs.some((x) => x.toLowerCase().includes(typed)))
      )
      .sort((a, b) => b.at.localeCompare(a.at))
    // The same thing done to the same document in the same minute is one line.
    const merged: Entry[] = []
    for (const e of filtered) {
      const last = merged[merged.length - 1]
      if (
        last &&
        last.event === e.event &&
        last.where === e.where &&
        last.doc?.label === e.doc?.label &&
        last.at.slice(0, 16) === e.at.slice(0, 16)
      )
        merged[merged.length - 1] = {
          ...last,
          qty: last.qty + e.qty,
          epcs: [...last.epcs, ...e.epcs],
        }
      else merged.push(e)
    }
    const out: { key: string; head: string; rows: Entry[] }[] = []
    for (const e of merged) {
      const key = dayKey(e.at)
      const last = out[out.length - 1]
      if (last?.key === key) last.rows.push(e)
      else out.push({ key, head: dayHead(e.at), rows: [e] })
    }
    return out
  }, [entries, store, typed])

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="mr-auto text-card-title font-semibold text-ink">
          History
        </h3>
        <Select
          aria-label="Store"
          value={store}
          onChange={setStore}
          className="w-56"
        >
          <option value="">All stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        {hasEpc && (
          <Input
            type="search"
            aria-label="EPC"
            value={epc}
            onChange={(event) => setEpc(event.target.value)}
            className="w-56"
          />
        )}
      </div>

      {history.isError ? (
        <ErrorState
          error={history.error}
          onRetry={() => void history.refetch()}
        />
      ) : history.isPending && row.code !== "" ? (
        <LoadingState />
      ) : days.length === 0 ? (
        <EmptyState>No history.</EmptyState>
      ) : (
        <div className="mt-4">
          {days.map((day) => (
            <div key={day.key}>
              <div className="flex h-12 items-end pb-2 font-semibold text-ink">
                {day.head}
              </div>
              {day.rows.map((e) => (
                <div
                  key={e.key}
                  className="grid h-14 grid-cols-[3.5rem_minmax(11rem,1.2fr)_4.5rem_minmax(7rem,1fr)_minmax(9rem,1.2fr)] items-center gap-4 border-t border-hairline px-4"
                >
                  <span className="text-mute tabular-nums">{hhmm(e.at)}</span>
                  <span className="flex min-w-0 items-center gap-3 font-medium text-ink">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        DOT[e.stage]
                      )}
                    />
                    <span className="truncate">{e.event}</span>
                  </span>
                  <span
                    className={cn(
                      "text-right tabular-nums",
                      e.stage === "missing" && "text-warn-fg"
                    )}
                  >
                    {count(e.qty)}
                  </span>
                  <span className="truncate">
                    {e.doc?.to && e.doc.sheet ? (
                      <AppLink
                        to={e.doc.to}
                        sheet={e.doc.sheet}
                        className="font-medium text-accent hover:underline"
                      >
                        {e.doc.label}
                      </AppLink>
                    ) : (
                      (e.doc?.label ?? null)
                    )}
                  </span>
                  <span className="truncate text-body">{e.where}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

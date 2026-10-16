import {
  queryOptions,
  useQuery,
  useSuspenseQueries,
} from "@tanstack/react-query"
import { useHydrated } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import type { ReceivedShipment } from "@itulah/contract"

import type { Refreshable } from "@/components/ui/refresh-stamp"
import { keys as operationKeys } from "@/lib/operations/keys"
import {
  fleetPoolsQuery,
  inventoryKeys,
  missingPage,
  type FleetPool,
  type MissingItem,
  type MissingScope,
} from "@/lib/queries/inventory"
import { receivedShipments } from "@/screens/operations/board/received"

/// The live exception feed the inbox, the nav badge and the store cards all
/// read. Two feeds, none of them sample:
///
/// - **Missing** — the ledger's own `:missing` balances, oldest first.
/// - **Store receive gaps** — surat jalan the stores signed for short, the
///   same read the operations board carries, so a case here and a lane there
///   can never disagree.
///
/// `Extra` has **no live feed yet**: count gains are not filed as cases
/// anywhere in the cloud, so no feed below ever emits that kind — the value
/// exists so the UI's type filter can offer it without lying about data.

/// How far back receive gaps are read, fixed when the hook first runs — a
/// window that slid on every render would be a new cache key and a new
/// request each time. The same pattern the operations board uses.
const RECEIVED_DAYS = 30

const MISSING_SCOPE: MissingScope = { sort: "missing_since", limit: 200 }

/// The start of the receive-gap window: midnight UTC, `RECEIVED_DAYS` back.
/// Whole days on purpose — the moment this hook mounts is not a question the
/// server needs asked, and a window to the millisecond is a new cache key at
/// every mount: the nav badge, this screen and the prefetcher would each fetch
/// their own copy and none could warm another's.
export function receivedSince(now: number = Date.now()): string {
  const today = Math.floor(now / 86_400_000) * 86_400_000
  return new Date(today - RECEIVED_DAYS * 86_400_000).toISOString()
}

/// The two feeds the cases are made of, as queries, shared by the hook below
/// and the prefetcher (`screens/inventory/prefetch.ts`).
export const missingFeedQuery = () =>
  queryOptions({
    queryKey: inventoryKeys.missing(MISSING_SCOPE),
    queryFn: ({ signal }) => missingPage(MISSING_SCOPE, signal),
  })

export const receivedFeedQuery = (since: string) =>
  queryOptions({
    queryKey: operationKeys.receivedShipments(since),
    queryFn: ({ signal }) => receivedShipments(since, signal),
  })

export type ExceptionKind = "Missing" | "Extra" | "Seen elsewhere"

/// One row of the received-shipments feed. Re-named here because the case
/// panel reads it out of the `raw` union and "the received shipment" is the
/// name the case speaks in, not the wire's.
export type ReceivedShipmentRow = ReceivedShipment

export interface ExceptionCase {
  /// Stable across reloads, and the shape a deep link or a store card can
  /// name: `missing:{subject_id}` | `gap:{shipment_number}:{sku_code}`.
  readonly id: string
  readonly kind: ExceptionKind
  /// Negative for missing, positive for extra.
  readonly qty: number
  /// The site id the case belongs to — what place cards and unit labels
  /// group by.
  readonly place: string
  /// The canonical pool id. A receive gap's is derived from the fleet read
  /// (the store's stockroom) and is empty when the fleet does not know the
  /// store.
  readonly pool: string
  readonly poolLabel: string
  readonly sku: string | null
  readonly article: string | null
  readonly ageDays: number | null
  /// `Counting` when an ACTIVE count covers the row
  /// (`MissingItem.latest_count_status`); the feeds hold nothing else open.
  readonly status: "Open" | "Counting"
  /// Count | Store receive | the missing cause's step.
  readonly from: string
  /// missing_reference_id / shipment_number.
  readonly doc: string | null
  readonly lastSeenAt: string | null
  /// The feed row itself, for the case panel and the writes against it.
  readonly raw: MissingItem | ReceivedShipmentRow
}

/// The movement cause that carried a piece into Missing, as the step people
/// know it by. The same reading `missing-data.ts` makes for the missing
/// screen's From column; kept here rather than exported from there because
/// this module's two data files serve different screens.
function stepOf(cause: string | null, referenceType: string | null): string {
  if (cause === null) return "Count"
  // A piece the destination did not find at its door (`STORE_RECEIPT`).
  if (referenceType === "STORE_RECEIPT") return "Receive"
  const known: Record<string, string> = {
    PICK: "Pick",
    PICK_SHORT: "Pick",
    PACK: "Pack",
    PACK_SHORT: "Pack",
    IN_TRANSIT: "Transit",
    STORE_RECEIVE: "Store receive",
    RETURN_TO_WAREHOUSE: "HO receive",
    COUNT: "Count",
    COUNT_VARIANCE: "Count",
    COUNT_SHORTAGE: "Count",
    RECONCILIATION: "Count",
  }
  const upper = cause.toUpperCase()
  if (known[upper]) return known[upper]
  const words = upper.toLowerCase().replace(/_/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function daysSince(iso: string | null): number | null {
  if (iso === null) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return Math.floor((Date.now() - at.getTime()) / 86_400_000)
}

/// The shelf a store's deliveries land in, looked up over the fleet read.
/// Rollups are skipped: they are fleet-wide figures, not a place you can
/// stand a gap's pool on.
interface PoolIndex {
  storeStockroom: (siteId: string) => { id: string; label: string } | null
}

function poolIndex(pools: readonly FleetPool[]): PoolIndex {
  const bySite = new Map<string, FleetPool[]>()
  for (const item of pools) {
    if (item.is_rollup) continue
    const list = bySite.get(item.site_id)
    if (list) list.push(item)
    else bySite.set(item.site_id, [item])
  }
  return {
    storeStockroom: (siteId) => {
      const own = bySite.get(siteId)
      if (own === undefined || own.length === 0) return null
      const room = own.find((item) => item.pool_code === "WAREHOUSE") ?? own[0]
      return { id: room.id, label: room.label }
    },
  }
}

/// The cases, merged from the feeds that answered. Oldest first — the inbox is
/// worked worst-case first, like the missing screen sorts.
function casesFrom(
  missing: Awaited<ReturnType<typeof missingPage>> | undefined,
  received: { readonly items: readonly ReceivedShipmentRow[] } | undefined,
  fleet: { readonly items: readonly FleetPool[] } | undefined
): readonly ExceptionCase[] {
  const pools = poolIndex(fleet?.items ?? [])
  const out: ExceptionCase[] = []

  for (const row of missing?.rows ?? []) {
    out.push({
      id: `missing:${row.subject_id}`,
      kind: "Missing",
      qty: -Math.abs(row.quantity),
      place: row.site_id,
      pool: row.origin_pool,
      poolLabel: row.pool_label,
      sku: row.sku_code,
      article: row.article_name,
      ageDays: row.age_hours === null ? null : Math.floor(row.age_hours / 24),
      status: row.latest_count_status === "ACTIVE" ? "Counting" : "Open",
      from: stepOf(row.missing_cause, row.missing_reference_type),
      doc: row.missing_reference_id,
      lastSeenAt: row.last_observation,
      raw: row,
    })
  }

  for (const row of received?.items ?? []) {
    if (!(row.open_gap_qty > 0)) continue
    const stockroom = pools.storeStockroom(row.destination_store_id)
    out.push({
      // The wire row is a whole surat jalan, not a per-SKU line, so the
      // sku segment of the documented grammar is empty here.
      id: `gap:${row.shipment_number}:`,
      kind: "Missing",
      qty: -row.open_gap_qty,
      place: row.destination_store_id,
      pool: stockroom?.id ?? "",
      poolLabel: stockroom?.label ?? "",
      sku: null,
      article: null,
      ageDays: daysSince(row.received_at),
      status: "Open",
      from: "Store receive",
      doc: row.shipment_number,
      lastSeenAt: null,
      raw: row,
    })
  }

  return out.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1))
}

/// The cases, merged from both feeds. `null` while ANY feed is loading —
/// an inbox that fills in kind by kind would have a selection that jumps —
/// and the array once every feed has answered. A feed that answered empty
/// simply contributes nothing.
///
/// Read by plain hooks: for the nav badge and for the Stock cards, which say
/// "loading" in a corner of a card and carry on. The inbox itself waits for
/// the feeds under a `<Suspense>` instead (`useSuspenseExceptionCases`).
export function useExceptionCases(): {
  cases: readonly ExceptionCase[] | null
  /// The feeds' own reads, for the screen's reload and "Updated" stamp.
  feeds: readonly Refreshable[]
} {
  // Fixed when the component mounts, to the day (`receivedSince`).
  const [since] = useState(() => receivedSince())

  const missing = useQuery(missingFeedQuery())
  const received = useQuery(receivedFeedQuery(since))
  // For the pool → site/label mapping, and the stockroom a gap names.
  const fleet = useQuery(fleetPoolsQuery())

  const cases = useMemo<readonly ExceptionCase[] | null>(() => {
    if (missing.isPending || received.isPending || fleet.isPending) return null
    return casesFrom(missing.data, received.data, fleet.data)
  }, [
    missing.isPending,
    received.isPending,
    fleet.isPending,
    missing.data,
    received.data,
    fleet.data,
  ])

  return { cases, feeds: [missing, received, fleet] }
}

/// The same cases for a screen that waits for them: the three feeds are read
/// with `useSuspenseQueries`, so the page streams in with the cases rather than
/// drawing a loading line first.
export function useSuspenseExceptionCases(): {
  cases: readonly ExceptionCase[]
  feeds: readonly Refreshable[]
} {
  const [since] = useState(() => receivedSince())

  const [missing, received, fleet] = useSuspenseQueries({
    queries: [missingFeedQuery(), receivedFeedQuery(since), fleetPoolsQuery()],
  })

  const cases = useMemo(
    () => casesFrom(missing.data, received.data, fleet.data),
    [missing.data, received.data, fleet.data]
  )

  return { cases, feeds: [missing, received, fleet] }
}

/// The nav badge's number. The feeds only hold open/counting rows — a
/// resolved case leaves the missing list and a cleared gap leaves the
/// received read — so the open count is simply the count. `null` while the
/// feeds are loading, which the sidebar reads as *not yet*, not as *none*.
///
/// Read by the shell, which is drawn on the server before the feeds are in and
/// again in the browser after they are: until the page is hydrated the answer
/// is "not yet", so the badge in the HTML and the badge of the browser's first
/// render are the same, and the number joins once the page is alive.
export function useOpenExceptionCount(): number | null {
  const { cases } = useExceptionCases()
  const hydrated = useHydrated()
  return !hydrated || cases === null ? null : cases.length
}

import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import type { ReceivedShipment } from "@itulah/contract"

import { keys as operationKeys } from "@/lib/operations/keys"
import {
  fleetPools,
  inventoryKeys,
  missingPage,
  observationAnomalies,
  type FleetPool,
  type MissingItem,
  type MissingScope,
  type ObservationAnomaly,
} from "@/lib/queries/inventory"
import { receivedShipments } from "@/screens/operations/board/received"

/// The live exception feed the inbox, the nav badge and the store cards all
/// read. Three feeds, none of them sample:
///
/// - **Missing** — the ledger's own `:missing` balances, oldest first.
/// - **Seen elsewhere** — the observation surface's placement mismatches: a
///   reader saw a tag in a pool other than its ledger position.
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

export type ExceptionKind = "Missing" | "Extra" | "Seen elsewhere"

/// One row of the received-shipments feed. Re-named here because the case
/// panel reads it out of the `raw` union and "the received shipment" is the
/// name the case speaks in, not the wire's.
export type ReceivedShipmentRow = ReceivedShipment

export interface ExceptionCase {
  /// Stable across reloads, and the shape a deep link or a store card can
  /// name: `missing:{subject_id}` | `gap:{shipment_number}:{sku_code}` |
  /// `mismatch:{epc}:{observed_pool}`.
  readonly id: string
  readonly kind: ExceptionKind
  /// Negative for missing, positive for extra/elsewhere.
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
  /// Count | Store receive | Readers | the missing cause's step.
  readonly from: string
  /// missing_reference_id / shipment_number / epc.
  readonly doc: string | null
  readonly lastSeenAt: string | null
  /// The feed row itself, for the case panel and the writes against it.
  readonly raw: MissingItem | ObservationAnomaly | ReceivedShipmentRow
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

/// Pool ids to sites and labels, over the fleet read.
///
/// A centre pool id's first segment **is** the site — a site id admits only
/// lowercase letters, digits and `-`, never the dot. But the fleet read also
/// carries Edge-derived rows, which may spell the same shelf with the node's
/// own site (`dc-01.warehouse`); the shadow link on such a row names the
/// origin, and the origin names the site it stands in. The same mapping the
/// pools screen makes, folded into two lookups.
interface PoolIndex {
  siteOf: (poolId: string) => string | null
  labelOf: (poolId: string) => string | null
  /// The shelf a store's deliveries land in, for receive-gap cases and the
  /// counts asked against them.
  storeStockroom: (siteId: string) => { id: string; label: string } | null
}

function poolIndex(pools: readonly FleetPool[]): PoolIndex {
  const siteOfOrigin = new Map<string, string>()
  for (const item of pools) {
    const shadowing = item.authority.shadowed_by_origin_id
    if (shadowing !== null) siteOfOrigin.set(shadowing, item.site_id)
  }
  const byCentreId = new Map<string, FleetPool>()
  for (const item of pools) {
    const site = siteOfOrigin.get(item.origin_id) ?? item.site_id
    const rest = item.id.slice(item.id.indexOf(".") + 1)
    const id = item.id.includes(".") ? `${site}.${rest}` : item.id
    byCentreId.set(id, item)
  }
  const bySite = new Map<string, FleetPool[]>()
  for (const item of pools) {
    if (item.is_rollup) continue
    const list = bySite.get(item.site_id)
    if (list) list.push(item)
    else bySite.set(item.site_id, [item])
  }
  return {
    siteOf: (poolId) =>
      byCentreId.get(poolId)?.site_id ??
      (poolId.includes(".") ? poolId.slice(0, poolId.indexOf(".")) : null),
    labelOf: (poolId) => byCentreId.get(poolId)?.label ?? null,
    storeStockroom: (siteId) => {
      const own = bySite.get(siteId)
      if (own === undefined || own.length === 0) return null
      const room = own.find((item) => item.pool_code === "WAREHOUSE") ?? own[0]
      return { id: room.id, label: room.label }
    },
  }
}

/// The cases, merged from all three feeds. `null` while ANY feed is loading —
/// an inbox that fills in kind by kind would have a selection that jumps —
/// and the array once every feed has answered. A feed that answered empty
/// simply contributes nothing.
export function useExceptionCases(): {
  cases: readonly ExceptionCase[] | null
} {
  // Fixed when the component mounts, like the board's `since`.
  const [since] = useState(() =>
    new Date(Date.now() - RECEIVED_DAYS * 86_400_000).toISOString()
  )

  const missing = useQuery({
    queryKey: inventoryKeys.missing(MISSING_SCOPE),
    queryFn: ({ signal }) => missingPage(MISSING_SCOPE, signal),
  })
  const anomalies = useQuery({
    queryKey: inventoryKeys.anomalies(),
    queryFn: ({ signal }) => observationAnomalies(signal),
  })
  // The same key the operations board holds it under, so one fetch serves
  // both screens.
  const received = useQuery({
    queryKey: operationKeys.receivedShipments(since),
    queryFn: ({ signal }) => receivedShipments(since, signal),
  })
  // For the pool → site/label mapping, and the stockroom a gap names.
  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const cases = useMemo<readonly ExceptionCase[] | null>(() => {
    if (
      missing.isPending ||
      anomalies.isPending ||
      received.isPending ||
      fleet.isPending
    )
      return null

    const pools = poolIndex(fleet.data?.items ?? [])
    const out: ExceptionCase[] = []

    for (const row of missing.data?.rows ?? []) {
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

    for (const row of anomalies.data ?? []) {
      out.push({
        id: `mismatch:${row.epc}:${row.observed_pool}`,
        kind: "Seen elsewhere",
        qty: row.quantity,
        place: pools.siteOf(row.ledger_pool) ?? row.ledger_pool,
        pool: row.ledger_pool,
        poolLabel: pools.labelOf(row.ledger_pool) ?? row.ledger_pool,
        sku: null,
        article: null,
        ageDays: daysSince(row.last_observed_at),
        status: "Open",
        from: "Readers",
        doc: row.epc,
        lastSeenAt: row.last_observed_at,
        raw: row,
      })
    }

    for (const row of received.data?.items ?? []) {
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

    // Oldest first — the inbox is worked worst-case first, like the missing
    // screen sorts.
    return out.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1))
  }, [missing.data, anomalies.data, received.data, fleet.data])

  return { cases }
}

/// The nav badge's number. The feeds only hold open/counting rows — a
/// resolved case leaves the missing list and a cleared gap leaves the
/// received read — so the open count is simply the count. `null` while the
/// feeds are loading, which the sidebar reads as *not yet*, not as *none*.
export function useOpenExceptionCount(): number | null {
  const { cases } = useExceptionCases()
  return cases === null ? null : cases.length
}

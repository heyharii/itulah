import type { FleetPool } from "@/lib/queries/inventory"

/// A pool's role, read from the fields the fleet read carries. The read has
/// no `role` column (the centre keeps it on `operational_pool.role`, see
/// backend/src/pool_role.rs), so the role is rebuilt from `pool_code`, the
/// `store_origin_site_id` that marks a per-store return pool, and `group` as
/// the last word.
export type PoolRole =
  | "RECEIVING"
  | "STOCKROOM"
  | "FLOOR"
  | "REJECT"
  | "RETURN"
  | "OUTBOUND"
  | "IN_TRANSIT"

export function roleOf(pool: FleetPool): PoolRole {
  if (pool.store_origin_site_id) return "RETURN"
  switch (pool.pool_code.toUpperCase()) {
    case "UNIDENTIFIED":
    case "UNTAGGED":
    case "RECEIVING":
      return "RECEIVING"
    case "WAREHOUSE":
    case "STOCKROOM":
      return "STOCKROOM"
    case "FLOOR":
      return "FLOOR"
    case "DC_REJECT":
    case "STORE_REJECT":
    case "REJECT":
      return "REJECT"
    case "RETURN":
      return "RETURN"
    case "PICKING":
    case "PICKED":
    case "PACKED":
    case "SHIPMENT":
    case "LOADED":
      return "OUTBOUND"
    case "IN_TRANSIT":
      return "IN_TRANSIT"
  }
  switch (pool.group) {
    case "REJECT":
      return "REJECT"
    case "PENDING":
      return "RECEIVING"
    case "OUTBOUND":
      return "OUTBOUND"
    case "STORE_INVENTORY":
      return "FLOOR"
    default:
      return "STOCKROOM"
  }
}

/// What a pool holds apart from its Missing pocket: `stock` already includes
/// it (Stock = On Hand + Allotted + Missing).
export const handOf = (pool: FleetPool): number =>
  pool.stock - (pool.missing ?? 0)

export interface Pocket {
  readonly key: string
  readonly label: string
  readonly pools: readonly FleetPool[]
  /// Without its Missing pocket.
  readonly hand: number
  readonly missing: number
  /// Null when a pool that holds something has never been seen.
  readonly seen: number | null
}

const sumSeen = (pools: readonly FleetPool[]): number | null => {
  let total = 0
  for (const pool of pools) {
    if (handOf(pool) === 0 && (pool.observed ?? 0) === 0) continue
    if (pool.observed === null || pool.observed === undefined) return null
    total += pool.observed
  }
  return total
}

export function pocketOf(
  key: string,
  label: string,
  pools: readonly FleetPool[]
): Pocket {
  return {
    key,
    label,
    pools,
    hand: pools.reduce((sum, pool) => sum + handOf(pool), 0),
    missing: pools.reduce((sum, pool) => sum + (pool.missing ?? 0), 0),
    seen: sumSeen(pools),
  }
}

/// The pockets a place is drawn in, always all of them, even when empty.
///   HO     Unallotted = STOCKROOM · Unidentified = RECEIVING ·
///          Allotted = PICKING + PACKED + SHIPMENT + LOADED ·
///          Return = REJECT + every per-store RETURN pool
///   Store  Floor = FLOOR · Stockroom = STOCKROOM · Return = REJECT
/// `pools` is already free of IN_TRANSIT (and, at a store, of outbound).
export function pocketsOf(
  kind: "ho" | "store",
  pools: readonly FleetPool[]
): Pocket[] {
  const by = (...roles: PoolRole[]) =>
    pools.filter((pool) => roles.includes(roleOf(pool)))
  if (kind === "ho") {
    return [
      pocketOf("unallotted", "Unallotted", by("STOCKROOM")),
      pocketOf("unidentified", "Unidentified", by("RECEIVING")),
      pocketOf("allotted", "Allotted", by("OUTBOUND")),
      pocketOf("return", "Return", by("REJECT", "RETURN")),
    ]
  }
  return [
    pocketOf("floor", "Floor", by("FLOOR")),
    pocketOf("stockroom", "Stockroom", by("STOCKROOM")),
    pocketOf("return", "Return", by("REJECT")),
  ]
}

/// The pocket a pool is shown in, by name: the same words the Stock sheet
/// uses. A site with a floor is a store (its warehouse is the Stockroom);
/// head office's warehouse is Unallotted.
export function pocketNameOf(
  pool: FleetPool,
  pools: readonly FleetPool[]
): string {
  const store = pools.some(
    (other) => other.site_id === pool.site_id && roleOf(other) === "FLOOR"
  )
  switch (roleOf(pool)) {
    case "FLOOR":
      return "Floor"
    case "STOCKROOM":
      return store ? "Stockroom" : "Unallotted"
    case "RECEIVING":
      return "Unidentified"
    case "OUTBOUND":
      return "Allotted"
    case "IN_TRANSIT":
      return "In transit"
    default:
      return "Return"
  }
}

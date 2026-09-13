import { node } from "@/lib/api"

/// The operational pools the centre knows about, with their balances.
///
/// Kept hand-written here, but no longer because it has to be: the route now
/// serialises `PoolRow` and `@itulah/contract` exports it. This app has not
/// been moved onto the generated types, so this interface stays as the
/// transcription it was — the generated `PoolRow` is the authority, and a
/// field that moves there is what makes this go stale.
export interface Pool {
  /// The canonical pool id, e.g. `dc.warehouse`, `dc.reject.store-01`,
  /// `store-01.floor`. The server parses this string back into a place, so it
  /// is an identifier and never a label.
  readonly id: string
  readonly site_id: string
  readonly site_name: string
  readonly site_kind: string
  /// PENDING · WAREHOUSE · OUTBOUND · REJECT · STORE_INVENTORY
  readonly group: string
  /// UNIDENTIFIED · UNTAGGED · WAREHOUSE · PICKING · PICKED · PACKED ·
  /// SHIPMENT · LOADED · IN_TRANSIT · DC_REJECT · STORE_REJECT · FLOOR ·
  /// REJECT
  readonly pool_code: string
  readonly label: string
  readonly store_origin_site_id: string | null
  readonly display_order: number
  /// A rollup is a sum of other pools, not a place goods can sit in. Nothing
  /// can be allotted out of one.
  readonly is_rollup: boolean
  readonly is_outbound_leaf: boolean
  readonly outbound_stage: string | null
  readonly destination_store_id: string | null
  /// Stock = On Hand + Allotted + Missing, as the server states in the same
  /// response. `allotted` is null on pools the equation does not apply to.
  readonly stock: number
  readonly allotted: number | null
  readonly on_hand: number
  readonly missing: number
  readonly observed: number
  readonly lost_rate: number
  readonly lost_quantity: number
  readonly exposure: number
}

/// The rows alone, for the screens that hold the whole list and work on it
/// locally.
///
/// `GET /inventory/pools` answers with an envelope now — `rows`, a keyset
/// `next_cursor`, a `total` over everything that matched, and facet counts —
/// in the shape `GET /finance/money` established. One place unwraps it, which
/// is the only reason the route's answer could change shape without touching
/// the screens that read it. A screen that wants the total or the facets asks
/// for `PoolPage` itself; a screen that pages MUST, because the rows alone
/// cannot say whether there are more.
///
/// `limit=500` is the server's own maximum, asked for explicitly because this
/// screen holds the whole set and filters it locally: the fleet has a hundred
/// and twelve pools, and the default page of two hundred would already cover
/// them, but the day somebody opens the fortieth shop is not the day a pool
/// picker should quietly stop listing shelves.
export function listPools(signal?: AbortSignal): Promise<Pool[]> {
  return node
    .get<{ rows: Pool[] }>("/api/v1/inventory/pools?limit=500", { signal })
    .then((body) => body.rows)
}

/// The sites that hold stock, derived from the pools rather than asked for
/// separately: every site with a pool appears here, and its kind and name come
/// from the same read the pool picker already needs.
export interface Site {
  readonly site_id: string
  readonly site_name: string
  readonly site_kind: string
}

export function sitesOf(pools: readonly Pool[], kind: string): Site[] {
  const seen = new Map<string, Site>()
  for (const pool of pools) {
    if (pool.site_kind !== kind || seen.has(pool.site_id)) {
      continue
    }
    seen.set(pool.site_id, {
      site_id: pool.site_id,
      site_name: pool.site_name,
      site_kind: pool.site_kind,
    })
  }
  return [...seen.values()].sort((left, right) => left.site_id.localeCompare(right.site_id))
}

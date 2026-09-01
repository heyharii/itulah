import { node } from "@/lib/api"

/// The operational pools the centre knows about, with their balances.
///
/// Hand-written for the same reason as the purchase-order reads:
/// `GET /api/v1/inventory/pools` is assembled with `json!()` in
/// `cloud/postgres/queries.rs` rather than serialised from a struct, so ts-rs
/// has nothing to generate and nothing here is checked against the server at
/// build time. Transcribed from that literal — if a field moves, this is where
/// it goes stale.
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

export function listPools(signal?: AbortSignal): Promise<Pool[]> {
  return node
    .get<{ items: Pool[] }>("/api/v1/inventory/pools", { signal })
    .then((body) => body.items)
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

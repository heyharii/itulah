import { Auth, Dc, Node, Sync } from "@itulah/contract/client"

/// This surface is served from the same origin as the DC node it talks to, so
/// the base URL is empty: the node's own router ends in a `ServeDir` fallback
/// and development proxies `/api` onto it (see vite.config.ts). One origin is
/// not a convenience — the session cookie is `SameSite=Strict`, so a browser
/// simply would not send it across two.
///
/// The node is **in the building**. That is the whole architecture of this app:
/// the deliveries, the racks, the picklists and the cartons are all answered
/// out of a SQLite file on a machine in the warehouse, so the floor keeps
/// working when the line to head office is down. Nothing here ever addresses
/// the centre.
export const node = new Node()
export const auth = new Auth(node)
export const sync = new Sync(node)

/// Every warehouse operation the node performs, typed from the Rust that serves
/// it. Screens call this rather than writing paths of their own — the envelopes
/// are part of the wire (`{items}` here, `{lines}` there) and unwrapping that at
/// forty call sites is forty chances to unwrap the wrong key.
export const dc = new Dc(node)

/// The two keys read from both ends of the app: by the component that decides
/// whether to draw a login box, and by every screen that has to name an actor
/// on a decision. Every other key lives in `lib/queries.ts`.
export const cacheKey = {
  identity: () => ["node", "identity"] as const,
  me: () => ["auth", "me"] as const,
}

/// The pools this node owns, as `edge/http.rs::present_pools` composes them.
///
/// That handler builds its rows with `json!` rather than from a struct, so there
/// is nothing for `ts-rs` to generate a type from — this is the narrow slice the
/// floor reads, and it is deliberately narrow so that the day the handler grows
/// a field, nothing here silently claims to know about it.
export interface PoolRow {
  readonly id: string
  readonly group: string
  readonly pool_code: string
  readonly label: string
  readonly display_order: number
  /// True for the outbound stage totals the node adds up itself. They
  /// double-count the leaves under them, so a screen that summed both would
  /// report twice the stock this DC holds.
  readonly is_rollup: boolean
  readonly is_outbound_leaf: boolean
  readonly outbound_stage: string | null
  readonly destination_store_id: string | null
  readonly stock: number
  readonly allotted: number | null
  readonly on_hand: number
  readonly missing: number
}

export interface PoolsAnswer {
  readonly as_of: string
  readonly inventory_equation: string
  readonly aggregation_policy: string
  readonly items: PoolRow[]
}

/// One function rather than two, and deliberately: two helpers under one cache
/// key means whoever asks first decides the shape. Callers that only want the
/// rows say `.items`.
export function poolsAnswer(signal?: AbortSignal): Promise<PoolsAnswer> {
  return node.get<PoolsAnswer>("/api/v1/inventory/pools", { signal })
}

/// What a SKU code actually is, as this node's resident catalogue snapshot
/// describes it.
///
/// Typed here rather than imported, and the reason is worth writing down: the
/// Rust struct (`edge/contracts.rs::CatalogIdentity`) *does* derive `ts_rs::TS`,
/// but a type is only written out if it is also NAMED in
/// `backend/tests/contract_types.rs` — so the generated package has no file for
/// it and an import would not compile. This is the narrow slice the floor reads.
export interface SkuIdentity {
  readonly sku_code: string
  readonly name: string
  readonly article_code: string | null
  readonly image_url: string | null
}

/// The most SKUs the node will answer for in one request. `edge/sqlite.rs`
/// refuses more, so asking for a picklist of six hundred as one query string is
/// a 400 rather than a long wait.
const IDENTITY_CHUNK = 200

/// Names for a list of SKU codes, as a lookup.
///
/// A picker reading `31001101001` off a phone is a picker walking to the wrong
/// rack. The names come from the node's own snapshot — never from the centre,
/// which this app cannot reach — and a SKU the snapshot has never heard of
/// simply has no entry, so the caller falls back to the code rather than being
/// handed an invented name.
export async function skuNames(
  codes: readonly string[],
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, SkuIdentity>> {
  const unique = [...new Set(codes)].filter((code) => code !== "")
  const found = new Map<string, SkuIdentity>()
  for (let at = 0; at < unique.length; at += IDENTITY_CHUNK) {
    const slice = unique.slice(at, at + IDENTITY_CHUNK)
    const body = await node.get<{ items: SkuIdentity[] }>(
      `/api/v1/catalog/identities?skus=${encodeURIComponent(slice.join(","))}`,
      { signal },
    )
    for (const item of body.items) found.set(item.sku_code, item)
  }
  return found
}

/// What is standing in the packing area: picked, not yet in a carton.
///
/// Worth a screen of its own attention because of how the node attributes work:
/// **a pick does not draw down an allotment line, a pack does** ("picked and
/// packed rise together" — `edge/sqlite.rs`). So the picklist goes on asking for
/// a garment that is already off the rack and standing by the bench, and a
/// picker reading only that number fetches it twice.
///
/// Matched on the pool id rather than on `outbound_stage`, which the node leaves
/// null for this one: the stages it names are the roll-ups above it.
export function pickingPool(pools: readonly PoolRow[]): PoolRow | null {
  return pools.find((pool) => pool.id.endsWith(".outbound.picking")) ?? null
}

/// The racks a pick comes off.
///
/// A pick names the pool it took stock from, and composing that id in the
/// browser — `${site}.warehouse:on_hand` — is how an app ends up writing
/// movements out of a pool this node does not own. So it is chosen from what
/// the node says it has: warehouse pools, leaves only, because a roll-up is a
/// total rather than a place.
export function racks(pools: readonly PoolRow[]): readonly PoolRow[] {
  return pools.filter((pool) => !pool.is_rollup && pool.group === "WAREHOUSE")
}

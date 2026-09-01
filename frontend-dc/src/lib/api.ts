import { Auth, Dc, Node, Sync } from "@itulah/contract/client"

/// This surface is served from the same origin as the DC node it talks to,
/// so the base URL is empty: production rewrites `/api/*` to the node and
/// development proxies it (see vite.config.ts). One origin is not a
/// convenience here — the session cookie is `SameSite=Strict`, so a browser
/// would simply not send it across two.
export const node = new Node()
export const auth = new Auth(node)
export const sync = new Sync(node)

/// Every warehouse operation this node performs, typed from the Rust that
/// serves it. Screens call this rather than writing paths of their own.
export const dc = new Dc(node)

/// The pools this node owns, as `edge/http.rs::present_pools` composes them.
///
/// That handler builds its rows with `json!` rather than from a struct, so
/// there is nothing to generate a type from — this is the narrow slice the
/// warehouse screens read, and it is deliberately narrow so that the day the
/// handler grows a field, nothing here silently claims to know about it.
export interface PoolRow {
  readonly id: string
  readonly group: string
  readonly pool_code: string
  readonly label: string
  readonly display_order: number
  /// True for the five outbound stage totals the node adds up itself. They
  /// double-count the leaves under them, so a screen that summed both would
  /// report twice the stock this DC holds.
  readonly is_rollup: boolean
  readonly outbound_stage: string | null
  readonly destination_store_id: string | null
  readonly stock: number
  readonly allotted: number | null
  readonly on_hand: number
  readonly missing: number
}

/// The pools, and the equation the node says they add up to.
///
/// The sentence comes from the server rather than being written here: it is
/// the node's own statement of what its numbers mean, and a screen that
/// paraphrased it would be free to drift from the arithmetic underneath.
export interface PoolsAnswer {
  readonly as_of: string
  readonly inventory_equation: string
  readonly aggregation_policy: string
  readonly items: PoolRow[]
}

/// One function rather than two, and deliberately.
///
/// There was briefly a second helper here that returned just the rows, and
/// both were used as the query function under the same cache key — so whoever
/// asked first decided the shape, and the other call site read `.filter` on an
/// object. One key, one shape: callers that only want the rows say `.items`.
export function poolsAnswer(signal?: AbortSignal): Promise<PoolsAnswer> {
  return node.get<PoolsAnswer>("/api/v1/inventory/pools", { signal })
}

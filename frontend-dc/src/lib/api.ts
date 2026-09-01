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
  readonly is_rollup: boolean
  readonly stock: number
  readonly on_hand: number
  readonly missing: number
}

export async function pools(signal?: AbortSignal): Promise<PoolRow[]> {
  const body = await node.get<{ items: PoolRow[] }>("/api/v1/inventory/pools", {
    signal,
  })
  return body.items
}

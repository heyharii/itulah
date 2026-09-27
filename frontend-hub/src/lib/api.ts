import { Auth, Clock, Dc, Node, Sync } from "@itulah/contract/client"

/// This surface is served from the same origin as the CLOUD node it talks to,
/// so the base URL is empty: production rewrites `/api/*` to the node and
/// development proxies it (see vite.config.ts). One origin is not a
/// convenience — the session cookie is `SameSite=Strict`, so a browser simply
/// would not send it across two.
export const node = new Node()
export const auth = new Auth(node)

/// The **second** backend this surface talks to: a DC edge node.
///
/// The Operations module is the warehouse console folded into the hub, and a
/// warehouse is not the centre — its deliveries, its racks and its outbox live
/// on a machine in the building. So those screens address a different server
/// from every other screen here, and the difference is declared once, at the
/// top, rather than discovered per fetch.
///
/// ## Why a base URL and not just `/api`
///
/// `/edge` is a prefix this app's own origin serves, and the proxy strips it
/// before forwarding (see vite.config.ts). Pointing the browser straight at
/// the node instead would be cross-origin, which costs a preflight on every
/// write and a CORS layer the edge does not have — `edge/http.rs` mounts none.
///
/// ## Why a token and not the cookie
///
/// Both backends name their cookies identically — `inventory_session` and
/// `inventory_csrf`, from `security.rs` — so proxied onto one origin they are
/// **the same cookie**. Signing in to the warehouse would sign you out of the
/// centre, silently, and the next thing you pressed at the centre would be a
/// 403. The edge login returns a bearer token in its body; this node carries
/// that instead and sends no cookies at all. See `Node.setBearer`.
const EDGE_BASE = import.meta.env.VITE_EDGE_BASE ?? "/edge"

export const edge = new Node(EDGE_BASE)

/// Where the edge token is kept between reloads.
///
/// `sessionStorage` and not `localStorage`: a tab is a shift. The token is a
/// live session on a warehouse node, and leaving it on the disk of a shared
/// office machine outlives the person who typed the password. A closed tab is
/// a signed-out warehouse, which is the right default for a console somebody
/// opens beside their real work.
const EDGE_TOKEN_KEY = "central.hub.edge-token"

function readStoredEdgeToken(): string | null {
  try {
    return sessionStorage.getItem(EDGE_TOKEN_KEY)
  } catch {
    // Storage can be denied outright (private mode, a locked-down profile).
    // A hub that cannot remember the warehouse session is a hub that asks for
    // it again, which is a nuisance; a hub that throws on boot is broken.
    return null
  }
}

/// Give the edge node a token, or `null` to forget it. Both the client and the
/// store are set here so the two cannot disagree — a token in memory that the
/// next reload does not have is a session that mysteriously ends on refresh.
export function setEdgeToken(token: string | null): void {
  edge.setBearer(token)
  try {
    if (token === null) sessionStorage.removeItem(EDGE_TOKEN_KEY)
    else sessionStorage.setItem(EDGE_TOKEN_KEY, token)
  } catch {
    // Held in memory for this page's life, which is better than refusing to
    // sign in because the browser will not keep a note of it.
  }
}

setEdgeToken(readStoredEdgeToken())

/// Local password sign-in for a warehouse recovery account. The normal hub
/// path exchanges a Cloud ticket for a local DC session in `edge-session.tsx`.
export const edgeAuth = new Auth(edge)

/// Every warehouse operation the node performs, typed from the Rust that
/// serves it. Screens call this rather than writing paths of their own — the
/// envelopes are part of the wire (`{items}` here, `{lines}` there) and
/// unwrapping that at forty call sites is forty chances to unwrap the wrong
/// key.
export const dc = new Dc(edge)

/// The node's outbox: whether today's work has actually reached the centre.
export const edgeSync = new Sync(edge)

/// The business clock, against the SAME node as everything else here — the
/// cloud, not the edge. The warehouse does not get to say what today is; the
/// centre does. It answers 403 wherever test controls are off, and the chip
/// that reads it is built to disappear when it does.
export const clock = new Clock(node)

/// The two keys read from both ends of the app: by the component that decides
/// whether to draw a login box, and by every screen that has to name an actor
/// on a decision. Every other key lives beside the function that fetches it,
/// in `lib/queries/<domain>.ts`.
///
/// One key per endpoint, in one place. Two modules spelling `/auth/me`
/// differently means fetching it twice and never noticing.
export const cacheKey = {
  identity: () => ["node", "identity"] as const,
  me: () => ["auth", "me"] as const,
  /// The same two questions asked of the *other* node. Kept apart from the
  /// pair above on purpose: one cache holding both nodes' answers under one
  /// key would have the warehouse's principal claiming to be the centre's, and
  /// signing out of one would empty the other.
  edgeIdentity: () => ["edge", "node", "identity"] as const,
  edgeMe: () => ["edge", "auth", "me"] as const,
}

/// The pools the DC node owns, as `edge/http.rs::present_pools` composes them.
///
/// That handler builds its rows with `json!` rather than from a struct, so
/// there is nothing for `ts-rs` to generate a type from — this is the narrow
/// slice the warehouse screens read, and it is deliberately narrow so that the
/// day the handler grows a field, nothing here silently claims to know about
/// it.
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
  readonly is_outbound_leaf: boolean
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
/// The app this came from briefly had a second helper returning just the rows,
/// and both were used as the query function under the same cache key — so
/// whoever asked first decided the shape, and the other call site read
/// `.filter` on an object. One key, one shape: callers that only want the rows
/// say `.items`.
export function poolsAnswer(signal?: AbortSignal): Promise<PoolsAnswer> {
  return edge.get<PoolsAnswer>("/api/v1/inventory/pools", { signal })
}

import {
  Auth,
  Clock,
  Dc,
  Node,
  Sync,
  type RequestOptions,
} from "@itulah/contract/client"
import { createIsomorphicFn, createServerOnlyFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"

/// This surface is served from the same origin as the CLOUD node it talks to,
/// so the base URL is empty: production rewrites `/api/*` to the node and
/// development proxies it (see vite.config.ts). One origin is not a
/// convenience — the session cookie is `SameSite=Strict`, so a browser simply
/// would not send it across two.
///
/// On the SERVER (the SSR pass) the same client runs without a browser: the
/// Start server addresses the node directly, and every read carries the
/// incoming request's session cookie, so what the server renders is what this
/// browser would have fetched. Only reads: a write belongs to the browser
/// session that made it, and never runs during a render. The request and the
/// node's address are both read per call, inside the request, never at module
/// load (Start's execution model: module scope runs before any request).
const requestCookie = createIsomorphicFn()
  .server(() => getRequestHeader("cookie") || undefined)
  .client(() => undefined)

const serverCloudBase = createServerOnlyFn(
  () =>
    process.env.ITULAH_CLOUD_URL ??
    // Development: the node the dev proxy targets, so the server and the
    // browser never read two different backends.
    process.env.VITE_API_TARGET ??
    "http://127.0.0.1:8080"
)

class ServerNode extends Node {
  override get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const cookie = requestCookie()
    return new Node(serverCloudBase()).get<T>(
      path,
      cookie === undefined
        ? options
        : { ...options, headers: { cookie, ...options.headers } }
    )
  }
}

export const node: Node =
  typeof window === "undefined" ? new ServerNode() : new Node()
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

// Restoring the warehouse session is a browser concern: the server has no
// `sessionStorage` and no edge session of its own.
if (typeof window !== "undefined") setEdgeToken(readStoredEdgeToken())

/// Local password sign-in for a warehouse recovery account. The normal hub
/// path exchanges a Cloud ticket for a local DC session in `edge-session.tsx`.
export const edgeAuth = new Auth(edge)

/// Where the warehouse lives: on a DC server in the building (`edge`, reached at
/// `/edge` with its own session) or inside the cloud itself (`cloud`: the same
/// `/api/v1/dc/...` paths on this origin, the ordinary cookie session).
///
/// The cloud says which in `GET /api/v1/health` (`dc_hosting`); `useDcHosting`
/// in `edge-session.tsx` asks once and records the answer here, before any
/// screen is let through to make a DC call. Until then it is `edge`, which is
/// what every deployment was before the cloud could host the warehouse.
export type DcHosting = "cloud" | "edge"

let dcHosting: DcHosting = "edge"

export function setDcHosting(hosting: DcHosting): void {
  dcHosting = hosting
}

/// The node every DC call goes to right now.
export function dcNode(): Node {
  return dcHosting === "cloud" ? node : edge
}

const edgeDc = new Dc(edge)
const cloudDc = new Dc(node)

/// The typed client for whichever node hosts the warehouse.
export function dcClient(): Dc {
  return dcHosting === "cloud" ? cloudDc : edgeDc
}

/// Every warehouse operation the warehouse performs, typed from the Rust that
/// serves it. Screens call this rather than writing paths of their own — the
/// envelopes are part of the wire (`{items}` here, `{lines}` there) and
/// unwrapping that at forty call sites is forty chances to unwrap the wrong
/// key.
///
/// A forwarding object rather than one fixed client: the hosting is learnt
/// from the cloud after the module loads, and every call site reads `dc.x()`
/// at the moment it runs, so each call picks the node then.
export const dc: Dc = new Proxy({} as Dc, {
  get(_target, property) {
    const client = dcClient()
    const value = Reflect.get(client, property, client)
    return typeof value === "function" ? value.bind(client) : value
  },
})

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
  /// Where the warehouse lives — `"cloud"` or `"edge"`. Under `node` so a sign-out
  /// keeps it, like the identity beside it.
  dcHosting: () => ["node", "dc-hosting"] as const,
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
export async function poolsAnswer(signal?: AbortSignal): Promise<PoolsAnswer> {
  // A DC server answers `{items}`; the cloud hosting the warehouse answers its
  // own paged list, `{rows}`. Both are read as `items`, or no rack is found
  // and the picklist's Submit stays dead.
  const answer = await dcNode().get<
    Omit<PoolsAnswer, "items"> & { items?: PoolRow[]; rows?: PoolRow[] }
  >("/api/v1/inventory/pools", { signal })
  return { ...answer, items: answer.items ?? answer.rows ?? [] }
}

/// A purchase return, as this node sees it: excess a buyer at the centre put
/// on a return, waiting for the warehouse to hand it to the supplier — or
/// already handed over, for the last fortnight.
///
/// Not in `@itulah/contract`: `edge/http.rs::present_purchase_returns` answers
/// with `json!()` too, so this is transcribed beside the route the same way
/// `PoolRow` above is.
export interface PurchaseReturnWork {
  readonly return_id: string
  readonly return_number: string
  readonly po_number: string
  readonly supplier_id: string
  readonly supplier_name: string | null
  /// The warehouse's person in charge, named when the delivery note was generated
  /// (0917); null until it is. Absent on a server older than that.
  readonly note_pic?: string | null
  /// When the delivery note was generated; null until it is.
  readonly note_generated_at?: string | null
  /// A few words per item on the note, by article code ("*" for the
  /// not-as-ordered pieces).
  readonly line_notes?: Readonly<Record<string, string>>
  readonly note: string | null
  readonly raised_by: string
  readonly received_at: string
  readonly status: "OPEN" | "HANDED_OVER"
  readonly handed_over_by: string | null
  readonly handed_over_to: string | null
  readonly handed_over_at: string | null
  readonly quantity: number
  readonly lines: readonly {
    readonly receipt_line_id: string
    readonly po_line_id: string
    readonly article_code: string
    readonly article_name: string
    readonly quantity: number
    /// The part of `quantity` that is not this article at all (0829).
    readonly wrong_quantity?: number
  }[]
}

/// This node's returns: open first, then the last fortnight's hand-overs.
export async function dcPurchaseReturns(
  signal?: AbortSignal
): Promise<PurchaseReturnWork[]> {
  const body = await dcNode().get<{ items: PurchaseReturnWork[] }>(
    "/api/v1/dc/purchase-returns",
    { signal }
  )
  return body.items
}

/// Generate the delivery note for the returns going to one supplier: the person in
/// charge is named, and each return has its note from then on. Refused for one
/// that is no longer open.
export async function generatePurchaseReturnNote(
  body: {
    return_ids: readonly string[]
    pic: string
    notes?: Readonly<Record<string, string>>
  },
  signal?: AbortSignal
): Promise<PurchaseReturnWork[]> {
  const answer = await dcNode().post<{ items: PurchaseReturnWork[] }>(
    "/api/v1/dc/purchase-returns/note",
    body,
    { signal }
  )
  return answer.items
}

/// Give the goods to the supplier. Closes the return; `handed_to` is the
/// driver's name, for the record, not a decision anything is made from.
export function handOverPurchaseReturn(
  returnId: string,
  body: {
    actor_id: string
    handed_to?: string | null
    idempotency_key: string
  },
  signal?: AbortSignal
): Promise<PurchaseReturnWork> {
  return dcNode().post<PurchaseReturnWork>(
    `/api/v1/dc/purchase-returns/${returnId}/hand-over`,
    body,
    { signal }
  )
}

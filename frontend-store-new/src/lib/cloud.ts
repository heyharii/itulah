import { Auth, Node } from "@itulah/contract/client"

/// The **second** backend this till talks to: head office.
///
/// Everything else in this app is answered out of the SQLite file on the
/// machine behind the counter, and `lib/api.ts` says so — the catalogue, the
/// prices, the stock, the day's takings. This module is the exception, and it
/// exists for one reason: **the Edge has no HR at all.** There is no employee,
/// no roster, no attendance and no leave in `backend/src/edge/` or in
/// `backend/migrations/sqlite/`; every one of those lives in Postgres at the
/// centre. A shop's rota is not a fact about the shop's node, it is a fact
/// about the company, and the company keeps it in one place on purpose.
///
/// So the HR screens address a different server from every other screen here,
/// and the difference is declared once, at the top, rather than discovered per
/// fetch.
///
/// # Why a base URL and not just `/api`
///
/// `/central` is a prefix this app's own origin serves, and the proxy strips
/// it before forwarding (see vite.config.ts). Pointing the browser straight at
/// the cloud instead would be cross-origin, which costs a preflight on every
/// write — and the centre's session cookie is `SameSite=Strict`, so it would
/// never be sent across two origins in the first place.
///
/// # Why a token and not the cookie
///
/// This is the **mirror** of `frontend-hub`, which reaches a warehouse Edge as
/// its second backend: there the cookie belongs to the centre and the Edge
/// carries a token; here the cookie belongs to this shop's Edge and the centre
/// carries the token.
///
/// The trap it avoids is the same one and it is real. Both backends name their
/// cookies identically — `inventory_session` and `inventory_csrf`, from
/// `security.rs` — so proxied onto one origin they are **the same cookie**.
/// Signing in to head office would sign the cashier out of the till, silently,
/// and the next thing they scanned would be a 403 in front of a customer. A
/// token carried in a header belongs to the client that holds it, so the two
/// sessions cannot overwrite each other. While it is set, this node sends no
/// cookies at all — see `Node.setBearer`.
const CLOUD_BASE = import.meta.env.VITE_CLOUD_BASE ?? "/central"

export const cloud = new Node(CLOUD_BASE)

/// Signing in to head office, separately from signing in to the till. Two
/// nodes, two principals, two sessions — a shop's Edge keeps its own accounts,
/// including the break-glass ones that let a counter sell with the line down,
/// and this app does not pretend one login covers both.
export const cloudAuth = new Auth(cloud)

/// The head-office token, held **in memory only**, and deliberately not in
/// `sessionStorage` the way the hub holds its warehouse token.
///
/// The hub runs on somebody's own laptop at a desk. This runs on a tablet at a
/// counter that three people use in a day, and a head-office session that
/// survives a reload there is a session the next cashier inherits without ever
/// typing a password. A reload signing the centre out is a nuisance once a
/// shift; the alternative is one person reading the shop's HR under another
/// person's name.
///
/// It also means the token cannot outlive the tab, be read off the disk of a
/// shared machine, or be left behind by somebody who walked away.
let token: string | null = null

/// Give the centre a token, or `null` to forget it. The client and this module
/// are set together so the two cannot disagree — a token in one and not the
/// other is a session that mysteriously ends on the next request.
export function setCloudToken(next: string | null): void {
  token = next
  cloud.setBearer(next)
}

/// Whether this browser is currently carrying a head-office session.
export function hasCloudToken(): boolean {
  return token !== null
}

/// The segment every head-office cache key begins with.
///
/// It is what keeps the centre's answers apart from the shop's in one cache: a
/// key that did not carry it would be dropped — or worse, kept — by the wrong
/// sign-out. `useSignOut` in `lib/session.tsx` removes every key that is not
/// one of the till's two session keys, which is exactly right here: when the
/// cashier signs out of the counter, head office's answers go with them.
export const CENTRAL_KEY_PREFIX = "central"

/// The two questions asked of the *other* node.
///
/// Kept apart from `cacheKey` in `lib/api.ts` on purpose: one cache holding
/// both nodes' answers under one key would have head office's principal
/// claiming to be the till's, and signing out of one would empty the other.
export const cloudKey = {
  identity: () => [CENTRAL_KEY_PREFIX, "node", "identity"] as const,
  me: () => [CENTRAL_KEY_PREFIX, "auth", "me"] as const,
}

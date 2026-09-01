import { Auth, Node, Sync } from "@itulah/contract/client"

/// This surface is served from the same origin as the STORE node it talks to,
/// so the base URL is empty: production rewrites `/api/*` to the node and
/// development proxies it (see vite.config.ts). One origin is not a
/// convenience — the session cookie is `SameSite=Strict`, so a browser simply
/// would not send it across two.
///
/// The node is *in the shop*. That is the whole architecture of this app: the
/// catalogue, the prices, the stock and the day's takings are all answered out
/// of a SQLite file on a machine behind the counter, so the till keeps selling
/// when the line to head office is down. Nothing here ever addresses the
/// centre.
export const node = new Node()
export const auth = new Auth(node)
export const sync = new Sync(node)

/// The two keys read from both ends of the app: by the component that decides
/// whether to draw a login box, and by every screen that has to name an actor
/// on a decision. Every other key lives beside the function that fetches it,
/// in `lib/queries.ts`.
export const cacheKey = {
  identity: () => ["node", "identity"] as const,
  me: () => ["auth", "me"] as const,
}

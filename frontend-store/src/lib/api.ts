import { Auth, Node } from "@itulah/contract/client"

/// This surface is served from the same origin as the STORE node it talks to,
/// so the base URL is empty: production rewrites `/api/*` to the node and
/// development proxies it (see vite.config.ts). One origin is not a
/// convenience here — the session cookie is `SameSite=Strict`, so a browser
/// would simply not send it across two.
export const node = new Node()
export const auth = new Auth(node)

/// A key that changes whenever a request's answer could change.
///
/// Only the two session reads live here; everything else this app asks for is
/// the shop's own catalogue or takings and is keyed beside the call that reads
/// it. These two are written down rather than spelled out at the call site
/// because two places write them — the login form settles `me` and signing out
/// empties it — and a key spelled differently in either place would leave the
/// previous person's name on the screen.
export const cacheKey = {
  identity: () => ["node", "identity"] as const,
  me: () => ["auth", "me"] as const,
}

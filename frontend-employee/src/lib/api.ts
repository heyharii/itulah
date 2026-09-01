import { Auth, Node } from "@itulah/contract/client"

/// This surface is served from the same origin as the CLOUD node it talks to,
/// so the base URL is empty: production rewrites `/api/*` to the node and
/// development proxies it (see vite.config.ts). One origin is not a
/// convenience here — the session cookie is `SameSite=Strict`, so a browser
/// would simply not send it across two.
export const node = new Node()
export const auth = new Auth(node)

/// A key that changes whenever a request's answer could change.
///
/// Only the two session reads live here; everything else this app asks for is
/// somebody's own HR record and is keyed in `lib/hr/queries.ts`. They are
/// written down rather than spelled out at the call site for the same reason:
/// a sign-out that clears a key nobody reads leaves the previous person's name
/// on the screen.
export const cacheKey = {
  identity: () => ["identity"] as const,
  me: () => ["auth", "me"] as const,
}

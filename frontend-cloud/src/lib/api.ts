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
/// Only the two session reads live here; every other answer this surface holds
/// is keyed beside the function that fetches it — `financeKeys`, `threadKey`,
/// and the rest. The session is the one thing read from both ends, by the
/// component that decides whether to draw a login box and by every screen that
/// has to name an actor on a decision, and two spellings of the one key had
/// both of them fetching `/auth/me` on first load.
export const cacheKey = {
  /// The node this surface is talking to. Two segments rather than the
  /// employee app's one: this app already keys a dozen domains off the first
  /// segment, and a bare `identity` reads like one of them.
  identity: () => ["node", "identity"] as const,
  me: () => ["auth", "me"] as const,
}

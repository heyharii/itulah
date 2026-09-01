import { Auth, Node } from "@itulah/contract/client"

/// This surface is served from the same origin as the CLOUD node it talks to,
/// so the base URL is empty: production rewrites `/api/*` to the node and
/// development proxies it (see vite.config.ts). One origin is not a
/// convenience — the session cookie is `SameSite=Strict`, so a browser simply
/// would not send it across two.
export const node = new Node()
export const auth = new Auth(node)

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
}

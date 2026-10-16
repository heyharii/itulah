import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import { conversationsQuery } from "@/lib/queries/discuss"
import { relayReady } from "@/lib/queries/hr"

/// What Discuss asks first, before it is open (`lib/prefetch.ts`). The options
/// are the screen's own (`lib/queries/discuss.ts`).
///
/// It opens on Chat, and the list of conversations is all Chat reads until one
/// is opened; the Notices feed is read when its tab is. Answered by head
/// office through the node's relay, so never warmed while idle (there is no
/// `warm` here).
export const prefetch: PrefetchMap = {
  "/news": (client) =>
    relayReady(client) ? warmQuery(client, conversationsQuery()) : undefined,
}

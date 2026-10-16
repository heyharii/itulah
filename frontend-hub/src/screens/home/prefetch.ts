import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import { briefQueryOptions } from "@/lib/queries/assistant"

/// What Home asks first, before the screen is open (`lib/prefetch.ts`): the
/// morning brief, with the options `useBrief` reads.
export const prefetch: PrefetchMap = {
  "/home": (client) => warmQuery(client, briefQueryOptions()),
}

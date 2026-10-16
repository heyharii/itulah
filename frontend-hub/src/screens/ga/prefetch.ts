import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import { gaOverviewQuery } from "@/lib/queries/ga"

/// What GA asks first, before the screen is open (`lib/prefetch.ts`). The
/// options are the screen's own (`lib/queries/ga.ts`).

export const prefetch: PrefetchMap = {
  // The overview is a single question, asked once.
  "/ga": (client) => warmQuery(client, gaOverviewQuery()),
}

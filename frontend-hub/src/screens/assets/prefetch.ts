import { warmInfinite, type PrefetchMap } from "@/lib/prefetch"
import { gaAssetBookQuery } from "@/lib/queries/ga"

/// What Assets asks first, before the screen is open (`lib/prefetch.ts`). The
/// options are the screen's own (`lib/queries/ga.ts`).

export const prefetch: PrefetchMap = {
  // The register opens on every build, nothing narrowed. A reading (a build
  // chip) lives in the address bar (`asset-view`); a link that carries one
  // asks for exactly that, and the screen does so itself.
  "/assets": (client, { search }) => {
    if (search["asset-view"] !== undefined) return
    return warmInfinite(client, gaAssetBookQuery({}))
  },
}

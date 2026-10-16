import { warmInfinite, type PrefetchMap } from "@/lib/prefetch"
import { gaContractBookQuery } from "@/lib/queries/ga"

/// What Contracts asks first, before the screen is open (`lib/prefetch.ts`).
/// The options are the screen's own (`lib/queries/ga.ts`).

export const prefetch: PrefetchMap = {
  // The register opens on the living contracts of every group. A group (a
  // chip) lives in the address bar (`contract-group`); a link that carries one
  // asks for exactly that, and the screen does so itself.
  "/contracts": (client, { search }) => {
    if (search["contract-group"] !== undefined) return
    return warmInfinite(client, gaContractBookQuery({ archived: false }))
  },
}

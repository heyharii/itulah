import { warmInfinite, type PrefetchMap } from "@/lib/prefetch"
import { letterListQuery } from "@/lib/queries/letters"

/// What Letters asks first, before the screen is open (`lib/prefetch.ts`). The
/// options are the screen's own (`lib/queries/letters.ts`).

export const prefetch: PrefetchMap = {
  // The register: every kind, every status, no search. One letter open
  // (`letter`) is the other state of this path and reads its own record.
  "/letters": (client, { search }) => {
    if (search.letter !== undefined) return
    return warmInfinite(client, letterListQuery({}))
  },
}

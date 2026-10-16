import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import { savedReportsQuery } from "@/lib/queries/reports"

/// What Reports asks first, before the screen is open (`lib/prefetch.ts`). The
/// options are the screen's own (`lib/queries/reports.ts`).

export const prefetch: PrefetchMap = {
  // The reports somebody kept. One report open (`report`) is the other state
  // of this path and reads its own definition and run.
  "/reports": (client, { search }) => {
    if (search.report !== undefined) return
    return warmQuery(client, savedReportsQuery())
  },
}

import { node } from "@/lib/api"
import type { GaOverview } from "@itulah/contract"

/// GA's own namespace on the wire.
///
/// The first segment is the domain, as it is for every module, so signing out
/// drops the whole department's answers by prefix. `ga` and not `finance`
/// because the two are different people's surfaces — see `http/ga.rs` — and a
/// screen that read its overview out of the books' namespace would be one more
/// place to remember that they are not the same thing.
export const gaKeys = {
  all: ["ga"] as const,

  /// One answer, and one key. The overview is a single question asked once —
  /// "what wants looking at today" — and every section in it comes from the
  /// same server-side thresholds. Splitting it per section would let a screen
  /// draw an expiring contract beside a repair that is two days stale.
  overview: () => ["ga", "overview"] as const,
}

/// What wants somebody's attention, as of the business clock's today.
///
/// No arguments: the thresholds are the server's, deliberately. A caller that
/// could pass a window would be a caller that could ask a different question
/// from the one the sidebar badge counts.
export function gaOverview(signal?: AbortSignal): Promise<GaOverview> {
  return node.get<GaOverview>("/api/v1/ga/overview", { signal })
}

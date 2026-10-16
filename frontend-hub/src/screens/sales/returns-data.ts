import type { ReturnScope } from "@/lib/queries/storeops"

/// A page the size the server defaults to. The table virtualises past 150.
export const PAGE = 100

/// The question the refund desk opens with: nothing searched or filtered,
/// biggest refund first (the `refund_total_minor` column, descending, as
/// `Returns` sets its sorting). Shared with the prefetcher (`prefetch.ts`).
export const RETURNS_OPENING_SCOPE: ReturnScope = {
  sort: "refund",
  dir: "desc",
  limit: PAGE,
}

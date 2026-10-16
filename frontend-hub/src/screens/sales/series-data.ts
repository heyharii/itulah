import { queryOptions } from "@tanstack/react-query"

import { analyticsKeys, salesSeries } from "@/lib/queries/analytics"
import type { SalesRange } from "@itulah/contract/reporting"

/// The fleet's takings over a span, bucketed: the one read Sales and Store
/// ranking are made of. Shared with the prefetcher (`prefetch.ts`) so the
/// server's answer is the screen's own.

/// The span being read. Today's column is still being written by tills that
/// are still open, so it is asked again every minute.
export const seriesQuery = (range: SalesRange) =>
  queryOptions({
    queryKey: analyticsKeys.series(range),
    queryFn: ({ signal }) => salesSeries(range, signal),
    refetchInterval: 60_000,
  })

/// The span before it, for the arrows. Nothing is still being written into a
/// span that has already closed. Read by a plain `useQuery`, never suspended
/// on: a comparison is worth nothing if it delays the number it qualifies.
export const priorSeriesQuery = (range: SalesRange) =>
  queryOptions({
    queryKey: analyticsKeys.series(range),
    queryFn: ({ signal }) => salesSeries(range, signal),
    staleTime: 5 * 60_000,
  })

/**
 * Document library query options — the only place a files cache key exists.
 *
 * See docs/frontend-rules.md §Q1 and src/components/inventory/queries.ts for
 * the pattern this follows.
 */

import { queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import { fetchDocumentLibrary } from "./api"

export const fileQueries = {
  all: () => ["files"] as const,

  /** The whole document library — folders, files and facets in one read.
   *  Classed `reference`, the same as the supplier directory: it changes on
   *  an upload or a move, not on a clock. */
  library: () =>
    queryOptions({
      queryKey: [...fileQueries.all(), "library"] as const,
      queryFn: ({ signal }) => fetchDocumentLibrary(signal),
      ...STALE.reference,
    }),
}

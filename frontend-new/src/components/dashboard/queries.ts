/**
 * Supplier directory query options — the only place a supplier cache key
 * exists.
 *
 * See docs/frontend-rules.md §Q1 and src/components/inventory/queries.ts for
 * the pattern this follows.
 */

import { queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import { fetchSupplierDirectory } from "./api"

export const supplierQueries = {
  all: () => ["suppliers"] as const,

  /**
   * The whole supplier directory. Classed `reference`, not `catalogue`: a
   * supplier record changes on a change-request, not on a shift, so a
   * 30-minute window is right and a refetch on focus would be noise.
   */
  directory: () =>
    queryOptions({
      queryKey: [...supplierQueries.all(), "directory"] as const,
      queryFn: ({ signal }) => fetchSupplierDirectory(signal),
      ...STALE.reference,
    }),
}

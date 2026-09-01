/**
 * Commercial query options — the only place a commercial cache key exists.
 *
 * See docs/frontend-rules.md §Q1 and src/components/inventory/queries.ts for
 * the reference this follows.
 */

import { queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import { fetchCommercialResource } from "./api"

export const commercialQueries = {
  all: () => ["commercial"] as const,

  /**
   * Every tab reads this one snapshot — campaigns, promotions, coupons,
   * vouchers, price lists, markdowns, pricing rules, the catalogue, stores,
   * divisions and tiers, assembled from three hub owners in one pass. Nothing
   * here closes over screen state (the price context, the search box, the
   * open tab), so the key carries no arguments.
   *
   * Classed `catalogue` rather than `ledger`: this is exactly the resource
   * set the class table names — articles, price lists, campaigns, supplier
   * records — authored by a person during the day, not a stream of movements
   * someone is acting on tick by tick.
   */
  snapshot: () =>
    queryOptions({
      queryKey: [...commercialQueries.all(), "snapshot"] as const,
      queryFn: ({ signal }) => fetchCommercialResource(signal),
      ...STALE.catalogue,
    }),
}

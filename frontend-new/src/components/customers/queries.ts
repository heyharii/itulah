/**
 * Customer query options — the only place a customer cache key exists.
 *
 * See docs/frontend-rules.md §Q1 and src/components/inventory/queries.ts for
 * the pattern this follows.
 */

import { queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import { fetchCustomer360, fetchCustomerDirectory } from "./api"

export const customerQueries = {
  all: () => ["customers"] as const,

  /** The admin directory — edited by a person during the day, not while
   *  someone else is watching the screen. */
  directory: () =>
    queryOptions({
      queryKey: [...customerQueries.all(), "directory"] as const,
      queryFn: ({ signal }) => fetchCustomerDirectory(signal),
      ...STALE.catalogue,
    }),

  /**
   * The 360 payload for whichever customer the URL is showing. Classed
   * `ledger`, not `operational`: it carries the purchase and points history,
   * and a stale balance here is money someone reads.
   */
  detail: (customerId: string | null | undefined) => {
    const id = customerId?.trim() ?? ""
    return queryOptions({
      queryKey: [...customerQueries.all(), "360", id] as const,
      queryFn: ({ signal }) => fetchCustomer360(id, signal),
      enabled: id.length > 0,
      ...STALE.ledger,
    })
  },
}

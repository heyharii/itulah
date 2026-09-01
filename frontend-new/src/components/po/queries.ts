/**
 * Purchase-order query options — the only place a PO cache key exists.
 *
 * See docs/frontend-rules.md §Q1 and src/components/inventory/queries.ts for
 * the pattern this follows.
 */

import { queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import {
  fetchPurchaseOrder,
  fetchPurchaseOrders,
  type PurchaseOrderQuery,
} from "./api"

export const poQueries = {
  all: () => ["po"] as const,

  /** The order list, PO lists and receiving move with the working day. */
  list: (query: PurchaseOrderQuery = {}) =>
    queryOptions({
      queryKey: [...poQueries.all(), "list", query.status ?? "all"] as const,
      queryFn: ({ signal }) => fetchPurchaseOrders(query, signal),
      ...STALE.operational,
    }),

  /** The order the URL says is open, by id. */
  detail: (id: string | null) =>
    queryOptions({
      queryKey: [...poQueries.all(), "detail", id] as const,
      queryFn: ({ signal }) => fetchPurchaseOrder(id ?? "", signal),
      enabled: Boolean(id),
      ...STALE.operational,
    }),
}

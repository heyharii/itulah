/**
 * Inventory query options — the only place an inventory cache key exists.
 *
 * `queryOptions` pairs a key with its fetcher and its cache class in one typed
 * object, so the route loader, the screen and any future mutation all name the
 * same query without repeating it. The old `useApiQuery` took the key as a loose
 * argument and threw that pairing away, which is why no loader could exist.
 *
 * See docs/frontend-rules.md §Q1.
 */

import { queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import {
  fetchInventory,
  fetchInventoryOperations,
  fetchCycleCountVariance,
  fetchInboundReturnDetail,
} from "./api"

export const inventoryQueries = {
  all: () => ["inventory"] as const,

  /**
   * The estate-wide snapshot behind the monitor, missing and ledger tabs.
   *
   * cloud-hub has no per-location balance route this screen can use, so the
   * request closes over nothing and the key carries no scope: the selected
   * location filters the one cached snapshot rather than refetching it. That
   * is also why changing the location filter is instant.
   *
   * Classed as `ledger` rather than `operational`: the movements inside this
   * payload are the signed stock ledger, and someone acts on those numbers.
   */
  snapshot: () =>
    queryOptions({
      queryKey: [...inventoryQueries.all(), "snapshot"] as const,
      queryFn: ({ signal }) => fetchInventory(signal),
      ...STALE.ledger,
    }),

  /** HO cycle counts and inbound returns — worklists, not stock figures. */
  operations: () =>
    queryOptions({
      queryKey: [...inventoryQueries.all(), "operations"] as const,
      queryFn: ({ signal }) => fetchInventoryOperations(signal),
      ...STALE.operational,
    }),

  cycleCountVariance: (id: string | null) =>
    queryOptions({
      queryKey: [...inventoryQueries.all(), "cycle-count", id, "variance"] as const,
      queryFn: ({ signal }) => fetchCycleCountVariance(id ?? "", signal),
      enabled: Boolean(id),
      ...STALE.operational,
    }),

  inboundReturn: (id: string | null) =>
    queryOptions({
      queryKey: [...inventoryQueries.all(), "inbound-return", id] as const,
      queryFn: ({ signal }) => fetchInboundReturnDetail(id ?? "", signal),
      enabled: Boolean(id),
      ...STALE.operational,
    }),
}

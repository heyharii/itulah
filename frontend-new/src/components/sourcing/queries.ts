/**
 * Sourcing query options — the only place a sourcing or shortlist cache key
 * exists.
 *
 * The catalogue and the shortlist stay two hierarchies, not one, because they
 * were already two independent top-level keys (`["sourcing", ...]` and
 * `["shortlist", ...]`) that writes.ts-equivalents in `api.ts` invalidate
 * separately today — see `SOURCING_KEY` / `SHORTLIST_KEY`. Folding them under
 * one `all()` would either widen every shortlist write's invalidation to the
 * whole catalogue, or require carrying two prefixes through this file's own
 * `all()`, neither of which the recipe asks for.
 *
 * See docs/frontend-rules.md §Q1 and src/components/inventory/queries.ts for
 * the reference this follows.
 */

import { queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import {
  listQueryKey,
  type ListQuery,
  type SortOrder,
} from "@/shared/api/list-query"
import {
  fetchSourcingCatalog,
  fetchSourcingItems,
  fetchSourcingReference,
  fetchSourcingShortlist,
} from "./api"

/** The sort keys the sourcing screen offers, as they appear in the URL. */
export type SourcingSortKey = "name" | "price" | "lead" | "updated"

/**
 * What the URL says the buyer is looking at.
 *
 * Deliberately a plain shape rather than the route's own search type: the
 * route imports this module, so importing its types back would close a cycle.
 */
export interface SourcingScope {
  q?: string
  division?: string[]
  supplier?: string[]
  tag?: string[]
  sort?: SourcingSortKey
  dir?: SortOrder
}

/* URL sort key → the `sort_by` value on `sourcingitem`'s SortWhitelist. */
const SORT_FIELD: Record<SourcingSortKey, string> = {
  name: "name",
  price: "unit_cost",
  lead: "lead_time_days",
  updated: "updated_at",
}

/**
 * The scope in the URL as the one shape a list request is made from.
 *
 * `division` carries division ids, not the display names the rail used to
 * filter on: `sourcing_items.division_id` is what the server can index, and a
 * name is not unique by contract.
 */
export function sourcingListQuery(scope: SourcingScope): ListQuery {
  const order: SortOrder = scope.dir === "desc" ? "desc" : "asc"
  const key = scope.sort ?? "updated"
  return {
    q: scope.q,
    sort: {
      field: SORT_FIELD[key],
      /* "Updated" reads as recency, not as a number: the screen has always put
       * the most recently touched style first under an ascending arrow, while
       * the column it sorts is a timestamp where newest is *largest*. Flip it
       * here so the arrow keeps meaning what it has always meant on screen. */
      order: key === "updated" ? (order === "asc" ? "desc" : "asc") : order,
    },
    filters: {
      division_id: scope.division,
      supplier_id: scope.supplier,
      tag_id: scope.tag,
    },
  }
}

export const sourcingQueries = {
  all: () => ["sourcing"] as const,

  /**
   * The whole, unfiltered catalogue joined onto its master data. Read by the
   * PO screens, which resolve order lines against every sourcing item and have
   * no scope of their own. The sourcing screen uses `reference` + `items`.
   */
  catalog: () =>
    queryOptions({
      queryKey: [...sourcingQueries.all(), "catalog"] as const,
      queryFn: ({ signal }) => fetchSourcingCatalog(signal),
      ...STALE.catalogue,
    }),

  /**
   * Suppliers, divisions, tags and locations — what the filters are chosen
   * *from*. Keyless because it does not depend on the scope, which is the
   * point: narrowing to one supplier must not empty the supplier list.
   */
  reference: () =>
    queryOptions({
      queryKey: [...sourcingQueries.all(), "reference"] as const,
      queryFn: ({ signal }) => fetchSourcingReference(signal),
      ...STALE.catalogue,
    }),

  /**
   * The server-filtered item list. The query goes into the key whole (flattened
   * by `listQueryKey`), so changing a filter starts a different list rather
   * than continuing the old one — docs/list-contract.md §3.
   */
  items: (query: ListQuery) =>
    queryOptions({
      queryKey: [
        ...sourcingQueries.all(),
        "items",
        listQueryKey(query),
      ] as const,
      queryFn: ({ signal }) => fetchSourcingItems(query, signal),
      ...STALE.catalogue,
    }),
}

export const shortlistQueries = {
  all: () => ["shortlist"] as const,

  /**
   * The named shortlist collection: which sourcing items are staged, and
   * which list each belongs to. This is a worklist a buyer is actively
   * building towards a PO, not reference data — `operational` matches it,
   * same as inventory's cycle-count and inbound-return worklists.
   */
  entries: () =>
    queryOptions({
      queryKey: [...shortlistQueries.all(), "entries"] as const,
      queryFn: ({ signal }) => fetchSourcingShortlist(signal),
      ...STALE.operational,
    }),
}

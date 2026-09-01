/**
 * Articles query options — the only place an articles cache key exists.
 *
 * See docs/frontend-rules.md §Q1 and src/components/inventory/queries.ts for
 * the reference this follows.
 */

import { queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import { listQueryKey } from "@/shared/api/list-query"
import { articleListQuery, fetchArticleCatalogue, type ArticleFilters } from "./api"

export const articlesQueries = {
  all: () => ["articles"] as const,

  /**
   * The article master — variant groups joined onto the item master, plus the
   * division and tag vocabularies and the hub's facet counts.
   *
   * The search and the two rails are part of the key, because they are part of
   * the *request*: the hub applies them (see `_lib/listquery` on
   * `/items/enriched`), so a different filter is a different list rather than a
   * continuation of the old one — docs/list-contract.md §3, frontend-rules Q3.
   * Layout, the expanded rows and the open sheet stay out of it; those are read
   * off the payload the screen already holds.
   *
   * Classed `catalogue`: this is what we sell, edited by a merchandiser during
   * the day and read by everyone else, not a figure someone is acting on tick
   * by tick.
   */
  catalogue: (filters: ArticleFilters = {}) =>
    queryOptions({
      queryKey: [
        ...articlesQueries.all(),
        "catalogue",
        listQueryKey(articleListQuery(filters)),
      ] as const,
      queryFn: ({ signal }) => fetchArticleCatalogue(filters, signal),
      ...STALE.catalogue,
    }),
}

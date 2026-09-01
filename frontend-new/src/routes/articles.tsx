import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

import { Articles } from "@/components/articles/articles"
import {
  ArticlesError,
  ArticlesPending,
} from "@/components/articles/route-states"
import { articlesQueries } from "@/components/articles/queries"

/**
 * What the article master is showing: the search, the two nav filters, the
 * layout, which rows are opened into their SKUs, and the article in the sheet.
 *
 * `divisionIds`, `tagNames` and `supplierIds` are arrays because all three
 * rails are multi-select: a merchandiser comparing Menswear against Kids, or
 * one supplier's range against another's, should not have to pick one.
 * An empty array — like an absent param — means no filter, never "match
 * nothing". `expanded` is repeatable for the same reason it always was: one
 * entry per opened row, so a link restores the set it was copied from.
 */
const searchSchema = z.object({
  query: z.string().optional(),
  divisionIds: z.array(z.string()).optional(),
  tagNames: z.array(z.string()).optional(),
  /** Supplier IDS, not names — a name is a label and two suppliers may share
   *  one. This is "articles this supplier may supply", through the sourcing
   *  link; it is not purchase history. */
  supplierIds: z.array(z.string()).optional(),
  layout: z.enum(["grid", "table"]).default("grid"),
  expanded: z.array(z.string()).optional(),
  /** The article the detail sheet is showing, by id. */
  open: z.string().optional(),
})

export type ArticlesSearch = z.infer<typeof searchSchema>

/** A bare `/articles` is the grid, unfiltered. Defaults are stripped so it stays that way. */
const SEARCH_DEFAULTS: Partial<ArticlesSearch> = {
  layout: "grid",
}

export const Route = createFileRoute("/articles")({
  validateSearch: zodValidator(searchSchema),
  search: { middlewares: [stripSearchParams(SEARCH_DEFAULTS)] },

  /**
   * The search and the three rails are `loaderDeps` because the hub applies
   * them: they go on the wire as `q`, `division_id`, `tag` and `supplier_id`,
   * and they are part of the cache key, so changing one is a different list
   * rather than a re-filter of the last one.
   *
   * `layout`, `expanded` and `open` are deliberately absent — they change what
   * the screen draws, not what it asked for, and putting them here would refetch
   * the catalogue every time a row was opened.
   */
  loaderDeps: ({ search: { query, divisionIds, tagNames, supplierIds } }) => ({
    query,
    divisionIds,
    tagNames,
    supplierIds,
  }),

  loader: async ({ context: { queryClient }, deps }) => {
    await queryClient.query({
      ...articlesQueries.catalogue(deps),
      staleTime: "static",
    })
  },

  component: Articles,
  pendingComponent: ArticlesPending,
  errorComponent: ArticlesError,
})

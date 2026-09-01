import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

import { Sourcing } from "@/components/sourcing/sourcing"
import {
  SourcingError,
  SourcingPending,
} from "@/components/sourcing/route-states"
import {
  shortlistQueries,
  sourcingListQuery,
  sourcingQueries,
} from "@/components/sourcing/queries"

/* Everything that decides which styles the buyer is looking at — the scope in
 * the left rail, the search box, the layout toggle, the sort, and the style
 * whose sheet is open. `detail` carries only the product id; the object is
 * resolved from the loaded list.
 *
 * `staged` is the shortlist: the same catalogue, narrowed to what has been
 * starred and grouped by the supplier a PO would go to. It is a scope, not a
 * second screen, so it lives here with the other scopes.
 *
 * `division`, `supplier` and `tag` are arrays because each is a set: picking a
 * second supplier means "either", not "instead". They carry ids — the division
 * id, the supplier id, the master-tag id — because those are what the server
 * filters on. `division` used to be `category` and used to hold a display
 * name; a name is not a key, and the rename is what stops a stale link from
 * silently matching nothing. */
const idList = z.array(z.string())

const searchSchema = z.object({
  staged: z.boolean().default(false),
  division: idList.optional(),
  supplier: idList.optional(),
  tag: idList.optional(),
  q: z.string().optional(),
  layout: z.enum(["grid", "table"]).default("grid"),
  sort: z.enum(["name", "price", "lead", "updated"]).default("updated"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  detail: z.string().optional(),
})

export type SourcingSearch = z.infer<typeof searchSchema>

/** A bare `/sourcing` is the catalogue at rest, so it should stay bare. */
const SEARCH_DEFAULTS: Partial<SourcingSearch> = {
  staged: false,
  layout: "grid",
  sort: "updated",
  dir: "asc",
}

export const Route = createFileRoute("/sourcing")({
  validateSearch: zodValidator(searchSchema),
  search: { middlewares: [stripSearchParams(SEARCH_DEFAULTS)] },

  /**
   * Search, the three id filters and the sort are the request now, not a
   * post-fetch `.filter()`, so they are deps: a change to any of them is a
   * different list and has to re-run the loader. `staged`, `layout` and
   * `detail` are deliberately absent — they rearrange or annotate rows the
   * screen already holds and must not refetch.
   */
  loaderDeps: ({ search: { q, division, supplier, tag, sort, dir } }) => ({
    q,
    division,
    supplier,
    tag,
    sort,
    dir,
  }),

  /**
   * The shortlist only fills in which stars are lit and which group `staged`
   * narrows to, and the screen's own `useQuery` already owns its loading state
   * for that — so it is kicked off but not awaited. The filter master data and
   * the scoped item list are both what the first paint needs.
   */
  loader: async ({ context: { queryClient }, deps }) => {
    void queryClient.query(shortlistQueries.entries()).catch(() => {})
    await Promise.all([
      queryClient.query(sourcingQueries.reference()),
      queryClient.query(sourcingQueries.items(sourcingListQuery(deps))),
    ])
  },

  component: Sourcing,
  pendingComponent: SourcingPending,
  errorComponent: SourcingError,
})

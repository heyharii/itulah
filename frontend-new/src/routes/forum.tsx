import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

import { Forum } from "@/components/forum/forum"
import { ForumError, ForumPending } from "@/components/forum/route-states"
import { forumQueries } from "@/components/forum/queries"

/**
 * What the board is showing: which feed, which category or tag, the sort,
 * the search, and the topic that is open. Composer drafts stay local.
 */
const searchSchema = z.object({
  view: z.enum(["all", "open", "priority"]).default("all"),
  sort: z.enum(["latest", "top", "new"]).default("latest"),
  category: z.string().optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  /** The topic the thread view is showing, by id. */
  open: z.string().optional(),
})

export type ForumSearch = z.infer<typeof searchSchema>

/** A bare `/forum` is every topic, newest first. Defaults are stripped so it stays that way. */
const SEARCH_DEFAULTS: Partial<ForumSearch> = {
  view: "all",
  sort: "latest",
}

export const Route = createFileRoute("/forum")({
  validateSearch: zodValidator(searchSchema),
  search: { middlewares: [stripSearchParams(SEARCH_DEFAULTS)] },

  /** `view` picks a real server-side feed filter, so it re-runs the loader —
   *  without `loaderDeps` a tab change would navigate onto stale data. */
  loaderDeps: ({ search }) => ({ view: search.view }),
  loader: async ({ context: { queryClient }, deps }) => {
    await queryClient.query({
      ...forumQueries.overview(deps.view),
      staleTime: "static",
    })
  },

  component: Forum,
  pendingComponent: ForumPending,
  errorComponent: ForumError,
})

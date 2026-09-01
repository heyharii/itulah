import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

import { HrHeadOffice } from "@/components/hr/hr-ho"
import { HrHoError, HrHoPending } from "@/components/hr/route-states"
import { hrQueries } from "@/components/hr/queries"

/* What the head-office People screen is looking at: which section, which
 * slice of the org, how the directory is drawn, and whose card is open.
 * Unsaved drafts (a shift, a pay component, a holiday) stay in the screen. */
const searchSchema = z.object({
  tab: z
    .enum([
      "overview",
      "directory",
      "decisions",
      "shifts",
      "components",
      "calendar",
      "benefits",
    ])
    .catch("overview")
    .default("overview"),
  location: z.string().optional(),
  division: z.string().optional(),
  query: z.string().optional(),
  layout: z.enum(["table", "grid"]).catch("table").default("table"),
  /* one param for the open person, whether the card is drawn from the live
   * directory or the local fixture registry */
  open: z.string().optional(),
})

export type HrHoSearch = z.infer<typeof searchSchema>

/** A bare `/hr-ho` is the estate overview. Defaults are stripped so it stays that way. */
const SEARCH_DEFAULTS: Partial<HrHoSearch> = {
  tab: "overview",
  layout: "table",
}

export const Route = createFileRoute("/_people/hr-ho")({
  validateSearch: zodValidator(searchSchema),
  search: { middlewares: [stripSearchParams(SEARCH_DEFAULTS)] },

  /**
   * The overview counters have no scope of their own — HO's dashboard is
   * estate-wide regardless of the directory's location/division filter — so
   * they are the critical query, awaited with a warm-cache-is-fine staleTime.
   *
   * The People directory is scoped by the same filters the sidebar and
   * search box write into the URL, so it needs `loaderDeps` to re-run when
   * they change; it stays a secondary, fire-and-forget fetch because its own
   * `useDomainQuery` in the directory tab already owns its loading state.
   */
  loaderDeps: ({ search }) => ({
    location: search.location,
    division: search.division,
    query: search.query,
  }),
  loader: async ({ context: { queryClient }, deps }) => {
    void queryClient
      .query(
        hrQueries.employees({
          locationId: deps.location,
          department: deps.division,
          search: deps.query,
          limit: 200,
        })
      )
      .catch(() => {})
    await queryClient.query({
      ...hrQueries.dashboard(),
      staleTime: "static",
    })
  },

  component: HrHeadOffice,
  pendingComponent: HrHoPending,
  errorComponent: HrHoError,
})

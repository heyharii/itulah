import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

import { HrStore } from "@/components/hr/hr-store"
import { currentMonthBounds } from "@/components/hr/month"
import { HrStoreError, HrStorePending } from "@/components/hr/route-states"
import { hrQueries } from "@/components/hr/queries"
import { LOCATIONS } from "@/components/hr/data"
import { todayKey } from "@/lib/day"

/* A manager belongs to exactly one of these; anything else in the URL is a
 * stale or hand-edited link and falls back to the default store rather than
 * rendering a screen with no location behind it. */
const STORE_IDS = LOCATIONS.filter((l) => l.kind !== "ho").map((l) => l.id)
const DEFAULT_STORE = "st-grand"

/* A store manager's screen state: which section, which store, which roster
 * week, and whose card is open. Everything a manager is part-way through
 * typing — a pay line, an attendance fix, a hire request — stays local. */
const searchSchema = z.object({
  tab: z
    .enum(["roster", "team", "attendance", "leave", "pay", "benefits"])
    .catch("roster")
    .default("roster"),
  locationId: z
    .string()
    .refine((id) => STORE_IDS.includes(id))
    .catch(DEFAULT_STORE)
    .default(DEFAULT_STORE),
  /* the Monday the roster week starts on; absent means the current week */
  week: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  open: z.string().optional(),
})

export type HrStoreSearch = z.infer<typeof searchSchema>

/** A bare `/hr-store` is this week's roster at the default store. Defaults are stripped so it stays that way. */
const SEARCH_DEFAULTS: Partial<HrStoreSearch> = {
  tab: "roster",
  locationId: DEFAULT_STORE,
}

export const Route = createFileRoute("/_people/hr-store")({
  validateSearch: zodValidator(searchSchema),
  search: { middlewares: [stripSearchParams(SEARCH_DEFAULTS)] },

  /**
   * Today's workforce coverage for the selected store is the critical query
   * — it is what "today's attendance moves with the working day" means for
   * this screen, so it is awaited with a warm-cache-is-fine staleTime rather
   * than blocking navigation on a fresh number every time.
   *
   * The team directory and this month's attendance window are secondary:
   * fired during navigation so their tabs render from a warm cache, but not
   * awaited — each owns its own loading state through its own
   * `useDomainQuery`. `locationId` is the only search param either reads, so
   * it is the only one declared in `loaderDeps`.
   */
  loaderDeps: ({ search }) => ({ locationId: search.locationId }),
  loader: async ({ context: { queryClient }, deps }) => {
    void queryClient
      .query(hrQueries.employees({ locationId: deps.locationId, limit: 200 }))
      .catch(() => {})
    void queryClient
      .query(
        hrQueries.attendance({
          locationId: deps.locationId,
          ...currentMonthBounds(),
          limit: 200,
        })
      )
      .catch(() => {})
    await queryClient.query({
      ...hrQueries.workforce(deps.locationId, todayKey()),
      staleTime: "static",
    })
  },

  component: HrStore,
  pendingComponent: HrStorePending,
  errorComponent: HrStoreError,
})

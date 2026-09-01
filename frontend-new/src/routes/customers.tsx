import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

import { Customers } from "@/components/customers/customers"
import {
  CustomersError,
  CustomersPending,
} from "@/components/customers/route-states"
import { customerQueries } from "@/components/customers/queries"

/**
 * Everything that decides what the customers app is showing.
 *
 * `open` is the customer id rather than the customer: the directory and the
 * 360 payload are two separate reads, and keying the detail fetch off the id
 * in the URL is what lets a profile survive a reload, a Back, or a link that
 * arrives before the directory has landed.
 */
const searchSchema = z.object({
  tab: z.enum(["people", "segments", "loyalty"]).default("people"),
  /** Free text over name, member id and phone. */
  query: z.string().optional(),
  tier: z.enum(["all", "gold", "silver", "none"]).default("all"),
  /** A segment id from `SEGMENTS`; narrows the people list. */
  segment: z.string().optional(),
  /** The customer the 360 sheet is showing, by id. */
  open: z.string().optional(),
})

export type CustomersSearch = z.infer<typeof searchSchema>

/** A bare `/customers` is every member. Defaults are stripped so it stays that way. */
const SEARCH_DEFAULTS: Partial<CustomersSearch> = {
  tab: "people",
  tier: "all",
}

export const Route = createFileRoute("/customers")({
  validateSearch: zodValidator(searchSchema),
  search: { middlewares: [stripSearchParams(SEARCH_DEFAULTS)] },

  /**
   * The directory is the critical query. The 360 sheet (`open`) is not
   * prefetched here, same as inventory's cycle-count/inbound-return detail
   * reads: it is a drill-down the screen's own `useDomainQuery` owns, not
   * something the whole route should wait on.
   */
  loader: async ({ context: { queryClient } }) => {
    await queryClient.query({
      ...customerQueries.directory(),
      staleTime: "static",
    })
  },

  component: Customers,
  pendingComponent: CustomersPending,
  errorComponent: CustomersError,
})

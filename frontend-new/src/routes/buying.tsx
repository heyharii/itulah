import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

import { Buying } from "@/components/dashboard/dashboard"
import {
  BuyingError,
  BuyingPending,
} from "@/components/dashboard/route-states"
import { supplierQueries } from "@/components/dashboard/queries"
import { SECTION_IDS, SORT_KEYS, VIEW_IDS } from "@/components/dashboard/data"
import { poQueries } from "@/components/po/queries"

/**
 * Everything that decides what the Buying screen is showing. The app has two
 * halves — the supplier directory and the orders placed with those suppliers —
 * and `section` is what picks between them, so the two halves keep their own
 * prefixed params rather than fighting over one `open` or one `sort`.
 *
 * Drafts, toasts and chrome stay local.
 */
const searchSchema = z.object({
  /** Which half of the app you are in: the directory, or its orders. */
  section: z.enum(SECTION_IDS).default("suppliers"),
  /** Which nav sections are unfolded. */
  expanded: z.array(z.enum(SECTION_IDS)).default(["suppliers"]),

  /* ── the supplier directory ─────────────────────────────────────────── */
  /** The saved-view tab / the Suppliers nav leaf — they are the same thing. */
  view: z.enum(VIEW_IDS).default("main"),
  q: z.string().default(""),
  /** Only suppliers with no purchase-order or receipt history. */
  noHistory: z.boolean().default(false),
  sort: z.enum(SORT_KEYS).optional(),
  dir: z.enum(["asc", "desc"]).default("asc"),
  /** Id of the supplier the detail sheet is showing. */
  open: z.string().optional(),

  /* ── the orders those suppliers get ─────────────────────────────────── */
  /** Its presence — even as an empty array — is what opens the PO draft. */
  draftFor: z.array(z.string()).optional(),
  /** Id of the purchase order whose detail is showing. */
  order: z.string().optional(),
  orderStatus: z
    .enum(["draft", "in-review", "approved", "sent", "active", "closed", "cancelled"])
    .optional(),
  /** Narrows the order list to one supplier — how a record reaches its orders. */
  orderSupplier: z.string().optional(),
})

export type BuyingSearch = z.infer<typeof searchSchema>

/** A bare `/buying` is the resting state, so it should stay bare. */
const SEARCH_DEFAULTS: Partial<BuyingSearch> = {
  view: "main",
  section: "suppliers",
  expanded: ["suppliers"],
  q: "",
  noHistory: false,
  dir: "asc",
}

export const Route = createFileRoute("/buying")({
  validateSearch: zodValidator(searchSchema),
  search: { middlewares: [stripSearchParams(SEARCH_DEFAULTS)] },

  /**
   * `/buying` is one route with two halves — the supplier directory and the
   * orders placed with those suppliers — and `section` is what picks between
   * them. Both queries load on every visit regardless (the nav's order counts
   * need the PO list even while looking at suppliers, and the directory
   * backs the supplier column on the orders pane), but only the half the
   * user actually lands on gates the navigation: the other one is fired and
   * forgotten, same as inventory's secondary `operations` query.
   */
  loaderDeps: ({ search }) => ({ section: search.section }),
  loader: async ({ context: { queryClient }, deps }) => {
    if (deps.section === "orders") {
      void queryClient.query(supplierQueries.directory()).catch(() => {})
      await queryClient.query({ ...poQueries.list(), staleTime: "static" })
      return
    }
    void queryClient.query(poQueries.list()).catch(() => {})
    await queryClient.query({
      ...supplierQueries.directory(),
      staleTime: "static",
    })
  },

  component: Buying,
  pendingComponent: BuyingPending,
  errorComponent: BuyingError,
})

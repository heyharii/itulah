import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

import { Commercial } from "@/components/commercial/commercial"
import {
  CommercialError,
  CommercialPending,
} from "@/components/commercial/route-states"
import { commercialQueries } from "@/components/commercial/queries"

/**
 * Everything that decides what commercial is showing.
 *
 * The price context is the reason this screen needed the URL at all: a price
 * only means anything alongside the store, channel and tier it resolved for,
 * and none of that could be linked to while it lived in a `useState` object.
 * It is flattened into three scalars so the link stays readable.
 */
const searchSchema = z.object({
  tab: z
    .enum(["catalog", "pricing", "campaigns", "codes", "returns"])
    .default("catalog"),
  query: z.string().optional(),
  /** The article the detail sheet is showing, by id. */
  open: z.string().optional(),
  /* the price context */
  store: z.string().optional(),
  channel: z.enum(["pos", "online"]).default("pos"),
  tier: z.string().optional(),
  /** Catalogue view toggle. */
  layout: z.enum(["table", "grid"]).default("table"),
  /** Vouchers tab: which kind of code is listed. */
  kind: z.enum(["all", "coupon", "voucher"]).default("all"),
  /** Campaigns tab: the expanded card, and the campaign the sheet is showing. */
  expand: z.string().optional(),
  detail: z.string().optional(),
})

export type CommercialSearch = z.infer<typeof searchSchema>

/** A bare `/commercial` is the catalogue at POS prices. Defaults are stripped so it stays that way. */
const SEARCH_DEFAULTS: Partial<CommercialSearch> = {
  tab: "catalog",
  channel: "pos",
  layout: "table",
  kind: "all",
}

export const Route = createFileRoute("/commercial")({
  validateSearch: zodValidator(searchSchema),
  search: { middlewares: [stripSearchParams(SEARCH_DEFAULTS)] },

  /**
   * Every tab reads the one commercial snapshot, and none of the search
   * params (tab, the price context, the filters) change what the fetcher
   * closes over — they only narrow it client-side. So there is one critical
   * query and no `loaderDeps`.
   */
  loader: async ({ context: { queryClient } }) => {
    await queryClient.query({
      ...commercialQueries.snapshot(),
      staleTime: "static",
    })
  },

  component: Commercial,
  pendingComponent: CommercialPending,
  errorComponent: CommercialError,
})

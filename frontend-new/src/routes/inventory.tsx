import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

import { Inventory } from "@/components/inventory/inventory"
import {
  InventoryError,
  InventoryPending,
} from "@/components/inventory/route-states"
import { inventoryQueries } from "@/components/inventory/queries"

/* Kept in step with `MoveKind` in @/components/inventory/data — an unknown
 * kind in the URL is rejected rather than silently filtering everything out. */
const MOVE_KINDS = [
  "receive",
  "dispatch",
  "transfer",
  "sale",
  "return",
  "correction",
  "count",
  "write-off",
] as const

/**
 * Everything that decides what the inventory screen is showing.
 *
 * `focus` is a location/bucket/stage drill-down; it is flattened into three
 * scalars so the URL stays readable and shareable rather than carrying a
 * serialised object.
 */
const searchSchema = z.object({
  tab: z
    .enum(["monitor", "missing", "ledger", "operations"])
    .default("monitor"),

  /* monitor — the drill-down and its article search */
  location: z.string().optional(),
  bucket: z.string().optional(),
  stage: z.string().optional(),
  q: z.string().optional(),

  /* missing — the status filter and the open unit */
  status: z.enum(["open", "found", "written-off", "all"]).default("open"),
  unit: z.string().optional(),

  /* ledger — its own movement-kind filter and its own search */
  kind: z.array(z.enum(MOVE_KINDS)).optional(),
  lq: z.string().optional(),

  /* operations — the open cycle-count / inbound-return detail sheet */
  op: z.enum(["count", "return"]).optional(),
  opId: z.string().optional(),
})

export type InventorySearch = z.infer<typeof searchSchema>

/** A bare `/inventory` is the monitor. Defaults are stripped so it stays that way. */
const SEARCH_DEFAULTS: Partial<InventorySearch> = {
  tab: "monitor",
  status: "open",
}

export const Route = createFileRoute("/inventory")({
  validateSearch: zodValidator(searchSchema),
  search: { middlewares: [stripSearchParams(SEARCH_DEFAULTS)] },

  /**
   * Start the snapshot during navigation rather than on mount.
   *
   * The screen used to render, then ask — so every arrival was blank, then a
   * spinner, then content, with the round trip serialised after the route's
   * code chunk. Here the fetch and the chunk load in parallel, and the screen
   * subscribes to a cache that is already warm.
   *
   * The snapshot is the critical query, so it is awaited. Operations feeds a
   * secondary tab, so it is fired and forgotten: awaiting it would let the
   * slower of the two gate the whole navigation, and its own `useQuery` owns
   * its loading and error state. Errors on the critical one are NOT swallowed
   * — `errorComponent` needs them.
   */
  loader: async ({ context: { queryClient } }) => {
    void queryClient.query(inventoryQueries.operations()).catch(() => {})
    await queryClient.query({
      ...inventoryQueries.snapshot(),
      staleTime: "static",
    })
  },

  component: Inventory,
  pendingComponent: InventoryPending,
  errorComponent: InventoryError,
})

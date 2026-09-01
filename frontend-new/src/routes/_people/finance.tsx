import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

import { Finance } from "@/components/finance/finance"
import { FinanceError, FinancePending } from "@/components/finance/route-states"
import { financeQueries } from "@/components/finance/queries"

/**
 * What the finance screen is looking at: the tab, and the supplier account
 * whose sheet is open. The payment draft is an unsaved form and stays local.
 */
const searchSchema = z.object({
  tab: z
    .enum(["overview", "payables", "revenue", "payroll", "expenses", "cash"])
    .default("overview"),
  /** Supplier id behind the account sheet. */
  openId: z.string().optional(),
})

export type FinanceSearch = z.infer<typeof searchSchema>

/** A bare `/finance` is the overview. Defaults are stripped so it stays that way. */
const SEARCH_DEFAULTS: Partial<FinanceSearch> = {
  tab: "overview",
}

export const Route = createFileRoute("/_people/finance")({
  validateSearch: zodValidator(searchSchema),
  search: { middlewares: [stripSearchParams(SEARCH_DEFAULTS)] },

  /**
   * Suppliers, payables and the posted P&L/cash-flow reports are the
   * critical query — the rail's "owed to suppliers" tile, the supplier list
   * and the overview tab all read it, so it is awaited. `staleTime: "static"`
   * accepts a warm cache rather than blocking navigation on a refetch; the
   * screen's own `useQuery` still owns revalidation on focus, per
   * `STALE.ledger`.
   *
   * Reimbursement claims feed only the claims tab, so they are fired and
   * forgotten: awaiting them would let that one tab's fetch gate the whole
   * navigation.
   */
  loader: async ({ context: { queryClient } }) => {
    void queryClient.query(financeQueries.reimbursements()).catch(() => {})
    await queryClient.query({
      ...financeQueries.resource(),
      staleTime: "static",
    })
  },

  component: Finance,
  pendingComponent: FinancePending,
  errorComponent: FinanceError,
})

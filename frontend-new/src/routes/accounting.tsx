import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

import { Accounting } from "@/components/accounting/accounting"
import {
  AccountingError,
  AccountingPending,
} from "@/components/accounting/route-states"
import { accountingQueries } from "@/components/accounting/queries"

/**
 * Everything that decides what the ledger is showing.
 *
 * The two filters are the whole point of putting this app in the URL: a
 * journal read is `account × period`, and until now neither half could be
 * linked to or restored. Both are named the way a bookkeeper names them —
 * the account by its CODE, not by the uuid the general-ledger route wants —
 * so the link stays readable; the code is resolved to an id against the chart
 * of accounts inside the screen.
 *
 * `openAccount` is likewise the account code the detail sheet is showing.
 */
const searchSchema = z.object({
  tab: z.enum(["chart", "journal", "balance", "periods"]).default("chart"),
  /** Account filter, by account code. Absent means every account. */
  accountCode: z.string().optional(),
  /** Period filter, by period id. Absent means the whole fiscal calendar. */
  periodId: z.string().optional(),
  /** The account the detail sheet is showing, by code. */
  openAccount: z.string().optional(),
})

export type AccountingSearch = z.infer<typeof searchSchema>

/** A bare `/accounting` is the chart of accounts. Defaults are stripped so it stays that way. */
const SEARCH_DEFAULTS: Partial<AccountingSearch> = {
  tab: "chart",
}

export const Route = createFileRoute("/accounting")({
  validateSearch: zodValidator(searchSchema),
  search: { middlewares: [stripSearchParams(SEARCH_DEFAULTS)] },

  /* The period and account filters decide the reporting window the secondary
   * reports are prefetched for, so both are loader deps — without them,
   * changing either in the URL would not re-run the loader. */
  loaderDeps: ({ search }) => ({
    periodId: search.periodId,
    accountCode: search.accountCode,
  }),

  /**
   * The chart of accounts, fiscal calendar and periods are the critical
   * query: nothing else on this screen — not the tab nav's counts, not the
   * filters, not the account/period lookup the reports need — can resolve
   * without them, so it is awaited with a warm cache accepted as fresh
   * enough (`staleTime: "static"`).
   *
   * The trial balance, balance sheet and journal are ledger reads for the
   * reporting window that reference implies (the selected period, or the
   * whole published fiscal calendar). They are fired once the reference has
   * landed but not awaited: the journal/balance/periods tabs own their own
   * loading state, and awaiting three ledger reports here would gate the
   * whole navigation on the slowest one.
   */
  loader: async ({ context: { queryClient }, deps }) => {
    await queryClient.query({
      ...accountingQueries.reference(),
      staleTime: "static",
    })

    const reference = queryClient.getQueryData(
      accountingQueries.reference().queryKey,
    )
    const periods = reference?.periods ?? []
    const selectedPeriod =
      periods.find((period) => period.id === deps.periodId) ?? null
    const range =
      selectedPeriod && selectedPeriod.startsOn && selectedPeriod.endsOn
        ? { from: selectedPeriod.startsOn, to: selectedPeriod.endsOn }
        : (reference?.bookRange ?? null)
    const account =
      reference?.accounts.find(
        (candidate) => candidate.code === deps.accountCode,
      ) ?? null

    void queryClient
      .query(accountingQueries.trialBalance(range))
      .catch(() => {})
    void queryClient
      .query(accountingQueries.balanceSheet(range?.to ?? null))
      .catch(() => {})
    void queryClient
      .query(accountingQueries.journal(account?.id ?? null, range))
      .catch(() => {})
  },

  component: Accounting,
  pendingComponent: AccountingPending,
  errorComponent: AccountingError,
})

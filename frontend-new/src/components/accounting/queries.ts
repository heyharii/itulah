/**
 * Accounting query options — the only place an accounting cache key exists.
 *
 * `queryOptions` pairs a key with its fetcher and its cache class in one typed
 * object, so the route loader, the screen and any future mutation all name the
 * same query without repeating it. See docs/frontend-rules.md §Q1 and
 * docs/recipe-domain-conversion.md.
 */

import { keepPreviousData, queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import {
  fetchAccounts,
  fetchBalanceSheet,
  fetchFiscalYears,
  fetchJournal,
  fetchPeriods,
  fetchTrialBalance,
  rangeOfYears,
  type DateRange,
  type LedgerReference,
} from "./api"

export const accountingQueries = {
  all: () => ["accounting"] as const,

  /**
   * Chart of accounts, fiscal calendar and periods.
   *
   * Classed `reference`, not `ledger`: an account, a fiscal year and a period
   * change on a change-request — opening a new fiscal year, closing a period —
   * not on a shift. The 30-minute window is fine here even though the same
   * screen also reads live journal figures elsewhere.
   */
  reference: () =>
    queryOptions({
      queryKey: [...accountingQueries.all(), "reference"] as const,
      queryFn: async ({ signal }): Promise<LedgerReference> => {
        const [accounts, fiscalYears] = await Promise.all([
          fetchAccounts(signal),
          fetchFiscalYears(signal),
        ])
        const periods = await fetchPeriods(fiscalYears, signal)
        const bookRange = rangeOfYears(fiscalYears)
        return { accounts, fiscalYears, periods, bookRange }
      },
      ...STALE.reference,
    }),

  /**
   * The journal for one account x one date window. Both halves are in the
   * key — they are the whole identity of the read, so two screens asking for
   * different windows must not share a cached answer.
   *
   * Classed `ledger`: these are posted GL lines, exactly what §STALE.ledger
   * means by "anything money-bearing" — a stale journal line is a wrong
   * decision by whoever is reading it, not a slow UI.
   */
  journal: (accountId: string | null, range: DateRange | null) =>
    queryOptions({
      queryKey: [
        ...accountingQueries.all(),
        "journal",
        accountId ?? null,
        range?.from ?? null,
        range?.to ?? null,
      ] as const,
      queryFn: ({ signal }) =>
        fetchJournal({ accountId: accountId ?? undefined, range }, signal),
      enabled: Boolean(range),
      /* A filtered list — switching the account or period filter should not
       * flash empty while the new window loads. See docs/frontend-rules.md
       * §Q7 / recipe step 4. */
      placeholderData: keepPreviousData,
      ...STALE.ledger,
    }),

  /**
   * Per-account debit/credit for a date window. `ledger` — it is the same
   * posted book as the journal, just aggregated.
   */
  trialBalance: (range: DateRange | null) =>
    queryOptions({
      queryKey: [
        ...accountingQueries.all(),
        "trial-balance",
        range?.from ?? "",
        range?.to ?? "",
      ] as const,
      queryFn: ({ signal }) =>
        fetchTrialBalance({ from: range?.from ?? "", to: range?.to ?? "" }, signal),
      enabled: Boolean(range?.from && range?.to),
      /* A per-account list scoped by the period filter — same reasoning as
       * the journal above. */
      placeholderData: keepPreviousData,
      ...STALE.ledger,
    }),

  /** Assets vs liabilities + equity, as of one date. `ledger` for the same reason. */
  balanceSheet: (asOf: string | null) =>
    queryOptions({
      queryKey: [...accountingQueries.all(), "balance-sheet", asOf ?? ""] as const,
      queryFn: ({ signal }) => fetchBalanceSheet(asOf ?? "", signal),
      enabled: Boolean(asOf),
      ...STALE.ledger,
    }),
}

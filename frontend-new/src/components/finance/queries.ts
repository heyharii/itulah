/**
 * Finance query options — the only place a finance cache key exists.
 *
 * `queryOptions` pairs a key with its fetcher and its cache class in one typed
 * object, so the route loader, the screen and any future mutation all name the
 * same query without repeating it. See docs/frontend-rules.md §Q1 and
 * docs/recipe-domain-conversion.md.
 */

import { queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import { fetchFinanceReimbursements, fetchFinanceResource } from "./api"
import { todayKey } from "@/lib/day"

export const financeQueries = {
  all: () => ["finance"] as const,

  /**
   * Suppliers, payables invoices and payments, plus the posted P&L and
   * cash-flow reports for the current calendar month.
   *
   * Classed `ledger`: this is what is owed to a supplier and what has been
   * paid, plus a posted accounting report — the textbook case in the recipe.
   * A stale outstanding balance here is a wrong payment decision, not a slow
   * UI. The month is part of the key: crossing midnight into a new month
   * must not serve last month's report from cache.
   */
  resource: () =>
    queryOptions({
      queryKey: [
        ...financeQueries.all(),
        "resource",
        todayKey().slice(0, 7),
      ] as const,
      queryFn: ({ signal }) => fetchFinanceResource(signal),
      ...STALE.ledger,
    }),

  /**
   * Employee reimbursement claims. Classed `ledger` for the same reason as
   * `resource`: a stale "submitted"/"approved" status is exactly the kind of
   * number someone acts on — pays, or pays twice.
   */
  reimbursements: () =>
    queryOptions({
      queryKey: [...financeQueries.all(), "reimbursements"] as const,
      queryFn: ({ signal }) => fetchFinanceReimbursements(signal),
      ...STALE.ledger,
    }),
}

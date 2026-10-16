import { queryOptions } from "@tanstack/react-query"
import { isoDate, type SalesRange } from "@itulah/contract/reporting"

import { analyticsKeys, salesSeries } from "@/lib/queries/analytics"
import {
  campaignPerformance,
  performanceKeys,
} from "@/lib/queries/commercial-performance"
import { listPurchaseOrders, procurementKeys } from "@/lib/queries/procurement"
import { listVouchers, voucherKeys } from "@/lib/queries/vouchers"
import type { ReportScope } from "@/screens/executive/scope"

/// The reads the Executive pages open with, as options shared by the screens
/// (which read them with `useSuspenseQuery`) and by the prefetcher
/// (`prefetch.ts`), so the key and the request cannot drift apart.
///
/// Not here, on purpose: the books (profit, cash, payables, postings) and the
/// workforce. A role below supervisor is refused the books and shown a line
/// that says so in place of a card, and the workforce is read for the unit a
/// shop belongs to — both stay plain reads that answer after the page is
/// drawn, which a suspending read cannot do.

/// What the shops took over one span, bucketed. Every page of the report reads
/// this period's, for the shop list and the figures.
export const salesSeriesQuery = (range: SalesRange) =>
  queryOptions({
    queryKey: analyticsKeys.series(range),
    queryFn: ({ signal }) => salesSeries(range, signal),
  })

/// The whole order book, for the purchasing page's "still coming" table.
export const ordersQuery = () =>
  queryOptions({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders(undefined, signal),
  })

/// The one-row peek at the voucher ledger, for what is outstanding.
export const vouchersPeekQuery = () =>
  queryOptions({
    queryKey: voucherKeys.list({ limit: 1 }),
    queryFn: ({ signal }) => listVouchers({ limit: 1 }, signal),
  })

/// A trading day as the instants the promotion report is asked in — WIB, the
/// same day boundary the sales report uses.
function instant(date: string): string {
  return `${date}T00:00:00+07:00`
}

function dayAfter(date: string): string {
  const next = new Date(`${date}T12:00:00`)
  next.setDate(next.getDate() + 1)
  return isoDate(next)
}

/// What each campaign did over the report's span, for the whole company or the
/// shop the report is narrowed to.
export const campaignsQuery = (
  scope: Pick<ReportScope, "current" | "store">
) => {
  const span = {
    from: instant(scope.current.from),
    to: instant(dayAfter(scope.current.to)),
    siteId: scope.store ?? null,
  }
  return queryOptions({
    queryKey: performanceKeys.campaigns(span),
    queryFn: ({ signal }) => campaignPerformance(span, signal),
    retry: false,
  })
}

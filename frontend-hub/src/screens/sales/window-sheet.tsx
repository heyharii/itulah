import { useInfiniteQuery } from "@tanstack/react-query"

import { AppLink } from "@/components/ui/app-link"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, LoadMore } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, money, moment } from "@/lib/format"
import { analyticsKeys, salesWindow } from "@/lib/queries/analytics"
import { queryState } from "@/lib/query-state"

/// Receipts per page. The totals never depend on it: the server computes them
/// over the whole span on every page.
const RECEIPTS_PAGE = 100

/// One shop over the span the screen is set to, down to the receipts.
///
/// The counterpart to a cell in the fleet chart: the chart says a shop took
/// nineteen million in September, this says across how many sales, in what
/// tenders, what came back, and which receipts they were. Shared by every screen
/// that draws a shop's takings, because it answers the same follow-up on each —
/// a screen that showed one set of words on Sales and another on Margin would
/// be teaching two vocabularies for one thing. It lives in the Sales module for
/// that reason, and Store ops opens the same sheet.
///
/// Receipts from the centre and from store tills share this list, while the
/// source-aware sale sheet keeps each one tied to its own durable record.
export function WindowSheet({
  siteId,
  from,
  to,
  spanText,
  onClose,
}: {
  siteId: string | null
  from: string
  to: string
  /// What the span is called in words, for the sheet's heading.
  spanText: string
  onClose: () => void
}) {
  /// The span's report, with its receipts walked a page at a time. Every page
  /// carries the whole span's totals; the first page's are the ones drawn, and
  /// the pages after it only add receipts.
  const window = useInfiniteQuery({
    queryKey: analyticsKeys.windowPages(siteId ?? "", from, to),
    queryFn: ({ pageParam, signal }) =>
      salesWindow(
        { siteId: siteId!, from, to, limit: RECEIPTS_PAGE, cursor: pageParam },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.transactions_next_cursor ?? undefined,
    enabled: siteId !== null,
  })

  return (
    <Sheet
      open={siteId !== null}
      onOpenChange={(open) => !open && onClose()}
      id={spanText}
      title={window.data?.pages[0]?.site_name ?? siteId ?? "Shop"}
    >
      {queryState(window, {
        loading: "Reading the shop's trade…",
        render: (data) => {
          const report = data.pages[0]
          const transactions = data.pages.flatMap((page) => page.transactions)
          return (
            <div className="flex flex-col gap-5">
              <Facts>
                <Fact term="Sales">{count(report.sales.count)}</Fact>
                <Fact term="Units">{count(report.sales.units_sold)}</Fact>
                <Fact term="Average basket">
                  {money(report.sales.average_minor)}
                </Fact>
                <Fact term="Voided">{count(report.sales.voided_count)}</Fact>
              </Facts>

              {report.sales.voided_count > 0 && (
                <Banner tone="warn">
                  {count(report.sales.voided_count)} sale
                  {report.sales.voided_count === 1 ? " was" : "s were"} voided
                  in this span. A voided sale is one that did not happen, so it
                  is in neither the takings nor the average.
                </Banner>
              )}

              {report.tenders.length > 0 && (
                <div>
                  <h4 className="mb-2 text-card-title font-semibold text-ink">
                    Taken in
                  </h4>
                  <MiniTable head={["Method", "Tenders", "Amount"]}>
                    {report.tenders.map((tender) => (
                      <tr
                        key={tender.method}
                        className="border-t border-hairline"
                      >
                        <td className="py-2 pr-2">
                          <Tag>{tender.method}</Tag>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {count(tender.count)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {money(tender.amount_minor)}
                        </td>
                      </tr>
                    ))}
                  </MiniTable>
                </div>
              )}

              <div>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  The drawer
                </h4>
                {/* The server's own identity, drawn as the subtraction it is:
                  cash_expected = cash_tendered − change − cash_refunds. */}
                <TotalsLadder
                  rows={[
                    {
                      label: "Cash tendered",
                      value: money(report.cash.cash_tendered_minor),
                    },
                    {
                      label: "Change given",
                      value: money(-report.cash.change_given_minor),
                    },
                    {
                      label: "Cash refunded",
                      value: money(-report.cash.cash_refunded_minor),
                    },
                  ]}
                  total={{
                    label: "Expected in the drawer",
                    value: money(report.cash.cash_expected_minor),
                  }}
                />
              </div>

              {report.returns.count > 0 && (
                <div>
                  <h4 className="mb-2 text-card-title font-semibold text-ink">
                    Came back
                  </h4>
                  <MiniTable head={["Refunded with", "Amount"]}>
                    {report.returns.by_method.map((entry) => (
                      <tr
                        key={entry.method}
                        className="border-t border-hairline"
                      >
                        <td className="py-2 pr-2">
                          <Tag>{entry.method}</Tag>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {money(entry.amount_minor)}
                        </td>
                      </tr>
                    ))}
                  </MiniTable>
                  <p className="mt-2 text-[0.9375rem] text-mute">
                    {count(report.returns.count)} return
                    {report.returns.count === 1 ? "" : "s"},{" "}
                    {money(report.returns.refund_total_minor)} altogether.
                  </p>
                </div>
              )}

              <div>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Receipts
                </h4>
                <MiniTable head={["Sale", "Paid with", "Units", "Total"]}>
                  {transactions.map((sale) => (
                    <tr key={sale.id} className="border-t border-hairline">
                      <td className="py-2 pr-2">
                        <AppLink
                          to="/sales"
                          sheet={{ key: "sale", value: sale.id }}
                          className="block font-mono text-[0.9375rem] text-accent hover:underline"
                        >
                          {sale.sale_number}
                        </AppLink>
                        {sale.source === "EDGE" && <Tag tone="info">POS</Tag>}
                        <span className="text-[0.9375rem] text-mute">
                          {moment(sale.completed_at)}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        {/* More than one is a split tender, which is the row a
                          supervisor opens this list to find. */}
                        <span className="inline-flex flex-wrap justify-end gap-1">
                          {sale.methods.map((method) => (
                            <Tag
                              key={method}
                              tone={
                                sale.methods.length > 1 ? "info" : "neutral"
                              }
                            >
                              {method}
                            </Tag>
                          ))}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(sale.units)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {money(sale.total_minor)}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
                {/* Inside the sheet's own scroll, so it asks for the next page
                  only as the reader nears the last receipt. */}
                <LoadMore query={window} />
              </div>

              <TotalsLadder
                rows={[
                  { label: "Net", value: money(report.sales.net_minor) },
                  { label: "Tax", value: money(report.sales.tax_minor) },
                  {
                    label: "Refunded",
                    value: money(-report.returns.refund_total_minor),
                  },
                ]}
                total={{
                  label: "Takings",
                  value: money(report.sales.gross_minor),
                }}
              />
            </div>
          )
        },
      })}
    </Sheet>
  )
}

import { useQuery } from "@tanstack/react-query"
import { Clock } from "lucide-react"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { ExceptionQueue, type Exception } from "@/components/ui/exception-queue"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, money, moment } from "@/lib/format"
import { listReturns, listSales, storeopsKeys } from "@/lib/queries/storeops"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { SaleSheet } from "@/screens/sales/sale-sheet"
import { rollUp } from "@/screens/sales/roll-up"

/// The counter, opened on what is wrong with it.
///
/// DESIGN.md is blunt that an overview leads with a queue of exceptions rather
/// than with vanity KPIs, and for a till the exception is unambiguous: a sale
/// still OPEN is a basket nobody finished. Either a shopper walked away, or a
/// cashier is standing at it right now — and the difference is how long it has
/// been open, which is why the queue is ordered by age rather than by value.
///
/// Everything here is derived from the two lists this module already reads.
/// There is deliberately no "today": the business day has a boundary the server
/// owns (`utc_offset_minutes`, WIB by default) and reinventing it in a browser
/// would give this screen a different Tuesday from the reports. What the
/// numbers are over is said out loud instead.

/// How long a basket has been sitting there, in the coarsest unit that is still
/// informative.
function ageOf(iso: string): { minutes: number; text: string } {
  const opened = new Date(iso).getTime()
  if (Number.isNaN(opened)) return { minutes: 0, text: "—" }
  const minutes = Math.max(0, Math.round((Date.now() - opened) / 60_000))
  if (minutes < 60) return { minutes, text: `${minutes}m open` }
  const hours = Math.round(minutes / 60)
  if (hours < 48) return { minutes, text: `${hours}h open` }
  return { minutes, text: `${Math.round(hours / 24)}d open` }
}

export function Overview() {
  const sale = useSheet("sale")

  const sales = useQuery({
    queryKey: storeopsKeys.sales("any"),
    queryFn: ({ signal }) => listSales({ limit: 500 }, signal),
  })
  const returns = useQuery({
    queryKey: storeopsKeys.returns(),
    queryFn: ({ signal }) => listReturns({ limit: 500 }, signal),
  })

  const rows = useMemo(() => sales.data ?? [], [sales.data])
  const refunds = useMemo(() => returns.data?.rows ?? [], [returns.data])
  const stores = useMemo(() => rollUp(rows, refunds), [rows, refunds])

  const open = useMemo(
    () =>
      rows
        .filter((row) => row.status === "OPEN")
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
    [rows]
  )

  const exceptions: readonly Exception[] = useMemo(
    () =>
      open.map((row) => {
        const age = ageOf(row.created_at)
        return {
          id: row.id,
          title: `${row.site_id} — ${row.sale_number}`,
          detail: `${age.text} · tendered ${money(row.paid_minor)} of ${money(row.total_minor)}`,
          amount: money(Math.max(row.total_minor - row.paid_minor, 0)),
          // Two hours is the line between "a cashier is at this counter" and
          // "nobody is coming back to it".
          severity:
            age.minutes >= 120 ? "high" : age.minutes >= 30 ? "medium" : "low",
          icon: <Clock className="size-[0.9375rem]" />,
          onOpen: () => sale.open(row.id),
        }
      }),
    [open, sale]
  )

  const takings = rows
    .filter((row) => row.status === "COMPLETED")
    .reduce((sum, row) => sum + row.total_minor, 0)
  const owing = open.reduce(
    (sum, row) => sum + Math.max(row.total_minor - row.paid_minor, 0),
    0
  )
  const refunded = refunds.reduce(
    (sum, entry) => sum + entry.refund_total_minor,
    0
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Sales"
        title="Shop floor"
        sub="The last 500 sales and returns the centre holds — not a business day, which the reports own."
      />

      {queryState(sales, {
        loading: "Reading the counters…",
        render: () => (
          <>
            <ExceptionQueue
              title="Tills left open"
              exceptions={exceptions}
              empty="Every till is square — nothing is sitting open."
            />

            <KpiStrip>
              <Kpi label="Tills open" value={count(open.length)} />
              <Kpi label="Owing on them" value={money(owing)} />
              <Kpi label="Stores trading" value={count(stores.length)} />
              <Kpi
                label="Sales held"
                value={count(
                  rows.filter((row) => row.status === "COMPLETED").length
                )}
              />
              <Kpi label="Takings" value={money(takings)} />
              <Kpi label="Refunded" value={money(refunded)} />
            </KpiStrip>

            <div className="grid gap-3 xl:grid-cols-2">
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>Latest back over the counter</CardTitle>
                  <AppLink
                    to="/sales/returns"
                    className="text-[0.875rem] font-medium text-accent hover:underline"
                  >
                    All returns
                  </AppLink>
                </CardHeader>
                <div className="px-4 pb-3.5">
                  {refunds.length === 0 ? (
                    <p className="py-6 text-center text-meta text-body">
                      Nothing has been taken back.
                    </p>
                  ) : (
                    <MiniTable head={["Return", "Store", "Refunded"]}>
                      {refunds.slice(0, 8).map((entry) => (
                        <tr key={entry.id} className="border-t border-hairline">
                          <td className="py-2 pr-2">
                            <AppLink
                              to="/sales/returns"
                              sheet={{ key: "refund", value: entry.id }}
                              className="block font-mono text-[0.875rem] text-accent hover:underline"
                            >
                              {entry.return_number}
                            </AppLink>
                            <span className="text-[0.875rem] text-mute">
                              {moment(entry.created_at)}
                            </span>
                          </td>
                          <td className="py-2 text-right">
                            <Tag>{entry.site_id}</Tag>
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {money(entry.refund_total_minor)}
                          </td>
                        </tr>
                      ))}
                    </MiniTable>
                  )}
                </div>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>Where the fleet stands</CardTitle>
                  <AppLink
                    to="/sales/analytics"
                    className="text-[0.875rem] font-medium text-accent hover:underline"
                  >
                    All stores
                  </AppLink>
                </CardHeader>
                <div className="px-4 pb-3.5">
                  {stores.length === 0 ? (
                    <EmptyState>
                      No shop has reported a sale to the centre yet.
                    </EmptyState>
                  ) : (
                    <MiniTable head={["Store", "Tills Open", "Takings"]}>
                      {[...stores]
                        .sort(
                          (a, b) =>
                            b.open_count - a.open_count ||
                            b.takings_minor - a.takings_minor
                        )
                        .slice(0, 8)
                        .map((store) => (
                          <tr
                            key={store.site_id}
                            className="border-t border-hairline"
                          >
                            <td className="py-2 pr-2">
                              <AppLink
                                to="/sales/analytics"
                                sheet={{ key: "store", value: store.site_id }}
                                className="text-[0.875rem] text-accent hover:underline"
                              >
                                {store.site_id}
                              </AppLink>
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {store.open_count > 0 ? (
                                <span className="font-medium text-warn-fg">
                                  {count(store.open_count)}
                                </span>
                              ) : (
                                <span className="text-mute">—</span>
                              )}
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {money(store.takings_minor)}
                            </td>
                          </tr>
                        ))}
                    </MiniTable>
                  )}
                </div>
              </Card>
            </div>
          </>
        ),
      })}

      <SaleSheet id={sale.value ?? null} onClose={sale.close} />
    </PageContent>
  )
}

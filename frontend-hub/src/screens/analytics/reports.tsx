import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { count, money } from "@/lib/format"
import {
  analyticsKeys,
  dailyReport,
  salesSeries,
  totalsByBucket,
  type SalesSeries,
} from "@/lib/queries/analytics"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { BarSeries, ChartLegend, type ChartSeries } from "@/components/ui/chart"
import {
  bucketLabel,
  bucketTitle,
  isoDate,
  spanOf,
} from "@itulah/contract/reporting"

/// Closing a day at one shop.
///
/// This is the report a shop reads to go home: what it took, in what tenders,
/// what came back, and what should physically be in the drawer. It is a
/// different question from the fleet chart next door and it is asked of one
/// shop and one local date, so the shop and the date are both in the URL — a
/// day-close report for the wrong day is not a stale answer, it is a different
/// question, and somebody sent this link meaning a particular one.
///
/// The business day has a boundary the SERVER owns (`utc_offset_minutes`,
/// WIB by default). Nothing here computes it: a browser deciding where Tuesday
/// starts would give this screen a different Tuesday from the shop's.
///
/// The shop roster comes from a fortnight of the series read, because there is
/// no site register among these three endpoints. That read earns its keep
/// twice — it also draws the fortnight behind the chosen day, which is what
/// turns "we took nineteen million" into "and that is a normal Tuesday".

const CONTEXT_DAYS = 14

const SERIES: readonly ChartSeries[] = [
  { key: "gross", label: "Takings", tone: "accent" },
]

export function Reports() {
  const store = useSheet("store")
  const date = useSheet("date")

  // Fixed at a fortnight of days, deliberately not the shared `?bucket`/`?span`
  // controls: those belong to the two comparison screens, and a day-close
  // report has no span to choose — it closes one day.
  const context = useMemo(() => spanOf("day", CONTEXT_DAYS), [])

  const roster = useQuery({
    queryKey: analyticsKeys.series(context),
    queryFn: ({ signal }) => salesSeries(context, signal),
  })

  const day = date.value ?? isoDate(new Date())

  return (
    <PageContent>
      <PageHeader
        crumb="Analytics"
        title="Reports"
        sub="One shop, one local business day: the takings, the tenders, and what should be in the drawer."
        actions={
          <Input
            type="date"
            value={day}
            onChange={(event) =>
              event.target.value !== "" && date.open(event.target.value)
            }
            className="h-8 w-44"
          />
        }
      />

      {queryState(roster, {
        loading: "Finding the shops…",
        render: (fleet) =>
          fleet.sites.length === 0 ? (
            <Card>
              <EmptyState>
                No shop has traded in the last fortnight, so there is no
                register of shops to pick a day from.
              </EmptyState>
            </Card>
          ) : (
            <>
              {/* Each shop's close is a different dataset, not a slice of one,
                  so these are sub-tabs rather than a segmented control. */}
              <SubTabs
                tabs={fleet.sites.map((site) => ({
                  value: site.site_id,
                  label: site.site_name,
                }))}
                value={store.value ?? fleet.sites[0].site_id}
                onChange={(next) => store.open(next)}
              />
              <DayClose
                siteId={store.value ?? fleet.sites[0].site_id}
                date={day}
                context={fleet}
              />
            </>
          ),
      })}
    </PageContent>
  )
}

function DayClose({
  siteId,
  date,
  context,
}: {
  siteId: string
  date: string
  context: SalesSeries
}) {
  const report = useQuery({
    queryKey: analyticsKeys.daily(siteId, date),
    queryFn: ({ signal }) => dailyReport({ siteId, date }, signal),
  })

  const chart = useMemo(
    () =>
      totalsByBucket(context, siteId).map((cell) => ({
        bucket: cell.bucket_start,
        gross: cell.gross_minor,
      })),
    [context, siteId]
  )

  return queryState(report, {
    loading: "Closing the day…",
    render: (closed) => (
      <>
        <KpiStrip>
          <Kpi label="Sales" value={count(closed.sales.count)} />
          <Kpi label="Units" value={count(closed.sales.units_sold)} />
          <Kpi label="Gross" value={money(closed.sales.gross_minor)} />
          <Kpi label="Net" value={money(closed.sales.net_minor)} />
          <Kpi label="Tax" value={money(closed.sales.tax_minor)} />
          <Kpi
            label="Voided"
            value={count(closed.sales.voided_count)}
            delta={closed.sales.voided_count > 0 ? "not takings" : undefined}
            tone="flat"
          />
        </KpiStrip>

        <Card className="mb-[1.125rem] overflow-hidden">
          <CardHeader>
            <CardTitle>The fortnight behind this day</CardTitle>
            <AppLink
              to="/storeops/sales"
              sheet={{ key: "store", value: siteId }}
              className="text-[0.75rem] font-medium text-accent hover:underline"
            >
              Receipts
            </AppLink>
          </CardHeader>
          <div className="px-3 pt-1 pb-3.5">
            <ChartLegend series={SERIES} />
            <BarSeries
              rows={chart}
              series={SERIES}
              format={money}
              labelOf={(bucket) => bucketLabel(bucket, "day")}
              titleOf={(bucket) => bucketTitle(bucket, "day")}
              className="h-[10rem]"
            />
          </div>
        </Card>

        <div className="mb-[1.125rem] grid gap-3 xl:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Taken in</CardTitle>
            </CardHeader>
            <div className="px-4 pb-3.5">
              {closed.tenders.length === 0 ? (
                <p className="py-6 text-center text-meta text-body">
                  Nothing was tendered on this day.
                </p>
              ) : (
                <MiniTable head={["Method", "Tenders", "Amount"]}>
                  {closed.tenders.map((tender) => (
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
              )}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Went back out</CardTitle>
              <AppLink
                to="/storeops/returns"
                className="text-[0.75rem] font-medium text-accent hover:underline"
              >
                All returns
              </AppLink>
            </CardHeader>
            <div className="px-4 pb-3.5">
              {closed.returns.count === 0 ? (
                <p className="py-6 text-center text-meta text-body">
                  Nothing came back over the counter.
                </p>
              ) : (
                <>
                  <MiniTable head={["Refunded with", "Amount"]}>
                    {closed.returns.by_method.map((entry) => (
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
                  <p className="mt-2 text-[0.6875rem] text-mute">
                    {count(closed.returns.count)} return
                    {closed.returns.count === 1 ? "" : "s"},{" "}
                    {money(closed.returns.refund_total_minor)} altogether.
                  </p>
                </>
              )}
            </div>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>The drawer</CardTitle>
            <span className="text-[0.75rem] text-mute">
              UTC{closed.utc_offset_minutes >= 0 ? "+" : "−"}
              {Math.abs(closed.utc_offset_minutes) / 60}
            </span>
          </CardHeader>
          <div className="px-4 pb-4">
            <TotalsLadder
              rows={[
                {
                  label: "Cash tendered",
                  value: money(closed.cash.cash_tendered_minor),
                },
                {
                  label: "Change given",
                  value: `− ${money(closed.cash.change_given_minor)}`,
                },
                {
                  label: "Cash refunded",
                  value: `− ${money(closed.cash.cash_refunded_minor)}`,
                },
              ]}
              total={{
                label: "Expected in the drawer",
                value: money(closed.cash.cash_expected_minor),
              }}
              className="border-t-0 pt-0"
            />
          </div>
        </Card>

        {/* The server's own statement of the arithmetic above, quoted rather
            than restated: two identities written twice are two identities that
            can drift apart. */}
        <Banner tone="info" className="mt-[1.125rem]">
          {closed.identity}
        </Banner>
      </>
    ),
  })
}

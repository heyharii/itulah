import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { ButtonGroup, Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import {
  analyticsKeys,
  fleetTotals,
  salesSeries,
  totalsByBucket,
  totalsBySite,
} from "@/lib/queries/analytics"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { BarSeries, ChartLegend, type ChartSeries } from "@/components/ui/chart"
import { usePeriod } from "@/screens/analytics/period"
import { WindowSheet } from "@/screens/analytics/window-sheet"
import {
  bucketLabel,
  bucketTitle,
  growth,
  growthLabel,
  type SalesBucket,
} from "@itulah/contract/reporting"

/// How the fleet is trading, and which shops are falling behind.
///
/// The chart answers "how is the fleet doing" — one accent column per bucket,
/// with the same span before it as a faint ghost behind. The table answers the
/// question that follows, and it is sorted by growth ASCENDING on purpose:
/// revenue-descending would put the biggest shops first every single time,
/// which is a ranking, not a decision. What somebody opens this screen to find
/// is the shop that took less than it did last month.
///
/// Both queries are the same read at two spans. The comparison is fetched
/// rather than derived because "the twelve months before these twelve" is
/// twelve calendar months — subtracting 365 days would compare February against
/// a piece of March.

interface ShopRow {
  readonly site_id: string
  readonly site_name: string
  readonly gross_minor: number
  readonly sales_count: number
  readonly units_sold: number
  readonly average_minor: number
  readonly before_minor: number
  /// `null` when the shop took nothing in the span before this one: a shop that
  /// went from zero to something has not grown by infinity, and printing a
  /// percentage there would be arithmetic rather than information.
  readonly growth: number | null
}

const columns: ColumnDef<TableSetup, ShopRow>[] = [
  {
    accessorKey: "site_name",
    header: "Shop",
    size: 220,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.site_name}</span>
    ),
  },
  {
    id: "growth",
    // Nothing to compare against sorts LAST in ascending order rather than
    // first: a new shop is not the worst-performing one.
    accessorFn: (row) => row.growth ?? Number.POSITIVE_INFINITY,
    header: "vs before",
    size: 120,
    meta: { align: "right" },
    cell: ({ row }) => {
      const value = row.original.growth
      if (value === null) {
        return <span className="text-mute">new</span>
      }
      return (
        <span
          className={
            value < 0
              ? "font-medium text-bad"
              : value > 0
                ? "text-ok-fg"
                : "text-mute"
          }
        >
          {growthLabel(value)}
        </span>
      )
    },
  },
  {
    accessorKey: "gross_minor",
    header: "Takings",
    size: 160,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {money(row.original.gross_minor)}
      </span>
    ),
  },
  {
    accessorKey: "before_minor",
    header: "Before",
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="text-mute">{money(row.original.before_minor)}</span>
    ),
  },
  {
    accessorKey: "sales_count",
    header: "Sales",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.sales_count),
  },
  {
    accessorKey: "units_sold",
    header: "Units",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.units_sold),
  },
  {
    accessorKey: "average_minor",
    header: "Average basket",
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) => money(row.original.average_minor),
  },
]

const BUCKETS: readonly { value: SalesBucket; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
]

const SERIES: readonly ChartSeries[] = [
  // Ghost first, so the live series is drawn over it.
  { key: "before", label: "Span before", tone: "ghost" },
  { key: "now", label: "Takings", tone: "accent" },
]

export function SalesAnalysis() {
  const period = usePeriod()
  const store = useSheet("store")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "growth", desc: false },
  ])

  const series = useQuery({
    queryKey: analyticsKeys.series(period.range),
    queryFn: ({ signal }) => salesSeries(period.range, signal),
  })
  const before = useQuery({
    queryKey: analyticsKeys.series(period.before),
    queryFn: ({ signal }) => salesSeries(period.before, signal),
  })

  const now = fleetTotals(series.data)
  const then = fleetTotals(before.data)
  // Deltas wait for the comparison rather than being computed against a zero
  // that has not arrived yet: "+∞%" for half a second is worse than no delta.
  const compared = before.data !== undefined

  const chart = useMemo(() => {
    const cells = totalsByBucket(series.data)
    const previous = totalsByBucket(before.data)
    return cells.map((cell, index) => ({
      bucket: cell.bucket_start,
      now: cell.gross_minor,
      // Aligned by position, which is what makes a Tuesday sit against the
      // Tuesday the reader's chosen span puts opposite it.
      before: previous[index]?.gross_minor ?? 0,
    }))
  }, [series.data, before.data])

  const rows = useMemo<readonly ShopRow[]>(() => {
    const previous = new Map(
      totalsBySite(before.data).map((entry) => [
        entry.site.site_id,
        entry.gross_minor,
      ])
    )
    return totalsBySite(series.data).map((entry) => {
      const beforeMinor = previous.get(entry.site.site_id) ?? 0
      return {
        site_id: entry.site.site_id,
        site_name: entry.site.site_name,
        gross_minor: entry.gross_minor,
        sales_count: entry.sales_count,
        units_sold: entry.units_sold,
        average_minor:
          entry.sales_count === 0
            ? 0
            : Math.round(entry.gross_minor / entry.sales_count),
        before_minor: beforeMinor,
        growth: compared ? growth(entry.gross_minor, beforeMinor) : null,
      }
    })
  }, [series.data, before.data, compared])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: ShopRow) => row.site_id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  const spanText = `${period.buckets} ${period.bucket}${period.buckets === 1 ? "" : "s"} to ${period.range.to}`

  return (
    <PageContent>
      <PageHeader
        crumb="Analytics"
        title="Sales analysis"
        sub="Every shop's takings over a span, against the same span before it."
      />

      <Toolbar>
        <Segmented
          options={BUCKETS}
          value={period.bucket}
          onChange={period.setBucket}
        />
        <ButtonGroup>
          {period.options.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === period.buckets}
              onClick={() => period.setBuckets(option)}
              className={
                option === period.buckets ? "bg-soft-2 text-ink!" : undefined
              }
            >
              {option}
            </button>
          ))}
        </ButtonGroup>
        <Toolbar.Spacer />
        <span className="text-meta text-mute">
          {period.range.from} — {period.range.to}
        </span>
      </Toolbar>

      {queryState(series, {
        loading: "Reading the fleet's trade…",
        render: (fleet) =>
          fleet.sites.length === 0 ? (
            <Card>
              <EmptyState>
                No shop traded in this span. Widen it, or pick a coarser bucket.
              </EmptyState>
            </Card>
          ) : (
            <>
              <KpiStrip>
                <Kpi
                  label="Takings"
                  value={money(now.gross_minor)}
                  delta={
                    compared &&
                    growth(now.gross_minor, then.gross_minor) !== null
                      ? growthLabel(growth(now.gross_minor, then.gross_minor)!)
                      : undefined
                  }
                  tone={
                    now.gross_minor > then.gross_minor
                      ? "up"
                      : now.gross_minor < then.gross_minor
                        ? "down"
                        : "flat"
                  }
                />
                <Kpi label="Net of tax" value={money(now.net_minor)} />
                <Kpi label="Tax" value={money(now.tax_minor)} />
                <Kpi
                  label="Sales"
                  value={count(now.sales_count)}
                  delta={
                    compared &&
                    growth(now.sales_count, then.sales_count) !== null
                      ? growthLabel(growth(now.sales_count, then.sales_count)!)
                      : undefined
                  }
                  tone={
                    now.sales_count > then.sales_count
                      ? "up"
                      : now.sales_count < then.sales_count
                        ? "down"
                        : "flat"
                  }
                />
                <Kpi label="Units" value={count(now.units_sold)} />
                <Kpi
                  label="Average basket"
                  value={
                    now.sales_count === 0
                      ? "—"
                      : money(Math.round(now.gross_minor / now.sales_count))
                  }
                />
              </KpiStrip>

              <Card className="mb-[1.125rem] overflow-hidden">
                <CardHeader>
                  <CardTitle>The fleet, by {period.bucket}</CardTitle>
                  <span className="text-[0.75rem] text-mute">{spanText}</span>
                </CardHeader>
                <div className="px-3 pt-1 pb-3.5">
                  <ChartLegend series={SERIES} />
                  <BarSeries
                    rows={chart}
                    series={SERIES}
                    format={money}
                    labelOf={(bucket) => bucketLabel(bucket, period.bucket)}
                    titleOf={(bucket) => bucketTitle(bucket, period.bucket)}
                  />
                </div>
              </Card>

              <Card className="overflow-hidden">
                <DataTable<ShopRow>
                  table={table}
                  onRowClick={(row) => store.open(row.site_id)}
                  isSelected={(row) => row.site_id === store.value}
                  empty="No shop traded in this span."
                  className="max-h-[calc(100vh-24rem)]"
                />
              </Card>
            </>
          ),
      })}

      <WindowSheet
        siteId={store.value ?? null}
        from={period.range.from}
        to={period.range.to}
        spanText={spanText}
        onClose={store.close}
      />
    </PageContent>
  )
}

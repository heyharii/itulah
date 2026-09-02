import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Meter } from "@/components/ui/meter"
import { PageHeader } from "@/components/ui/page-header"
import { ButtonGroup, Segmented, Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
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
  type SalesBucket,
} from "@itulah/contract/reporting"

/// What the takings are made of, and which shop earns least per garment.
///
/// **Say what this is not.** The sales reports carry net, tax and gross; they
/// do not carry what the stock cost, so nothing here is gross margin. What it
/// can say honestly is the wedge between what a shopper handed over and what
/// the business kept — the tax that was never the shop's — and, per shop, how
/// much net revenue each garment that left the floor actually brought in.
///
/// That last figure is the decision metric and the reason this list sorts
/// ascending by it. Two shops can take the same money on very different stock,
/// and the one moving twice the units for it is the one selling cheap. A
/// margin screen sorted by revenue would hide exactly that shop behind the
/// biggest branch.

interface MarginRow {
  readonly site_id: string
  readonly site_name: string
  readonly gross_minor: number
  readonly net_minor: number
  readonly tax_minor: number
  readonly units_sold: number
  readonly sales_count: number
  readonly net_per_unit_minor: number
  /// Net as a fraction of what was taken. Near-uniform across a fleet on one
  /// tax regime, which is exactly why an outlier here is worth seeing.
  readonly retained: number
  /// This shop's net per unit against the best in the fleet — a proportion, so
  /// it can be drawn on a track.
  readonly against_best: number
}

const columns: ColumnDef<TableSetup, MarginRow>[] = [
  {
    accessorKey: "site_name",
    header: "Shop",
    size: 200,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.site_name}</span>
    ),
  },
  {
    accessorKey: "net_per_unit_minor",
    header: "Net per unit",
    size: 190,
    meta: { align: "right" },
    // The decision metric. Drawn against the best shop in the fleet as well as
    // written out: the number alone does not say whether it is bad, and the
    // comparison is the whole question.
    cell: ({ row }) => (
      <span className="flex items-center justify-end gap-2">
        <Meter
          value={row.original.against_best}
          tone={row.original.against_best < 0.6 ? "warn" : "accent"}
          className="w-14 min-w-0"
        />
        <span className="font-medium text-ink">
          {row.original.units_sold === 0
            ? "—"
            : money(row.original.net_per_unit_minor)}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "gross_minor",
    header: "Taken",
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) => money(row.original.gross_minor),
  },
  {
    accessorKey: "tax_minor",
    header: "Tax",
    size: 140,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="text-mute">{money(row.original.tax_minor)}</span>
    ),
  },
  {
    accessorKey: "net_minor",
    header: "Net",
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) => money(row.original.net_minor),
  },
  {
    accessorKey: "retained",
    header: "Retained",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.gross_minor === 0
        ? "—"
        : `${(row.original.retained * 100).toFixed(1)}%`,
  },
  {
    accessorKey: "units_sold",
    header: "Units",
    size: 100,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.units_sold),
  },
]

const BUCKETS: readonly { value: SalesBucket; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
]

/// The one place a second colour is allowed in a bar: `{accent}` base with an
/// `a-orange` cap. What is stacked here is a subtraction — the tax sitting on
/// top of the net is the part that was never the shop's.
const SERIES: readonly ChartSeries[] = [
  { key: "net", label: "Net of tax", tone: "accent" },
  { key: "tax", label: "Tax", tone: "cap" },
]

export function Margin() {
  const period = usePeriod()
  const store = useSheet("store")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "net_per_unit_minor", desc: false },
  ])

  const series = useQuery({
    queryKey: analyticsKeys.series(period.range),
    queryFn: ({ signal }) => salesSeries(period.range, signal),
  })

  const totals = fleetTotals(series.data)

  const chart = useMemo(
    () =>
      totalsByBucket(series.data).map((cell) => ({
        bucket: cell.bucket_start,
        net: cell.net_minor,
        tax: cell.tax_minor,
      })),
    [series.data]
  )

  const rows = useMemo<readonly MarginRow[]>(() => {
    const sites = totalsBySite(series.data)
    const perUnit = (entry: (typeof sites)[number]) =>
      entry.units_sold === 0
        ? 0
        : Math.round(entry.net_minor / entry.units_sold)
    // The fleet's best, so every row can be drawn against something. A fleet
    // where nobody sold anything has no best, and the meters stay empty rather
    // than dividing by zero.
    const best = sites.reduce((top, entry) => Math.max(top, perUnit(entry)), 0)
    return sites.map((entry) => ({
      site_id: entry.site.site_id,
      site_name: entry.site.site_name,
      gross_minor: entry.gross_minor,
      net_minor: entry.net_minor,
      tax_minor: entry.tax_minor,
      units_sold: entry.units_sold,
      sales_count: entry.sales_count,
      net_per_unit_minor: perUnit(entry),
      retained:
        entry.gross_minor === 0 ? 0 : entry.net_minor / entry.gross_minor,
      against_best: best === 0 ? 0 : perUnit(entry) / best,
    }))
  }, [series.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: MarginRow) => row.site_id,
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
        title="Margin"
        sub="What is left of the takings once the tax comes off, and what each garment sold actually brought in."
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

      {/* Said at the top rather than in a footnote, because a screen called
          Margin that quietly means something narrower is worse than one that
          says what it has. */}
      <Banner tone="info" className="mb-[1.125rem]">
        Cost of goods is not in the sales reports, so this is revenue retained —
        not gross margin. What a garment cost to buy lives on the purchase
        orders; until the two are joined, no screen in this app can subtract one
        from the other honestly.
      </Banner>

      {queryState(series, {
        loading: "Reading the fleet's trade…",
        render: (fleet) =>
          fleet.sites.length === 0 ? (
            <Card>
              <EmptyState>
                No shop traded in this span, so there is nothing to take tax
                off.
              </EmptyState>
            </Card>
          ) : (
            <>
              <KpiStrip>
                <Kpi label="Taken" value={money(totals.gross_minor)} />
                <Kpi label="Net of tax" value={money(totals.net_minor)} />
                <Kpi label="Tax" value={money(totals.tax_minor)} />
                <Kpi
                  label="Retained"
                  value={
                    totals.gross_minor === 0
                      ? "—"
                      : `${((totals.net_minor / totals.gross_minor) * 100).toFixed(1)}%`
                  }
                />
                <Kpi label="Units sold" value={count(totals.units_sold)} />
                <Kpi
                  label="Net per unit"
                  value={
                    totals.units_sold === 0
                      ? "—"
                      : money(Math.round(totals.net_minor / totals.units_sold))
                  }
                />
              </KpiStrip>

              <Card className="mb-[1.125rem] overflow-hidden">
                <CardHeader>
                  <CardTitle>What the takings are made of</CardTitle>
                  <span className="text-[0.75rem] text-mute">{spanText}</span>
                </CardHeader>
                <div className="px-3 pt-1 pb-3.5">
                  <ChartLegend series={SERIES} />
                  <BarSeries
                    rows={chart}
                    series={SERIES}
                    stacked
                    format={money}
                    labelOf={(bucket) => bucketLabel(bucket, period.bucket)}
                    titleOf={(bucket) => bucketTitle(bucket, period.bucket)}
                  />
                </div>
              </Card>

              <Card className="overflow-hidden">
                <DataTable<MarginRow>
                  table={table}
                  onRowClick={(row) => store.open(row.site_id)}
                  isSelected={(row) => row.site_id === store.value}
                  empty="No shop traded in this span."
                  className="max-h-[calc(100vh-26rem)]"
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

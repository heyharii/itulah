import {
  growth,
  growthLabel,
  type SalesBucket,
} from "@itulah/contract/reporting"
import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import {
  BarSeries,
  ChartLegend,
  Sparkline,
  type ChartRow,
  type ChartSeries,
} from "@/components/ui/chart"
import { DataTable } from "@/components/ui/data-table"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { ButtonGroup, Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { useFilters } from "@/lib/filters"
import { count, money } from "@/lib/format"
import { analyticsKeys, salesSeries } from "@/lib/queries/analytics"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { Delta } from "@/screens/sales/delta"
import {
  buildMatrix,
  SALES_KINDS,
  showSales,
  type SalesKind,
} from "@/screens/sales/matrix"
import { usePeriod } from "@/screens/sales/period"
import { WindowSheet } from "@/screens/sales/window-sheet"

/// Sales analytics — the estate read one store at a time.
///
/// **The division of labour with `/sales`.** That screen reads DOWN time: a row
/// is a trading day and the shops are folded under it. This one reads ACROSS
/// the estate: a row is a store, and time is folded into it as a total and a
/// shape. They are the same series from the same endpoint, indexed by the same
/// `matrix.ts`, asked the two different questions a head office actually has —
/// "how did we trade this month" and "which of these thirteen shops is the
/// problem".
///
/// **The chart is the same card Sales carries, with a different axis.** Same
/// five pressable totals, same ghost bars for the span before, same grammar —
/// and there a column is a day, here a column is a store. Somebody who has
/// learnt to read one has learnt to read the other, which is worth more than
/// either screen having a chart of its own invention.
///
/// Bars rather than the line Sales draws, and that follows from the axis: a
/// line joins consecutive points and says "this became that", which is true of
/// Monday and Tuesday and is nonsense about Store 04 and Store 09. Stores are
/// categories in an order somebody chose; days are a sequence.
///
/// **Gaining and Losing ground** sit under it because they are the two orders
/// nobody finds by sorting the table: ranked by growth rather than by size, so
/// a small store falling off a cliff is not buried under a big one having an
/// ordinary month.
///
/// The table is at the foot, because a ranking is a headline and somebody
/// eventually wants every figure for every store in one grid they can filter.

/// Ghost first, so the live series is drawn over it rather than beside it.
const SERIES: readonly ChartSeries[] = [
  { key: "before", label: "Span before", tone: "ghost" },
  { key: "now", label: "This span", tone: "accent" },
]

const BUCKETS: readonly { value: SalesBucket; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
]

/// One store over the span, in every measure the series can answer.
interface StoreRow {
  readonly site_id: string
  readonly site_name: string
  readonly colour: string
  readonly gross_minor: number
  readonly sales_count: number
  readonly units_sold: number
  readonly average_minor: number
  readonly items_per_sale: number
  /// This store's share of the estate's takings, 0–1. The figure that turns a
  /// ranking into a proportion — third place means something different in a
  /// fleet where the top store is half the business.
  readonly share: number
  readonly before_minor: number
  /// `null` when the store took nothing in the span before: a store that went
  /// from zero to something has not grown by infinity.
  readonly growth: number | null
  /// Takings per bucket, in axis order, for the mark in the row.
  readonly trend: readonly number[]
}

export function SalesAnalytics() {
  const period = usePeriod()
  const store = useSheet("store")
  const [ranking, setRanking] = useState<SalesKind>("gross_minor")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "gross_minor", desc: true },
  ])

  const series = useQuery({
    queryKey: analyticsKeys.series(period.range),
    queryFn: ({ signal }) => salesSeries(period.range, signal),
    refetchInterval: 60_000,
  })
  const prior = useQuery({
    queryKey: analyticsKeys.series(period.before),
    queryFn: ({ signal }) => salesSeries(period.before, signal),
    staleTime: 5 * 60_000,
  })

  const matrix = useMemo(() => buildMatrix(series.data), [series.data])
  const before = useMemo(
    () => (prior.data === undefined ? undefined : buildMatrix(prior.data)),
    [prior.data]
  )

  const rows = useMemo<readonly StoreRow[]>(() => {
    const estate = matrix.grandTotal("gross_minor")
    return matrix.rows.map((site) => {
      const gross = matrix.siteTotal(site.site_id, "gross_minor")
      const was = before?.siteTotal(site.site_id, "gross_minor") ?? 0
      return {
        site_id: site.site_id,
        site_name: site.site_name,
        colour: matrix.colourOf(site.site_id),
        gross_minor: gross,
        sales_count: matrix.siteTotal(site.site_id, "sales_count"),
        units_sold: matrix.siteTotal(site.site_id, "units_sold"),
        average_minor: matrix.siteTotal(site.site_id, "average_minor"),
        items_per_sale: matrix.siteTotal(site.site_id, "items_per_sale"),
        share: estate === 0 ? 0 : gross / estate,
        before_minor: was,
        growth: before === undefined ? null : growth(gross, was),
        trend: matrix.buckets.map((bucket) =>
          matrix.siteValue(site.site_id, bucket, "gross_minor")
        ),
      }
    })
  }, [matrix, before])

  const trading = rows.filter((row) => row.sales_count > 0)

  /// One column per store, biggest first on the chosen measure, with the same
  /// store's figure over the comparison span behind it.
  ///
  /// Keyed by the store's NAME rather than its id, because that is what the
  /// axis prints and `<BarSeries>` labels a column by its `bucket`. Two shops
  /// sharing a display name would collide — the site register does not allow
  /// it, and the table below carries every row by id regardless.
  const bars: ChartRow[] = useMemo(
    () =>
      [...rows]
        .sort(
          (left, right) =>
            valueOf(right, ranking) - valueOf(left, ranking)
        )
        .map((row) => ({
          bucket: row.site_name,
          before: before?.siteTotal(row.site_id, ranking) ?? 0,
          now: valueOf(row, ranking),
        })),
    [rows, ranking, before]
  )

  const filters = useFilters(columns)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: StoreRow) => row.site_id,
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  const spanText = `${period.buckets} ${period.bucket}${period.buckets === 1 ? "" : "s"} to ${period.range.to}`

  return (
    <PageContent>
      <PageHeader
        crumb="Sales"
        title="Sales analytics"
        sub="Every store against the estate, and against the same span before it."
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
        loading: "Reading the estate's trade…",
        render: (fleet) =>
          fleet.sites.length === 0 ? (
            <Card>
              <EmptyState>
                No store traded in this span. Widen it, or pick a coarser
                bucket.
              </EmptyState>
            </Card>
          ) : (
            <>
              {/* Shaped like the chart on Sales, deliberately: the same card,
                  the same five pressable totals, the same ghost comparison —
                  and the only thing that differs is what the axis is. There
                  a column is a day; here a column is a store. Somebody who
                  has learnt to read one has learnt to read the other. */}
              <Card className="mb-[1.125rem] overflow-hidden">
                <div className="flex flex-col justify-center gap-0.5 border-b border-hairline px-4 py-3">
                  <span className="text-card-title font-semibold text-ink">
                    Sales by store
                  </span>
                  <span className="text-[0.875rem] text-mute">
                    {spanText} · {count(trading.length)} of{" "}
                    {count(rows.length)} stores trading · faint bars are the{" "}
                    {period.buckets} {period.bucket}
                    {period.buckets === 1 ? "" : "s"} before
                  </span>
                </div>

                <div className="grid grid-cols-2 border-b border-hairline sm:grid-cols-3 lg:grid-cols-5">
                  {SALES_KINDS.map((option) => (
                    <button
                      key={option.kind}
                      type="button"
                      aria-pressed={ranking === option.kind}
                      onClick={() => setRanking(option.kind)}
                      className={cn(
                        "flex cursor-pointer flex-col justify-start gap-1 border-t border-l border-hairline px-4 py-2.5 text-left transition-colors first:border-l-0 sm:border-t-0",
                        ranking === option.kind ? "bg-soft" : "hover:bg-soft"
                      )}
                    >
                      <span className="text-eyebrow font-semibold text-mute uppercase">
                        {option.label}
                      </span>
                      <span className="text-metric leading-none font-semibold text-ink tabular-nums">
                        {showSales(
                          option.kind,
                          matrix.grandTotal(option.kind)
                        )}
                      </span>
                      {before === undefined ? (
                        <span className="text-[0.875rem] text-faint">
                          {option.hint}
                        </span>
                      ) : (
                        <Delta
                          now={matrix.grandTotal(option.kind)}
                          before={before.grandTotal(option.kind)}
                        />
                      )}
                    </button>
                  ))}
                </div>

                <div className="px-3 pt-3 pb-3.5">
                  <ChartLegend series={SERIES} />
                  <BarSeries
                    rows={bars}
                    series={SERIES}
                    format={(value) => showSales(ranking, value)}
                    labelOf={(store) => store}
                    titleOf={(store) => store}
                  />
                </div>
              </Card>

              {/* Two orders nobody would find by sorting a table: who gained
                  and who lost. Ranked by growth rather than by size, so a small
                  store falling off a cliff is not buried under a big one having
                  an ordinary month. */}
              {before !== undefined && (
                <div className="mb-[1.125rem] grid gap-[1.125rem] lg:grid-cols-2">
                  <Movers
                    title="Gaining"
                    empty="No store took more than it did in the span before."
                    rows={rows}
                    direction="up"
                    onOpen={store.open}
                  />
                  <Movers
                    title="Losing ground"
                    empty="No store took less than it did in the span before."
                    rows={rows}
                    direction="down"
                    onOpen={store.open}
                  />
                </div>
              )}

              <Toolbar>
                <FilterPanel model={filters} table={table} />
                <Toolbar.Spacer />
                <span className="text-meta text-mute">
                  Trend is each store against its own best {period.bucket}, not
                  against the others.
                </span>
              </Toolbar>

              <Card className="overflow-hidden">
                <DataTable<StoreRow>
                  table={table}
                  onRowClick={(row) => store.open(row.site_id)}
                  isSelected={(row) => row.site_id === store.value}
                  empty={
                    <>
                      None of the {count(rows.length)} stores in this span match
                      the filters in force.
                    </>
                  }
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

// ---------------------------------------------------------------------------

/// One store's figure in one measure. A switch rather than an index so a
/// sixth measure cannot be added without this failing to compile.
function valueOf(row: StoreRow, kind: SalesKind): number {
  switch (kind) {
    case "gross_minor":
      return row.gross_minor
    case "sales_count":
      return row.sales_count
    case "units_sold":
      return row.units_sold
    case "average_minor":
      return row.average_minor
    case "items_per_sale":
      return row.items_per_sale
  }
}

/// The stores that moved, in the direction asked for.
///
/// Capped at five. A "who is losing ground" panel listing eleven stores is the
/// table again, and the reader who wants all of them has it at the foot of the
/// screen.
function Movers({
  title,
  empty,
  rows,
  direction,
  onOpen,
}: {
  title: string
  empty: string
  rows: readonly StoreRow[]
  direction: "up" | "down"
  onOpen: (siteId: string) => void
}) {
  const moved = rows
    .filter((row) =>
      row.growth === null
        ? false
        : direction === "up"
          ? row.growth > 0
          : row.growth < 0
    )
    .sort((left, right) =>
      direction === "up"
        ? (right.growth ?? 0) - (left.growth ?? 0)
        : (left.growth ?? 0) - (right.growth ?? 0)
    )
    .slice(0, 5)

  return (
    <Card className="overflow-hidden p-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      {moved.length === 0 ? (
        <p className="px-4 py-6 text-center text-meta text-body">{empty}</p>
      ) : (
        <div className="flex flex-col">
          {moved.map((row, index) => (
            <button
              key={row.site_id}
              type="button"
              onClick={() => onOpen(row.site_id)}
              className={cn(
                "flex cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-soft",
                index > 0 && "border-t border-hairline"
              )}
            >
              <span
                aria-hidden
                className="size-[7px] shrink-0 rounded-[2px]"
                style={{ background: row.colour }}
              />
              <span className="w-24 shrink-0 truncate text-cell font-medium text-ink">
                {row.site_name}
              </span>
              <Sparkline
                values={row.trend}
                colour={row.colour}
                className="hidden max-w-24 flex-1 sm:block"
              />
              <span className="ml-auto shrink-0 text-cell text-body tabular-nums">
                {money(row.gross_minor)}
              </span>
              <span
                className={cn(
                  "w-14 shrink-0 text-right text-cell font-medium tabular-nums",
                  direction === "up" ? "text-ok" : "text-bad"
                )}
              >
                {row.growth === null ? "—" : growthLabel(row.growth)}
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------

const columns: ColumnDef<TableSetup, StoreRow>[] = [
  {
    accessorKey: "site_name",
    header: "Store",
    size: 190,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="size-[7px] shrink-0 rounded-[2px]"
          style={{ background: row.original.colour }}
        />
        <span className="truncate font-medium text-ink">
          {row.original.site_name}
        </span>
      </span>
    ),
  },
  {
    id: "trend",
    header: "Trend",
    size: 110,
    // Not sortable and not filterable: it is a shape, and there is no order
    // over shapes. The columns beside it are what a reader narrows by.
    enableSorting: false,
    cell: ({ row }) => (
      <Sparkline values={row.original.trend} colour={row.original.colour} />
    ),
  },
  {
    accessorKey: "gross_minor",
    header: "Takings",
    size: 150,
    /// **No `scale`, despite the `_minor` in the name.** `lib/format.ts` says
    /// it plainly — IDR has no minor unit in practice, so the server's "minor"
    /// is already whole rupiah and `money()` prints it undivided. A
    /// `scale: 100` would put every bound out by a factor of a hundred, which
    /// is a narrowed list that looks right and is not.
    meta: { align: "right", filter: { kind: "number", unit: "Rp" } },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {money(row.original.gross_minor)}
      </span>
    ),
  },
  {
    accessorKey: "share",
    header: "Share",
    size: 90,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="text-body tabular-nums">
        {`${(row.original.share * 100).toFixed(1)}%`}
      </span>
    ),
  },
  {
    id: "growth",
    // Nothing to compare against sorts LAST in ascending order rather than
    // first: a new store is not the worst-performing one.
    accessorFn: (row) => row.growth ?? Number.POSITIVE_INFINITY,
    header: "vs before",
    size: 110,
    /// **Deliberately not filterable, and the accessor above is why.** A store
    /// with nothing to compare against is `null` — not assessed — and this
    /// column stands `+∞` in for it so the sort can put it last. A number
    /// clause cannot see that substitution: "grew by at least 0%" would answer
    /// with every store that opened this month, each one reported as having
    /// grown infinitely.
    meta: { align: "right" },
    cell: ({ row }) => {
      const value = row.original.growth
      if (value === null) return <span className="text-mute">new</span>
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
    accessorKey: "sales_count",
    header: "Transactions",
    size: 120,
    meta: { align: "right", filter: { kind: "number", unit: "sales" } },
    cell: ({ row }) => count(row.original.sales_count),
  },
  {
    accessorKey: "average_minor",
    header: "Avg transaction",
    size: 140,
    meta: { align: "right", filter: { kind: "number", unit: "Rp" } },
    cell: ({ row }) => money(Math.round(row.original.average_minor)),
  },
  {
    accessorKey: "units_sold",
    header: "Units",
    size: 100,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) => count(row.original.units_sold),
  },
  {
    accessorKey: "items_per_sale",
    header: "UPT",
    size: 90,
    meta: { align: "right" },
    cell: ({ row }) => showSales("items_per_sale", row.original.items_per_sale),
  },
]


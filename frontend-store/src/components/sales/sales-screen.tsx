import { ComparisonPicker } from "@/components/sales/comparison-picker"
import { Delta } from "@/components/sales/delta"
import { ReceiptSheet } from "@/components/sales/receipt-sheet"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import { compactMoney, money, units } from "@itulah/contract/money"
import type { Comparison, ComparisonMode, SalesBucket } from "@itulah/contract/reporting"
import {
  bucketEnd,
  bucketLabel,
  bucketTitle,
  comparisonOf,
  SALES_BUCKETS,
  SALES_SPANS,
  spanOf,
} from "@itulah/contract/reporting"
import type { StoreMeasure } from "@/lib/sales"
import {
  buildStoreMatrix,
  STORE_MEASURES,
  storeSeries,
  storeSeriesKey,
} from "@/lib/sales"
import { storeTableFeatures, type StoreTableFeatures } from "@/lib/table"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { flexRender, useTable } from "@tanstack/react-table"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { useMemo, useState } from "react"

/// One line of the matrix: a measure, read either over the span on screen or
/// over the span it is being compared against.
///
/// Two rows per measure rather than one row of pairs, because a percentage
/// answers "how much" and hides "out of what" — the figure it moved from has
/// to be readable under it.
interface MeasureRow {
  readonly measure: StoreMeasure
  readonly label: string
  readonly kind: "now" | "before"
}

/// The two columns that stay put while the buckets scroll sideways. Every
/// bucket in a row is read against them, so they cannot go off the left edge.
const MEASURE_WIDTH = 150
const TOTAL_WIDTH = 130

function frozen(columnId: string): React.CSSProperties | undefined {
  if (columnId === "measure") {
    return { width: MEASURE_WIDTH, minWidth: MEASURE_WIDTH }
  }
  if (columnId === "total") {
    return { left: MEASURE_WIDTH, width: TOTAL_WIDTH, minWidth: TOTAL_WIDTH }
  }
  return undefined
}

function headClass(columnId: string): string {
  const base =
    "bg-card text-muted-foreground sticky top-0 h-10 border-b px-3 font-medium"
  if (columnId === "measure") {
    return cn(base, "left-0 z-30 border-r text-left")
  }
  if (columnId === "total") {
    return cn(base, "z-30 border-r text-right")
  }
  return cn(base, "z-20 text-right whitespace-nowrap")
}

function bodyClass(columnId: string, kind: MeasureRow["kind"]): string {
  const base = "bg-card group-hover:bg-muted transition-colors"
  if (kind === "now") {
    if (columnId === "measure") {
      return cn(base, "sticky left-0 z-10 border-r px-3 pt-2 text-left font-medium")
    }
    // No padding: the figure is a button, and the tap target is the whole cell
    // rather than the text in the middle of it.
    if (columnId === "total") {
      return cn(base, "sticky z-10 border-r p-0")
    }
    return cn(base, "p-0")
  }
  if (columnId === "measure") {
    return cn(base, "sticky left-0 z-10 border-r border-b px-3 pb-2 text-left font-normal")
  }
  if (columnId === "total") {
    return cn(
      base,
      "sticky z-10 border-r border-b px-3 pb-2 text-right font-mono tabular-nums",
    )
  }
  return cn(
    base,
    "border-b px-3 pb-2 text-right font-mono text-xs tabular-nums",
  )
}

function format(value: number, measured: StoreMeasure, exact = false): string {
  return measured !== "gross_minor"
    ? units(value)
    : exact
      ? money(value)
      : compactMoney(value)
}

/// Nothing sold reads as a dash, not as "Rp 0".
///
/// A column of zeroes and a column of figures look alike at a glance, which is
/// the opposite of what a table of daily takings is for — the eye should fall
/// straight on the days the shop was shut.
function figure(value: number, measured: StoreMeasure, exact = false) {
  return value === 0 ? (
    <span className="text-muted-foreground/50">–</span>
  ) : (
    format(value, measured, exact)
  )
}

/// What this shop sold, read on the shop's own node.
///
/// NOT the till. A cashier ringing up a sale has no use for a month of
/// history, and this screen is lazy-loaded for that reason — the till bundle
/// does not carry the chart library at all until somebody opens this.
///
/// The centre has the same screen across every shop. This one exists anyway
/// because it answers when the link to the centre is down, which is the whole
/// reason an edge node is here. A manager closing up does not stop needing
/// today's takings because a tunnel dropped.
///
/// One shop, so the rows are the three measures rather than a list of
/// branches — and all three are on screen at once instead of behind a toggle,
/// because "takings up, units down" is the sentence a manager is looking for
/// and it cannot be seen one measure at a time.
export function SalesScreen() {
  const [bucket, setBucket] = useState<SalesBucket>("day")
  const [span, setSpan] = useState<number>(SALES_SPANS.day[2])
  const [mode, setMode] = useState<ComparisonMode>("prev")
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({})
  const [measure, setMeasure] = useState<StoreMeasure>("gross_minor")
  const [open, setOpen] = useState<{ from: string; to: string; title: string } | null>(
    null,
  )

  const range = useMemo(() => spanOf(bucket, span), [bucket, span])
  const comparison: Comparison = useMemo(
    () => comparisonOf(range, span, mode, custom),
    [range, span, mode, custom],
  )

  const series = useQuery({
    queryKey: storeSeriesKey(range),
    queryFn: ({ signal }) => storeSeries(range, signal),
    // The till behind this screen is still writing into today's column.
    refetchInterval: 60_000,
  })
  const priorRange = useMemo(
    () => ({ from: comparison.from, to: comparison.to, bucket }),
    [comparison, bucket],
  )
  const prior = useQuery({
    queryKey: storeSeriesKey(priorRange),
    queryFn: ({ signal }) => storeSeries(priorRange, signal),
    // Nothing is still being written into a period that has already closed.
    staleTime: 5 * 60_000,
  })

  const now = useMemo(() => buildStoreMatrix(series.data), [series.data])
  const before = useMemo(
    () => (prior.data === undefined ? undefined : buildStoreMatrix(prior.data)),
    [prior.data],
  )

  const chooseBucket = (next: SalesBucket) => {
    setBucket(next)
    // A span is a count of buckets, so it does not survive a change of bucket:
    // "30" means a readable month of days and two and a half years of months.
    setSpan(SALES_SPANS[next][2] ?? SALES_SPANS[next][0])
  }

  // One row per measure, and a second under it for the span being compared
  // against — only when there is one to compare with.
  const data = useMemo<MeasureRow[]>(
    () =>
      STORE_MEASURES.flatMap((option) =>
        before === undefined
          ? [{ ...option, kind: "now" as const }]
          : [
              { ...option, kind: "now" as const },
              { ...option, kind: "before" as const },
            ],
      ),
    [before],
  )

  const columns = useMemo<ColumnDef<StoreTableFeatures, MeasureRow>[]>(
    () => [
      {
        id: "measure",
        header: "Measure",
        cell: ({ row }) =>
          row.original.kind === "now" ? (
            row.original.label
          ) : before === undefined ? null : (
            <span className="flex items-baseline gap-2">
              <span className="truncate text-xs">{comparison.full}</span>
              <Delta
                now={now.total(row.original.measure)}
                before={before.total(row.original.measure)}
                against={comparison.full}
              />
            </span>
          ),
      },
      {
        id: "total",
        header: "Total",
        cell: ({ row }) =>
          row.original.kind === "now" ? (
            <button
              type="button"
              onClick={() =>
                setOpen({ from: range.from, to: range.to, title: "Whole range" })
              }
              className="hover:bg-muted w-full cursor-pointer px-3 pt-2 text-right font-mono font-semibold tabular-nums transition-colors"
            >
              {figure(now.total(row.original.measure), row.original.measure, true)}
            </button>
          ) : before === undefined ? null : (
            figure(before.total(row.original.measure), row.original.measure, true)
          ),
      },
      ...now.buckets.map((start, index) => ({
        id: start,
        header: bucketLabel(start, bucket),
        cell: ({ row }: { row: { original: MeasureRow } }) => {
          if (row.original.kind === "now") {
            const value = now.valueAt(start, row.original.measure)
            return (
              <button
                type="button"
                disabled={value === 0}
                onClick={() =>
                  setOpen({
                    from: start,
                    to: bucketEnd(start, bucket),
                    title: bucketTitle(start, bucket),
                  })
                }
                className="hover:bg-muted w-full cursor-pointer px-3 pt-2 text-right font-mono tabular-nums transition-colors disabled:cursor-default disabled:hover:bg-transparent"
              >
                {figure(value, row.original.measure)}
              </button>
            )
          }
          // Aligned by POSITION, not by date. The comparison span starts on a
          // different day — that is the whole reason it was named — so day two
          // sits under day two.
          const wasBucket = before?.buckets[index]
          return before === undefined || wasBucket === undefined ? (
            <span className="text-muted-foreground/40">·</span>
          ) : (
            figure(before.valueAt(wasBucket, row.original.measure), row.original.measure)
          )
        },
      })),
    ],
    [now, before, comparison, bucket, range],
  )

  const table = useTable({
    features: storeTableFeatures,
    columns,
    data,
    getRowId: (row: MeasureRow) => `${row.measure}-${row.kind}`,
  })

  const config: ChartConfig = {
    value: { label: STORE_MEASURES.find((m) => m.measure === measure)?.label ?? "" },
  }
  const rows = now.buckets.map((start) => ({
    bucket: start,
    value: now.valueAt(start, measure),
  }))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 className="mr-auto text-sm font-semibold tracking-tight">Sales</h2>
        <div className="flex overflow-hidden rounded-4xl border" role="group" aria-label="Period">
          {SALES_BUCKETS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={bucket === option}
              onClick={() => chooseBucket(option)}
              className={cn(
                "h-9 cursor-pointer px-4 text-sm font-medium capitalize transition-colors not-first:border-l",
                bucket === option
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground",
              )}
            >
              {option}
            </button>
          ))}
        </div>
        {/* Buttons rather than a dropdown. This runs on a touchscreen in a
            shop, where a menu that opens over the thing you are reading costs
            a tap and a moment of not being able to see it. */}
        <div className="flex overflow-hidden rounded-4xl border" role="group" aria-label="Span">
          {SALES_SPANS[bucket].map((count) => (
            <button
              key={count}
              type="button"
              aria-pressed={span === count}
              onClick={() => setSpan(count)}
              className={cn(
                "h-9 w-11 cursor-pointer text-sm font-medium tabular-nums transition-colors not-first:border-l",
                span === count
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground",
              )}
            >
              {count}
            </button>
          ))}
        </div>
        <ComparisonPicker
          comparison={comparison}
          range={range}
          onChange={(next) => {
            setMode(next.mode)
            setCustom({ from: next.from, to: next.to })
          }}
        />
      </div>

      {series.isPending ? (
        <p className="text-muted-foreground p-8 text-center text-sm">
          Adding up the till…
        </p>
      ) : series.isError ? (
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-destructive text-sm">
            {series.error instanceof ApiError
              ? series.error.message
              : "The sales figures could not be read."}
          </p>
          <Button variant="outline" onClick={() => void series.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {/* The headline three, each measured against the chosen span. Also
              the control: pressing one draws it. */}
          <div className="grid grid-cols-3 gap-px border-b bg-border">
            {STORE_MEASURES.map((option) => (
              <button
                key={option.measure}
                type="button"
                aria-pressed={measure === option.measure}
                onClick={() => setMeasure(option.measure)}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 px-4 py-3 text-left transition-colors",
                  measure === option.measure ? "bg-muted/60" : "bg-card hover:bg-muted/30",
                )}
              >
                <span className="text-muted-foreground text-xs">{option.label}</span>
                <span className="font-mono text-lg leading-none font-semibold tabular-nums">
                  {format(now.total(option.measure), option.measure)}
                </span>
                {before !== undefined && (
                  <Delta
                    now={now.total(option.measure)}
                    before={before.total(option.measure)}
                    against={comparison.full}
                  />
                )}
              </button>
            ))}
          </div>

          <div className="px-2 py-3">
            <ChartContainer config={config} className="aspect-auto h-[200px] w-full">
              <BarChart accessibilityLayer data={rows} margin={{ left: 4, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                  tickFormatter={(value: string) => bucketLabel(value, bucket)}
                />
                <YAxis
                  width={58}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                  tickFormatter={(value: number) => format(value, measure)}
                />
                <ChartTooltip
                  cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
                  content={
                    <ShopTooltip
                      bucket={bucket}
                      render={(value) => format(value, measure, true)}
                    />
                  }
                />
                {/* One series, so no legend: the tile pressed above already
                    names what is drawn. */}
                <Bar
                  dataKey="value"
                  maxBarSize={28}
                  radius={[4, 4, 0, 0]}
                  fill="var(--primary)"
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
          </div>

          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th
                      key={header.id}
                      scope="col"
                      title={
                        frozen(header.column.id) === undefined
                          ? bucketTitle(header.column.id, bucket)
                          : undefined
                      }
                      className={headClass(header.column.id)}
                      style={frozen(header.column.id)}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>

            {/* One tbody per measure, so a measure and the span it is compared
                against hover together and the rule separates measures rather
                than rows. */}
            {STORE_MEASURES.map((option) => (
              <tbody key={option.measure} className="group">
                {table
                  .getRowModel()
                  .rows.filter((row) => row.original.measure === option.measure)
                  .map((row) => (
                    <tr
                      key={row.id}
                      className={
                        row.original.kind === "before"
                          ? "text-muted-foreground"
                          : undefined
                      }
                    >
                      {row.getAllCells().map((cell) => {
                        const content = flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )
                        const className = bodyClass(
                          cell.column.id,
                          row.original.kind,
                        )
                        // The measure names the row, so it is the row's
                        // heading rather than one more cell in it.
                        return cell.column.id === "measure" ? (
                          <th
                            key={cell.id}
                            scope="row"
                            className={className}
                            style={frozen(cell.column.id)}
                          >
                            {content}
                          </th>
                        ) : (
                          <td
                            key={cell.id}
                            className={className}
                            style={frozen(cell.column.id)}
                          >
                            {content}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      <ReceiptSheet scope={open} onClose={() => setOpen(null)} />
    </div>
  )
}

function ShopTooltip({
  active,
  payload,
  label,
  bucket,
  render,
}: {
  active?: boolean
  payload?: readonly { value?: number }[]
  label?: string
  bucket: SalesBucket
  render: (value: number) => string
}) {
  if (!active || !payload?.length || label === undefined) {
    return null
  }
  return (
    <div className="border-border/50 bg-background grid min-w-40 gap-1 rounded-lg border px-2.5 py-2 text-xs shadow-xl">
      <span className="font-medium">{bucketTitle(label, bucket)}</span>
      <span className="font-mono font-semibold tabular-nums">
        {render(payload[0]?.value ?? 0)}
      </span>
    </div>
  )
}

export default SalesScreen

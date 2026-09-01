import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { compactMoney, money, units } from "@/lib/money"
import type { SalesBucket } from "@/lib/sales"
import { bucketLabel, bucketTitle } from "@/lib/sales"
import { cn } from "@/lib/utils"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { SalesMatrix, SalesSeriesKind } from "@/components/sales/matrix"
import { chartConfig, SERIES_KINDS } from "@/components/sales/matrix"

/// What the fleet took, stacked by shop.
///
/// Stacked rather than grouped because the question this chart is opened to
/// answer is "how did the fleet trade" — the height of the column is the
/// answer, and each shop's share of it is the follow-up. Grouped bars put the
/// follow-up first and make the total something the reader has to add up.
///
/// The three measures share one chart rather than getting one each. They are
/// the same shape over the same days and the reader is comparing them across
/// a click, not side by side; three charts would be three axes to re-read.
export function SalesChart({
  matrix,
  bucket,
  kind,
  onKindChange,
}: {
  matrix: SalesMatrix
  bucket: SalesBucket
  kind: SalesSeriesKind
  onKindChange: (kind: SalesSeriesKind) => void
}) {
  const config = chartConfig(matrix)

  const rows = matrix.buckets.map((start) => {
    const row: Record<string, string | number> = { bucket: start }
    // Which band gets the rounded cap. Recorded per column rather than derived
    // in the renderer, because "the last series with something in it" is a
    // property of the column and every band would otherwise recompute it.
    let top = ""
    for (const series of matrix.series) {
      const value = matrix.valueAt(series.key, start, kind)
      row[series.key] = value
      if (value > 0) {
        top = series.key
      }
    }
    row[TOP_BAND] = top
    return row
  })

  const format = (value: number) =>
    kind === "gross_minor" ? money(value) : units(value)

  return (
    <Card className="gap-0 rounded-none border-0 border-b py-0 shadow-none">
      <CardHeader className="flex flex-col items-stretch gap-0 border-b p-0! sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-0.5 px-3.5 py-3 sm:py-0">
          {/* "The fleet" is a lie about a chart showing one shop, and the shop's
              own name is the first thing somebody who narrowed to it wants
              confirmed. */}
          <span className="text-sm font-semibold tracking-tight">
            {matrix.series.length === 1 ? matrix.series[0].label : "The fleet, by shop"}
          </span>
          <span className="text-muted-foreground text-[11.5px]">
            {matrix.buckets.length === 0
              ? "No period in this span."
              : `${bucketTitle(matrix.buckets[0], bucket)} — ${bucketTitle(
                  matrix.buckets[matrix.buckets.length - 1],
                  bucket,
                )}`}
          </span>
        </div>
        {/* The totals are the control. A reader who wants to know what the
            fleet took reads the number; a reader who wants the shape of it
            over time presses the same number and the chart follows. */}
        <div className="flex">
          {SERIES_KINDS.map((option) => (
            <button
              key={option.kind}
              type="button"
              data-active={kind === option.kind}
              aria-pressed={kind === option.kind}
              className="data-[active=true]:bg-muted/50 relative z-30 flex flex-1 cursor-pointer flex-col justify-center gap-0.5 border-t px-3.5 py-2.5 text-left transition-colors even:border-l last:border-l sm:border-t-0 sm:border-l sm:px-5 sm:py-3"
              onClick={() => onKindChange(option.kind)}
            >
              <span className="text-muted-foreground text-[11px]">{option.label}</span>
              <span className="font-mono text-base leading-none font-semibold tabular-nums">
                {option.kind === "gross_minor"
                  ? compactMoney(matrix.grandTotal(option.kind))
                  : units(matrix.grandTotal(option.kind))}
              </span>
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="px-1 py-3 sm:px-3">
        {/* Written here rather than left to recharts so it reads in the same
            order as the stack — top band first — and wraps instead of
            overflowing once a fleet has more shops than fit on one line. */}
        {matrix.series.length > 1 && (
          <div className="mb-1 flex flex-wrap justify-center gap-x-3 gap-y-1 px-2 text-[11px]">
            {[...matrix.series].reverse().map((band) => (
              <span key={band.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: `var(--color-${band.key})` }}
                />
                <span className="text-muted-foreground">{band.label}</span>
              </span>
            ))}
          </div>
        )}
        {matrix.series.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-xs">
            No shop has sold anything in this span.
          </p>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
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
                tickFormatter={(value: number) =>
                  kind === "gross_minor" ? compactMoney(value) : units(value)
                }
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
                content={
                  <SalesTooltip matrix={matrix} bucket={bucket} format={format} />
                }
              />
              {matrix.series.map((series) => (
                <Bar
                  key={series.key}
                  dataKey={series.key}
                  stackId="fleet"
                  maxBarSize={24}
                  fill={`var(--color-${series.key})`}
                  isAnimationActive={false}
                  shape={(props: object) => <Band {...props} band={series.key} />}
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

/// The column key that names the topmost band with something in it.
const TOP_BAND = "__top"

/// The surface gap between two shops' bands, in pixels.
///
/// White does the separating, not a stroke. A border around each band would
/// add ink that is not data and, on a thin column, would be most of it.
const BAND_GAP = 2

/// The radius of the column's cap. Only the topmost band is rounded; the
/// baseline stays square, because a rounded foot would lift the column off the
/// axis it is measured from.
const CAP_RADIUS = 4

function Band({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  fill,
  payload,
  band,
}: {
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
  payload?: Record<string, unknown>
  band: string
}) {
  if (height <= 0 || width <= 0) {
    return null
  }
  const capped = payload?.[TOP_BAND] === band
  // The gap sits above each band, between it and the shop stacked on top of
  // it — so the topmost band takes none and the column's height stays honest
  // where the reader measures it.
  const gap = capped ? 0 : Math.min(BAND_GAP, height)
  const top = y + gap
  const drawn = height - gap
  if (drawn <= 0) {
    return null
  }
  if (!capped) {
    return <rect x={x} y={top} width={width} height={drawn} fill={fill} />
  }
  const radius = Math.min(CAP_RADIUS, width / 2, drawn)
  const right = x + width
  const bottom = top + drawn
  return (
    <path
      fill={fill}
      d={
        `M${x},${bottom} L${x},${top + radius} Q${x},${top} ${x + radius},${top} ` +
        `L${right - radius},${top} Q${right},${top} ${right},${top + radius} ` +
        `L${right},${bottom} Z`
      }
    />
  )
}

/// What one column is made of, biggest shop first.
///
/// Written here rather than passed as a `formatter` to the stock tooltip
/// because a stacked column has one thing the stock one cannot say: the
/// total. A reader looking at a column wants the height and then the split,
/// and adding eight numbers in their head is not reading a chart.
function SalesTooltip({
  active,
  payload,
  label,
  matrix,
  bucket,
  format,
}: {
  active?: boolean
  payload?: readonly { dataKey?: string | number; value?: number; color?: string }[]
  label?: string
  matrix: SalesMatrix
  bucket: SalesBucket
  format: (value: number) => string
}) {
  if (!active || !payload?.length || label === undefined) {
    return null
  }
  const shown = payload
    .map((item) => ({
      key: String(item.dataKey ?? ""),
      value: item.value ?? 0,
      colour: item.color,
    }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value)
  const total = shown.reduce((sum, item) => sum + item.value, 0)

  return (
    <div className="border-border/50 bg-background grid min-w-48 gap-1.5 rounded-lg border px-2.5 py-2 text-xs shadow-xl">
      <div className="font-medium">{bucketTitle(label, bucket)}</div>
      {shown.length === 0 ? (
        <span className="text-muted-foreground">Nothing sold.</span>
      ) : (
        <>
          <div className="grid gap-1">
            {shown.map((item) => (
              <div key={item.key} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.colour }}
                />
                <span className="text-muted-foreground flex-1 truncate">
                  {matrix.labelOf(item.key)}
                </span>
                <span className="font-mono font-medium tabular-nums">
                  {format(item.value)}
                </span>
              </div>
            ))}
          </div>
          <div className={cn("flex items-center gap-2 border-t pt-1.5")}>
            <span className="text-muted-foreground flex-1">Fleet</span>
            <span className="font-mono font-semibold tabular-nums">{format(total)}</span>
          </div>
        </>
      )}
    </div>
  )
}

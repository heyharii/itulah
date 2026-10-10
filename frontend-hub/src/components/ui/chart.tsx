import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { compactFormat } from "@/lib/format"
import { cn } from "@/lib/utils"

/// The bar chart, in this app's grammar.
///
/// Promoted here from `src/screens/analytics/chart.tsx`, where it was inlined
/// because `components/` was not that module's to edit. Finance is the second
/// module to need a chart, so it moved — unchanged, because nothing in it knew
/// about sales and nothing in it knows about finance either.
///
/// DESIGN.md's bar grammar, point by point:
///
///  * **Thin bars.** `maxBarSize` caps them, so ninety days do not become
///    ninety hairlines and seven days do not become seven slabs.
///  * **`{accent}` is the primary series**, and indigo means the same thing
///    here as it does on a selected row.
///  * **One categorical cap.** `a-orange` is the only second colour a stacked
///    bar gets. Anything more and the chart starts telling shops apart by hue,
///    which is a thing eight colours can do and a fleet of nineteen cannot.
///  * **Faint ghost comparison bars behind**, drawn first and wider so the
///    live series sits in front of them.
///  * **Faint gridlines**, horizontal only. A vertical grid on a category axis
///    is a fence between columns that are already separated by a gap.
///  * **Tabular numbers**, everywhere a figure is drawn.
///
/// Type size is inherited rather than set: the container carries `text-eyebrow`
/// and the SVG text picks it up, so no px literal reaches a tick.

/// Which role a series plays. Not a colour — a role. A caller cannot pass a
/// hue, which is what keeps a fourth colour out of the chart.
export type SeriesTone = "accent" | "cap" | "ghost"

const FILL: Record<SeriesTone, string> = {
  accent: "var(--accent)",
  cap: "var(--a-orange)",
  ghost: "var(--hairline-2)",
}

export interface ChartSeries {
  /// The key on each row.
  readonly key: string
  readonly label: string
  readonly tone: SeriesTone
}

export interface ChartRow {
  /// The category, and the value the axis is labelled with.
  readonly bucket: string
  readonly [series: string]: string | number
}

/// Axis ticks only. Full precision belongs in the tooltip and in the table
/// underneath; an axis exists to say roughly how tall a bar is.
const compact = compactFormat()

export function BarSeries({
  rows,
  series,
  /// Stack rather than group. Stacking answers "how much altogether" first and
  /// "of which how much" second, which is the order these charts are read in.
  stacked = false,
  /// The full figure, for the tooltip.
  format,
  /// A bucket's name in full, for the tooltip's heading.
  titleOf,
  /// A bucket's name on the axis: short, because there can be ninety of them.
  labelOf,
  className,
}: {
  rows: readonly ChartRow[]
  series: readonly ChartSeries[]
  stacked?: boolean
  format: (value: number) => string
  titleOf: (bucket: string) => string
  labelOf: (bucket: string) => string
  className?: string
}) {
  return (
    <div className={cn("w-full text-eyebrow", className ?? "h-[13.75rem]")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows as ChartRow[]}
          margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
          // Negative, so the live series is drawn over the ghost rather than
          // beside it. Ghost series are declared first for the same reason.
          barGap={stacked ? 0 : -9}
        >
          <CartesianGrid
            vertical={false}
            stroke="var(--hairline)"
            strokeDasharray="2 3"
          />
          <XAxis
            dataKey="bucket"
            tickFormatter={labelOf}
            tick={{ fill: "var(--mute)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--hairline-2)" }}
            interval="preserveStartEnd"
            minTickGap={14}
          />
          <YAxis
            tickFormatter={(value: number) => compact.format(value)}
            tick={{ fill: "var(--mute)" }}
            tickLine={false}
            axisLine={false}
            width={46}
          />
          <Tooltip
            cursor={{ fill: "var(--soft)" }}
            content={(info) => {
              if (
                info.active !== true ||
                info.payload === undefined ||
                info.payload.length === 0
              ) {
                return null
              }
              return (
                <div className="rounded-inner border border-hairline bg-canvas px-2.5 py-2 shadow-pop">
                  <div className="mb-1 text-[0.875rem] font-medium text-ink">
                    {titleOf(String(info.label ?? ""))}
                  </div>
                  {info.payload.map((entry, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-1.5 text-[0.875rem] text-body"
                    >
                      <span
                        aria-hidden
                        className="size-[5px] shrink-0 rounded-full"
                        style={{ background: entry.color }}
                      />
                      <span>{String(entry.name ?? "")}</span>
                      <span className="ml-auto pl-4 font-medium text-ink tabular-nums">
                        {format(Number(entry.value ?? 0))}
                      </span>
                    </div>
                  ))}
                </div>
              )
            }}
          />
          {series.map((band) => (
            <Bar
              key={band.key}
              dataKey={band.key}
              name={band.label}
              fill={FILL[band.tone]}
              stackId={stacked ? "one" : undefined}
              maxBarSize={band.tone === "ghost" ? 18 : 11}
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/// A level and the cost of reaching it, on one axis.
///
/// The third chart in this file, and the only one that draws two series — so
/// the rule the other two keep is worth restating rather than quietly dropped.
/// `<BarSeries>` takes a `tone` per series and `<LineSeries>` takes none: a
/// caller cannot choose a hue, which is what keeps a fourth colour out of the
/// app. Nothing changes here. The two roles are FIXED — the line is whatever
/// the reader picked, the bars are always what it cost — so the colours are
/// decided in this function and there is still no hue to pass in.
///
/// **One axis, deliberately.** Discount runs at a tenth of the sales it buys,
/// so the bars are short and that is the finding, not a drawing problem. A
/// second axis would scale them up to match the line and invite the eye to read
/// "as much discount as sales", which is the single most flattering lie a
/// promotion chart can tell. If the bars are invisible, the discount was small.
///
/// `bars` is nullable for the case where the two would be the same series: when
/// the reader picks Discount Given itself, it is drawn once as the line rather
/// than twice in two colours.
export function ComboSeries({
  rows,
  bars,
  line,
  format,
  titleOf,
  labelOf,
  className,
}: {
  rows: readonly ChartRow[]
  bars: { readonly key: string; readonly label: string } | null
  line: { readonly key: string; readonly label: string }
  format: (value: number) => string
  titleOf: (bucket: string) => string
  labelOf: (bucket: string) => string
  className?: string
}) {
  return (
    <div className={cn("w-full text-eyebrow", className ?? "h-[13.75rem]")}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows as ChartRow[]}
          margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="var(--hairline)"
            strokeDasharray="2 3"
          />
          <XAxis
            dataKey="bucket"
            tickFormatter={labelOf}
            tick={{ fill: "var(--mute)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--hairline-2)" }}
            interval="preserveStartEnd"
            minTickGap={14}
          />
          <YAxis
            tickFormatter={(value: number) => compact.format(value)}
            tick={{ fill: "var(--mute)" }}
            tickLine={false}
            axisLine={false}
            width={46}
          />
          <Tooltip
            cursor={{ fill: "var(--soft)" }}
            content={(info) => {
              if (
                info.active !== true ||
                info.payload === undefined ||
                info.payload.length === 0
              ) {
                return null
              }
              return (
                <div className="rounded-inner border border-hairline bg-canvas px-2.5 py-2 shadow-pop">
                  <div className="mb-1 text-[0.875rem] font-medium text-ink">
                    {titleOf(String(info.label ?? ""))}
                  </div>
                  {info.payload.map((entry, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-1.5 text-[0.875rem] text-body"
                    >
                      <span
                        aria-hidden
                        className="size-[5px] shrink-0 rounded-full"
                        style={{ background: entry.color }}
                      />
                      <span>{String(entry.name ?? "")}</span>
                      <span className="ml-auto pl-4 font-medium text-ink tabular-nums">
                        {format(Number(entry.value ?? 0))}
                      </span>
                    </div>
                  ))}
                </div>
              )
            }}
          />
          {bars !== null && (
            <Bar
              dataKey={bars.key}
              name={bars.label}
              fill="var(--a-violet)"
              maxBarSize={11}
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          )}
          {/* No smoothing: a curved promotion line invents trading on days
              nothing sold, which is the same objection `<LineSeries>` makes. */}
          <Line
            type="linear"
            dataKey={line.key}
            name={line.label}
            stroke="var(--accent)"
            strokeWidth={1.5}
            dot={{ r: 2, fill: "var(--accent)", strokeWidth: 0 }}
            activeDot={{ r: 3.5 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/// One line over an ordered axis, in the same grammar.
///
/// The sibling `<BarSeries>` earned its place answering "how much, per
/// bucket"; this one answers the other question a ledger asks — *where was
/// this heading over the window* — and a bar chart cannot answer it. A running
/// balance is a level, not a quantity: consecutive bars invite the eye to add
/// them up, and adding two running balances together is meaningless.
///
/// Deliberately as spare as `<BarSeries>` and sharing everything it can: the
/// same grid, the same axes, the same compact ticks, the same tooltip. One
/// series only, and no tone — a level has nothing to be compared against on
/// its own axis, and the day a second one is wanted it will want a legend and
/// a reason, which is a change worth making then rather than a prop worth
/// carrying now.
///
/// An area under the line rather than a bare stroke: at this size the fill is
/// what makes the shape legible, and it is the accent at a wash rather than a
/// second colour.
///
/// **One optional exception to "one series only": a ghost.** `<BarSeries>` has
/// always drawn the span before as faint bars behind the live ones, and a line
/// answering "how did we trade" gets the same question asked of it. It is still
/// not a second series in the sense the paragraph above refuses — it carries no
/// hue, it cannot be chosen by the caller, and it is the SAME measure over a
/// different span. A second measure still wants a legend and a reason.
export interface ChartGhost {
  /// The key on each row carrying the comparison value.
  readonly dataKey: string
  /// What this point is called in the tooltip, given the whole row — so a
  /// comparison aligned by POSITION rather than by date can name its own day
  /// instead of borrowing the heading above it.
  readonly labelOf: (row: ChartRow) => string
}

export function LineSeries({
  rows,
  /// The key on each row carrying the value.
  dataKey,
  label,
  ghost,
  format,
  titleOf,
  labelOf,
  className,
}: {
  rows: readonly ChartRow[]
  dataKey: string
  label: string
  ghost?: ChartGhost
  format: (value: number) => string
  titleOf: (bucket: string) => string
  labelOf: (bucket: string) => string
  className?: string
}) {
  return (
    <div className={cn("w-full text-eyebrow", className ?? "h-[13.75rem]")}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={rows as ChartRow[]}
          margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
        >
          <defs>
            <linearGradient id="line-series-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
              <stop
                offset="100%"
                stopColor="var(--accent)"
                stopOpacity={0.01}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="var(--hairline)"
            strokeDasharray="2 3"
          />
          <XAxis
            dataKey="bucket"
            tickFormatter={labelOf}
            tick={{ fill: "var(--mute)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--hairline-2)" }}
            interval="preserveStartEnd"
            minTickGap={14}
          />
          <YAxis
            tickFormatter={(value: number) => compact.format(value)}
            tick={{ fill: "var(--mute)" }}
            tickLine={false}
            axisLine={false}
            width={46}
          />
          <Tooltip
            cursor={{ stroke: "var(--hairline-2)" }}
            content={(info) => {
              if (
                info.active !== true ||
                info.payload === undefined ||
                info.payload.length === 0
              ) {
                return null
              }
              const row = info.payload[0].payload as ChartRow
              const live = info.payload.find(
                (entry) => entry.dataKey === dataKey
              )
              const past =
                ghost === undefined
                  ? undefined
                  : info.payload.find(
                      (entry) => entry.dataKey === ghost.dataKey
                    )
              return (
                <div className="rounded-inner border border-hairline bg-canvas px-2.5 py-2 shadow-pop">
                  <div className="mb-1 text-[0.875rem] font-medium text-ink">
                    {titleOf(String(info.label ?? ""))}
                  </div>
                  <div className="flex items-center gap-1.5 text-[0.875rem] text-body">
                    <span
                      aria-hidden
                      className="size-[5px] shrink-0 rounded-full"
                      style={{ background: FILL.accent }}
                    />
                    <span>{label}</span>
                    <span className="ml-auto pl-4 font-medium text-ink tabular-nums">
                      {format(Number(live?.value ?? 0))}
                    </span>
                  </div>
                  {/* Named by its OWN date. The heading above is the day being
                      hovered; this point is a different day, and a tooltip
                      that let it borrow the heading would be the chart's one
                      chance to mislead. */}
                  {ghost !== undefined && past !== undefined && (
                    <div className="mt-0.5 flex items-center gap-1.5 text-[0.875rem] text-mute">
                      <span
                        aria-hidden
                        className="size-[5px] shrink-0 rounded-full"
                        style={{ background: FILL.ghost }}
                      />
                      <span>{ghost.labelOf(row)}</span>
                      <span className="ml-auto pl-4 font-medium tabular-nums">
                        {format(Number(past.value ?? 0))}
                      </span>
                    </div>
                  )}
                </div>
              )
            }}
          />
          {/* Declared first, so the live series is drawn over it. Dashed and
              unfilled: a second filled area under the first is two washes
              overlapping, and at this height that is a muddy band rather than
              two shapes. */}
          {ghost !== undefined && (
            <Line
              type="monotone"
              dataKey={ghost.dataKey}
              stroke="var(--hairline-2)"
              strokeWidth={1.25}
              strokeDasharray="3 3"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          )}
          <Area
            type="monotone"
            dataKey={dataKey}
            name={label}
            stroke="var(--accent)"
            strokeWidth={1.5}
            fill="url(#line-series-fill)"
            // A dot per movement is a ninety-dot line on a busy account; the
            // hover dot is what a reader actually points at.
            dot={false}
            activeDot={{ r: 3, fill: "var(--accent)", stroke: "none" }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/// ── The one categorical stack ───────────────────────────────────────────────
///
/// `<BarSeries>` above takes a *role* and never a hue, and that is what keeps
/// a fourth colour out of the ordinary chart. This is the exception the rule
/// was written against, and it is drawn narrowly rather than by loosening it:
/// **one shop per band, at most five of them, and everything else as Other.**
///
/// The reason it exists at all is that "how did the fleet trade, and which
/// branch is the reason" is one question asked in one glance. The reason it is
/// capped at five is the same reason `<BarSeries>` refuses a fourth colour: a
/// fleet of thirteen shops cannot be told apart by hue. The colours themselves,
/// their fixed order and why it is fixed are in `lib/chart-bands.ts`.

export interface ChartBand {
  readonly key: string
  readonly label: string
  /// One of `BAND_TONES`, or `BAND_NEUTRAL`. Not an arbitrary hue: the callers
  /// take these from the same list, so two screens drawing the same fleet draw
  /// it in the same colours.
  readonly colour: string
}

/// The column key naming the topmost band that has something in it.
const TOP_BAND = "__top"

/// The surface gap between two bands, in pixels. White does the separating,
/// not a stroke: a border round each band would add ink that is not data and,
/// on a thin column, would be most of it.
const BAND_GAP = 2

/// Only the topmost band is capped. A rounded foot would lift the column off
/// the axis it is measured from.
const CAP_RADIUS = 3

/// What the fleet took, stacked by shop.
///
/// Stacked rather than grouped because the question is "how much altogether"
/// first and "of which how much" second. Grouped bars put the follow-up first
/// and make the total something the reader has to add up.
export function BandStack({
  rows,
  bands,
  format,
  titleOf,
  labelOf,
  /// What the whole column is called in the tooltip's last line.
  totalLabel = "Fleet",
  className,
}: {
  rows: readonly ChartRow[]
  bands: readonly ChartBand[]
  format: (value: number) => string
  titleOf: (bucket: string) => string
  labelOf: (bucket: string) => string
  totalLabel?: string
  className?: string
}) {
  // Which band gets the cap is a property of the COLUMN, so it is recorded
  // once per row rather than recomputed by every band that draws itself.
  const data = rows.map((row) => {
    let top = ""
    for (const band of bands) {
      if (Number(row[band.key] ?? 0) > 0) top = band.key
    }
    return { ...row, [TOP_BAND]: top }
  })
  const colours = new Map(bands.map((band) => [band.key, band.colour]))
  const labels = new Map(bands.map((band) => [band.key, band.label]))

  return (
    <div className={cn("w-full text-eyebrow", className ?? "h-[13.75rem]")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid
            vertical={false}
            stroke="var(--hairline)"
            strokeDasharray="2 3"
          />
          <XAxis
            dataKey="bucket"
            tickFormatter={labelOf}
            tick={{ fill: "var(--mute)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--hairline-2)" }}
            interval="preserveStartEnd"
            minTickGap={14}
          />
          <YAxis
            tickFormatter={(value: number) => compact.format(value)}
            tick={{ fill: "var(--mute)" }}
            tickLine={false}
            axisLine={false}
            width={46}
          />
          <Tooltip
            cursor={{ fill: "var(--soft)" }}
            content={(info) => {
              if (
                info.active !== true ||
                info.payload === undefined ||
                info.payload.length === 0
              ) {
                return null
              }
              // Biggest first, and nothing that sold nothing: a column of
              // thirteen shops on a quiet Sunday is eleven zeroes and two
              // figures, and the two are the whole message.
              const shown = info.payload
                .map((entry) => ({
                  key: String(entry.dataKey ?? ""),
                  value: Number(entry.value ?? 0),
                }))
                .filter((entry) => entry.value > 0)
                .sort((left, right) => right.value - left.value)
              const total = shown.reduce((sum, entry) => sum + entry.value, 0)
              return (
                <div className="min-w-[11rem] rounded-inner border border-hairline bg-canvas px-2.5 py-2 shadow-pop">
                  <div className="mb-1 text-[0.875rem] font-medium text-ink">
                    {titleOf(String(info.label ?? ""))}
                  </div>
                  {shown.length === 0 ? (
                    <span className="text-[0.875rem] text-mute">
                      Nothing sold.
                    </span>
                  ) : (
                    <>
                      {shown.map((entry) => (
                        <div
                          key={entry.key}
                          className="flex items-center gap-1.5 text-[0.875rem] text-body"
                        >
                          <span
                            aria-hidden
                            className="size-[5px] shrink-0 rounded-full"
                            style={{ background: colours.get(entry.key) }}
                          />
                          <span className="truncate">
                            {labels.get(entry.key) ?? entry.key}
                          </span>
                          <span className="ml-auto pl-4 font-medium text-ink tabular-nums">
                            {format(entry.value)}
                          </span>
                        </div>
                      ))}
                      {/* A stacked column has one thing the stock tooltip
                          cannot say: the height. Adding five numbers in your
                          head is not reading a chart. */}
                      <div className="mt-1 flex items-center gap-1.5 border-t border-hairline pt-1 text-[0.875rem] text-body">
                        <span>{totalLabel}</span>
                        <span className="ml-auto pl-4 font-semibold text-ink tabular-nums">
                          {format(total)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )
            }}
          />
          {bands.map((band) => (
            <Bar
              key={band.key}
              dataKey={band.key}
              name={band.label}
              fill={band.colour}
              stackId="fleet"
              maxBarSize={22}
              isAnimationActive={false}
              shape={(props: object) => <Band {...props} band={band.key} />}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

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
  if (height <= 0 || width <= 0) return null
  const capped = payload?.[TOP_BAND] === band
  // The gap sits ABOVE each band, between it and the shop stacked on top of
  // it — so the topmost band takes none and the column's height stays honest
  // where the reader measures it against the axis.
  const gap = capped ? 0 : Math.min(BAND_GAP, height)
  const top = y + gap
  const drawn = height - gap
  if (drawn <= 0) return null
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

/// The stack's legend, top band first so it reads in the order the column is
/// drawn. Never optional: with five colours on one surface, the legend is what
/// stops identity being carried by hue alone.
export function BandLegend({ bands }: { bands: readonly ChartBand[] }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.875rem] text-body">
      {[...bands].reverse().map((band) => (
        <span key={band.key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-[5px] shrink-0 rounded-full"
            style={{ background: band.colour }}
          />
          {band.label}
        </span>
      ))}
    </div>
  )
}

/// The legend, written here rather than left to the chart library so it sits
/// above the plot in reading order and wraps instead of overflowing.
export function ChartLegend({ series }: { series: readonly ChartSeries[] }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.875rem] text-body">
      {series.map((band) => (
        <span key={band.key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-[5px] shrink-0 rounded-full"
            style={{ background: FILL[band.tone] }}
          />
          {band.label}
        </span>
      ))}
    </div>
  )
}

/// ── The mark that fits in a table cell ──────────────────────────────────────

/// A shape, at the size of a word.
///
/// Not a chart, and the difference is why it carries no axis, no grid, no
/// tooltip and no numbers: a chart is a thing a reader interrogates, and this
/// is a thing they glance at on the way to the figure beside it. What it
/// answers is the one question a column of totals cannot — whether the number
/// got there going up or coming down.
///
/// Hand-drawn as an SVG polyline rather than handed to recharts. Thirteen of
/// these in a table is thirteen `<ResponsiveContainer>`s each measuring itself
/// on every resize, and none of them would draw anything the four lines below
/// do not.
///
/// **Scaled to its own row, and that is deliberate.** A shop taking two million
/// a day and one taking two hundred thousand both fill the height, because the
/// question is the shape of each shop's own trade. Their sizes are in the
/// figures beside them, where a number can be read exactly rather than
/// estimated from a height eleven pixels tall.
export function Sparkline({
  values,
  colour = "var(--accent)",
  className,
}: {
  readonly values: readonly number[]
  /// A CSS value. The shop's own band colour where a screen has one, so the
  /// mark and the row's swatch agree.
  readonly colour?: string
  readonly className?: string
}) {
  // Two points make a line; one makes nothing worth drawing.
  if (values.length < 2) {
    return <span className={cn("inline-block", className)} />
  }

  const top = Math.max(...values)
  // From zero rather than from the smallest value. A floor at the minimum
  // magnifies noise into a cliff — every flat week would draw as a mountain
  // range — and a sales line's zero is a real place.
  const height = top === 0 ? 1 : top
  const step = 100 / (values.length - 1)
  const points = values
    .map((value, index) => `${index * step},${28 - (value / height) * 26}`)
    .join(" ")

  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      aria-hidden
      className={cn("h-[1.75rem] w-full", className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke={colour}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

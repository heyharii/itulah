import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

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
const compact = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
})

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
                  <div className="mb-1 text-[0.6875rem] font-medium text-ink">
                    {titleOf(String(info.label ?? ""))}
                  </div>
                  {info.payload.map((entry, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-1.5 text-[0.6875rem] text-body"
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

/// The legend, written here rather than left to the chart library so it sits
/// above the plot in reading order and wraps instead of overflowing.
export function ChartLegend({ series }: { series: readonly ChartSeries[] }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-body">
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

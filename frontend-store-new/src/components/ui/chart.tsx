import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { cn } from "@/lib/utils"

/// The chart, in the console's grammar.
///
/// Ported from `frontend-hub/src/components/ui/chart.tsx` rather than invented
/// here: this app is the console's phone expression, and a till that drew its
/// own idea of a line would be a second chart grammar in one company. What
/// travelled is the AREA-UNDER-A-LINE, which is the shape the console uses for
/// a run of days; the bar and band series stayed behind, because nothing on a
/// till compares shops to each other.
///
/// The rules that came with it, unchanged:
///
///  * **`{accent}` is the primary series.** One colour, because there is one
///    series. A second hue would have to mean something.
///  * **Faint gridlines, horizontal only.** A vertical grid on a date axis is
///    a fence between days that the line already crosses.
///  * **No dot per point.** Thirty days is thirty dots; the hover dot is what
///    a reader actually points at.
///  * **Axis ticks are compact, the tooltip is exact.** An axis says roughly
///    how tall; the number belongs in the tooltip and in the table below it.
///  * **Tabular numbers wherever a figure is drawn.**
///
/// Type size is inherited rather than set: the container carries
/// `text-eyebrow` and the SVG text picks it up, so no px literal reaches a
/// tick.
export interface ChartRow {
  /// The category, and the value the axis is labelled with.
  readonly bucket: string
  readonly [series: string]: string | number
}

/// Axis ticks only, in the shop's own locale.
const compact = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
})

export function LineSeries({
  rows,
  /// The key on each row carrying the value.
  dataKey,
  label,
  format,
  titleOf,
  labelOf,
  className,
}: {
  rows: readonly ChartRow[]
  dataKey: string
  label: string
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
              return (
                <div className="rounded-inner border border-hairline bg-canvas px-2.5 py-2 shadow-pop">
                  <div className="mb-1 text-[0.6875rem] font-medium text-ink">
                    {titleOf(String(info.label ?? ""))}
                  </div>
                  <div className="flex items-center gap-1.5 text-[0.6875rem] text-body">
                    <span
                      aria-hidden
                      className="size-[5px] shrink-0 rounded-full"
                      style={{ background: "var(--accent)" }}
                    />
                    <span>{label}</span>
                    <span className="ml-auto pl-4 font-medium text-ink tabular-nums">
                      {format(Number(info.payload[0].value ?? 0))}
                    </span>
                  </div>
                </div>
              )
            }}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            name={label}
            stroke="var(--accent)"
            strokeWidth={1.5}
            fill="url(#line-series-fill)"
            dot={false}
            activeDot={{ r: 3, fill: "var(--accent)", stroke: "none" }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts"

import type { ChartRow } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

/// The Money module's two charts, in the hub's grammar.
///
/// `components/ui/chart.tsx` carries the one line a till needed. The hub's
/// Sales and Reports draw two things it does not: the span before as a faint
/// ghost behind the line, and bars for a grouped run. Both are ported from
/// `frontend-hub/src/components/ui/chart.tsx` rather than re-imagined, so the
/// same trade reads the same way at head office and in the shop. The rules
/// travelled with them:
///
///  * `{accent}` is the primary series; the ghost is `{hairline-2}` and has no
///    hue a caller can choose.
///  * Faint gridlines, horizontal only; no dot per point; compact ticks on the
///    axis and the exact figure in the tooltip; tabular numbers throughout.
///
/// Type size is inherited: the container carries `text-eyebrow` and the SVG
/// text picks it up, so no px literal reaches a tick.

/// Axis ticks only, in the shop's own locale.
const compact = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
})

const GRID = (
  <CartesianGrid
    vertical={false}
    stroke="var(--hairline)"
    strokeDasharray="2 3"
  />
)

/// One figure in a tooltip: a dot, what it is, how much.
function TipRow({
  colour,
  label,
  value,
  quiet = false,
}: {
  colour: string
  label: React.ReactNode
  value: string
  quiet?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-pill",
        quiet ? "mt-0.5 text-mute" : "text-body",
      )}
    >
      <span
        aria-hidden
        className="size-[5px] shrink-0 rounded-full"
        style={{ background: colour }}
      />
      <span>{label}</span>
      <span
        className={cn(
          "ml-auto pl-4 font-medium tabular-nums",
          !quiet && "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  )
}

/// A run of days as an area under a line, with the span before as a dashed
/// ghost behind it.
///
/// The ghost is aligned by POSITION, not by date — the day before a thirty-day
/// span is thirty days earlier, which is the whole point of it — so each row
/// carries the ghost's own day and the tooltip names it rather than letting it
/// borrow the heading above.
export function TrendLine({
  rows,
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
  ghost?: {
    readonly dataKey: string
    readonly labelOf: (row: ChartRow) => string
  }
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
          <defs>
            <linearGradient id="money-trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
              <stop
                offset="100%"
                stopColor="var(--accent)"
                stopOpacity={0.01}
              />
            </linearGradient>
          </defs>
          {GRID}
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
                (entry) => entry.dataKey === dataKey,
              )
              const past =
                ghost === undefined
                  ? undefined
                  : info.payload.find(
                      (entry) => entry.dataKey === ghost.dataKey,
                    )
              return (
                <div className="rounded-inner border border-hairline bg-canvas px-2.5 py-2 shadow-pop">
                  <div className="mb-1 text-pill font-medium text-ink">
                    {titleOf(String(info.label ?? ""))}
                  </div>
                  <TipRow
                    colour="var(--accent)"
                    label={label}
                    value={format(Number(live?.value ?? 0))}
                  />
                  {ghost !== undefined && past !== undefined && (
                    <TipRow
                      quiet
                      colour="var(--hairline-2)"
                      label={ghost.labelOf(row)}
                      value={format(Number(past.value ?? 0))}
                    />
                  )}
                </div>
              )
            }}
          />
          {/* Declared first, so the live series is drawn over it. Dashed and
              unfilled: two washes overlapping at this height read as one
              muddy band rather than two shapes. */}
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
            fill="url(#money-trend-fill)"
            dot={false}
            activeDot={{ r: 3, fill: "var(--accent)", stroke: "none" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/// A grouped run — days, weeks or months — as thin bars.
///
/// Bars rather than the line Sales draws because Reports groups: a week is a
/// quantity somebody adds up, and a bar says "this much" where a line says
/// "this became that". `maxBarSize` keeps thirty days from turning into thirty
/// hairlines and four weeks from turning into four slabs. The busiest bucket
/// is full accent and the rest a step back, so the one worth asking about is
/// found without reading the axis.
export function RunBars({
  rows,
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
  const peak = Math.max(0, ...rows.map((row) => Number(row[dataKey] ?? 0)))
  return (
    <div className={cn("w-full text-eyebrow", className ?? "h-[13.75rem]")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows as ChartRow[]}
          margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
        >
          {GRID}
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
                  <div className="mb-1 text-pill font-medium text-ink">
                    {titleOf(String(info.label ?? ""))}
                  </div>
                  <TipRow
                    colour="var(--accent)"
                    label={label}
                    value={format(Number(info.payload[0].value ?? 0))}
                  />
                </div>
              )
            }}
          />
          <Bar
            dataKey={dataKey}
            name={label}
            maxBarSize={18}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
            // Per bar rather than per series: the peak is the one mark with
            // a colour of its own.
            shape={(props: BarShapeProps) => (
              <Rectangle
                x={props.x}
                y={props.y}
                width={props.width}
                height={props.height}
                // Only the top is rounded. A rounded foot would lift the bar
                // off the axis it is measured from.
                radius={[3, 3, 0, 0]}
                fill="var(--accent)"
                fillOpacity={
                  peak > 0 && Number(props.value) === peak ? 1 : 0.45
                }
              />
            )}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

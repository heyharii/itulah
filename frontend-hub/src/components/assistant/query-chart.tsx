import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { money } from "@/lib/format"

/// A chart the model composed, drawn in this app's grammar.
///
/// `components/ui/chart.tsx` is the grammar for charts somebody designed: two
/// tones, a fixed shape, a screen built around it. This is the other case —
/// the question arrived this morning and the chart was chosen for it — and it
/// needs three things that one deliberately refuses: a kind picked at runtime,
/// a series count decided by a query, and slices.
///
/// **What it keeps from that grammar**, because these are the parts that make
/// a chart in this app look like this app: thin bars, horizontal gridlines
/// only, tabular figures, ticks that inherit their size, and the accent as the
/// first series.
///
/// **Where it departs, and why.** DESIGN.md allows one categorical cap — the
/// accent and one more — on the grounds that a chart telling nineteen shops
/// apart by hue is a chart nobody can read. That holds for a fleet chart on a
/// fixed screen. It does not hold here: this chart exists because somebody
/// asked one question, its categories are few and named, and the alternative to
/// a third colour is refusing to draw the answer. So the palette runs to six,
/// and past six a pie becomes bars rather than inventing a seventh — the
/// honest failure, because the other repair is grouping the tail into "other",
/// which silently changes the figures.

/// How the model asked for it to be drawn. Everything here is checked before
/// it is used: this is a payload assembled by a language model, so a column
/// name that does not exist has to leave a gap rather than throw.
export interface ChartSpec {
  readonly kind: "bar" | "line" | "area" | "pie"
  readonly x: string
  readonly y: readonly string[]
  readonly stacked?: boolean
  readonly money?: boolean
}

/// Nothing here animates, which is the house rule `components/ui/chart.tsx`
/// already follows: a chart that grows out of the floor is a chart that is
/// wrong for the first second somebody looks at it, and under a screen reader
/// or a paused animation frame it is a chart that is wrong for good.
///
/// Six, in the order they are handed out. The accent first, because the first
/// series is the answer and the rest are context.
const PALETTE = [
  "var(--accent)",
  "var(--a-orange)",
  "var(--a-green)",
  "var(--a-violet)",
  "var(--a-blue)",
  "var(--a-pink)",
]

/// Past this a pie is a colour wheel with a legend nobody reads.
const MAX_SLICES = 6

/// Axis ticks only. Full precision belongs in the tooltip and in the table
/// underneath; an axis exists to say roughly how tall a bar is.
const compact = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
})

/// One chart, or nothing.
///
/// Nothing when the spec names a column the query did not return — which is a
/// model mistake, and the table underneath still answers the question. Drawing
/// an empty axis instead would say the data was missing.
export function QueryChart({
  spec,
  columns,
  rows,
}: {
  spec: ChartSpec
  readonly columns: readonly string[]
  /// Rows as they arrive: one array per row, in column order.
  readonly rows: readonly (readonly unknown[])[]
}) {
  const at = (column: string) => columns.indexOf(column)
  const xIndex = at(spec.x)
  const series = spec.y.filter((key) => at(key) >= 0)
  if (xIndex < 0 || series.length === 0 || rows.length === 0) return null

  const data = rows.map((row) => {
    const point: Record<string, string | number> = {
      [spec.x]: label(row[xIndex]),
    }
    for (const key of series) {
      const value = row[at(key)]
      point[key] = typeof value === "number" ? value : Number(value ?? 0) || 0
    }
    return point
  })

  const format = (value: number) =>
    spec.money ? money(value) : new Intl.NumberFormat("id-ID").format(value)
  const tick = (value: number) => compact.format(value)

  // A pie of one measure across too many rows is a wheel. Bars, in that case:
  // the same figures, still readable, and no data thrown away to fit.
  const kind =
    spec.kind === "pie" && (data.length > MAX_SLICES || series.length > 1)
      ? "bar"
      : spec.kind

  return (
    <div className="px-3 pt-3 pb-1 text-eyebrow">
      <ResponsiveContainer width="100%" height={kind === "pie" ? 200 : 176}>
        {kind === "pie" ? (
          <PieChart>
            <Pie
              data={data}
              dataKey={series[0]}
              nameKey={spec.x}
              innerRadius="52%"
              outerRadius="82%"
              paddingAngle={1.5}
              stroke="var(--canvas)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((_, index) => (
                <Cell key={index} fill={PALETTE[index % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip content={<Card format={format} />} />
          </PieChart>
        ) : kind === "line" ? (
          <LineChart data={data} margin={MARGIN}>
            {grid}
            <XAxis {...axis} dataKey={spec.x} />
            <YAxis {...axis} tickFormatter={tick} width={44} />
            <Tooltip content={<Card format={format} />} cursor={CURSOR} />
            {series.map((key, index) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={PALETTE[index % PALETTE.length]}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        ) : kind === "area" ? (
          <AreaChart data={data} margin={MARGIN}>
            {grid}
            <XAxis {...axis} dataKey={spec.x} />
            <YAxis {...axis} tickFormatter={tick} width={44} />
            <Tooltip content={<Card format={format} />} cursor={CURSOR} />
            {series.map((key, index) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stackId={spec.stacked ? "one" : undefined}
                stroke={PALETTE[index % PALETTE.length]}
                fill={PALETTE[index % PALETTE.length]}
                fillOpacity={0.14}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        ) : (
          <BarChart data={data} margin={MARGIN}>
            {grid}
            <XAxis {...axis} dataKey={spec.x} />
            <YAxis {...axis} tickFormatter={tick} width={44} />
            <Tooltip content={<Card format={format} />} cursor={CURSOR} />
            {series.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                stackId={spec.stacked ? "one" : undefined}
                fill={PALETTE[index % PALETTE.length]}
                maxBarSize={22}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>

      {series.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 px-1 pb-1">
          {series.map((key, index) => (
            <span key={key} className="flex items-center gap-1.5 text-mute">
              <span
                aria-hidden
                className="size-2 rounded-[2px]"
                style={{ background: PALETTE[index % PALETTE.length] }}
              />
              {key}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const MARGIN = { top: 4, right: 4, bottom: 0, left: 0 }
const CURSOR = { fill: "var(--soft-2)" }

const axis = {
  tickLine: false,
  axisLine: false,
  tick: { fill: "var(--mute)" },
  interval: "preserveStartEnd" as const,
  minTickGap: 12,
}

const grid = (
  <CartesianGrid vertical={false} stroke="var(--hairline)" strokeDasharray="0" />
)

/// The tooltip. Its own component because recharts' default is a white box
/// with a border radius this app does not use anywhere else.
function Card({
  active,
  payload,
  label: heading,
  format,
}: {
  active?: boolean
  payload?: readonly { name?: string; value?: number; color?: string }[]
  label?: string
  format: (value: number) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-inner border border-hairline bg-canvas px-2.5 py-1.5 shadow-pop">
      {heading !== undefined && (
        <div className="mb-1 text-eyebrow font-semibold text-mute uppercase">
          {heading}
        </div>
      )}
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-meta">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-[2px]"
            style={{ background: entry.color }}
          />
          <span className="min-w-0 flex-1 truncate text-body">
            {entry.name}
          </span>
          <span className="font-medium text-ink tabular-nums">
            {format(Number(entry.value ?? 0))}
          </span>
        </div>
      ))}
    </div>
  )
}

/// A category's name, as an axis can print it.
function label(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "string") {
    // A timestamp on an axis is a date; the time of day is never what a bucket
    // is called.
    const day = /^(\d{4}-\d{2}-\d{2})T/.exec(value)
    return day ? day[1] : value
  }
  return String(value)
}

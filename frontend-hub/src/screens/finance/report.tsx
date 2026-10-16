import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Card } from "@/components/ui/card"
import { Checkbox, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Toolbar } from "@/components/ui/segmented"
import { dateText, money, compactFormat } from "@/lib/format"
import { cn } from "@/lib/utils"

/// ERPNext's query report, in this app's parts.
///
/// Frappe draws every report the same way (`views/reports/query_report.js`):
/// the filters in one row under the title, then the report summary, then the
/// chart, then the table. These are those pieces, so every Finance report is
/// the same page with different figures in it — which is most of why
/// ERPNext's reports read as tidy.

// ── filters ──────────────────────────────────────────────────────────────

/// The filter row. A toolbar: controls left to right in ERPNext's order, the
/// sentence saying what is on screen at the far end.
export function ReportFilters({
  children,
  note,
  exportAction,
}: {
  children: React.ReactNode
  /// What the filters add up to, in words.
  note?: React.ReactNode
  /// The report's Export button, for a phone: its header is the top bar, so
  /// the button is a row at the foot of the Filters sheet instead of at the
  /// top of the page. Pass the same `<ExportButton>` the header carries.
  exportAction?: React.ReactNode
}) {
  return (
    <Toolbar>
      {children}
      {note && (
        <>
          <Toolbar.Spacer />
          <span className="text-[0.9375rem] text-mute">{note}</span>
        </>
      )}
      {exportAction !== undefined && (
        <div className="md:hidden [&>button]:w-full">{exportAction}</div>
      )}
    </Toolbar>
  )
}

export type Periodicity = "Monthly" | "Quarterly" | "Half-Yearly" | "Yearly"

export const PERIODICITIES: readonly Periodicity[] = [
  "Monthly",
  "Quarterly",
  "Half-Yearly",
  "Yearly",
]

/// ERPNext's Periodicity filter.
export function PeriodicitySelect({
  value,
  onChange,
}: {
  value: Periodicity
  onChange: (value: Periodicity) => void
}) {
  return (
    <span className="inline-flex w-36 shrink-0">
      <Select
        value={value}
        onChange={(next) => onChange(next as Periodicity)}
        className="h-8 w-36"
        aria-label="Periodicity"
      >
        {PERIODICITIES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    </span>
  )
}

/// A check filter — ERPNext's Accumulated Values, Show zero values.
export function FilterCheck({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Checkbox
      label={label}
      checked={checked}
      onChange={onChange}
      className="shrink-0"
    />
  )
}

// ── periods ──────────────────────────────────────────────────────────────

export interface Period {
  readonly key: string
  readonly label: string
  readonly from: string
  readonly to: string
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

const STEP: Record<Periodicity, number> = {
  Monthly: 1,
  Quarterly: 3,
  "Half-Yearly": 6,
  Yearly: 12,
}

/// The periods a window covers under a periodicity, clipped to it — ERPNext's
/// `get_period_list`, on calendar periods.
///
/// A period starts where its kind starts (a quarter in January, April, July or
/// October; a half in January or July; a year in January) whatever day the
/// window opens on, and is clipped to the window rather than spilling past it,
/// so the columns always add up to the window. With `accumulated`, every
/// period runs from the window's start, as ERPNext's Accumulated Values does.
///
/// Dates are sliced, never parsed: `new Date("2026-08-01")` is UTC, and in
/// Jakarta that names July for the first seven hours of every first-of-month.
export function periodsOf(
  from: string,
  to: string,
  periodicity: Periodicity,
  accumulated = false
): readonly Period[] {
  const step = STEP[periodicity]
  const startYear = Number(from.slice(0, 4))
  const startMonth = Number(from.slice(5, 7))
  const endYear = Number(to.slice(0, 4))
  const endMonth = Number(to.slice(5, 7))
  if (
    ![startYear, startMonth, endYear, endMonth].every(Number.isFinite) ||
    from > to
  ) {
    return []
  }

  let year = startYear
  let month = startMonth - ((startMonth - 1) % step)
  const periods: Period[] = []
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const open = iso(year, month, 1)
    const last = new Date(year, month - 1 + step, 0)
    const close = iso(last.getFullYear(), last.getMonth() + 1, last.getDate())
    periods.push({
      key: open,
      label: labelOf(year, month, periodicity),
      from: accumulated ? from : open > from ? open : from,
      to: close < to ? close : to,
    })
    month += step
    while (month > 12) {
      month -= 12
      year += 1
    }
  }
  return periods
}

function labelOf(
  year: number,
  month: number,
  periodicity: Periodicity
): string {
  switch (periodicity) {
    case "Monthly":
      return dateText(new Date(year, month - 1, 1), {
        month: "short",
        year: "numeric",
      })
    case "Quarterly":
      return `Q${Math.floor((month - 1) / 3) + 1} ${year}`
    case "Half-Yearly":
      return `H${month <= 6 ? 1 : 2} ${year}`
    case "Yearly":
      return String(year)
  }
}

// ── summary ──────────────────────────────────────────────────────────────

export interface SummaryItem {
  readonly label: string
  readonly value?: number | null
  /// ERPNext's indicator: green for a profit, red for a loss.
  readonly indicator?: "Green" | "Red"
  /// Drawn instead of `value` as money — for a figure that is not money, such
  /// as a margin ("39.3%").
  readonly display?: string
}

/// ERPNext's report summary: the few figures the report is read for, above
/// the chart. The server's own totals, never a sum of the rows below.
export function ReportSummary({ items }: { items: readonly SummaryItem[] }) {
  const text = (item: SummaryItem) =>
    item.display !== undefined
      ? item.display
      : item.value === null || item.value === undefined
        ? "—"
        : money(item.value)
  return (
    <>
      {/* A phone: the figures are one card, two to a row, like every list's. */}
      <KpiStrip className="md:hidden">
        {items.map((item) => (
          <Kpi
            key={item.label}
            label={item.label}
            value={
              <span
                className={
                  item.indicator === "Green"
                    ? "text-ok"
                    : item.indicator === "Red"
                      ? "text-bad-fg"
                      : undefined
                }
              >
                {text(item)}
              </span>
            }
          />
        ))}
      </KpiStrip>
      <Card className="figure-box mb-3 max-md:hidden">
        <dl className="grid grid-cols-2 divide-hairline sm:flex sm:divide-x">
          {items.map((item) => (
            <div key={item.label} className="min-w-0 flex-1 px-4 py-3.5">
              <dt className="truncate text-[0.9375rem] text-mute">
                {item.label}
              </dt>
              <dd
                className={cn(
                  "mt-1 text-[1.25rem] leading-tight font-semibold tracking-[-0.01em] tabular-nums",
                  item.indicator === "Green"
                    ? "text-ok"
                    : item.indicator === "Red"
                      ? "text-bad-fg"
                      : "text-ink"
                )}
              >
                {text(item)}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  )
}

// ── chart ────────────────────────────────────────────────────────────────

export interface ReportSeries {
  readonly key: string
  readonly label: string
}

/// Up to three series, coloured by position: the accent, the categorical
/// cap, and ink for a third that is the difference of the first two (Net
/// Profit, Equity). A caller names series, never hues.
const SERIES_COLOURS = [
  "var(--accent)",
  "var(--a-orange)",
  "var(--ink)",
] as const

export interface ReportChartRow {
  readonly label: string
  readonly [series: string]: string | number
}

const compact = compactFormat()

/// ERPNext's report chart: bars per period, or lines when the values are
/// accumulated — a running figure is a level, and bars invite adding up.
export function ReportChart({
  rows,
  series,
  kind,
}: {
  rows: readonly ReportChartRow[]
  series: readonly ReportSeries[]
  kind: "bar" | "line"
}) {
  const shown = series.slice(0, SERIES_COLOURS.length)
  const colour = (index: number) => SERIES_COLOURS[index] ?? SERIES_COLOURS[0]

  const axes = (
    <>
      <CartesianGrid
        vertical={false}
        stroke="var(--hairline)"
        strokeDasharray="2 3"
      />
      <XAxis
        dataKey="label"
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
        width={52}
      />
      <Tooltip
        cursor={
          kind === "bar"
            ? { fill: "var(--soft)" }
            : { stroke: "var(--hairline-2)" }
        }
        content={(info) => {
          if (info.active !== true || !info.payload?.length) return null
          return (
            <div className="rounded-inner border border-hairline bg-canvas px-2.5 py-2 shadow-pop">
              <div className="mb-1 text-[0.9375rem] font-medium text-ink">
                {String(info.label ?? "")}
              </div>
              {shown.map((item, index) => {
                const entry = info.payload?.find(
                  (candidate) => candidate.dataKey === item.key
                )
                return (
                  <div
                    key={item.key}
                    className="flex items-center gap-1.5 text-[0.9375rem] text-body"
                  >
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: colour(index) }}
                    />
                    <span>{item.label}</span>
                    <span className="ml-auto pl-4 font-medium text-ink tabular-nums">
                      {money(Number(entry?.value ?? 0))}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        }}
      />
    </>
  )

  return (
    <Card className="mb-3 px-4 pt-4 pb-3.5">
      <div className="h-[15rem] w-full text-eyebrow">
        <ResponsiveContainer width="100%" height="100%">
          {kind === "bar" ? (
            <BarChart
              data={rows as ReportChartRow[]}
              margin={{ top: 6, right: 8, bottom: 0, left: 4 }}
              barGap={2}
              barCategoryGap="28%"
            >
              {axes}
              {shown.map((item, index) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  name={item.label}
                  fill={colour(index)}
                  maxBarSize={18}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          ) : (
            <LineChart
              data={rows as ReportChartRow[]}
              margin={{ top: 6, right: 8, bottom: 0, left: 4 }}
            >
              {axes}
              {shown.map((item, index) => (
                <Line
                  key={item.key}
                  type="linear"
                  dataKey={item.key}
                  name={item.label}
                  stroke={colour(index)}
                  strokeWidth={2}
                  dot={{ r: 3, strokeWidth: 0, fill: colour(index) }}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--canvas)" }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.9375rem] text-body">
        {shown.map((item, index) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ background: colour(index) }}
            />
            {item.label}
          </span>
        ))}
      </div>
    </Card>
  )
}

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Card } from "@/components/ui/card"
import type { ChartRow } from "@/components/ui/chart"
import { Input, Select } from "@/components/ui/field"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { EmptyState } from "@/components/ui/states"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { isoDay, lastDays, seriesKey, fetchSeries } from "@/lib/queries"
import type { SalesSeries, SalesWindow } from "@/lib/queries"
import { queryState } from "@/lib/query-state"
import { fetchWindowAll, windowAllKey } from "@/lib/sales-window"
import { cn } from "@/lib/utils"
import { RunBars, TrendLine } from "@/screens/money/chart"
import {
  bucketTick,
  bucketTitle,
  dayStamp,
  tenderOf,
} from "@/screens/money/format"
import {
  CardHead,
  MoneyScreen,
  SpanPicker,
  Toolbar,
} from "@/screens/money/parts"
import {
  cashierRows,
  daysOfReceipts,
  daysOfSeries,
  grouped,
  hourRows,
  sum,
  valueOf,
  weekdayRows,
  type Day,
  type Figures,
  type Group,
  type Measure,
  type Row,
} from "@/screens/money/sales-data"
import { money, units } from "@itulah/contract/money"

/// This shop's sales, cut the way the hub's "Sales by …" screens cut them —
/// but only the cuts this node can answer. It serves two things: the daily
/// series, and a window of receipts (amount, items, cashier, time) with the
/// tender totals. Days, weeks, months, weekdays, hours, cashiers and payment
/// methods all come from those; nothing here is estimated.
///
/// Not offered, because the node has no sale lines to cut by: tag, division,
/// article, SKU, PO, supplier and campaign.

type Preset = "today" | "7" | "30" | "90" | "month" | "custom"
type View =
  | "days"
  | "weeks"
  | "months"
  | "weekdays" | "hours" | "cashiers" | "payment"

const PRESETS: readonly { value: Preset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom" },
]

const VIEWS: readonly { value: View; label: string }[] = [
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
  { value: "weekdays", label: "Weekdays" },
  { value: "hours", label: "Hours" },
  { value: "cashiers", label: "Cashiers" },
  { value: "payment", label: "Payment" },
]

const groupOf = (view: View): Group =>
  view === "weeks" ? "week" : view === "months" ? "month" : "day"
const byDayOf = (view: View) =>
  view === "days" || view === "weeks" || view === "months"

function rangeOf(
  preset: Preset,
  custom: { from: string; to: string },
): { from: string; to: string } {
  const today = new Date()
  if (preset === "today") return { from: isoDay(today), to: isoDay(today) }
  if (preset === "month") {
    return {
      from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: isoDay(today),
    }
  }
  if (preset === "custom") {
    const [from, to] =
      custom.from <= custom.to
        ? [custom.from, custom.to]
        : [custom.to, custom.from]
    return { from, to }
  }
  return lastDays(Number(preset))
}

export function Sales() {
  const [preset, setPreset] = useState<Preset>("30")
  const [custom, setCustom] = useState(() => {
    const today = isoDay(new Date())
    return { from: lastDays(7).from, to: today }
  })
  const [cashier, setCashier] = useState("")
  const [view, setView] = useState<View>("days")
  const [measure, setMeasure] = useState<Measure>("gross_minor")

  const range = rangeOf(preset, custom)

  const series = useQuery({
    queryKey: seriesKey(range.from, range.to, "day"),
    queryFn: ({ signal }) => fetchSeries({ ...range, bucket: "day" }, signal),
  })
  const window = useQuery({
    queryKey: windowAllKey(range.from, range.to),
    queryFn: ({ signal }) => fetchWindowAll(range, signal),
  })

  const cashiers = [
    ...new Set((window.data?.receipts ?? []).map((one) => one.actor_id)),
  ].sort()
  // A cashier chosen and then gone from the new range stays selectable, so
  // the filter never silently lets go of itself.
  if (cashier !== "" && !cashiers.includes(cashier)) cashiers.push(cashier)

  // Tenders are the shop's, not a cashier's.
  const activeView: View =
    cashier !== "" && view === "payment" ? "days" : view
  const views = VIEWS.filter((one) => cashier === "" || one.value !== "payment")

  const filtered = cashier !== "" || preset !== "30"
  const reset = () => {
    setPreset("30")
    setCashier("")
  }

  // Days straight from the series when nothing narrows it; from receipts when
  // a cashier does.
  const fromSeries = byDayOf(activeView) && cashier === ""
  const source = (fromSeries ? series : window) as typeof window

  return (
    <MoneyScreen>
      <Toolbar>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <SpanPicker options={PRESETS} value={preset} onChange={setPreset} />
          {preset === "custom" && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                aria-label="From"
                className="h-11 md:h-8 md:w-40"
                value={custom.from}
                max={custom.to}
                onChange={(event) =>
                  event.target.value !== "" &&
                  setCustom({ ...custom, from: event.target.value })
                }
              />
              <Input
                type="date"
                aria-label="To"
                className="h-11 md:h-8 md:w-40"
                value={custom.to}
                min={custom.from}
                max={isoDay(new Date())}
                onChange={(event) =>
                  event.target.value !== "" &&
                  setCustom({ ...custom, to: event.target.value })
                }
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {filtered && (
            <button
              type="button"
              onClick={reset}
              className="h-8 px-2 text-[0.875rem] font-medium text-accent"
            >
              Clear filters
            </button>
          )}
          <Select
            aria-label="Cashier"
            className="h-11 flex-1 md:h-8 md:w-48 md:flex-none"
            value={cashier}
            onChange={setCashier}
          >
            <option value="">All cashiers</option>
            {cashiers.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </Select>
        </div>
      </Toolbar>

      {queryState(source, {
        loading: "Loading",
        render: (data) => (
          <Body
            view={activeView}
            views={views}
            setView={setView}
            measure={measure}
            setMeasure={setMeasure}
            range={range}
            cashier={cashier}
            series={fromSeries ? (data as unknown as SalesSeries) : undefined}
            window={fromSeries ? window.data : (data as SalesWindow)}
          />
        ),
      })}
    </MoneyScreen>
  )
}

function Tabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div
      role="tablist"
      className="flex [scrollbar-width:none] gap-1 overflow-x-auto border-b border-hairline [&::-webkit-scrollbar]:hidden"
    >
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(option.value)}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 pt-2 pb-2.5 text-[0.875rem] font-medium whitespace-nowrap transition-colors pointer-coarse:min-h-11",
              on
                ? "border-accent text-ink"
                : "border-transparent text-body hover:text-ink",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

const MEASURES: readonly {
  value: Measure
  label: string
  show: (value: number) => string
}[] = [
  { value: "gross_minor", label: "Sales", show: (value) => money(value) },
  { value: "sales_count", label: "Receipts", show: units },
  { value: "average_minor", label: "Average", show: (value) => money(value) },
  { value: "units_sold", label: "Items", show: units },
]

function Body({
  view,
  views,
  setView,
  measure,
  setMeasure,
  range,
  cashier,
  series,
  window,
}: {
  view: View
  views: readonly { value: View; label: string }[]
  setView: (next: View) => void
  measure: Measure
  setMeasure: (next: Measure) => void
  range: { from: string; to: string }
  cashier: string
  series?: SalesSeries
  window?: SalesWindow
}) {
  const group = groupOf(view)
  const byDay = byDayOf(view)
  const receipts = (window?.receipts ?? []).filter(
    (one) => cashier === "" || one.actor_id === cashier,
  )

  // Payment has tenders, which count payments rather than sales and know
  // nothing about items.
  const payment = view === "payment"
  const measures = payment
    ? MEASURES.filter((one) => one.value !== "units_sold")
    : MEASURES
  const active = measures.some((one) => one.value === measure)
    ? measure
    : "gross_minor"
  const shown = measures.find((one) => one.value === active) ?? measures[0]

  let rows: readonly Row[] = []
  let days: readonly Day[] = []
  if (byDay) {
    days = grouped(
      series !== undefined
        ? daysOfSeries(series)
        : daysOfReceipts(receipts, range.from, range.to),
      group,
    )
    rows = days.map((day) => ({ ...day, key: day.day, label: day.day }))
  } else if (view === "weekdays") rows = weekdayRows(receipts)
  else if (view === "hours") rows = hourRows(receipts)
  else if (view === "cashiers") rows = cashierRows(receipts)
  else {
    rows = (window?.tenders ?? []).map((tender) => ({
      key: tender.method,
      label: tenderOf(tender.method).word,
      sales_count: tender.count,
      units_sold: 0,
      gross_minor: tender.amount_minor,
    }))
  }

  // Receipts are what the views below the days are cut from, and the node
  // hands over at most this many.
  const cut = !byDay && window?.receipts_truncated === true
  const total: Figures = payment
    ? {
        sales_count: window?.sales.count ?? 0,
        units_sold: window?.sales.units_sold ?? 0,
        gross_minor: sum(rows).gross_minor,
      }
    : sum(rows)

  const tabs = <Tabs options={views} value={view} onChange={setView} />

  if (total.sales_count === 0) {
    return (
      <div className="flex flex-col gap-6">
        {tabs}
        <Card>
          <EmptyState>No sales in this period.</EmptyState>
        </Card>
      </div>
    )
  }

  const chartRows: readonly ChartRow[] = rows.map((row) => ({
    bucket: row.key,
    now: valueOf(row, active),
  }))

  return (
    <div className="flex flex-col gap-6">
      <StatStrip className="mb-0">
        <Stat label="Sales" value={money(total.gross_minor)} />
        <Stat label="Receipts" value={units(total.sales_count)} />
        <Stat
          label="Average"
          value={money(valueOf(total, "average_minor"))}
        />
        {!payment && <Stat label="Items" value={units(total.units_sold)} />}
      </StatStrip>

      {tabs}

      <Card>
        <CardHead
          title={VIEWS.find((one) => one.value === view)?.label ?? ""}
          aside={
            <>
              {cut && (
                <span className="text-[0.875rem] text-warn-fg">
                  Latest {units(window?.receipts_limit ?? 0)} sales
                </span>
              )}
              <SpanPicker
                options={measures}
                value={active}
                onChange={setMeasure}
                className="max-md:hidden"
              />
            </>
          }
          className="px-5 py-4"
        />
        <div className="px-4 pt-5 pb-4 md:px-5">
          <SpanPicker
            options={measures}
            value={active}
            onChange={setMeasure}
            className="mb-4 md:hidden"
          />
          {byDay ? (
            <TrendLine
              rows={chartRows}
              dataKey="now"
              label={shown.label}
              format={shown.show}
              labelOf={(start) => bucketTick(start, group)}
              titleOf={(start) => bucketTitle(start, group)}
              className="h-[13.75rem] md:h-[17.5rem]"
            />
          ) : (
            <RunBars
              rows={chartRows.map((row) => ({
                ...row,
                bucket: labelFor(rows, String(row.bucket)),
              }))}
              dataKey="now"
              label={shown.label}
              format={shown.show}
              labelOf={(text) => text}
              titleOf={(text) => text}
              className="h-[13.75rem] md:h-[17.5rem]"
            />
          )}
        </div>
      </Card>

      <Card>
        <Table
          view={view}
          rows={rows}
          total={total}
          payment={payment}
        />
      </Card>
    </div>
  )
}

function labelFor(rows: readonly Row[], key: string): string {
  return rows.find((row) => row.key === key)?.label ?? key
}

function Table({
  view,
  rows,
  total,
  payment,
}: {
  view: View
  rows: readonly Row[]
  total: Figures
  payment: boolean
}) {
  type Line = Row & { foot?: boolean }
  const group = groupOf(view)
  const byDay = byDayOf(view)
  // Periods with no sales at all are not rows.
  const sold = rows.filter((row) => row.sales_count > 0)
  const list: Line[] = [
    // Days read newest first: the one somebody wants is the latest.
    ...(byDay ? [...sold].reverse() : sold),
    { key: "total", label: "Total", foot: true, ...total },
  ]

  const figure = (line: Line, value: number, text: string) =>
    value === 0 && line.foot !== true ? null : (
      <span className={line.foot === true ? "font-semibold text-ink" : ""}>
        {text}
      </span>
    )

  const first =
    byDay
      ? group === "day"
        ? "Day"
        : group === "week"
          ? "Week of"
          : "Month"
      : (VIEWS.find((one) => one.value === view)?.label ?? "")

  const columns: ListColumn<Line>[] = [
    {
      id: "label",
      header: first,
      className: "min-w-[9rem] py-1",
      cell: (line) => {
        if (line.foot === true) {
          return <span className="font-semibold text-ink">Total</span>
        }
        const text =
          byDay
            ? group === "day"
              ? dayStamp(line.label)
              : bucketTitle(line.label, group)
            : line.label
        return (
          <span className="text-ink">{text}</span>
        )
      },
    },
    {
      id: "sales",
      header: "Sales",
      align: "right",
      card: "status",
      className: "tabular-nums",
      cell: (line) => figure(line, line.gross_minor, money(line.gross_minor)),
    },
    {
      id: "receipts",
      header: "Receipts",
      align: "right",
      card: "hide",
      className: "tabular-nums",
      cell: (line) =>
        figure(line, line.sales_count, units(line.sales_count)),
    },
    {
      id: "average",
      header: "Average",
      align: "right",
      card: "hide",
      className: "tabular-nums max-lg:hidden",
      cell: (line) =>
        figure(
          line,
          line.sales_count,
          money(valueOf(line, "average_minor")),
        ),
    },
    ...(payment
      ? []
      : [
          {
            id: "items",
            header: "Items",
            align: "right",
            card: "hide",
            className: "tabular-nums",
            cell: (line) =>
              figure(line, line.units_sold, units(line.units_sold)),
          } satisfies ListColumn<Line>,
        ]),
    ...(byDay
      ? []
      : [
          {
            id: "share",
            header: "Share",
            align: "right",
            card: "hide",
            className: "tabular-nums max-md:hidden",
            cell: (line) =>
              total.gross_minor === 0 ? null : (
                <span className={line.foot === true ? "font-semibold" : ""}>
                  {Math.round((line.gross_minor / total.gross_minor) * 100)}%
                </span>
              ),
          } satisfies ListColumn<Line>,
        ]),
    {
      id: "summary",
      header: "",
      card: "meta",
      className: "hidden",
      cell: (line) => (
        <span>
          {units(line.sales_count)} receipts
          {payment ? "" : ` · ${units(line.units_sold)} items`}
        </span>
      ),
    },
  ]

  return (
    <ListTable
      roomy
      rows={list}
      columns={columns}
      rowKey={(line) => line.key}
      empty="No sales in this period."
    />
  )
}

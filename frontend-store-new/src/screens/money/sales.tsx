import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import type { ChartRow } from "@/components/ui/chart"
import { Field, Input, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import type { ListColumn } from "@/components/ui/list-table"
import { BottomSheet, PickerSheet } from "@/components/ui/picker-sheet"
import { EmptyState } from "@/components/ui/states"
import { useLayout } from "@/lib/layout"
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
  spanWords,
  tenderOf,
} from "@/screens/money/format"
import {
  ChartCard,
  DeskBar,
  MoneyScreen,
  Rows,
  SpanPicker,
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
///
/// ## On a phone
///
/// Nothing at the top but the figures. The period is the dock's status chip;
/// what the list is cut by, and which figure the chart and the cards lead with,
/// are rows of its ⚙ sheet, and the cashier is its filter. The cut is a list of
/// lead cards — the chosen figure as the lead, the rest in the foot — under a
/// chart that is as wide as the glass with its busiest bucket written under it.
/// A desk keeps the toolbar, the tabs and the hub's table.

type Preset = "today" | "7" | "30" | "90" | "month" | "custom"
type View =
  "days" | "weeks" | "months" | "weekdays" | "hours" | "cashiers" | "payment"

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

export function Sales() {
  const phone = useLayout() === "phone"
  const [preset, setPreset] = useState<Preset>("30")
  const [custom, setCustom] = useState(() => {
    const today = isoDay(new Date())
    return { from: lastDays(7).from, to: today }
  })
  const [cashier, setCashier] = useState("")
  const [view, setView] = useState<View>("days")
  const [measure, setMeasure] = useState<Measure>("gross_minor")
  // The phone's two sheets that are not the dock's own: a cashier to narrow
  // to, and the two ends of a custom span.
  const [cashiersOpen, setCashiersOpen] = useState(false)
  const [datesOpen, setDatesOpen] = useState(false)

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
  const activeView: View = cashier !== "" && view === "payment" ? "days" : view
  const views = VIEWS.filter((one) => cashier === "" || one.value !== "payment")

  // Payment has tenders, which count payments rather than sales and know
  // nothing about items.
  const payment = activeView === "payment"
  const measures = payment
    ? MEASURES.filter((one) => one.value !== "units_sold")
    : MEASURES
  const activeMeasure = measures.some((one) => one.value === measure)
    ? measure
    : "gross_minor"

  // Days straight from the series when nothing narrows it; from receipts when
  // a cashier does.
  const fromSeries = byDayOf(activeView) && cashier === ""
  const source = (fromSeries ? series : window) as typeof window

  return (
    <MoneyScreen>
      {/* The dock, on a phone: renders nothing anywhere else. */}
      <DockTools
        status={{
          value: preset,
          options: PRESETS,
          onChange: (next) => {
            setPreset(next as Preset)
            // Custom is two dates: they are asked for the moment it is chosen,
            // and again each time it is chosen again.
            if (next === "custom") setDatesOpen(true)
          },
        }}
        filter={{
          count: cashier === "" ? 0 : 1,
          label: "Cashier",
          onOpen: () => setCashiersOpen(true),
        }}
        views={[
          {
            title: "Show by",
            value: activeView,
            options: views,
            onChange: (next) => setView(next as View),
          },
          {
            title: "Figure",
            value: activeMeasure,
            options: measures,
            onChange: (next) => setMeasure(next as Measure),
          },
        ]}
      />
      {phone && (
        <>
          <PickerSheet
            open={cashiersOpen}
            onOpenChange={setCashiersOpen}
            title="Cashier"
            options={[
              { value: "", label: "All cashiers" },
              ...cashiers.map((one) => ({ value: one, label: one })),
            ]}
            selected={[cashier]}
            onPick={setCashier}
          />
          <BottomSheet
            open={datesOpen}
            onOpenChange={setDatesOpen}
            title="Custom dates"
            action={
              <button
                type="button"
                onClick={() => setDatesOpen(false)}
                className="h-tap shrink-0 rounded-inner px-3 text-[0.9375rem] font-semibold text-accent active:opacity-60"
              >
                Done
              </button>
            }
          >
            <div className="flex flex-col gap-4 px-4 pb-4">
              <DateFields custom={custom} onChange={setCustom} />
            </div>
          </BottomSheet>
        </>
      )}

      {/* The desk's toolbar: the span and the cashier. */}
      <DeskBar>
        <SpanPicker options={PRESETS} value={preset} onChange={setPreset} />
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <DateFields custom={custom} onChange={setCustom} inline />
          </div>
        )}
        <span className="flex-1" />
        {cashier !== "" && (
          <button
            type="button"
            onClick={() => setCashier("")}
            className="h-8 px-2 text-[0.875rem] font-medium text-accent"
          >
            Clear cashier
          </button>
        )}
        <Select
          aria-label="Cashier"
          className="h-8 w-48"
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
      </DeskBar>

      {queryState(source, {
        loading: "Reading the sales…",
        render: (data) => (
          <Body
            view={activeView}
            views={views}
            setView={setView}
            measures={measures}
            measure={activeMeasure}
            setMeasure={setMeasure}
            range={range}
            cashier={cashier}
            phone={phone}
            series={fromSeries ? (data as unknown as SalesSeries) : undefined}
            window={fromSeries ? window.data : (data as SalesWindow)}
          />
        ),
      })}
    </MoneyScreen>
  )
}

/// The two ends of a custom span. Stacked and labelled in the phone's sheet,
/// side by side on the desk's toolbar.
function DateFields({
  custom,
  onChange,
  inline = false,
}: {
  custom: { from: string; to: string }
  onChange: (next: { from: string; to: string }) => void
  inline?: boolean
}) {
  const from = (
    <Input
      type="date"
      aria-label="From"
      className={inline ? "h-8 w-40" : undefined}
      value={custom.from}
      max={custom.to}
      onChange={(event) =>
        event.target.value !== "" &&
        onChange({ ...custom, from: event.target.value })
      }
    />
  )
  const to = (
    <Input
      type="date"
      aria-label="To"
      className={inline ? "h-8 w-40" : undefined}
      value={custom.to}
      min={custom.from}
      max={isoDay(new Date())}
      onChange={(event) =>
        event.target.value !== "" &&
        onChange({ ...custom, to: event.target.value })
      }
    />
  )
  if (inline) {
    return (
      <>
        {from}
        {to}
      </>
    )
  }
  return (
    <>
      <Field label="From">{from}</Field>
      <Field label="To">{to}</Field>
    </>
  )
}

/// The desk's tabs: which cut of the sales is on the page. On a phone it is a
/// row of the dock's ⚙ sheet instead.
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
      className="flex gap-1 border-b border-hairline max-md:hidden"
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

function Body({
  view,
  views,
  setView,
  measures,
  measure,
  setMeasure,
  range,
  cashier,
  phone,
  series,
  window,
}: {
  view: View
  views: readonly { value: View; label: string }[]
  setView: (next: View) => void
  measures: typeof MEASURES
  measure: Measure
  setMeasure: (next: Measure) => void
  range: { from: string; to: string }
  cashier: string
  phone: boolean
  series?: SalesSeries
  window?: SalesWindow
}) {
  const group = groupOf(view)
  const byDay = byDayOf(view)
  const receipts = (window?.receipts ?? []).filter(
    (one) => cashier === "" || one.actor_id === cashier,
  )

  const payment = view === "payment"
  const shown = measures.find((one) => one.value === measure) ?? measures[0]

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

  const nameOf = (row: Row): string =>
    byDay
      ? group === "day"
        ? dayStamp(row.label)
        : bucketTitle(row.label, group)
      : row.label

  const chartRows: readonly ChartRow[] = rows.map((row) => ({
    bucket: row.key,
    now: valueOf(row, measure),
  }))
  const busiest = rows.reduce<Row | null>(
    (best, row) =>
      best === null || valueOf(row, measure) > valueOf(best, measure)
        ? row
        : best,
    null,
  )
  const note = (
    <>
      {busiest !== null && valueOf(busiest, measure) > 0 && (
        <>
          Busiest: {nameOf(busiest)} · {shown.show(valueOf(busiest, measure))}
        </>
      )}
      {cut && (
        <span className="block text-warn-fg">
          Latest {units(window?.receipts_limit ?? 0)} sales
        </span>
      )}
    </>
  )

  // Periods with no sales at all are not rows. Days read newest first: the one
  // somebody wants is the latest.
  const sold = rows.filter((row) => row.sales_count > 0)
  const list: Line[] = [...(byDay ? [...sold].reverse() : sold)]

  return (
    <div className="flex flex-col gap-4">
      <KpiStrip className="mb-0">
        <Kpi label="Sales" value={money(total.gross_minor)} />
        <Kpi label="Receipts" value={units(total.sales_count)} />
        <Kpi label="Average" value={money(valueOf(total, "average_minor"))} />
        {!payment && <Kpi label="Items" value={units(total.units_sold)} />}
      </KpiStrip>

      {tabs}

      <ChartCard
        title={shown.label}
        sub={spanWords(range.from, range.to)}
        aside={
          <SpanPicker
            options={measures}
            value={measure}
            onChange={setMeasure}
            className="max-md:hidden"
          />
        }
        note={note}
      >
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
            // Seven weekdays do not fit a phone in full: Mon, Tue, … and the
            // tooltip names the day.
            labelOf={(text) => (view === "weekdays" ? text.slice(0, 3) : text)}
            titleOf={(text) => text}
            className="h-[13.75rem] md:h-[17.5rem]"
          />
        )}
      </ChartCard>

      <Table
        view={view}
        phone={phone}
        rows={list}
        total={total}
        payment={payment}
        measures={measures}
        measure={measure}
        nameOf={nameOf}
      />
    </div>
  )
}

function labelFor(rows: readonly Row[], key: string): string {
  return rows.find((row) => row.key === key)?.label ?? key
}

type Line = Row & { foot?: boolean }

/// What a row says beside its lead figure: the other figures it has, in the
/// order a shop reads them. The lead is the one the chart is drawn from.
function aboutOf(
  line: Row,
  measure: Measure,
  payment: boolean,
  total: Figures,
  byDay: boolean,
): string {
  const parts: string[] = []
  const receipts = `${units(line.sales_count)} ${
    payment
      ? line.sales_count === 1
        ? "payment"
        : "payments"
      : line.sales_count === 1
        ? "receipt"
        : "receipts"
  }`
  const items = `${units(line.units_sold)} ${line.units_sold === 1 ? "item" : "items"}`
  const sales = money(line.gross_minor)
  if (measure === "gross_minor")
    parts.push(receipts, ...(payment ? [] : [items]))
  else if (measure === "sales_count")
    parts.push(sales, ...(payment ? [] : [items]))
  else if (measure === "average_minor") parts.push(receipts, sales)
  else parts.push(sales, receipts)
  if (!byDay && total.gross_minor > 0) {
    parts.push(`${Math.round((line.gross_minor / total.gross_minor) * 100)}%`)
  }
  return parts.join(" · ")
}

function Table({
  view,
  phone,
  rows,
  total,
  payment,
  measures,
  measure,
  nameOf,
}: {
  view: View
  phone: boolean
  rows: readonly Line[]
  total: Figures
  payment: boolean
  measures: typeof MEASURES
  measure: Measure
  nameOf: (row: Row) => string
}) {
  const group = groupOf(view)
  const byDay = byDayOf(view)
  const shown = measures.find((one) => one.value === measure) ?? measures[0]
  // A desk's table closes on its total; a phone's strip of figures already is
  // it.
  const list: Line[] = phone
    ? [...rows]
    : [...rows, { key: "total", label: "Total", foot: true, ...total }]

  const figure = (line: Line, value: number, text: string) =>
    value === 0 && line.foot !== true ? null : (
      <span className={line.foot === true ? "font-semibold text-ink" : ""}>
        {text}
      </span>
    )

  const first = byDay
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
      cell: (line) =>
        line.foot === true ? (
          <span className="font-semibold text-ink">Total</span>
        ) : (
          <span className="text-ink">{nameOf(line)}</span>
        ),
    },
    {
      id: "sales",
      header: "Sales",
      align: "right",
      className: "tabular-nums",
      cell: (line) => figure(line, line.gross_minor, money(line.gross_minor)),
    },
    {
      id: "receipts",
      header: payment ? "Payments" : "Receipts",
      align: "right",
      className: "tabular-nums",
      cell: (line) => figure(line, line.sales_count, units(line.sales_count)),
    },
    {
      id: "average",
      header: "Average",
      align: "right",
      className: "tabular-nums max-lg:hidden",
      cell: (line) =>
        figure(line, line.sales_count, money(valueOf(line, "average_minor"))),
    },
    ...(payment
      ? []
      : [
          {
            id: "items",
            header: "Items",
            align: "right",
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
            className: "tabular-nums max-md:hidden",
            cell: (line) =>
              total.gross_minor === 0 ? null : (
                <span className={line.foot === true ? "font-semibold" : ""}>
                  {Math.round((line.gross_minor / total.gross_minor) * 100)}%
                </span>
              ),
          } satisfies ListColumn<Line>,
        ]),
  ]

  return (
    <Rows
      roomy
      rows={list}
      columns={columns}
      rowKey={(line) => line.key}
      empty="No sales in this period."
      card={(line) => ({
        title: nameOf(line),
        lead: {
          figure: shown.show(valueOf(line, measure)),
          caption: shown.label,
        },
        foot: {
          info: aboutOf(line, measure, payment, total, byDay),
        },
      })}
    />
  )
}

import {
  useQuery,
  useSuspenseQueries,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { node } from "@/lib/api"
import { count, dateText, money, moneyCompact } from "@/lib/format"
import { dailyReportQuery, type SaleTenderTotal } from "@/lib/queries/analytics"
import { storeCashCountsQuery } from "@/lib/queries/finance"
import { type UnitView } from "@/lib/queries/organisation"
import { useLayout } from "@/lib/layout"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { Status } from "@/components/ui/pill"
import { Grid, Td, Th } from "@/screens/finance-final/parts"
import { isoDay, todayIso } from "@/screens/finance/chart"
import { PhoneList } from "@/components/ui/phone-cards"
import { PhoneChoice, PhoneFigures } from "@/screens/finance/parts"
import { FactsSheet } from "@/screens/finance/phone-parts"
import {
  chosenStoreOf,
  lastDays,
  lastWeeks,
  remember,
  useRemembered,
} from "@/screens/finance/store-units"
import { StoreFrame, useOpenStores } from "@/screens/finance/stores-frame"
import type { CashCountRow } from "@itulah/contract"

/// Finance › Stores (owner, 2026-10-01): one shop at a time, its money from
/// head office's side — what the till took each day against what reached the
/// drawer and the bank, what it spent from petty cash each week, and the cash
/// counts.
///
/// Two rails, the way a booking site lays out dates: the shops down the left,
/// and across the top the days (sales) or the weeks (expenses, cash counts),
/// each carrying its own figure so the day worth opening is visible before it
/// is opened.

export function StoresSales() {
  return (
    <StoreFrame title="Sales by day">
      {(unit, picker) => (
        <SalesByDay key={unit.id} unit={unit} picker={picker} />
      )}
    </StoreFrame>
  )
}

/// Cash counts are a list of counts, not a shop's page: the shop is a picker
/// in the bar under the head, the week a rail of tabs, and a count opens as a
/// sheet from its row.
export function StoresCounts() {
  return (
    <PageContent>
      <PageHeader crumb="Finance › Stores" title="Cash counts" />
      <Suspense fallback={<LoadingState>Reading the shops…</LoadingState>}>
        <CountsPage />
      </Suspense>
    </PageContent>
  )
}

function CountsPage() {
  const { stores } = useOpenStores()
  const kept = useRemembered()
  // Empty until somebody picks: the page follows the shop the tab remembers.
  const [picked, setPicked] = useState("")
  const unit = chosenStoreOf(stores, picked === "" ? kept : picked)
  if (unit === undefined) return <EmptyState>No shop is open yet.</EmptyState>
  const picker = (
    <Toolbar>
      <Select
        value={unit.id}
        onChange={(next) => {
          setPicked(next)
          remember(next)
        }}
        aria-label="Shop"
        className="h-control w-64"
      >
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.name} · {store.code}
          </option>
        ))}
      </Select>
    </Toolbar>
  )
  return (
    <>
      {picker}
      <Suspense
        key={unit.id}
        fallback={<LoadingState>Reading the counts…</LoadingState>}
      >
        <CountsByWeek unit={unit} />
      </Suspense>
    </>
  )
}

// ---------------------------------------------------------------------------
// The date rail
// ---------------------------------------------------------------------------

interface RailStop {
  readonly key: string
  readonly top: string
  readonly bottom: string
  readonly figure: number | undefined
  readonly flag?: boolean
  /// What the phone's sheet says beside the stop instead of the bare figure.
  readonly note?: string
}

/// A row of dates, newest on the left where the eye starts, each with its figure — the booking
/// site's fare calendar, for money a shop took or spent.
function DateRail({
  title,
  stops,
  value,
  onChange,
}: {
  /// What the stops are, for the phone's chip: "Day", "Week".
  title: string
  stops: readonly RailStop[]
  value: string
  onChange: (key: string) => void
}) {
  return (
    <>
      {/* A rail that scrolls sideways is not for a phone: there the days are
          a chip in the dock and a sheet listing every one with its figure. */}
      <PhoneChoice
        title={title}
        value={value}
        onChange={onChange}
        options={[...stops].reverse().map((stop) => ({
          value: stop.key,
          label: `${stop.top} · ${stop.bottom}`,
          short: stop.bottom,
          note:
            stop.figure === undefined
              ? "…"
              : stop.note !== undefined && stop.figure !== 0
                ? stop.note
                : stop.figure === 0
                  ? "—"
                  : compact(stop.figure),
        }))}
      />
      <div className="mb-5 flex [scrollbar-width:thin] gap-2 overflow-x-auto pb-1 max-md:hidden">
        {[...stops].reverse().map((stop) => {
          const on = stop.key === value
          return (
            <button
              key={stop.key}
              type="button"
              onClick={() => onChange(stop.key)}
              aria-pressed={on}
              className={cn(
                "flex min-w-[7.5rem] shrink-0 flex-col items-start rounded-inner border px-3.5 py-2.5 text-left transition-colors",
                on
                  ? "border-accent bg-accent-bg"
                  : "border-hairline-2 bg-canvas hover:border-hairline-strong"
              )}
            >
              <span
                className={cn(
                  "text-[0.9375rem]",
                  on ? "text-accent" : "text-mute"
                )}
              >
                {stop.top}
              </span>
              <span
                className={cn("font-medium", on ? "text-ink" : "text-text")}
              >
                {stop.bottom}
              </span>
              <span
                className={cn(
                  "mt-1 text-[0.9375rem] tabular-nums",
                  stop.flag ? "text-bad-fg" : "text-body"
                )}
              >
                {stop.figure === undefined
                  ? "…"
                  : stop.figure === 0
                    ? "—"
                    : compact(stop.figure)}
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}

function compact(minor: number): string {
  return moneyCompact(minor)
}

function weekEnd(monday: string): string {
  const end = new Date(`${monday}T00:00:00`)
  end.setDate(end.getDate() + 6)
  return isoDay(end)
}

function weekLabel(monday: string): { top: string; bottom: string } {
  const start = new Date(`${monday}T00:00:00`)
  const end = new Date(`${weekEnd(monday)}T00:00:00`)
  return {
    top: `Week of ${dateText(start, { day: "numeric", month: "short" })}`,
    bottom: `${dateText(start, { day: "numeric" })}–${dateText(end, { day: "numeric", month: "short" })}`,
  }
}

// ---------------------------------------------------------------------------
// Sales by day
// ---------------------------------------------------------------------------

function SalesByDay({
  unit,
  picker,
}: {
  unit: UnitView
  picker: React.ReactNode
}) {
  const siteId = unit.sites[0]?.id ?? ""
  if (siteId === "")
    return (
      <>
        <Toolbar>{picker}</Toolbar>
        <EmptyState>This shop has no till yet.</EmptyState>
      </>
    )
  return <SalesDays siteId={siteId} picker={picker} />
}

function SalesDays({
  siteId,
  picker,
}: {
  siteId: string
  picker: React.ReactNode
}) {
  const days = useMemo(() => lastDays(14), [])
  const [picked, setPicked] = useState(days[days.length - 1])
  const reports = useSuspenseQueries({
    queries: days.map((date) => dailyReportQuery(siteId, date)),
  })
  const index = days.indexOf(picked)
  const report = reports[index]?.data

  const rail = (
    <DateRail
      title="Day"
      value={picked}
      onChange={setPicked}
      stops={days.map((date, i) => {
        const at = new Date(`${date}T00:00:00`)
        return {
          key: date,
          top:
            date === todayIso() ? "Today" : dateText(at, { weekday: "short" }),
          bottom: dateText(at, { day: "numeric", month: "short" }),
          figure: reports[i]?.data?.sales.gross_minor,
        }
      })}
    />
  )
  const bar = <Toolbar>{picker}</Toolbar>

  if (report === undefined)
    return (
      <>
        {rail}
        {bar}
        <EmptyState>This day could not be read.</EmptyState>
      </>
    )
  if (report.sales.count === 0)
    return (
      <>
        {rail}
        {bar}
        <EmptyState>Nothing was sold on this day.</EmptyState>
      </>
    )
  return (
    <>
      {/* The day's four figures lead the page. */}
      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        <Kpi
          label="Sales"
          value={money(report.sales.gross_minor)}
          delta={`${count(report.sales.count)} receipts`}
          tone="flat"
        />
        <Kpi
          label="Returns"
          value={money(report.returns.refund_total_minor)}
          delta={`${count(report.returns.count)} returns`}
          tone="flat"
        />
        <div title="Cash taken less change and refunds">
          <Kpi
            label="Cash in drawer"
            value={money(report.cash.cash_expected_minor)}
          />
        </div>
        <div title="Receipts cancelled">
          <Kpi label="Voided" value={count(report.sales.voided_count)} />
        </div>
      </KpiStrip>
      {rail}
      {bar}
      <TenderTable tenders={report.tenders} />
    </>
  )
}

/// What each tender took at the till on the day. On a card the tender names it
/// and what it took and how many receipts follow.
function TenderTable({ tenders }: { tenders: readonly Tender[] }) {
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: tenders,
        columns: TENDER_COLUMNS,
        getRowId: (row: Tender) => row.method,
      }),
      [tenders]
    )
  )
  return (
    <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
      <DataTable<Tender> table={table} pageScroll cardSort={false} cardsApart />
    </Card>
  )
}

type Tender = SaleTenderTotal

const TENDER_COLUMNS: ColumnDef<TableSetup, Tender>[] = [
  {
    id: "paid_by",
    accessorFn: (row) => tenderWord(row.method),
    header: "Paid by",
    size: 240,
    enableSorting: false,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <span className="text-ink">{tenderWord(row.original.method)}</span>
    ),
  },
  {
    id: "receipts",
    accessorFn: (row) => row.count,
    header: "Receipts",
    size: 140,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => count(row.original.count),
  },
  {
    id: "taken",
    accessorFn: (row) => row.amount_minor,
    header: "Taken at the till",
    size: 190,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => money(row.original.amount_minor),
  },
]

function tenderWord(method: string): string {
  const words: Record<string, string> = {
    CASH: "Cash",
    DEBIT: "Debit card",
    DEBIT_CARD: "Debit card",
    CREDIT: "Credit card",
    CREDIT_CARD: "Credit card",
    QRIS: "QRIS",
    VOUCHER: "Voucher",
    TRANSFER: "Transfer",
  }
  return (
    words[method.toUpperCase()] ??
    method
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase())
  )
}

// ---------------------------------------------------------------------------
// Petty cash by week
// ---------------------------------------------------------------------------

interface StoreExpense {
  readonly expense_id: string
  readonly expense_number: string
  readonly category: string
  readonly amount_minor: number
  readonly spent_on: string
  readonly vendor: string
  readonly memo: string | null
  readonly status: string
  readonly claimed_by: string
}

export function ExpensesByWeek({ unit }: { unit: UnitView }) {
  const weeks = useMemo(() => lastWeeks(8), [])
  const [picked, setPicked] = useState(weeks[weeks.length - 1])
  const expenses = useQuery({
    queryKey: ["finance", "store-expenses", unit.id] as const,
    queryFn: ({ signal }) =>
      node.get<StoreExpense[]>(
        `/api/v1/store-money/expenses?unit=${encodeURIComponent(unit.id)}&limit=500`,
        { signal }
      ),
  })
  const inWeek = (monday: string) =>
    (expenses.data ?? []).filter(
      (row) =>
        row.status !== "REJECTED" &&
        row.spent_on >= monday &&
        row.spent_on <= weekEnd(monday)
    )
  const rows = inWeek(picked)
  const total = rows.reduce((sum, row) => sum + row.amount_minor, 0)
  const phone = useLayout() === "phone"

  return (
    <>
      <DateRail
        title="Week"
        value={picked}
        onChange={setPicked}
        stops={weeks.map((monday) => ({
          key: monday,
          ...weekLabel(monday),
          figure: expenses.isPending
            ? undefined
            : inWeek(monday).reduce((sum, row) => sum + row.amount_minor, 0),
        }))}
      />
      {expenses.isPending ? (
        <LoadingState>Reading petty cash…</LoadingState>
      ) : expenses.isError ? (
        <ErrorState error={expenses.error} />
      ) : rows.length === 0 ? (
        <EmptyState>Nothing was paid from petty cash this week.</EmptyState>
      ) : phone ? (
        <>
          <PhoneFigures
            items={[
              { label: "Week total", value: total },
              { label: "Expenses", value: rows.length, unit: "count" },
            ]}
          />
          <PhoneList
            rows={rows.map((row) => ({
              key: row.expense_id,
              title: row.vendor,
              line: `${categoryWord(row.category)}${row.memo ? ` · ${row.memo}` : ""}`,
              lead: money(row.amount_minor),
              foot: dateText(new Date(`${row.spent_on}T00:00:00`), {
                day: "numeric",
                month: "short",
                year: "numeric",
              }),
              action: (
                <Status
                  tone={
                    row.status === "APPROVED" || row.status === "POSTED"
                      ? "neutral"
                      : "warn"
                  }
                >
                  {statusWord(row.status)}
                </Status>
              ),
            }))}
          />
        </>
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th width="8rem">Spent on</Th>
              <Th>What for</Th>
              <Th width="11rem">Status</Th>
              <Th align="right" width="11rem">
                Amount
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.expense_id}>
                <Td className="text-body">
                  {dateText(new Date(`${row.spent_on}T00:00:00`), {
                    day: "numeric",
                    month: "short",
                  })}
                </Td>
                <Td className="max-w-0">
                  <span className="block truncate text-ink">{row.vendor}</span>
                  <span className="block truncate text-[0.9375rem] text-mute">
                    {categoryWord(row.category)}
                    {row.memo ? ` · ${row.memo}` : ""}
                  </span>
                </Td>
                <Td
                  className={
                    row.status === "APPROVED" || row.status === "POSTED"
                      ? "text-body"
                      : "text-warn-fg"
                  }
                >
                  {statusWord(row.status)}
                </Td>
                <Td align="right">{money(row.amount_minor)}</Td>
              </tr>
            ))}
            <tr data-total className="h-14 bg-soft">
              <Td colSpan={3} className="font-medium text-ink">
                Week total · {count(rows.length)}{" "}
                {rows.length === 1 ? "expense" : "expenses"}
              </Td>
              <Td align="right" className="font-medium text-ink">
                {money(total)}
              </Td>
            </tr>
          </tbody>
        </Grid>
      )}
    </>
  )
}

function categoryWord(code: string): string {
  return code
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase())
}

function statusWord(status: string): string {
  switch (status) {
    case "CLAIMED":
    case "PENDING":
      return "Waiting for approval"
    case "APPROVED":
      return "Approved"
    case "POSTED":
      return "In the books"
    case "REJECTED":
      return "Rejected"
    default:
      return categoryWord(status)
  }
}

// ---------------------------------------------------------------------------
// Cash counts by week
// ---------------------------------------------------------------------------

function CountsByWeek({ unit }: { unit: UnitView }) {
  const weeks = useMemo(() => lastWeeks(8), [])
  const [picked, setPicked] = useState(weeks[weeks.length - 1])
  const siteIds = unit.sites.map((site) => site.id)
  const counts = useSuspenseQuery(storeCashCountsQuery(unit.id))
  const mine = counts.data.filter((row) => siteIds.includes(row.site_id))
  const inWeek = (monday: string) =>
    mine.filter(
      (row) => row.counted_on >= monday && row.counted_on <= weekEnd(monday)
    )
  const rows = inWeek(picked)

  return (
    <>
      <DateRail
        title="Week"
        value={picked}
        onChange={setPicked}
        stops={weeks.map((monday) => {
          const week = inWeek(monday)
          const variance = week.reduce(
            (sum, row) => sum + row.variance_minor,
            0
          )
          return {
            key: monday,
            ...weekLabel(monday),
            figure: Math.abs(variance),
            flag: variance !== 0,
            note: `Off by ${compact(Math.abs(variance))}`,
          }
        })}
      />
      {rows.length === 0 ? (
        <EmptyState>No cash was counted this week.</EmptyState>
      ) : (
        <CountsTable rows={rows} />
      )}
    </>
  )
}

/// The week's counts. A row opens the count — who counted, who watched, what
/// the books said and why they differed — as a sheet; on a card the cash box
/// names it and the three figures follow.
const COUNT_COLUMNS: ColumnDef<TableSetup, CashCountRow>[] = [
  {
    id: "counted_on",
    accessorFn: (row) => row.counted_on,
    header: "Counted on",
    size: 130,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span className="text-body">
        {dateText(new Date(`${row.original.counted_on}T00:00:00`), {
          day: "numeric",
          month: "short",
        })}
      </span>
    ),
  },
  {
    id: "box",
    accessorFn: (row) => row.account_name,
    header: "Cash box",
    size: 280,
    enableSorting: false,
    meta: { card: "title", grow: 240 },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-ink">{row.original.account_name}</span>
        <span className="truncate text-[0.9375rem] font-normal text-mute">
          {row.original.counted_by}
          {row.original.witnessed_by
            ? ` · witnessed by ${row.original.witnessed_by}`
            : ""}
          {row.original.reason ? ` · ${row.original.reason}` : ""}
        </span>
      </span>
    ),
  },
  {
    id: "books",
    accessorFn: (row) => row.per_books_minor,
    header: "Books",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => money(row.original.per_books_minor),
  },
  {
    id: "counted",
    accessorFn: (row) => row.counted_minor,
    header: "Counted",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => money(row.original.counted_minor),
  },
  {
    id: "difference",
    accessorFn: (row) => row.variance_minor,
    header: "Difference",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span
        className={
          row.original.variance_minor === 0
            ? "text-mute"
            : "font-medium text-bad-fg"
        }
      >
        {row.original.variance_minor === 0
          ? "·"
          : money(row.original.variance_minor)}
      </span>
    ),
  },
]

function CountsTable({ rows }: { rows: readonly CashCountRow[] }) {
  const [shown, setShown] = useState<CashCountRow | null>(null)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: COUNT_COLUMNS,
        getRowId: (row: CashCountRow) => row.count_id,
      }),
      [rows]
    )
  )
  return (
    <>
      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <DataTable<CashCountRow>
          table={table}
          onRowClick={setShown}
          isSelected={(row) => row.count_id === shown?.count_id}
          pageScroll
          cardSort={false}
          cardsApart
        />
      </Card>
      <FactsSheet
        open={shown !== null}
        onClose={() => setShown(null)}
        title={shown?.account_name ?? ""}
        id={shown?.entry_number ?? undefined}
        caption={
          shown === null
            ? undefined
            : dateText(new Date(`${shown.counted_on}T00:00:00`), {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
        }
        facts={
          shown === null
            ? []
            : [
                { label: "Counted by", value: shown.counted_by },
                { label: "Witnessed by", value: shown.witnessed_by || "—" },
                { label: "Books", value: money(shown.per_books_minor) },
                { label: "Counted", value: money(shown.counted_minor) },
                {
                  label: "Difference",
                  value:
                    shown.variance_minor === 0
                      ? "—"
                      : money(shown.variance_minor),
                },
                { label: "Reason", value: shown.reason || "—" },
              ]
        }
      />
    </>
  )
}

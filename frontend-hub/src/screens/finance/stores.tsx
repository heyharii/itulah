import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { node } from "@/lib/api"
import { count, dateText, money } from "@/lib/format"
import { analyticsKeys, dailyReport } from "@/lib/queries/analytics"
import { financeKeys, listCashCounts } from "@/lib/queries/finance"
import { type UnitView } from "@/lib/queries/organisation"
import { cn } from "@/lib/utils"
import { Grid, Td, Th } from "@/screens/finance-final/parts"
import { isoDay, todayIso } from "@/screens/finance/chart"
import { StoreFrame } from "@/screens/finance/stores-frame"

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
    <StoreFrame
      title="Sales by day"
      sub="What each till took, day by day, against the drawer and the bank."
    >
      {(unit) => <SalesByDay key={unit.id} unit={unit} />}
    </StoreFrame>
  )
}

export function StoresCounts() {
  return (
    <StoreFrame
      title="Cash counts"
      sub="The cash counted in each shop, week by week, against the books."
    >
      {(unit) => <CountsByWeek key={unit.id} unit={unit} />}
    </StoreFrame>
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
}

/// A row of dates, newest on the left where the eye starts, each with its figure — the booking
/// site's fare calendar, for money a shop took or spent.
function DateRail({
  stops,
  value,
  onChange,
}: {
  stops: readonly RailStop[]
  value: string
  onChange: (key: string) => void
}) {
  return (
    <div className="mb-5 flex [scrollbar-width:thin] gap-2 overflow-x-auto pb-1">
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
                "text-[0.875rem]",
                on ? "text-accent" : "text-mute"
              )}
            >
              {stop.top}
            </span>
            <span className={cn("font-medium", on ? "text-ink" : "text-text")}>
              {stop.bottom}
            </span>
            <span
              className={cn(
                "mt-1 text-[0.875rem] tabular-nums",
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
  )
}

const shortNumber = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
})

function compact(minor: number): string {
  return `Rp ${shortNumber.format(minor)}`
}

function lastDays(n: number): string[] {
  const days: string[] = []
  for (let back = n - 1; back >= 0; back -= 1) {
    const date = new Date()
    date.setDate(date.getDate() - back)
    days.push(isoDay(date))
  }
  return days
}

/// The Mondays of the last `n` weeks, oldest first.
function lastWeeks(n: number): string[] {
  const monday = new Date()
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const weeks: string[] = []
  for (let back = n - 1; back >= 0; back -= 1) {
    const start = new Date(monday)
    start.setDate(start.getDate() - back * 7)
    weeks.push(isoDay(start))
  }
  return weeks
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

function SalesByDay({ unit }: { unit: UnitView }) {
  const siteId = unit.sites[0]?.id ?? ""
  const days = useMemo(() => lastDays(14), [])
  const [picked, setPicked] = useState(days[days.length - 1])
  const reports = useQueries({
    queries: days.map((date) => ({
      queryKey: [...analyticsKeys.all, "daily", siteId, date] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        dailyReport({ siteId, date }, signal),
      enabled: siteId !== "",
      staleTime: 60_000,
    })),
  })
  const index = days.indexOf(picked)
  const report = reports[index]?.data

  return (
    <>
      <DateRail
        value={picked}
        onChange={setPicked}
        stops={days.map((date, i) => {
          const at = new Date(`${date}T00:00:00`)
          return {
            key: date,
            top:
              date === todayIso()
                ? "Today"
                : dateText(at, { weekday: "short" }),
            bottom: dateText(at, { day: "numeric", month: "short" }),
            figure: reports[i]?.data?.sales.gross_minor,
          }
        })}
      />
      {reports[index]?.isPending ? (
        <LoadingState>Reading the day…</LoadingState>
      ) : report === undefined ? (
        <EmptyState>This day could not be read.</EmptyState>
      ) : report.sales.count === 0 ? (
        <EmptyState>Nothing was sold on this day.</EmptyState>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Figure
              label="Sales"
              value={money(report.sales.gross_minor)}
              note={`${count(report.sales.count)} receipts`}
            />
            <Figure
              label="Returns"
              value={money(report.returns.refund_total_minor)}
              note={`${count(report.returns.count)} returns`}
            />
            <Figure
              label="Cash expected in the drawer"
              value={money(report.cash.cash_expected_minor)}
              note="Cash taken less change and refunds"
            />
            <Figure
              label="Voided"
              value={count(report.sales.voided_count)}
              note="Receipts cancelled"
            />
          </div>
          <Grid>
            <thead>
              <tr>
                <Th>Paid by</Th>
                <Th align="right" width="9rem">
                  Receipts
                </Th>
                <Th align="right" width="12rem">
                  Taken at the till
                </Th>
              </tr>
            </thead>
            <tbody>
              {report.tenders.map((tender) => (
                <tr key={tender.method}>
                  <Td className="text-ink">{tenderWord(tender.method)}</Td>
                  <Td align="right">{count(tender.count)}</Td>
                  <Td align="right">{money(tender.amount_minor)}</Td>
                </tr>
              ))}
            </tbody>
          </Grid>
          <p className="mt-3 text-[0.875rem] text-mute">
            Cash goes to the drawer and the bank on deposit; card and QRIS
            arrive from the acquirer a day or two later, less the fee — matched
            on Card &amp; EDC Settlement.
          </p>
        </>
      )}
    </>
  )
}

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

  return (
    <>
      <DateRail
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
                  <span className="block truncate text-[0.875rem] text-mute">
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
  const counts = useQuery({
    queryKey: [...financeKeys.all, "cash-counts", "unit", unit.id] as const,
    queryFn: ({ signal }) => listCashCounts(signal),
  })
  const mine = (counts.data ?? []).filter((row) =>
    siteIds.includes(row.site_id)
  )
  const inWeek = (monday: string) =>
    mine.filter(
      (row) => row.counted_on >= monday && row.counted_on <= weekEnd(monday)
    )
  const rows = inWeek(picked)

  return (
    <>
      <DateRail
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
            figure: counts.isPending ? undefined : Math.abs(variance),
            flag: variance !== 0,
          }
        })}
      />
      <p className="-mt-2 mb-4 text-[0.875rem] text-mute">
        The figure on each week is how far the counts missed the books.
      </p>
      {counts.isPending ? (
        <LoadingState>Reading the counts…</LoadingState>
      ) : counts.isError ? (
        <ErrorState error={counts.error} />
      ) : rows.length === 0 ? (
        <EmptyState>No cash was counted this week.</EmptyState>
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th width="8rem">Counted on</Th>
              <Th>Cash box</Th>
              <Th align="right" width="10rem">
                Books
              </Th>
              <Th align="right" width="10rem">
                Counted
              </Th>
              <Th align="right" width="10rem">
                Difference
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.count_id}>
                <Td className="text-body">
                  {dateText(new Date(`${row.counted_on}T00:00:00`), {
                    day: "numeric",
                    month: "short",
                  })}
                </Td>
                <Td className="max-w-0">
                  <span className="block truncate text-ink">
                    {row.account_name}
                  </span>
                  <span className="block truncate text-[0.875rem] text-mute">
                    {row.counted_by}
                    {row.witnessed_by
                      ? ` · witnessed by ${row.witnessed_by}`
                      : ""}
                    {row.reason ? ` · ${row.reason}` : ""}
                  </span>
                </Td>
                <Td align="right">{money(row.per_books_minor)}</Td>
                <Td align="right">{money(row.counted_minor)}</Td>
                <Td
                  align="right"
                  className={
                    row.variance_minor === 0
                      ? "text-mute"
                      : "font-medium text-bad-fg"
                  }
                >
                  {row.variance_minor === 0 ? "·" : money(row.variance_minor)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Grid>
      )}
    </>
  )
}

function Figure({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <div className="rounded-card border border-hairline-2 bg-canvas px-5 py-4 shadow-soft">
      <div className="text-[0.875rem] text-body">{label}</div>
      <div className="mt-1 text-[1.25rem] font-semibold text-ink tabular-nums">
        {value}
      </div>
      <div className="mt-0.5 text-[0.875rem] text-mute">{note}</div>
    </div>
  )
}

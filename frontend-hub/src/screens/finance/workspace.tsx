import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useMemo } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Kpi } from "@/components/ui/kpi"
import { dateText, money, compactFormat } from "@/lib/format"
import { bankTotalQuery, payablesAgingQuery } from "@/lib/queries/finance"
import { profitAndLossQuery } from "@/lib/queries/finance-domains"
import { cn } from "@/lib/utils"
import {
  lastMonths,
  monthLabel,
  todayIso,
  type MonthBucket,
} from "@/screens/finance/chart"
import { AGEING_BUCKETS, type NumberCard } from "@/screens/finance/measures"

import type { AgingBuckets } from "@itulah/contract"

/// ERPNext's workspace, in this app's parts.
///
/// ERPNext opens Accounting on a workspace (`accounts/workspace/invoicing`):
/// a chart across the top, a row of number cards, then "Reports & Masters" —
/// cards of links. Its Dashboard (`accounts_dashboard/accounts`) is the same
/// number cards over more charts. These are those pieces, and the reads
/// behind them, so Home and Dashboard draw them identically.
///
/// Each chart and card says which of ERPNext's it is, and where ours reads a
/// different document — a till sale rather than a Sales Invoice — the comment
/// at the read says so.

// ── months ───────────────────────────────────────────────────────────────

export type { MonthBucket }

/// The last `count` months, oldest first, ending with this one — ERPNext's
/// "Last Year, Monthly" timespan.
export function useLastMonths(count = 12): readonly MonthBucket[] {
  const today = todayIso()
  return useMemo(() => lastMonths(count, today), [today, count])
}

const shortMonth = (key: string) =>
  dateText(new Date(`${key}-01T00:00:00`), { month: "short" })
const longMonth = (key: string) =>
  monthLabel(Number(key.slice(0, 4)), Number(key.slice(5, 7)))

// ── reads ────────────────────────────────────────────────────────────────

export interface PnlMonth {
  readonly bucket: string
  readonly income: number
  readonly expense: number
  readonly net: number
  readonly [series: string]: string | number
}

/// ERPNext's "Profit and Loss" chart: Income, Expense and Net Profit, month
/// by month. One read per month under the key the Profit and Loss report
/// owns, so the chart warms that screen.
///
/// Read inside a `<Suspense>`: the months are all there or the boundary waits,
/// so `pending` and `failed` are only here for the callers that still ask.
///
/// Expense is income less net profit — everything between the top line and
/// the bottom one — so the three always agree, as they do in ERPNext.
export function useMonthlyPnl(months: readonly MonthBucket[]) {
  const reads = useSuspenseQueries({
    queries: months.map((bucket) => profitAndLossQuery(bucket.from, bucket.to)),
  })
  const rows: PnlMonth[] = months.map((bucket, index) => {
    const pnl = reads[index]?.data
    const income = pnl?.revenue_minor ?? 0
    const net = pnl?.net_profit_minor ?? 0
    return { bucket: bucket.key, income, expense: income - net, net }
  })
  return { rows, pending: false, failed: false }
}

/// ERPNext's "Bank Balance" chart: what the bank accounts held at each
/// month's end, in the books.
export function useBankBalance(months: readonly MonthBucket[]) {
  const reads = useSuspenseQueries({
    queries: months.map((bucket) => bankTotalQuery(bucket.to)),
  })
  const rows = months.map((bucket, index) => ({
    bucket: bucket.key,
    balance: reads[index]?.data ?? 0,
  }))
  return { rows, pending: false, failed: false }
}

/// The four questions the Finance Overview answers (owner, 2026-10-01): how
/// much money is there, how much is owed, what did cash do this month, and
/// what did the month cost. They replace ERPNext's Total Outgoing/Incoming
/// Bills and Payment cards, whose names read as the opposite of what they held.
///
/// - **Money in the bank** — the bank accounts today, in the books.
/// - **Total payables** — what is owed to suppliers, from the payables
///   ageing (`measures.ts`), so it is the same figure as the ageing bar below
///   it and as every other screen that says "payables".
/// - **Cash flow, this month** — the bank balance today less the last
///   month-end's: what moved through the accounts, not profit.
/// - **Expenses, this month** — the month to date, from the profit and loss.
export function useNumberCards() {
  const months = useLastMonths(2)
  const bank = useBankBalance(months)
  const pnl = useMonthlyPnl(months)
  const ageing = useSuspenseQuery(payablesAgingQuery(todayIso()))

  const [before, now] = bank.rows
  return [
    {
      label: "Money in the bank",
      value: now?.balance,
      change: null,
      pending: bank.pending || bank.failed,
    },
    {
      label: "Total payables",
      value: ageing.data?.total.total_minor,
      change: null,
      pending: false,
    },
    {
      label: "Cash flow this month",
      value: now && before ? now.balance - before.balance : undefined,
      change: null,
      pending: bank.pending || bank.failed,
    },
    {
      label: "Expenses this month",
      value: pnl.rows[pnl.rows.length - 1]?.expense,
      change: null,
      pending: pnl.pending || pnl.failed,
    },
  ] as const
}

// ── pieces ───────────────────────────────────────────────────────────────

/// The number cards, in a row. A figure still being read shows a dash
/// rather than a zero: "nothing" and "not asked yet" are different answers.
export function NumberCards({ cards }: { cards: readonly NumberCard[] }) {
  return (
    // `group/kpis`, as `KpiStrip` sets it, so a card with no delta keeps the
    // line a sibling's delta takes and the figures stand level.
    <div className="group/kpis mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Kpi
          key={card.label}
          label={card.label}
          value={
            card.pending || card.value === undefined ? "—" : money(card.value)
          }
          delta={
            card.change === null
              ? undefined
              : `${card.change >= 0 ? "↑" : "↓"} ${Math.abs(card.change).toLocaleString("id-ID", { maximumFractionDigits: 1 })}% since last month`
          }
          tone={
            card.change === null
              ? undefined
              : card.change > 0
                ? "up"
                : card.change < 0
                  ? "down"
                  : "flat"
          }
        />
      ))}
    </div>
  )
}

/// One question and its answer: the label, the figure large, a line saying
/// what the figure is made of, and the chart that shows how it got there.
/// The Finance Overview is four of these in a grid (owner, 2026-10-01).
export function FigureCard({
  label,
  figure,
  note,
  pending,
  children,
}: {
  label: string
  figure: number | undefined
  note?: React.ReactNode
  pending?: boolean
  children: React.ReactNode
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
        <div>
          <div className="text-[1.75rem] leading-tight font-semibold tracking-[-0.01em] text-ink tabular-nums">
            {pending || figure === undefined ? "—" : money(figure)}
          </div>
          {note && (
            <div className="mt-0.5 text-[0.9375rem] text-mute">{note}</div>
          )}
        </div>
        {children}
      </div>
    </Card>
  )
}

/// A chart in a card: its name, what it covers, the chart. `half` sits two
/// to a row on a wide screen, as ERPNext's Half-width charts do.
export function ChartCard({
  title,
  meta,
  legend,
  half = false,
  children,
}: {
  title: string
  meta?: string
  legend?: React.ReactNode
  half?: boolean
  children: React.ReactNode
}) {
  return (
    <Card className={cn("mb-3", half ? "xl:col-span-1" : "xl:col-span-2")}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {meta && <span className="text-[0.9375rem] text-mute">{meta}</span>}
      </CardHeader>
      <div className="px-4 pb-4">
        {children}
        {legend}
      </div>
    </Card>
  )
}

/// What a chart says while its reads are out, or when one failed.
export function ChartState({
  pending,
  failed,
  children,
}: {
  pending: boolean
  failed: boolean
  children: React.ReactNode
}) {
  if (pending) {
    return (
      <p className="flex h-[13.75rem] items-center justify-center text-[0.9375rem] text-mute">
        Reading the books…
      </p>
    )
  }
  if (failed) {
    return (
      <p className="flex h-[13.75rem] items-center justify-center text-[0.9375rem] text-mute">
        Some months could not be read.
      </p>
    )
  }
  return <>{children}</>
}

/// Three lines on one axis — the three are one measure, rupiah, and
/// income less expense is net profit by construction. Accent and the
/// categorical cap for the two flows; ink, thinner and dashed, for the
/// result, so it reads as the difference rather than a third flow.
const PNL_SERIES = [
  { key: "income", label: "Income", stroke: "var(--accent)", dash: undefined },
  {
    key: "expense",
    label: "Expense",
    stroke: "var(--a-orange)",
    dash: undefined,
  },
  { key: "net", label: "Net Profit/Loss", stroke: "var(--ink)", dash: "4 3" },
] as const

const compact = compactFormat()

export function ProfitAndLossChart({ rows }: { rows: readonly PnlMonth[] }) {
  return (
    <>
      <div className="h-[15rem] w-full text-eyebrow">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows as PnlMonth[]}
            margin={{ top: 6, right: 8, bottom: 0, left: 4 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--hairline)"
              strokeDasharray="2 3"
            />
            <XAxis
              dataKey="bucket"
              tickFormatter={shortMonth}
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
              cursor={{ stroke: "var(--hairline-2)" }}
              content={(info) => {
                if (info.active !== true || !info.payload?.length) return null
                return (
                  <div className="rounded-inner border border-hairline bg-canvas px-2.5 py-2 shadow-pop">
                    <div className="mb-1 text-[0.9375rem] font-medium text-ink">
                      {longMonth(String(info.label ?? ""))}
                    </div>
                    {PNL_SERIES.map((series) => {
                      const entry = info.payload?.find(
                        (item) => item.dataKey === series.key
                      )
                      return (
                        <div
                          key={series.key}
                          className="flex items-center gap-1.5 text-[0.9375rem] text-body"
                        >
                          <span
                            aria-hidden
                            className="h-0.5 w-3 shrink-0 rounded-full"
                            style={{ background: series.stroke }}
                          />
                          <span>{series.label}</span>
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
            {PNL_SERIES.map((series) => (
              <Line
                key={series.key}
                type="linear"
                dataKey={series.key}
                name={series.label}
                stroke={series.stroke}
                strokeWidth={series.key === "net" ? 1.5 : 2}
                strokeDasharray={series.dash}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--canvas)" }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legend
        items={PNL_SERIES.map((series) => ({
          label: series.label,
          colour: series.stroke,
          line: true,
        }))}
      />
    </>
  )
}

export function Legend({
  items,
}: {
  items: readonly { label: string; colour: string; line?: boolean }[]
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.9375rem] text-body">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "shrink-0 rounded-full",
              item.line ? "h-0.5 w-3" : "size-2"
            )}
            style={{ background: item.colour }}
          />
          {item.label}
        </span>
      ))}
    </div>
  )
}

/// ERPNext's ageing chart, which its report draws as a "percentage" bar:
/// one row split by how late the money is. Age is ordered, so the buckets
/// are one hue getting darker — not due is the neutral before it starts.
const AGE_COLOURS = [
  "var(--hairline-2)",
  "color-mix(in oklab, var(--accent) 35%, var(--canvas))",
  "color-mix(in oklab, var(--accent) 58%, var(--canvas))",
  "color-mix(in oklab, var(--accent) 80%, var(--canvas))",
  "var(--accent)",
] as const

/// The words come from `measures.ts`, so this bar, the Overview's columns and
/// the Accounts Payable table cannot name a bucket three ways.
const AGE_BUCKETS = AGEING_BUCKETS.map((bucket, index) => ({
  key: bucket.key,
  label: bucket.label,
  colour: AGE_COLOURS[index],
}))

export function AgeingBar({ buckets }: { buckets: AgingBuckets }) {
  const total = buckets.total_minor
  if (total <= 0) {
    return (
      <p className="py-6 text-center text-[0.9375rem] text-mute">
        Nothing is owed.
      </p>
    )
  }
  return (
    <div className="@container">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
        {AGE_BUCKETS.map((bucket) => {
          const value = buckets[bucket.key]
          if (value <= 0) return null
          return (
            <div
              key={bucket.key}
              title={`${bucket.label}: ${money(value)}`}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${(value / total) * 100}%`,
                background: bucket.colour,
              }}
            />
          )
        })}
      </div>
      {/* One column per bucket, under the bar it describes — read left to
          right like the bar, rather than two columns the eye has to zigzag. */}
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 @xl:grid-cols-5">
        {AGE_BUCKETS.map((bucket) => (
          <div
            key={bucket.key}
            className="flex flex-col gap-0.5 text-[0.9375rem]"
          >
            <dt className="flex items-center gap-2 text-mute">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: bucket.colour }}
              />
              {bucket.label}
            </dt>
            <dd
              className={
                buckets[bucket.key] > 0
                  ? "font-medium text-ink tabular-nums"
                  : "text-faint tabular-nums"
              }
            >
              {money(buckets[bucket.key])}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export const monthTick = shortMonth
export const monthTitle = longMonth

/// A card of links, as ERPNext's workspace groups its masters and reports.
export interface LinkCardSpec {
  readonly title: string
  readonly links: readonly { readonly label: string; readonly to: string }[]
}

export function LinkCards({ cards }: { cards: readonly LinkCardSpec[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader>
            <CardTitle>{card.title}</CardTitle>
          </CardHeader>
          <ul className="flex flex-col px-2 pb-2.5">
            {card.links.map((link) => (
              <li key={link.to + link.label}>
                <Link
                  to={link.to}
                  className="flex h-9 items-center rounded-inner px-2 text-[0.9375rem] text-body transition-colors hover:bg-soft hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}

/// ERPNext's "Reports & Masters" heading over the link cards.
export function WorkspaceHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-6 mb-3 text-[1rem] font-semibold text-ink">{children}</h2>
  )
}

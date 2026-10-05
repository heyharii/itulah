import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { BarSeries, LineSeries } from "@/components/ui/chart"
import { PageHeader } from "@/components/ui/page-header"
import { count, day, money } from "@/lib/format"
import { financeKeys, listAllBills, listGiros } from "@/lib/queries/finance"
import { domainKeys, profitAndLoss } from "@/lib/queries/finance-domains"
import { isoDay, todayIso } from "@/screens/finance/chart"
import { useSupplierName } from "@/screens/finance/hooks"
import {
  AgeingBar,
  ChartCard,
  ChartState,
  NumberCards,
  monthTick,
  monthTitle,
  useBankBalance,
  useLastMonths,
  useMonthlyPnl,
  useNumberCards,
  usePayablesAgeing,
  useTotalLiabilities,
} from "@/screens/finance/workspace"

/// The Finance Overview (owner, 2026-10-01): what is in the bank, what has to
/// be paid soon, what is already late, and how the month is going — then the
/// payments themselves, by name, each list a doorway to the screen that pays
/// them. Named sections rather than one "needs attention" queue: a person
/// opening Finance in the morning asks "what do I pay this week", not "what is
/// wrong".
export function FinanceDashboard() {
  const months = useLastMonths(12)
  const pnl = useMonthlyPnl(months)
  const bank = useBankBalance(months)
  const supplierName = useSupplierName()

  const bills = useQuery({
    queryKey: [...financeKeys.bills("POSTED", null), "projection"],
    queryFn: ({ signal }) => listAllBills("POSTED", undefined, signal),
    staleTime: 30_000,
  })
  const giros = useQuery({
    queryKey: ["finance", "giros", "projection", "OUT"] as const,
    queryFn: ({ signal }) =>
      listGiros({ direction: "OUT", limit: 1000 }, signal),
    staleTime: 30_000,
  })

  const today = todayIso()
  const fortnight = isoDay(addDays(new Date(), 14))

  // Every payment the company still owes, bill or giro, as one shape.
  const owed = useMemo<Owed[]>(() => {
    const rows: Owed[] = []
    for (const bill of bills.data ?? []) {
      if (bill.outstanding_minor <= 0 || bill.due_date === null) continue
      rows.push({
        key: `b-${bill.invoice_id}`,
        due: bill.due_date,
        late: bill.days_overdue,
        who: supplierName(bill.supplier_id, bill.supplier_name),
        what: bill.invoice_number,
        how: "Bill",
        amount: bill.outstanding_minor,
      })
    }
    for (const giro of giros.data ?? []) {
      if (!["ISSUED", "DELIVERED", "DUE"].includes(giro.status)) continue
      rows.push({
        key: `g-${giro.giro_id}`,
        due: giro.due_date,
        late: giro.days_overdue,
        // A giro names its payee by supplier code; say the supplier.
        who:
          giro.party_name === null
            ? "—"
            : supplierName(giro.party_name, giro.party_name),
        what: giro.number,
        how: "Giro",
        amount: giro.amount_minor,
      })
    }
    return rows
  }, [bills.data, giros.data, supplierName])

  const upcoming = owed
    .filter((row) => row.due >= today && row.due <= fortnight)
    .sort((a, b) => a.due.localeCompare(b.due))
  const overdue = owed
    .filter((row) => row.due < today)
    .sort((a, b) => b.late - a.late)
  const overdueTotal = overdue.reduce((sum, row) => sum + row.amount, 0)

  const owedTotal = owed.reduce((sum, row) => sum + row.amount, 0)

  // What the stock is worth, as the balance sheet carries it: the lines under
  // the client's INVENTORY heading (goods, shopping bags, goods in transit).
  const sheet = useTotalLiabilities()
  const inventoryValue = (sheet.data?.lines ?? [])
    .filter(
      (line) =>
        /inventory|persediaan/i.test(line.group_name ?? "") ||
        /^(persediaan|bdp|barang dalam perjalanan)/i.test(line.account_name)
    )
    .reduce((sum, line) => sum + line.amount_minor, 0)

  // Six months of expense, by the client's own expense groups.
  const recent = months.slice(-6)
  const statements = useQueries({
    queries: recent.map((bucket) => ({
      queryKey: domainKeys.profitAndLoss(bucket.from, bucket.to),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        profitAndLoss(bucket.from, bucket.to, signal),
    })),
  })
  const expenseMonths = recent.map((bucket, index) => {
    const groups = new Map<string, number>()
    for (const line of statements[index]?.data?.lines ?? []) {
      if (!EXPENSE_SECTIONS.has(line.section)) continue
      const group = line.group_name ?? line.account_name
      groups.set(group, (groups.get(group) ?? 0) + line.amount_minor)
    }
    return { bucket: bucket.key, groups }
  })
  const expensesPending = statements.some((read) => read.isPending)
  const ageing = usePayablesAgeing()

  const balances = bank.rows.map((row) => row.balance)
  const bankNow = balances[balances.length - 1]
  // What the accounts gained or lost: today against the last month end, and
  // the month before that against its own.
  const flowThisMonth =
    balances.length >= 2
      ? balances[balances.length - 1] - balances[balances.length - 2]
      : undefined
  const flowLastMonth =
    balances.length >= 3
      ? balances[balances.length - 2] - balances[balances.length - 3]
      : undefined
  const listsPending = bills.isPending || giros.isPending

  return (
    <PageContent>
      <PageHeader crumb="Finance" title="Overview" />

      {/* Four figures (owner, 2026-10-01): the money we hold, what we owe,
          what cash did this month, and what the stock on the shelves is
          worth. */}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Headline
          label="Cash and bank"
          value={bank.pending ? undefined : bankNow}
          note="Every bank account, today"
        />
        <Headline
          label="Total payables"
          value={listsPending ? undefined : owedTotal}
          note={
            overdueTotal > 0
              ? `${money(overdueTotal)} of it overdue`
              : "Bills and giros not yet paid"
          }
        />
        <Headline
          label="Cash flow this month"
          value={bank.pending ? undefined : flowThisMonth}
          note={
            flowLastMonth === undefined
              ? "Change in the bank since month end"
              : `Last month ${money(flowLastMonth)}`
          }
          delta={percentChange(flowThisMonth, flowLastMonth)}
          tone={(flowThisMonth ?? 0) < 0 ? "bad" : undefined}
        />
        <Headline
          label="Inventory value"
          value={sheet.isPending ? undefined : inventoryValue}
          note="Stock at cost, in the books today"
        />
      </div>

      {/* Two charts as wide as the two lists below them (owner, 2026-10-01:
          no page-wide charts, no cards smaller than their neighbours). */}
      <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SmallChart
          title="Cash and bank"
          meta="Month end · 12 months"
          pending={bank.pending}
          failed={bank.failed}
        >
          <LineSeries
            rows={bank.rows}
            dataKey="balance"
            label="Bank balance"
            format={money}
            titleOf={monthTitle}
            labelOf={monthTick}
            className="h-[13rem]"
          />
        </SmallChart>
        <SmallChart
          title="Income and expenses"
          meta="Monthly · 6 months"
          pending={pnl.pending}
          failed={pnl.failed}
        >
          <BarSeries
            rows={pnl.rows.slice(-6).map((row) => ({
              bucket: row.bucket,
              income: row.income,
              expense: row.expense,
            }))}
            series={[
              { key: "expense", label: "Expenses", tone: "ghost" },
              { key: "income", label: "Income", tone: "accent" },
            ]}
            format={money}
            titleOf={monthTitle}
            labelOf={monthTick}
            className="h-[13rem]"
          />
        </SmallChart>
      </div>
      <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <PaymentList
          title="Upcoming payments"
          note="Due in the next 14 days"
          to="/finance/payables/projection"
          rows={upcoming}
          pending={listsPending}
          empty="Nothing falls due in the next two weeks."
          when={(row) => day(row.due)}
        />
        <PaymentList
          title="Overdue payments"
          note="Past their due date, still unpaid"
          to="/finance/payables/aging"
          rows={overdue}
          pending={listsPending}
          empty="Nothing is late."
          when={(row) => (
            <span className="text-bad-fg">
              {count(row.late)} {row.late === 1 ? "day" : "days"} late
            </span>
          )}
        />
      </div>

      {/* Below the payments, the two that explain them (owner, 2026-10-01):
          what the months cost by kind, and how old what we owe is. */}
      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SmallChart
          title="Expenses per month"
          meta="By expense group · 6 months"
          pending={expensesPending}
          failed={statements.some((read) => read.isError)}
        >
          <ExpenseGroups months={expenseMonths} />
        </SmallChart>
        <SmallChart
          title="Payables ageing"
          meta="Supplier bills, as at today"
          pending={ageing.isPending}
          failed={ageing.isError}
        >
          {ageing.data && <AgeingColumns buckets={ageing.data.total} />}
        </SmallChart>
      </div>
    </PageContent>
  )
}

const EXPENSE_SECTIONS: ReadonlySet<string> = new Set([
  "OPERATING_EXPENSE",
  "OTHER_OPERATING_EXPENSE",
])

/// Calm, distinct fills for up to six stacked groups; the sixth is "Other".
const GROUP_FILLS = [
  "#2563eb",
  "#60a5fa",
  "#8b5cf6",
  "#f59e0b",
  "#f43f5e",
  "#b9c0c9",
]

/// Stacked monthly bars by expense group, with the groups and their six-month
/// totals beside them. The five largest groups by name, the rest as Other.
function ExpenseGroups({
  months,
}: {
  months: readonly { bucket: string; groups: ReadonlyMap<string, number> }[]
}) {
  const totals = new Map<string, number>()
  for (const month of months)
    for (const [group, amount] of month.groups)
      totals.set(group, (totals.get(group) ?? 0) + amount)
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1])
  const named = ranked.slice(0, 5).map(([group]) => group)
  const legend = [
    ...named.map((group) => ({ group, total: totals.get(group) ?? 0 })),
    ...(ranked.length > 5
      ? [
          {
            group: "Other",
            total: ranked.slice(5).reduce((sum, [, v]) => sum + v, 0),
          },
        ]
      : []),
  ]
  const stacks = months.map((month) => {
    const parts = legend.map(({ group }) =>
      group === "Other"
        ? [...month.groups.entries()]
            .filter(([name]) => !named.includes(name))
            .reduce((sum, [, v]) => sum + Math.max(0, v), 0)
        : Math.max(0, month.groups.get(group) ?? 0)
    )
    return {
      bucket: month.bucket,
      parts,
      sum: parts.reduce((a, b) => a + b, 0),
    }
  })
  const top = Math.max(1, ...stacks.map((stack) => stack.sum))
  if (legend.length === 0)
    return (
      <p className="py-10 text-center text-[0.875rem] text-mute">
        No expense in these months.
      </p>
    )
  return (
    <div className="flex gap-6">
      <div className="flex h-[13rem] flex-1 items-end gap-3">
        {stacks.map((stack) => (
          <div
            key={stack.bucket}
            className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5"
            title={`${monthTitle(stack.bucket)} · ${money(stack.sum)}`}
          >
            <div
              className="flex w-full flex-col-reverse overflow-hidden rounded-t-[4px]"
              style={{ height: `${(stack.sum / top) * 85}%` }}
            >
              {stack.parts.map((part, index) => (
                <div
                  key={index}
                  style={{
                    height: `${stack.sum === 0 ? 0 : (part / stack.sum) * 100}%`,
                    background: GROUP_FILLS[index],
                  }}
                />
              ))}
            </div>
            <span className="text-center text-[0.875rem] text-mute">
              {monthTick(stack.bucket)}
            </span>
          </div>
        ))}
      </div>
      <ul className="flex w-56 shrink-0 flex-col justify-center gap-2.5">
        {legend.map((row, index) => (
          <li
            key={row.group}
            className="flex items-center gap-2 text-[0.875rem]"
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: GROUP_FILLS[index] }}
            />
            <span
              className="min-w-0 flex-1 truncate text-body"
              title={row.group}
            >
              {titleCase(row.group)}
            </span>
            <span className="text-ink tabular-nums">
              {short.format(row.total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/// The server's ageing as five columns: not yet due, then by how late.
function AgeingColumns({
  buckets,
}: {
  buckets: {
    not_due_minor: number
    days_1_30_minor: number
    days_31_60_minor: number
    days_61_90_minor: number
    days_over_90_minor: number
    total_minor: number
  }
}) {
  const columns = [
    { label: "Not due", value: buckets.not_due_minor, fill: "#b9c0c9" },
    { label: "1–30 days", value: buckets.days_1_30_minor, fill: "#f59e0b" },
    { label: "31–60 days", value: buckets.days_31_60_minor, fill: "#fb923c" },
    { label: "61–90 days", value: buckets.days_61_90_minor, fill: "#f43f5e" },
    { label: "> 90 days", value: buckets.days_over_90_minor, fill: "#be123c" },
  ]
  const top = Math.max(1, ...columns.map((column) => column.value))
  return (
    <div className="flex h-[13rem] items-end gap-3">
      {columns.map((column) => (
        <div
          key={column.label}
          className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5"
        >
          <span className="text-center text-[0.875rem] font-medium text-ink tabular-nums">
            {`Rp ${short.format(column.value)}`}
          </span>
          <div
            className="w-full rounded-t-[4px]"
            style={{
              height: `${Math.max(2, (column.value / top) * 70)}%`,
              background: column.fill,
            }}
          />
          <span className="text-center text-[0.875rem] text-body">
            {column.label}
          </span>
        </div>
      ))}
    </div>
  )
}

const short = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
})

/// "BEBAN ADMINISTRASI DAN UMUM" → "Beban Administrasi Dan Umum".
function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|\s)\S/g, (head) => head.toUpperCase())
}

interface Owed {
  readonly key: string
  readonly due: string
  readonly late: number
  readonly who: string
  readonly what: string
  readonly how: "Bill" | "Giro"
  readonly amount: number
}

/// A chart in a small card: its name, what it covers, the chart.
function SmallChart({
  title,
  meta,
  pending,
  failed,
  children,
}: {
  title: string
  meta: string
  pending: boolean
  failed: boolean
  children: React.ReactNode
}) {
  return (
    <div className="rounded-card border border-hairline-2 bg-canvas px-5 py-4 shadow-soft">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="font-medium text-ink">{title}</span>
        <span className="text-[0.875rem] text-mute">{meta}</span>
      </div>
      <ChartState pending={pending} failed={failed}>
        {children}
      </ChartState>
    </div>
  )
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/// How far a figure moved against the one before it, as a signed percentage
/// of the earlier one's size — undefined when either is missing or the earlier
/// one is nil (a change from nothing has no percentage).
function percentChange(now: number | undefined, before: number | undefined) {
  // A month with nothing in it yet (the 1st) compares with nothing: "+100%"
  // against last month would be arithmetic, not news.
  if (now === undefined || before === undefined || before === 0 || now === 0)
    return undefined
  return ((now - before) / Math.abs(before)) * 100
}

function Headline({
  label,
  value,
  note,
  tone,
  delta,
}: {
  label: string
  value: number | undefined
  note: string
  tone?: "bad"
  /// Percent against last month: up is green, down is red.
  delta?: number
}) {
  return (
    <div className="rounded-card border border-hairline-2 bg-canvas px-5 py-4 shadow-soft">
      <div className="text-[0.875rem] text-body">{label}</div>
      <div
        className={
          tone === "bad"
            ? "mt-1 text-[1.375rem] font-semibold text-bad-fg tabular-nums"
            : "mt-1 text-[1.375rem] font-semibold text-ink tabular-nums"
        }
      >
        {value === undefined ? "—" : money(value)}
      </div>
      {delta !== undefined && (
        <div
          className={
            delta >= 0
              ? "mt-0.5 text-[0.875rem] font-medium text-ok-fg tabular-nums"
              : "mt-0.5 text-[0.875rem] font-medium text-bad-fg tabular-nums"
          }
        >
          {delta >= 0 ? "↑" : "↓"}{" "}
          {Math.abs(delta).toLocaleString("id-ID", {
            maximumFractionDigits: 1,
          })}
          %<span className="font-normal text-mute"> vs last month</span>
        </div>
      )}
      <div className="mt-0.5 text-[0.875rem] text-mute">{note}</div>
    </div>
  )
}

/// A titled list of payments, six at most, with the way to all of them.
function PaymentList({
  title,
  note,
  to,
  rows,
  pending,
  empty,
  when,
}: {
  title: string
  note: string
  to: string
  rows: readonly Owed[]
  pending: boolean
  empty: string
  when: (row: Owed) => React.ReactNode
}) {
  const shown = rows.slice(0, 6)
  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  return (
    <section className="flex flex-col">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[1rem] font-medium text-ink">{title}</h2>
          <p className="text-[0.875rem] text-mute">{note}</p>
        </div>
        <AppLink to={to} variant="ghost" size="sm">
          {rows.length > shown.length
            ? `All ${count(rows.length)} · ${money(total)}`
            : "Open"}
        </AppLink>
      </div>
      <div className="overflow-hidden rounded-card border border-hairline-2 bg-canvas shadow-soft">
        {pending ? (
          <p className="px-5 py-8 text-center text-[0.875rem] text-mute">
            Reading…
          </p>
        ) : shown.length === 0 ? (
          <p className="px-5 py-8 text-center text-[0.875rem] text-mute">
            {empty}
          </p>
        ) : (
          shown.map((row) => (
            <div
              key={row.key}
              className="flex items-center gap-4 border-b border-hairline px-5 py-3.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-ink">{row.who}</div>
                <div className="truncate text-[0.875rem] text-mute">
                  {row.how} · <span className="font-mono">{row.what}</span>
                </div>
              </div>
              <div className="w-28 shrink-0 text-[0.875rem] text-body">
                {when(row)}
              </div>
              <div className="w-36 shrink-0 text-right font-medium text-ink tabular-nums">
                {money(row.amount)}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

/// ERPNext's Payments dashboard (`accounts_dashboard/payments`): the same
/// number cards over the charts about money moving — bills in and out, what
/// is owed and how late, and the bank. Of its five charts, three are drawn,
/// for the reasons `FinanceDashboard` gives.
export function PaymentsDashboard() {
  const months = useLastMonths(12)
  const bank = useBankBalance(months)
  const cards = useNumberCards()
  const ageing = usePayablesAgeing()

  return (
    <PageContent>
      <PageHeader crumb="Finance · Payments" title="Payments Dashboard" />

      <NumberCards cards={cards} />

      <div className="grid grid-cols-1 gap-x-3 xl:grid-cols-2">
        <ChartCard title="Accounts Payable Ageing" meta="As at today">
          <ChartState pending={ageing.isPending} failed={ageing.isError}>
            {ageing.data && <AgeingBar buckets={ageing.data.total} />}
          </ChartState>
        </ChartCard>

        <ChartCard title="Bank Balance" meta="Month end · Last 12 months">
          <ChartState pending={bank.pending} failed={bank.failed}>
            <LineSeries
              rows={bank.rows}
              dataKey="balance"
              label="Bank balance"
              format={money}
              titleOf={monthTitle}
              labelOf={monthTick}
            />
          </ChartState>
        </ChartCard>
      </div>
    </PageContent>
  )
}

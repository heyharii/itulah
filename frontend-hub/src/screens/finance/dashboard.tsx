import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Suspense, useMemo } from "react"
import { ArrowUpRight } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { BarSeries, LineSeries } from "@/components/ui/chart"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { count, day, money, moneyCompact } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import type { SheetKey } from "@/lib/sheets"
import {
  openDeliveriesQuery,
  payablesAgingQuery,
  projectionBillsQuery,
  projectionGirosQuery,
} from "@/lib/queries/finance"
import { profitAndLossQuery } from "@/lib/queries/finance-domains"
import { supplierNamesQuery } from "@/lib/queries/procurement"
import { isoDay, todayIso } from "@/screens/finance/chart"
import { useSupplierName } from "@/screens/finance/hooks"
import { NeedsAttention } from "@/screens/finance/needs-attention"
import {
  AGEING_BUCKETS,
  overdueMinor,
  useDeliveryNumber,
  PENDING_CARDS,
  useInventoryValueNow,
} from "@/screens/finance/measures"
import { CardFigure, PhoneList } from "@/components/ui/phone-cards"
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
} from "@/screens/finance/workspace"

/// The Finance Overview (owner, 2026-10-01): what is in the bank, what has to
/// be paid soon, what is already late, and how the month is going — then the
/// payments themselves, by name, each list a doorway to the screen that pays
/// them. Named sections rather than one "needs attention" queue: a person
/// opening Finance in the morning asks "what do I pay this week", not "what is
/// wrong".
export function FinanceDashboard() {
  // The head stands at once; every section below it reads its own figures
  // inside its own boundary, so the ones that are ready are drawn while the
  // slower ones are still on their way (and the chart's twelve reads do not
  // hold up the four figures).
  return (
    <PageContent>
      <PageHeader className="max-md:hidden" crumb="Finance" title="Overview" />

      {/* Four figures (owner, 2026-10-01): the money we hold, what we owe,
          what cash did this month, and what the stock on the shelves is
          worth. */}
      <Suspense fallback={<Figures />}>
        <LiveFigures />
      </Suspense>

      <NeedsAttention />

      <Suspense fallback={<Payments />}>
        <LivePayments />
      </Suspense>

      {/* Two charts as wide as the two lists above them (owner, 2026-10-01:
          no page-wide charts, no cards smaller than their neighbours). */}
      <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Suspense
          fallback={
            <SmallChart
              title="Cash and bank"
              to="/finance/accounting/general-ledger"
              meta="Month end · 12 months"
              pending
              failed={false}
            >
              {null}
            </SmallChart>
          }
        >
          <CashChart />
        </Suspense>
        <Suspense
          fallback={
            <SmallChart
              title="Income and expenses"
              to="/finance/reports/profit-and-loss"
              meta="Monthly · 6 months"
              pending
              failed={false}
            >
              {null}
            </SmallChart>
          }
        >
          <IncomeChart />
        </Suspense>
      </div>

      {/* Below the payments, the two that explain them (owner, 2026-10-01):
          what the months cost by kind, and how old what we owe is. */}
      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Suspense
          fallback={
            <SmallChart
              title="Expenses per month"
              to="/finance/reports/expenses-by-month"
              meta="By expense group · 6 months"
              pending
              failed={false}
            >
              {null}
            </SmallChart>
          }
        >
          <ExpenseChart />
        </Suspense>
        <Suspense
          fallback={
            <SmallChart
              title="Payables ageing"
              to="/finance/payables/aging"
              meta="Total payables, as at today"
              pending
              failed={false}
            >
              {null}
            </SmallChart>
          }
        >
          <AgeingChart />
        </Suspense>
      </div>
    </PageContent>
  )
}

/// The Overview's four figures, read: the bank, what is owed and what of it is
/// late, what cash did, and what the stock is worth.
function LiveFigures() {
  const months = useLastMonths(12)
  const bank = useBankBalance(months)
  // Total payables is ONE read, the server's ageing (`measures.ts` says what
  // it counts).
  const payables = useSuspenseQuery(payablesAgingQuery(todayIso()))
  // What the stock is worth: set-up stock, stock waiting to be set up, and
  // stock in transit, each counted once.
  const inventory = useInventoryValueNow()

  const owedTotal = payables.data.total.total_minor
  const overdueTotal = overdueMinor(payables.data.total)
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
  return (
    <Figures
      bankNow={bankNow}
      owedTotal={owedTotal}
      overdueTotal={overdueTotal}
      flowThisMonth={flowThisMonth}
      flowLastMonth={flowLastMonth}
      inventoryValue={inventory.value}
    />
  )
}

/// The four figures. Every one reads "—" until it is given a value, which is
/// also what the boundary shows while they are being read.
function Figures({
  bankNow,
  owedTotal,
  overdueTotal,
  flowThisMonth,
  flowLastMonth,
  inventoryValue,
}: {
  bankNow?: number
  owedTotal?: number
  overdueTotal?: number
  flowThisMonth?: number
  flowLastMonth?: number
  inventoryValue?: number
}) {
  const figure = (value: number | undefined, to: string) =>
    value === undefined ? (
      "—"
    ) : (
      <AppLink to={to} title={money(value)} className="record-link">
        {moneyCompact(value)}
      </AppLink>
    )

  return (
    <KpiStrip>
      <Kpi
        label="Cash and bank"
        value={figure(bankNow, "/finance/cash-bank/bank-accounts")}
      />
      <Kpi
        label="Total payables"
        value={figure(owedTotal, "/finance/payables/aging")}
        delta={
          overdueTotal !== undefined && overdueTotal > 0 ? (
            <span title={money(overdueTotal)} className="text-bad-fg">
              {moneyCompact(overdueTotal)} overdue
            </span>
          ) : undefined
        }
      />
      <Kpi
        label="Cash flow this month"
        value={figure(flowThisMonth, "/finance/reports/cash-flow")}
        delta={
          flowLastMonth === undefined ? undefined : (
            <span title={money(flowLastMonth)} className="font-normal">
              Last month {moneyCompact(flowLastMonth)}
            </span>
          )
        }
      />
      <Kpi
        label="Inventory value"
        value={figure(inventoryValue, "/finance/inventory/valuation")}
      />
    </KpiStrip>
  )
}

function CashChart() {
  const months = useLastMonths(12)
  const bank = useBankBalance(months)
  return (
    <SmallChart
      title="Cash and bank"
      to="/finance/accounting/general-ledger"
      meta="Month end · 12 months"
      pending={false}
      failed={false}
    >
      {bank.rows.every((row) => row.balance === 0) ? (
        <ChartEmpty>No bank balance in these months.</ChartEmpty>
      ) : (
        <LineSeries
          rows={bank.rows}
          dataKey="balance"
          label="Bank balance"
          format={money}
          titleOf={monthTitle}
          labelOf={monthTick}
          className="h-[13rem]"
        />
      )}
    </SmallChart>
  )
}

function IncomeChart() {
  const months = useLastMonths(12)
  const pnl = useMonthlyPnl(months)
  return (
    <SmallChart
      title="Income and expenses"
      to="/finance/reports/profit-and-loss"
      meta="Monthly · 6 months"
      pending={false}
      failed={false}
    >
      {pnl.rows
        .slice(-6)
        .every((row) => row.income === 0 && row.expense === 0) ? (
        <ChartEmpty>No income or expense in these months.</ChartEmpty>
      ) : (
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
      )}
    </SmallChart>
  )
}

/// Six months of expense, by the client's own expense groups.
function ExpenseChart() {
  const months = useLastMonths(12)
  const recent = months.slice(-6)
  const statements = useSuspenseQueries({
    queries: recent.map((bucket) => profitAndLossQuery(bucket.from, bucket.to)),
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
  return (
    <SmallChart
      title="Expenses per month"
      to="/finance/reports/expenses-by-month"
      meta="By expense group · 6 months"
      pending={false}
      failed={false}
    >
      <ExpenseGroups months={expenseMonths} />
    </SmallChart>
  )
}

function AgeingChart() {
  const payables = useSuspenseQuery(payablesAgingQuery(todayIso()))
  return (
    <SmallChart
      title="Payables ageing"
      to="/finance/payables/aging"
      meta="Total payables, as at today"
      pending={false}
      failed={false}
    >
      <AgeingColumns buckets={payables.data.total} />
    </SmallChart>
  )
}

/// The two lists of what is about to leave the bank and what is late, with
/// their rows still being read.
function Payments({ owed }: { owed?: readonly Owed[] }) {
  const today = todayIso()
  const fortnight = isoDay(addDays(new Date(), 14))
  const upcoming = (owed ?? [])
    .filter((row) => row.late <= 0 && row.due <= fortnight && row.due >= today)
    .sort((a, b) => a.due.localeCompare(b.due))
  // Overdue is supplier debt past its due date and nothing else — a giro
  // already holds the debt, and one the bank has not cleared yet is the Giro
  // Board's matter, so the list and the "overdue" under Total payables are
  // one number.
  const overdue = (owed ?? [])
    .filter((row) => row.how !== "Giro" && row.late > 0)
    .sort((a, b) => b.late - a.late)
  return (
    <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
      <PaymentList
        title="Upcoming payments"
        note="Due in the next 14 days"
        to="/finance/payables/projection"
        rows={upcoming}
        pending={owed === undefined}
        failed={false}
        empty="Nothing falls due in the next two weeks."
        when={(row) => day(row.due)}
      />
      <PaymentList
        title="Overdue payments"
        note="Past their due date, still unpaid"
        to="/finance/payables/aging"
        rows={overdue}
        pending={owed === undefined}
        failed={false}
        empty="Nothing is late."
        when={(row) => (
          <span className="text-bad-fg">
            {count(row.late)} {row.late === 1 ? "day" : "days"} late
          </span>
        )}
      />
    </div>
  )
}

function LivePayments() {
  const today = todayIso()
  // Every open item behind the payables figure: the posted bills, then the
  // deliveries no bill covers yet, then — for what is about to leave the bank
  // — the giros issued and not cleared.
  useSuspenseQuery(supplierNamesQuery())
  const supplierName = useSupplierName()
  const bills = useSuspenseQuery(projectionBillsQuery("POSTED"))
  const deliveries = useSuspenseQuery(openDeliveriesQuery(today))
  const deliveryNumber = useDeliveryNumber()
  const giros = useSuspenseQuery(projectionGirosQuery())

  // Every open item behind the figure, as one shape. `late` is the server's
  // own days past due (negative until the day), so "overdue" is the same
  // question the ageing asked and not a second date comparison made here.
  const owed = useMemo<Owed[]>(() => {
    const rows: Owed[] = []
    for (const bill of bills.data) {
      // A held bill is owed but not ageing: the figure leaves it out, so the
      // list does too.
      if (bill.on_hold || bill.outstanding_minor <= 0) continue
      const due = bill.next_due_date ?? bill.due_date
      if (due === null) continue
      rows.push({
        key: `b-${bill.invoice_id}`,
        to: "/finance/payables/bills",
        sheet: { key: "bill", value: bill.invoice_id },
        due,
        late: bill.days_overdue,
        who: supplierName(bill.supplier_id, bill.supplier_name),
        what: bill.invoice_number,
        how: "Bill",
        amount: bill.outstanding_minor,
      })
    }
    for (const item of deliveries.data.items) {
      if (item.outstanding_minor <= 0) continue
      rows.push({
        key: `d-${item.entry_id}`,
        to: "/finance/accounting/journal-entries",
        sheet: { key: "entry", value: item.entry_id },
        due: item.due_date ?? item.posting_date,
        late: item.age_days,
        who: supplierName(item.party_id, item.party_name),
        what: deliveryNumber(item.voucher_id, item.entry_number),
        how: "Delivery",
        amount: item.outstanding_minor,
      })
    }
    for (const giro of giros.data) {
      if (!["ISSUED", "DELIVERED", "DUE"].includes(giro.status)) continue
      rows.push({
        key: `g-${giro.giro_id}`,
        to: "/finance/cash-bank/giro",
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
  }, [bills.data, deliveries.data, giros.data, supplierName, deliveryNumber])

  return <Payments owed={owed} />
}

const EXPENSE_SECTIONS: ReadonlySet<string> = new Set([
  "OPERATING_EXPENSE",
  "OTHER_OPERATING_EXPENSE",
])

/// Calm, distinct fills for up to six stacked groups; the sixth is "Other".
const GROUP_FILLS = [
  "var(--accent)",
  "var(--a-blue)",
  "var(--a-violet)",
  "var(--a-orange)",
  "var(--a-pink)",
  "var(--hairline-2)",
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
      <p className="py-10 text-center text-[0.9375rem] text-mute">
        No expense in these months.
      </p>
    )
  return (
    <div className="flex gap-6 max-md:flex-col">
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
            <span className="text-center text-[0.9375rem] text-mute">
              {monthTick(stack.bucket)}
            </span>
          </div>
        ))}
      </div>
      <ul className="flex w-56 shrink-0 flex-col justify-center gap-2.5 max-md:w-full">
        {legend.map((row, index) => (
          <li
            key={row.group}
            className="flex items-center gap-2 text-[0.9375rem]"
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
              {moneyCompact(row.total)}
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
  const fills = [
    "var(--hairline-2)",
    "var(--a-orange)",
    "var(--a-pink)",
    "var(--a-violet)",
    "var(--accent)",
  ]
  const columns = AGEING_BUCKETS.map((bucket, index) => ({
    label: bucket.label,
    value: buckets[bucket.key],
    fill: fills[index],
  }))
  const top = Math.max(1, ...columns.map((column) => column.value))
  // Five columns of "Rp 123,5 M" over a 59px-wide bar do not fit a phone:
  // there the ageing is the five figures, each with its colour.
  if (useLayout() === "phone")
    return (
      <ul className="flex flex-col gap-2.5">
        {columns.map((column) => (
          <li
            key={column.label}
            className="flex items-center gap-2.5 text-[0.9375rem]"
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: column.fill }}
            />
            <span className="min-w-0 flex-1 truncate text-body">
              {column.label}
            </span>
            <span className="font-medium text-ink tabular-nums">
              {money(column.value)}
            </span>
          </li>
        ))}
      </ul>
    )
  return (
    <div className="flex h-[13rem] items-end gap-3">
      {columns.map((column) => (
        <div
          key={column.label}
          className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5"
        >
          <span className="text-center text-[0.9375rem] font-medium text-ink tabular-nums">
            {moneyCompact(column.value)}
          </span>
          <div
            className="w-full rounded-t-[4px]"
            style={{
              height: `${Math.max(2, (column.value / top) * 70)}%`,
              background: column.fill,
            }}
          />
          <span className="text-center text-[0.9375rem] text-body">
            {column.label}
          </span>
        </div>
      ))}
    </div>
  )
}

/// "BEBAN ADMINISTRASI DAN UMUM" → "Beban Administrasi Dan Umum".
function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|\s)\S/g, (head) => head.toUpperCase())
}

interface Owed {
  readonly key: string
  readonly to: string
  readonly sheet?: { key: SheetKey; value: string }
  readonly due: string
  readonly late: number
  readonly who: string
  readonly what: string
  readonly how: "Bill" | "Delivery" | "Giro"
  readonly amount: number
}

/// A chart in a small card: its name, what it covers, the chart.
function SmallChart({
  title,
  meta,
  to,
  pending,
  failed,
  children,
}: {
  title: string
  meta: string
  to: string
  pending: boolean
  failed: boolean
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0 rounded-card border border-hairline bg-canvas px-4 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[1rem] font-semibold text-ink">
          <AppLink
            to={to}
            className="inline-flex items-center gap-1 hover:text-accent"
          >
            {title}
            <ArrowUpRight className="size-4 shrink-0 text-line-ico" />
          </AppLink>
        </h2>
        <span className="text-[0.9375rem] text-mute">{meta}</span>
      </div>
      <ChartState pending={pending} failed={failed}>
        {children}
      </ChartState>
    </section>
  )
}

/// What a chart card says when its months are all nothing: one sentence in
/// place of an axis labelled 0 to 4.
function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex h-[13rem] items-center justify-center text-[0.9375rem] text-mute">
      {children}
    </p>
  )
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/// A titled list of payments, six at most, with the way to all of them.
function PaymentList({
  title,
  note,
  to,
  rows,
  pending,
  failed,
  empty,
  when,
}: {
  title: string
  note: string
  to: string
  rows: readonly Owed[]
  pending: boolean
  /// A list that could not be read is not an empty one: "Nothing is late."
  /// over a failed read is the most reassuring wrong answer this page has.
  failed: boolean
  empty: string
  when: (row: Owed) => React.ReactNode
}) {
  const shown = rows.slice(0, 6)
  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  const phone = useLayout() === "phone"
  const navigate = useNavigate()
  return (
    <section className="flex flex-col">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[1rem] font-medium text-ink">{title}</h2>
          <p className="text-[0.9375rem] text-mute">{note}</p>
        </div>
        <AppLink to={to} variant="ghost" size="sm">
          {rows.length > shown.length
            ? `View all ${count(rows.length)}`
            : "View all"}
        </AppLink>
      </div>
      {phone && !pending && !failed && shown.length > 0 ? (
        <PhoneList
          rows={shown.map((row) => ({
            key: row.key,
            title: (
              <AppLink to={row.to} sheet={row.sheet} className="record-link">
                {row.who}
              </AppLink>
            ),
            code: `${row.how} · ${row.what}`,
            lead: <CardFigure value={money(row.amount)} />,
            foot: when(row),
            onOpen: () =>
              void navigate({
                to: row.to,
                search: row.sheet ? { [row.sheet.key]: row.sheet.value } : {},
              } as never),
          }))}
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-hairline bg-canvas">
          {pending ? (
            <p className="px-5 py-8 text-center text-[0.9375rem] text-mute">
              Reading…
            </p>
          ) : failed ? (
            <p className="px-5 py-8 text-center text-[0.9375rem] text-mute">
              These payments could not be read.
            </p>
          ) : shown.length === 0 ? (
            <p className="px-5 py-8 text-center text-[0.9375rem] text-mute">
              {empty}
            </p>
          ) : (
            shown.map((row) => (
              <AppLink
                key={row.key}
                to={row.to}
                sheet={row.sheet}
                className="flex items-center gap-4 border-b border-hairline px-4 py-3.5 transition-colors duration-(--t-hover) last:border-b-0 hover:bg-soft"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ink">{row.who}</div>
                  <div className="truncate text-[0.9375rem] text-mute">
                    {row.how} · <span>{row.what}</span>
                  </div>
                </div>
                <div className="w-28 shrink-0 text-[0.9375rem] text-body">
                  {when(row)}
                </div>
                <div className="w-36 shrink-0 text-right font-medium text-ink tabular-nums">
                  {money(row.amount)}
                </div>
              </AppLink>
            ))
          )}
        </div>
      )}
      {shown.length > 0 && (
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-[0.9375rem] text-mute">
          <span>
            {count(rows.length)} {rows.length === 1 ? "payment" : "payments"}
          </span>
          <span className="font-medium text-ink tabular-nums">
            {money(total)}
          </span>
        </div>
      )}
    </section>
  )
}

/// ERPNext's Payments dashboard (`accounts_dashboard/payments`): the same
/// number cards over the charts about money moving — bills in and out, what
/// is owed and how late, and the bank. Of its five charts, three are drawn,
/// for the reasons `FinanceDashboard` gives.
export function PaymentsDashboard() {
  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Payments"
        title="Payments Dashboard"
      />

      <Suspense fallback={<NumberCards cards={PENDING_CARDS} />}>
        <LiveNumberCards />
      </Suspense>

      <div className="grid grid-cols-1 gap-x-3 xl:grid-cols-2">
        <Suspense
          fallback={
            <ChartCard title="Accounts Payable Ageing" meta="As at today">
              <ChartState pending failed={false}>
                {null}
              </ChartState>
            </ChartCard>
          }
        >
          <AgeingCard />
        </Suspense>

        <Suspense
          fallback={
            <ChartCard title="Bank Balance" meta="Month end · Last 12 months">
              <ChartState pending failed={false}>
                {null}
              </ChartState>
            </ChartCard>
          }
        >
          <BankCard />
        </Suspense>
      </div>
    </PageContent>
  )
}

function LiveNumberCards() {
  return <NumberCards cards={useNumberCards()} />
}

function AgeingCard() {
  const ageing = useSuspenseQuery(payablesAgingQuery(todayIso()))
  return (
    <ChartCard title="Accounts Payable Ageing" meta="As at today">
      <AgeingBar buckets={ageing.data.total} />
    </ChartCard>
  )
}

function BankCard() {
  const months = useLastMonths(12)
  const bank = useBankBalance(months)
  return (
    <ChartCard title="Bank Balance" meta="Month end · Last 12 months">
      <LineSeries
        rows={bank.rows}
        dataKey="balance"
        label="Bank balance"
        format={money}
        titleOf={monthTitle}
        labelOf={monthTick}
      />
    </ChartCard>
  )
}

import { useQuery } from "@tanstack/react-query"

import type { ProfitAndLoss } from "@itulah/contract"
import { Card } from "@/components/ui/card"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import { financeKeys, payablesAging } from "@/lib/queries/finance"
import { domainKeys, saleDayTotals } from "@/lib/queries/finance-domains"
import { useUnitLabel } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import {
  cashAt,
  useCash,
  useProfit,
  useScopeUnit,
} from "@/screens/executive/books"
import { Refused } from "@/screens/executive/overview"
import { percent, ratio, rupiah } from "@/screens/executive/format"
import {
  Bar,
  Figure,
  Figures,
  Head,
  Line,
  ReportPage,
} from "@/screens/executive/parts"
import { useReportScope } from "@/screens/executive/scope"

/// Cash & Profit — what the period earned by the books, the cash the company
/// holds, what it owes suppliers, and how much of the trade the books have not
/// caught up with yet.

/// The statement in the client's own eleven lines (FINANCE-HARD-RULES P17).
/// Costs arrive positive and are drawn in brackets; a subtotal is bold.
const STATEMENT: readonly {
  readonly label: string
  readonly pick: (p: ProfitAndLoss) => number
  readonly cost?: boolean
  readonly total?: boolean
}[] = [
  { label: "Net sales", pick: (p) => p.revenue_minor },
  {
    label: "Cost of sales",
    pick: (p) => p.cost_of_sales_minor,
    cost: true,
  },
  { label: "Gross profit", pick: (p) => p.gross_profit_minor, total: true },
  {
    label: "Operating expenses",
    pick: (p) => p.operating_expenses_minor,
    cost: true,
  },
  {
    label: "Gross operating profit",
    pick: (p) => p.gross_operating_profit_minor,
    total: true,
  },
  {
    label: "Other operating expenses",
    pick: (p) => p.other_operating_expenses_minor,
    cost: true,
  },
  {
    label: "Net operating profit",
    pick: (p) => p.net_operating_profit_minor,
    total: true,
  },
  {
    label: "Non-operating income / expense",
    pick: (p) => p.non_operating_minor,
  },
  {
    label: "Profit before tax",
    pick: (p) => p.profit_before_tax_minor,
    total: true,
  },
  { label: "Income tax", pick: (p) => p.income_tax_minor, cost: true },
  { label: "Net profit", pick: (p) => p.net_profit_minor, total: true },
]

function signed(value: number, cost: boolean | undefined): string {
  if (cost && value !== 0) return `(${rupiah(value)})`
  return rupiah(value)
}

export function ExecutiveFinance() {
  const scope = useReportScope()
  const unitName = useUnitLabel()
  const profit = useProfit(scope)
  const cash = useCash(scope)
  const unit = useScopeUnit(scope)
  const aging = useQuery({
    // Supplier payables live at head office only (FINANCE-HARD-RULES I4), so
    // this is the company's figure whichever shop the page is narrowed to.
    queryKey: financeKeys.payablesAging(scope.asOf, null),
    queryFn: ({ signal }) => payablesAging({ as_of: scope.asOf }, signal),
    retry: false,
  })
  const posting = useQuery({
    queryKey: domainKeys.saleDays(
      scope.current.from,
      scope.current.to,
      scope.store
    ),
    queryFn: ({ signal }) =>
      saleDayTotals(scope.current.from, scope.current.to, signal, {
        site: scope.store,
      }),
    retry: false,
  })

  const overdue = aging.data
    ? aging.data.total.total_minor - aging.data.total.not_due_minor
    : undefined

  return (
    <ReportPage title="Cash & Profit" scope={scope}>
      <Figures>
        <Figure
          label="Net profit"
          value={profit.data ? rupiah(profit.data.now.net_profit_minor) : "—"}
          now={profit.data?.now.net_profit_minor}
          before={profit.data?.before.net_profit_minor}
        />
        <Figure
          label="Cash & bank"
          value={
            cash.data && unit !== null ? rupiah(cashAt(cash.data, unit)) : "—"
          }
          note={`Balance as of ${scope.asOfLabel}`}
        />
        <Figure
          label="Overdue payables"
          value={overdue === undefined ? "—" : rupiah(overdue)}
          note={
            aging.data
              ? `Of ${rupiah(aging.data.total.total_minor)} supplier payables`
              : undefined
          }
        />
        <Figure
          label="Not yet booked"
          value={posting.data ? rupiah(posting.data.unposted_gross_minor) : "—"}
          note={
            posting.data
              ? `${count(posting.data.unposted)} of ${count(posting.data.total)} sales days`
              : undefined
          }
        />
      </Figures>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="overflow-hidden">
          <Head title="Profit and loss" />
          <div className="overflow-x-auto px-[1.125rem] pb-3">
            {queryState(profit, {
              loading: "Reading the books…",
              refused: <Refused />,
              render: ({ now, before }) => (
                <MiniTable
                  head={[
                    "Line",
                    "This Period",
                    "% of Sales",
                    "Previous Period",
                  ]}
                  style={{ minWidth: "32rem" }}
                >
                  {STATEMENT.map((line) => {
                    const value = line.pick(now)
                    return (
                      <MiniRow key={line.label}>
                        <MiniCell
                          className={cn(line.total && "font-semibold text-ink")}
                        >
                          {line.label}
                        </MiniCell>
                        <MiniCell
                          align="right"
                          className={cn(line.total && "font-semibold text-ink")}
                        >
                          <span title={money(value)}>
                            {signed(value, line.cost)}
                          </span>
                        </MiniCell>
                        <MiniCell align="right" className="text-mute">
                          {percent(ratio(value, now.revenue_minor))}
                        </MiniCell>
                        <MiniCell align="right" className="text-body">
                          {signed(line.pick(before), line.cost)}
                        </MiniCell>
                      </MiniRow>
                    )
                  })}
                </MiniTable>
              ),
            })}
          </div>
        </Card>

        <div className="flex flex-col gap-3">
          <Card className="overflow-hidden">
            <Head
              title="Supplier payables"
              to="/finance/payables/aging"
              link="Open payables"
            />
            <div className="px-[1.125rem] pb-3">
              {queryState(aging, {
                loading: "Reading the payables…",
                refused: <Refused />,
                render: ({ total }) => {
                  const buckets = [
                    ["Not yet due", total.not_due_minor, "accent"],
                    ["1–30 days", total.days_1_30_minor, "warn"],
                    ["31–60 days", total.days_31_60_minor, "warn"],
                    ["61–90 days", total.days_61_90_minor, "bad"],
                    ["> 90 days", total.days_over_90_minor, "bad"],
                  ] as const
                  const widest = Math.max(
                    ...buckets.map(([, value]) => value),
                    1
                  )
                  return total.total_minor === 0 ? (
                    <EmptyState>No supplier payables are open.</EmptyState>
                  ) : (
                    buckets.map(([label, value, tone]) => (
                      <Bar
                        key={label}
                        label={label}
                        value={rupiah(value)}
                        share={value / widest}
                        tone={tone}
                      />
                    ))
                  )
                },
              })}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <Head
              title="Sales & booking"
              to="/finance/receivables/sales-postings"
              link="Open postings"
            />
            <div className="px-[1.125rem] pb-3">
              {queryState(posting, {
                loading: "Reading the postings…",
                refused: <Refused />,
                render: (page) => (
                  <>
                    <Line label="Sales days" value={count(page.total)} />
                    <Line label="Booked" value={count(page.posted)} />
                    <Line
                      label="Not yet booked"
                      value={count(page.unposted)}
                      aside={rupiah(page.unposted_gross_minor)}
                      strong={page.unposted > 0}
                    />
                  </>
                ),
              })}
            </div>
          </Card>
        </div>
      </div>

      {scope.store === undefined && (
        <Card className="mt-3 overflow-hidden">
          <Head title="Cash & bank by unit" />
          <div className="px-[1.125rem] pb-3">
            {queryState(cash, {
              loading: "Reading the cash…",
              refused: <Refused />,
              render: (matrix) => {
                const units = matrix.units
                  .map((id, index) => ({
                    id,
                    value: matrix.column_totals[index] ?? 0,
                  }))
                  .filter((unit) => unit.value !== 0)
                  .sort((a, b) => b.value - a.value)
                const widest = Math.max(...units.map((unit) => unit.value), 1)
                return units.length === 0 ? (
                  <EmptyState>
                    No cash or bank balance has been recorded yet.
                  </EmptyState>
                ) : (
                  <div className="grid gap-x-8 md:grid-cols-2">
                    {units.map((unit) => (
                      <Bar
                        key={unit.id}
                        label={unitName(unit.id)}
                        value={rupiah(unit.value)}
                        share={unit.value / widest}
                        tone={unit.value < 0 ? "bad" : "accent"}
                      />
                    ))}
                  </div>
                )
              },
            })}
          </div>
        </Card>
      )}
    </ReportPage>
  )
}

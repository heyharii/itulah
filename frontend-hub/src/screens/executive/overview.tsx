import { Card } from "@/components/ui/card"
import { LineSeries } from "@/components/ui/chart"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  cashAt,
  useCash,
  useProfit,
  useScopeUnit,
} from "@/screens/executive/books"
import {
  change,
  changeLabel,
  changeTone,
  percent,
  ratio,
  rupiah,
  tick,
  tickTitle,
} from "@/screens/executive/format"
import {
  Figure,
  Figures,
  Head,
  Line,
  ReportPage,
} from "@/screens/executive/parts"
import { useReportScope } from "@/screens/executive/scope"
import { useTrade } from "@/screens/executive/sales"
import { cn } from "@/lib/utils"

/// Overview — the company on one page: what it sold, what it kept, what it
/// holds, and which shops moved it.

export function ExecutiveOverview() {
  const scope = useReportScope()
  const trade = useTrade(scope)
  const profit = useProfit(scope)
  const cash = useCash(scope)
  const unit = useScopeUnit(scope)

  const total = trade.query.data?.total

  return (
    <ReportPage title="Overview" scope={scope}>
      <Figures>
        <Figure
          label="Net sales"
          value={total ? rupiah(total.net) : "…"}
          now={total?.net}
          before={total?.before}
        />
        <Figure
          label="Transactions"
          value={total ? count(total.sales) : "…"}
          now={total?.sales}
          before={total?.salesBefore}
        />
        <Figure
          label="Gross profit"
          value={profit.data ? rupiah(profit.data.now.gross_profit_minor) : "—"}
          now={profit.data?.now.gross_profit_minor}
          before={profit.data?.before.gross_profit_minor}
        />
        <Figure
          label="Cash & bank"
          value={
            cash.data && unit !== null ? rupiah(cashAt(cash.data, unit)) : "—"
          }
          note={`Balance as of ${scope.asOfLabel}`}
        />
      </Figures>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <Head
            title="Net sales"
            to="/executive/stores"
            link="Store performance"
          />
          <div className="px-[1.125rem] pb-4">
            {queryState(trade.query, {
              loading: "Reading the sales…",
              render: ({ chart, total }) => (
                <>
                  <LineSeries
                    rows={chart}
                    dataKey="now"
                    label="This period"
                    ghost={{
                      dataKey: "before",
                      labelOf: (row) =>
                        tickTitle(String(row.beforeStart), scope.bucket),
                    }}
                    format={money}
                    titleOf={(bucket) => tickTitle(bucket, scope.bucket)}
                    labelOf={(bucket) => tick(bucket, scope.bucket)}
                    className="h-[15rem]"
                  />
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-hairline pt-3 text-[0.875rem] text-body">
                    <span>
                      Average sale{" "}
                      <strong className="font-medium text-ink tabular-nums">
                        {total.sales === 0
                          ? "—"
                          : rupiah(Math.round(total.net / total.sales))}
                      </strong>
                    </span>
                    <span>
                      Pcs sold{" "}
                      <strong className="font-medium text-ink tabular-nums">
                        {count(total.units)}
                      </strong>
                    </span>
                    <span className="ml-auto flex items-center gap-3 text-mute">
                      <Legend tone="accent">This period</Legend>
                      <Legend tone="ghost">Previous period</Legend>
                    </span>
                  </div>
                </>
              ),
            })}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <Head title="Profit" to="/executive/finance" link="Cash & profit" />
          <div className="px-[1.125rem] pb-3">
            {queryState(profit, {
              loading: "Reading the books…",
              refused: <Refused />,
              render: ({ now, before }) => {
                const rows = [
                  ["Sales", now.revenue_minor, before.revenue_minor],
                  [
                    "Gross profit",
                    now.gross_profit_minor,
                    before.gross_profit_minor,
                  ],
                  [
                    "Operating profit",
                    now.net_operating_profit_minor,
                    before.net_operating_profit_minor,
                  ],
                  ["Net profit", now.net_profit_minor, before.net_profit_minor],
                ] as const
                return (
                  <>
                    {rows.map(([label, value, prior], index) => {
                      const moved = change(value, prior)
                      return (
                        <Line
                          key={label}
                          label={label}
                          strong={index === rows.length - 1}
                          value={rupiah(value)}
                          aside={
                            <span
                              className={cn(
                                changeTone(moved) === "up" && "text-ok-fg",
                                changeTone(moved) === "down" && "text-bad-fg"
                              )}
                            >
                              {changeLabel(moved)}
                            </span>
                          }
                        />
                      )
                    })}
                    <p className="mt-2 text-[0.875rem] text-mute">
                      Gross margin{" "}
                      <span className="font-medium text-ink">
                        {percent(
                          ratio(now.gross_profit_minor, now.revenue_minor)
                        )}
                      </span>
                      <span className="mx-1.5 text-faint">·</span>
                      Net margin{" "}
                      <span className="font-medium text-ink">
                        {percent(
                          ratio(now.net_profit_minor, now.revenue_minor)
                        )}
                      </span>
                    </p>
                  </>
                )
              },
            })}
          </div>
        </Card>
      </div>

      {scope.store === undefined && (
        <Card className="mt-3 overflow-hidden">
          <Head
            title="Stores"
            to="/executive/stores"
            link="All store figures"
          />
          <div className="overflow-x-auto px-[1.125rem] pb-3">
            {queryState(trade.query, {
              loading: "Reading the stores…",
              render: ({ stores, total }) =>
                stores.length === 0 ? (
                  <EmptyState>
                    No store has sold anything in this period yet.
                  </EmptyState>
                ) : (
                  <MiniTable
                    head={[
                      "Store",
                      "Net Sales",
                      "Change",
                      "Share",
                      "Transactions",
                    ]}
                    style={{ minWidth: "34rem" }}
                  >
                    {[...stores]
                      .sort((a, b) => b.net - a.net)
                      .map((store) => {
                        const moved = change(store.net, store.before)
                        return (
                          <MiniRow key={store.site_id}>
                            <MiniCell>
                              <button
                                type="button"
                                onClick={() => scope.setStore(store.site_id)}
                                className="font-medium text-ink hover:text-accent"
                              >
                                {store.name}
                              </button>
                            </MiniCell>
                            <MiniCell align="right">
                              <span title={money(store.net)}>
                                {rupiah(store.net)}
                              </span>
                            </MiniCell>
                            <MiniCell
                              align="right"
                              className={cn(
                                changeTone(moved) === "up" && "text-ok-fg",
                                changeTone(moved) === "down" && "text-bad-fg"
                              )}
                            >
                              {changeLabel(moved)}
                            </MiniCell>
                            <MiniCell align="right">
                              {percent(ratio(store.net, total.net))}
                            </MiniCell>
                            <MiniCell align="right">
                              {count(store.sales)}
                            </MiniCell>
                          </MiniRow>
                        )
                      })}
                  </MiniTable>
                ),
            })}
          </div>
        </Card>
      )}
    </ReportPage>
  )
}

export function Legend({
  tone,
  children,
}: {
  tone: "accent" | "ghost"
  children: React.ReactNode
}) {
  return (
    <span className="flex items-center gap-1.5 text-[0.875rem] whitespace-nowrap">
      <span
        aria-hidden
        className={cn(
          "h-0.5 w-3 rounded-full",
          tone === "accent" ? "bg-accent" : "bg-hairline-strong"
        )}
      />
      {children}
    </span>
  )
}

/// Finance reads are the supervisor's. Somebody below that sees the trade and
/// is told, once, why the books are not beside it.
export function Refused() {
  return (
    <p className="py-6 text-center text-[0.875rem] text-mute">
      Book figures are for supervisors and above.
    </p>
  )
}

import { Suspense } from "react"

import { Card } from "@/components/ui/card"
import { LineSeries } from "@/components/ui/chart"
import { EmptyState, LoadingState } from "@/components/ui/states"
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
  CardTable,
  field,
  type CardShape,
} from "@/screens/executive/card-table"
import {
  Figure,
  Figures,
  Head,
  Line,
  ReportPage,
} from "@/screens/executive/parts"
import { useReportScope, type ReportScope } from "@/screens/executive/scope"
import { useTrade } from "@/screens/executive/sales"
import { cn } from "@/lib/utils"

/// Overview — the company on one page: what it sold, what it kept, what it
/// holds, and which shops moved it.

export function ExecutiveOverview() {
  const scope = useReportScope()
  const profit = useProfit(scope)
  const cash = useCash(scope)
  const unit = useScopeUnit(scope)

  return (
    <ReportPage title="Overview" scope={scope}>
      <Figures>
        <Suspense
          fallback={
            <>
              <Figure label="Net sales" value="…" />
              <Figure label="Transactions" value="…" />
            </>
          }
        >
          <TradeFigures scope={scope} />
        </Suspense>
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
            <Suspense
              fallback={<LoadingState>Reading the sales…</LoadingState>}
            >
              <NetSalesChart scope={scope} />
            </Suspense>
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
                    <p className="mt-2 text-[0.9375rem] text-mute">
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
        <Card className="mt-3 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <Head
            title="Stores"
            to="/executive/stores"
            link="All store figures"
          />
          <Suspense fallback={<LoadingState>Reading the stores…</LoadingState>}>
            <StoreRanking scope={scope} />
          </Suspense>
        </Card>
      )}
    </ReportPage>
  )
}

/// This period's two trade figures, each against the period before.
function TradeFigures({ scope }: { scope: ReportScope }) {
  const { data } = useTrade(scope)
  const total = data.total
  return (
    <>
      <Figure
        label="Net sales"
        value={rupiah(total.net)}
        now={total.net}
        before={total.before}
      />
      <Figure
        label="Transactions"
        value={count(total.sales)}
        now={total.sales}
        before={total.salesBefore}
      />
    </>
  )
}

/// The line of this period's net sales over the previous one's, with what the
/// average sale was.
function NetSalesChart({ scope }: { scope: ReportScope }) {
  const { data } = useTrade(scope)
  const { chart, total } = data
  return (
    <>
      <LineSeries
        rows={chart}
        dataKey="now"
        label="This period"
        ghost={{
          dataKey: "before",
          labelOf: (row) => tickTitle(String(row.beforeStart), scope.bucket),
        }}
        format={money}
        titleOf={(bucket) => tickTitle(bucket, scope.bucket)}
        labelOf={(bucket) => tick(bucket, scope.bucket)}
        className="h-[15rem]"
      />
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-hairline pt-3 text-[0.9375rem] text-body">
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
  )
}

/// Every shop that traded, biggest first. A row narrows the whole report to its
/// shop.
function StoreRanking({ scope }: { scope: ReportScope }) {
  const { data } = useTrade(scope)
  const { stores, total } = data
  return stores.length === 0 ? (
    <EmptyState>No store has sold anything in this period yet.</EmptyState>
  ) : (
    <CardTable<StoreLine>
      columns={STORE_COLUMNS}
      rows={[...stores]
        .sort((a, b) => b.net - a.net)
        .map((store) => ({
          site_id: store.site_id,
          name: store.name,
          net: store.net,
          change: change(store.net, store.before),
          share: ratio(store.net, total.net),
          sales: store.sales,
        }))}
      getRowId={storeId}
      card={STORE_CARD}
      // A store's row narrows the whole report to it.
      onRowClick={(row) => scope.setStore(row.site_id)}
    />
  )
}

interface StoreLine {
  readonly site_id: string
  readonly name: string
  readonly net: number
  readonly change: number | null
  readonly share: number | null
  readonly sales: number
}

const storeId = (row: StoreLine) => row.site_id

const STORE_COLUMNS = [
  field<StoreLine>(
    "name",
    "Store",
    (store) => <span className="font-medium text-ink">{store.name}</span>,
    { by: (store) => store.name }
  ),
  field<StoreLine>(
    "net",
    "Net Sales",
    (store) => <span title={money(store.net)}>{rupiah(store.net)}</span>,
    { right: true, by: (store) => store.net }
  ),
  field<StoreLine>(
    "change",
    "Change",
    (store) => (
      <span
        className={cn(
          changeTone(store.change) === "up" && "text-ok-fg",
          changeTone(store.change) === "down" && "text-bad-fg"
        )}
      >
        {changeLabel(store.change)}
      </span>
    ),
    { right: true, by: (store) => store.change }
  ),
  field<StoreLine>("share", "Share", (store) => percent(store.share), {
    right: true,
    by: (store) => store.share,
    priority: 3,
  }),
  field<StoreLine>("sales", "Transactions", (store) => count(store.sales), {
    right: true,
    by: (store) => store.sales,
    priority: 2,
  }),
]

/// A phone's card: the shop, what it sold as the figure, and how it moved.
const STORE_CARD: CardShape<StoreLine> = {
  lead: (store) => ({
    value: <span title={money(store.net)}>{rupiah(store.net)}</span>,
    caption: "net sales",
    tone: store.net === 0 ? "quiet" : undefined,
  }),
  foot: (store) => (
    <>
      {store.change !== null && (
        <>
          <span
            className={cn(
              "font-medium",
              changeTone(store.change) === "up" && "text-ok-fg",
              changeTone(store.change) === "down" && "text-bad-fg"
            )}
          >
            {changeLabel(store.change)}
          </span>{" "}
          vs previous period ·{" "}
        </>
      )}
      {count(store.sales)} {store.sales === 1 ? "transaction" : "transactions"}{" "}
      · share {percent(store.share)}
    </>
  ),
}

export function Legend({
  tone,
  children,
}: {
  tone: "accent" | "ghost"
  children: React.ReactNode
}) {
  return (
    <span className="flex items-center gap-1.5 text-[0.9375rem] whitespace-nowrap">
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
    <p className="py-6 text-center text-[0.9375rem] text-mute">
      Book figures are for supervisors and above.
    </p>
  )
}

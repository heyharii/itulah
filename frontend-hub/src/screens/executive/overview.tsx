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

/// Ringkasan — the company on one page: what it sold, what it kept, what it
/// holds, and which shops moved it.

export function ExecutiveOverview() {
  const scope = useReportScope()
  const trade = useTrade(scope)
  const profit = useProfit(scope)
  const cash = useCash(scope)
  const unit = useScopeUnit(scope)

  const total = trade.query.data?.total

  return (
    <ReportPage title="Ringkasan" scope={scope}>
      <Figures>
        <Figure
          label="Penjualan bersih"
          value={total ? rupiah(total.net) : "…"}
          now={total?.net}
          before={total?.before}
        />
        <Figure
          label="Transaksi"
          value={total ? count(total.sales) : "…"}
          now={total?.sales}
          before={total?.salesBefore}
        />
        <Figure
          label="Laba kotor"
          value={profit.data ? rupiah(profit.data.now.gross_profit_minor) : "—"}
          now={profit.data?.now.gross_profit_minor}
          before={profit.data?.before.gross_profit_minor}
        />
        <Figure
          label="Kas & bank"
          value={
            cash.data && unit !== null ? rupiah(cashAt(cash.data, unit)) : "—"
          }
          note={`Saldo per ${scope.asOfLabel}`}
        />
      </Figures>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <Head
            title="Penjualan bersih"
            to="/executive/stores"
            link="Kinerja toko"
          />
          <div className="px-[1.125rem] pb-4">
            {queryState(trade.query, {
              loading: "Membaca penjualan…",
              render: ({ chart, total }) => (
                <>
                  <LineSeries
                    rows={chart}
                    dataKey="now"
                    label="Periode ini"
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
                      Rata-rata struk{" "}
                      <strong className="font-medium text-ink tabular-nums">
                        {total.sales === 0
                          ? "—"
                          : rupiah(Math.round(total.net / total.sales))}
                      </strong>
                    </span>
                    <span>
                      Unit terjual{" "}
                      <strong className="font-medium text-ink tabular-nums">
                        {count(total.units)}
                      </strong>
                    </span>
                    <span className="ml-auto flex items-center gap-3 text-mute">
                      <Legend tone="accent">Periode ini</Legend>
                      <Legend tone="ghost">Periode lalu</Legend>
                    </span>
                  </div>
                </>
              ),
            })}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <Head title="Laba" to="/executive/finance" link="Kas & laba" />
          <div className="px-[1.125rem] pb-3">
            {queryState(profit, {
              loading: "Membaca buku…",
              refused: <Refused />,
              render: ({ now, before }) => {
                const rows = [
                  ["Penjualan", now.revenue_minor, before.revenue_minor],
                  [
                    "Laba kotor",
                    now.gross_profit_minor,
                    before.gross_profit_minor,
                  ],
                  [
                    "Laba usaha",
                    now.net_operating_profit_minor,
                    before.net_operating_profit_minor,
                  ],
                  [
                    "Laba bersih",
                    now.net_profit_minor,
                    before.net_profit_minor,
                  ],
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
                      Margin kotor{" "}
                      <span className="font-medium text-ink">
                        {percent(
                          ratio(now.gross_profit_minor, now.revenue_minor)
                        )}
                      </span>
                      <span className="mx-1.5 text-faint">·</span>
                      Margin bersih{" "}
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
          <Head title="Toko" to="/executive/stores" link="Semua angka toko" />
          <div className="overflow-x-auto px-[1.125rem] pb-3">
            {queryState(trade.query, {
              loading: "Membaca toko…",
              render: ({ stores, total }) =>
                stores.length === 0 ? (
                  <EmptyState>
                    Belum ada toko yang berjualan di periode ini.
                  </EmptyState>
                ) : (
                  <MiniTable
                    head={[
                      "Toko",
                      "Penjualan Bersih",
                      "Perubahan",
                      "Kontribusi",
                      "Transaksi",
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
    <span className="flex items-center gap-1.5 text-[0.875rem]">
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
      Angka buku hanya untuk supervisor ke atas.
    </p>
  )
}

import { Users, Wallet } from "lucide-react"
import { Fragment, useState } from "react"

import { Segmented } from "@/components/ui/segmented"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/states"
import { useGo } from "@/lib/go"
import {
  MAX_DAYS,
  setReportFilters,
  useReportFilters,
  useReportRows,
  type Tx,
} from "@/lib/queries/money-report"
import { cn } from "@/lib/utils"
import { MoneyScreen } from "@/screens/money/parts"
import {
  cashiersOf,
  countBy,
  dayShort,
  figuresOf,
  narrow,
  paymentsOf,
  rangeWords,
  share,
  signedMoney,
} from "@/screens/money/report-model"
import {
  Cell,
  FilterBar,
  Labelled,
  Nil,
  PickFilter,
  Red,
  ReportTable,
  type Col,
} from "@/screens/money/report-parts"
import { money } from "@itulah/contract/money"

/// Finance › Payments: what each way of paying took, in a block per day — or
/// per cashier session when asked. A block's own cells (date, cashier,
/// discount, net sales) span its payment rows.
///
/// The share is of what was sold: refunds are left out of it, so a method
/// cannot pass 100%. Discount reads "—" until the node sends it.

type By = "day" | "session"

interface Block {
  readonly key: string
  readonly day: string
  readonly cashier: string
  readonly rows: readonly Tx[]
  readonly methods: readonly {
    readonly label: string
    readonly total: number
    readonly count: number
    readonly sold: number
  }[]
  readonly sold: number
  readonly net: number
}

function blockOf(
  key: string,
  day: string,
  cashier: string,
  rows: readonly Tx[],
  only: string | null,
): Block {
  const labels = [...new Set(rows.flatMap(paymentsOf))].filter(
    (label) => only === null || label === only,
  )
  const methods = labels
    .map((label) => {
      // Only sales pay a method. A return is an exchange: its negative row is
      // not cash out, and the credit it carries is not a payment — counting
      // either here moved Rp 248.850 from Cash to "Other" on 30 Oct 2026.
      const own = rows.flatMap((row) =>
        row.kind !== "Sale"
          ? []
          : row.tenders
              .filter((tender) => !tender.credit && tender.label === label)
              .map((tender) => ({ row, tender })),
      )
      return {
        label,
        total: own.reduce((sum, one) => sum + one.tender.minor, 0),
        count: new Set(
          own
            .filter((one) => one.row.kind === "Sale")
            .map((one) => one.row.key),
        ).size,
        sold: own
          .filter((one) => one.row.kind === "Sale")
          .reduce((sum, one) => sum + one.tender.minor, 0),
      }
    })
    .sort((a, b) => b.total - a.total)
  return {
    key,
    day,
    cashier,
    rows,
    methods,
    sold: methods.reduce((sum, one) => sum + one.sold, 0),
    net: rows.reduce((sum, row) => sum + row.net, 0),
  }
}

export function Payments() {
  const go = useGo()
  const filters = useReportFilters()
  const report = useReportRows(filters.from, filters.to)
  const [by, setBy] = useState<By>("day")

  const rows = narrow(report.rows, filters.cashier, filters.payment)
  const days = [...new Set(rows.map((row) => row.day))].sort().reverse()
  const blocks: Block[] = days.flatMap((day) => {
    const ofDay = rows.filter((row) => row.day === day)
    if (by === "day")
      return [blockOf(day, day, filters.cashier ?? "", ofDay, filters.payment)]
    return [...new Set(ofDay.map((row) => row.shiftId))]
      .map((id) => {
        const mine = ofDay.filter((row) => row.shiftId === id)
        return blockOf(id, day, mine[0].cashier, mine, filters.payment)
      })
      .sort((a, b) => a.cashier.localeCompare(b.cashier))
  })

  const withCashier = by === "session" || filters.cashier !== null
  const columns: Col[] = [
    { id: "date", head: "Date" },
    ...(withCashier ? [{ id: "cashier", head: "Cashier" }] : []),
    { id: "payment", head: "Payment" },
    { id: "total", head: "Total", right: true },
    { id: "tx", head: "Transactions", right: true },
    { id: "share", head: "Share", right: true },
    { id: "disc", head: "Discount", right: true },
    { id: "net", head: "Net Sales", right: true },
  ]
  const total = figuresOf(rows)
  const foot = {
    date: (
      <Labelled label="Period">{rangeWords(filters.from, filters.to)}</Labelled>
    ),
    cashier: (
      <Labelled label="Sessions">
        {new Set(rows.map((row) => row.shiftId)).size}
      </Labelled>
    ),
    payment: (
      <Labelled label="Payments">
        {new Set(rows.flatMap(paymentsOf)).size}
      </Labelled>
    ),
    tx: (
      <Labelled label="Transactions" right>
        {total.sales}
      </Labelled>
    ),
    disc: (
      <Labelled label="Discount" right>
        {total.discount === null ? "—" : `−${money(total.discount)}`}
      </Labelled>
    ),
    net: (
      <Labelled label="Net Sales" right>
        {money(total.net)}
      </Labelled>
    ),
  }

  const open = (block: Block, label: string) => {
    setReportFilters({
      from: block.day,
      to: block.day,
      cashier: block.cashier === "" ? filters.cashier : block.cashier,
      payment: label,
    })
    go("/money/transactions")
  }

  return (
    <MoneyScreen>
      <FilterBar filters={filters}>
        <PickFilter
          value={filters.cashier}
          options={countBy(report.rows, cashiersOf)}
          placeholder="All Cashiers"
          icon={Users}
          onChange={(cashier) => setReportFilters({ cashier })}
        />
        <PickFilter
          value={filters.payment}
          options={countBy(report.rows, paymentsOf)}
          placeholder="All Payments"
          icon={Wallet}
          onChange={(payment) => setReportFilters({ payment })}
        />
        <span className="flex-1" />
        <Segmented<By>
          options={[
            { value: "day", label: "Per Day" },
            { value: "session", label: "Per Session" },
          ]}
          value={by}
          onChange={setBy}
        />
      </FilterBar>

      {report.capped && (
        <Banner tone="warn">
          Showing the last {MAX_DAYS} days of the period.
        </Banner>
      )}
      {report.blind ? (
        <Banner tone="warn">
          Hidden from cashiers. Sign in as a supervisor.
        </Banner>
      ) : report.loading ? (
        <LoadingState>Reading the payments…</LoadingState>
      ) : report.error !== null ? (
        <ErrorState error={report.error} />
      ) : blocks.length === 0 ? (
        <EmptyState art={null}>No payments in this period.</EmptyState>
      ) : (
        <ReportTable columns={columns} foot={foot} ruled>
          {blocks.map((block, index) => (
            <Fragment key={block.key}>
              {block.methods.map((method, at) => (
                <tr
                  key={method.label}
                  tabIndex={0}
                  onClick={() => open(block, method.label)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") open(block, method.label)
                  }}
                  className={cn(
                    "cursor-pointer hover:bg-soft",
                    at === 0 &&
                      index > 0 &&
                      "[&>td]:border-t [&>td]:border-t-hairline-2",
                  )}
                >
                  {at === 0 && (
                    <Cell rowSpan={block.methods.length} middle>
                      {dayShort(block.day)}
                    </Cell>
                  )}
                  {withCashier && at === 0 && (
                    <Cell rowSpan={block.methods.length} middle ruled>
                      {block.cashier}
                    </Cell>
                  )}
                  <Cell ruled>{method.label}</Cell>
                  <Cell right ruled>
                    {method.total < 0 ? (
                      <Red>{signedMoney(method.total)}</Red>
                    ) : (
                      money(method.total)
                    )}
                  </Cell>
                  <Cell right ruled>
                    {method.count}
                  </Cell>
                  <Cell right ruled>
                    {share(method.sold, block.sold)}
                  </Cell>
                  {at === 0 && (
                    <Cell rowSpan={block.methods.length} right middle ruled>
                      <Nil />
                    </Cell>
                  )}
                  {at === 0 && (
                    <Cell rowSpan={block.methods.length} right middle ruled>
                      {block.net < 0 ? (
                        <Red>{signedMoney(block.net)}</Red>
                      ) : (
                        money(block.net)
                      )}
                    </Cell>
                  )}
                </tr>
              ))}
            </Fragment>
          ))}
        </ReportTable>
      )}
    </MoneyScreen>
  )
}

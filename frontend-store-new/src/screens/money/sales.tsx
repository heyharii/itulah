import { Users } from "lucide-react"
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
  piecesWords,
  rangeWords,
} from "@/screens/money/report-model"
import {
  Cell,
  FilterBar,
  Labelled,
  Nil,
  PickFilter,
  ReportTable,
  type Col,
} from "@/screens/money/report-parts"
import { money } from "@itulah/contract/money"

/// Finance › Sales: the takings per day, or per cashier session inside each
/// day. A row opens the Transactions behind it.
///
/// Every figure is a sum of the sales the node lists per session
/// (`lib/queries/money-report.ts`). Discount is not on the node's sale, so its
/// column reads "—" until it is.

type By = "day" | "session"

interface Line {
  readonly key: string
  readonly day: string
  readonly cashier: string
  readonly rows: readonly Tx[]
}

const nil = (minor: number, text = money(minor)) =>
  minor === 0 ? <Nil /> : text

export function Sales() {
  const go = useGo()
  const filters = useReportFilters()
  const report = useReportRows(filters.from, filters.to)
  const [by, setBy] = useState<By>("day")

  const rows = narrow(report.rows, filters.cashier, null)
  const days = [...new Set(rows.map((row) => row.day))].sort().reverse()
  const lines: Line[] = days.flatMap((day) => {
    const ofDay = rows.filter((row) => row.day === day)
    if (by === "day") return [{ key: day, day, cashier: "", rows: ofDay }]
    const shifts = [...new Set(ofDay.map((row) => row.shiftId))]
    return shifts
      .map((id) => {
        const mine = ofDay.filter((row) => row.shiftId === id)
        return { key: id, day, cashier: mine[0].cashier, rows: mine }
      })
      .sort((a, b) => a.cashier.localeCompare(b.cashier))
  })

  const open = (line: Line) => {
    setReportFilters({
      from: line.day,
      to: line.day,
      cashier: by === "session" ? line.cashier : filters.cashier,
    })
    go("/money/transactions")
  }

  const columns: Col[] = [
    { id: "date", head: "Date" },
    ...(by === "session" ? [{ id: "cashier", head: "Cashier" }] : []),
    { id: "tx", head: "Transactions", right: true },
    { id: "pcs", head: "Pieces", right: true },
    { id: "ret", head: "Returns", right: true },
    { id: "disc", head: "Discount", right: true },
    { id: "cash", head: "Cash", right: true },
    { id: "edc", head: "EDC", right: true },
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
    tx: (
      <Labelled label="Transactions" right>
        {total.sales}
      </Labelled>
    ),
    pcs: (
      <Labelled label="Pieces" right>
        {piecesWords(total.pieces)}
      </Labelled>
    ),
    ret: (
      <Labelled label="Returns" right>
        {total.returns === 0 ? "—" : total.returns}
      </Labelled>
    ),
    disc: (
      <Labelled label="Discount" right>
        {total.discount === null ? "—" : `−${money(total.discount)}`}
      </Labelled>
    ),
    cash: (
      <Labelled label="Cash" right>
        {money(total.cash)}
      </Labelled>
    ),
    edc: (
      <Labelled label="EDC" right>
        {money(total.edc)}
      </Labelled>
    ),
    net: (
      <Labelled label="Net Sales" right>
        {money(total.net)}
      </Labelled>
    ),
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
        <LoadingState>Reading the sales…</LoadingState>
      ) : report.error !== null ? (
        <ErrorState error={report.error} />
      ) : lines.length === 0 ? (
        <EmptyState art={null}>No sales in this period.</EmptyState>
      ) : (
        <ReportTable columns={columns} foot={foot}>
          {lines.map((line, index) => {
            const f = figuresOf(line.rows)
            const sessions = lines.filter((one) => one.day === line.day)
            const firstOfDay = sessions[0].key === line.key
            return (
              <Fragment key={line.key}>
                <tr
                  tabIndex={0}
                  onClick={() => open(line)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") open(line)
                  }}
                  className={cn(
                    "cursor-pointer hover:bg-soft",
                    by === "session" &&
                      firstOfDay &&
                      index > 0 &&
                      "[&>td]:border-t [&>td]:border-t-hairline-2",
                  )}
                >
                  {(by === "day" || firstOfDay) && (
                    <Cell
                      rowSpan={by === "session" ? sessions.length : undefined}
                      middle
                    >
                      {dayShort(line.day)}
                    </Cell>
                  )}
                  {by === "session" && <Cell>{line.cashier}</Cell>}
                  <Cell right>{f.sales}</Cell>
                  <Cell right>{nil(f.pieces, piecesWords(f.pieces))}</Cell>
                  <Cell right>
                    {f.returns === 0 ? <Nil /> : f.returns}
                  </Cell>
                  <Cell right>
                    {f.discount === null || f.discount === 0 ? (
                      <Nil />
                    ) : (
                      `−${money(f.discount)}`
                    )}
                  </Cell>
                  <Cell right>{nil(f.cash)}</Cell>
                  <Cell right>{nil(f.edc)}</Cell>
                  <Cell right>{nil(f.net)}</Cell>
                </tr>
              </Fragment>
            )
          })}
        </ReportTable>
      )}
    </MoneyScreen>
  )
}

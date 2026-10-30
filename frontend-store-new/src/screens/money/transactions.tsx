import { Search, Users, Wallet } from "lucide-react"
import { useState } from "react"

import { PeopleTabs } from "@/components/ui/people-tabs"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/states"
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
  figuresOf,
  narrow,
  paymentsOf,
  piecesWords,
  rangeWords,
  signedMoney,
  stampWords,
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
import { ReceiptSheet } from "@/screens/money/sales-session"
import { money } from "@itulah/contract/money"

/// Finance › Transactions: every sale and return of the period, one line each.
///
/// A return is a line of its own on the code of the sale it was made against
/// (the node keeps the refund on that sale — see `money-report.ts`). No Voids
/// tab: a voided sale never counted. Discount reads "—" until the node sends
/// it.

type Kind = "all" | "Sale" | "Return"

export function Transactions() {
  const filters = useReportFilters()
  const report = useReportRows(filters.from, filters.to)
  const [kind, setKind] = useState<Kind>("all")
  const [code, setCode] = useState("")
  const [opened, setOpened] = useState<Tx | null>(null)

  // The tabs count what the bar leaves; the bar's pickers list what the
  // period holds.
  const inBar = narrow(report.rows, filters.cashier, filters.payment).filter(
    (row) => row.code.toLowerCase().includes(code.trim().toLowerCase()),
  )
  const rows = inBar.filter((row) => kind === "all" || row.kind === kind)
  const count = (of: Kind) =>
    inBar.filter((row) => of === "all" || row.kind === of).length

  const columns: Col[] = [
    { id: "date", head: "Date" },
    { id: "code", head: "Transaction Code" },
    ...(filters.cashier === null ? [{ id: "cashier", head: "Cashier" }] : []),
    ...(filters.payment === null ? [{ id: "payment", head: "Payment" }] : []),
    { id: "pcs", head: "Pieces", right: true },
    { id: "disc", head: "Discount", right: true },
    { id: "net", head: "Net Sales", right: true },
  ]
  const total = figuresOf(rows)
  const foot = {
    date: (
      <Labelled label="Period">{rangeWords(filters.from, filters.to)}</Labelled>
    ),
    code: (
      <Labelled label="Transactions">
        {rows.length.toLocaleString("id-ID")}
      </Labelled>
    ),
    pcs: (
      <Labelled label="Pieces" right>
        {piecesWords(total.pieces)}
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

  return (
    <MoneyScreen>
      <PeopleTabs<Kind>
        title="Show"
        plainCount
        zeros
        tabs={[
          { value: "all", label: "All", count: count("all") },
          { value: "Sale", label: "Sales", count: count("Sale") },
          { value: "Return", label: "Returns", count: count("Return") },
        ]}
        value={kind}
        onChange={setKind}
      />
      <FilterBar filters={filters}>
        <label className="flex h-10 w-[14rem] items-center gap-2 rounded-inner border border-hairline-2 bg-canvas px-3 text-[0.9375rem] focus-within:border-accent">
          <Search className="size-4 shrink-0 text-body" />
          <input
            aria-label="Transaction Code"
            placeholder="Transaction Code"
            autoComplete="off"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-mute"
          />
        </label>
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
        <LoadingState>Reading the transactions…</LoadingState>
      ) : report.error !== null ? (
        <ErrorState error={report.error} />
      ) : rows.length === 0 ? (
        <EmptyState art={null}>No transactions match.</EmptyState>
      ) : (
        <ReportTable columns={columns} foot={foot} sticky>
          {rows.map((row) => (
            <tr
              key={row.key}
              tabIndex={0}
              onClick={() => setOpened(row)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setOpened(row)
              }}
              className="cursor-pointer hover:bg-soft"
            >
              <Cell>{stampWords(row.at)}</Cell>
              <Cell>
                <span className="inline-flex items-center gap-2">
                  {row.code}
                  {row.kind === "Return" && (
                    <span className="rounded-md bg-warn-bg px-1.5 text-[0.9375rem] leading-6 text-warn-fg">
                      Return
                    </span>
                  )}
                </span>
              </Cell>
              {filters.cashier === null && <Cell>{row.cashier}</Cell>}
              {filters.payment === null && <Cell>{row.payment}</Cell>}
              <Cell right>
                {row.pieces === 0 ? <Nil /> : piecesWords(row.pieces)}
              </Cell>
              <Cell right>
                {row.discount === null || row.discount === 0 ? (
                  <Nil />
                ) : (
                  `−${money(row.discount)}`
                )}
              </Cell>
              <Cell right className={cn(row.net < 0 && "text-bad-fg")}>
                {row.net < 0 ? (
                  <Red>{signedMoney(row.net)}</Red>
                ) : (
                  money(row.net)
                )}
              </Cell>
            </tr>
          ))}
        </ReportTable>
      )}

      <ReceiptSheet
        saleId={opened?.saleId ?? null}
        receiptNo={opened?.receiptNo ?? null}
        open={opened !== null}
        onClose={() => setOpened(null)}
      />
    </MoneyScreen>
  )
}

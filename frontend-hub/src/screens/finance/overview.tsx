import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  Archive,
  CalendarClock,
  GitBranch,
  Receipt,
  Scale,
  Wallet,
} from "lucide-react"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { ExceptionQueue, type Exception } from "@/components/ui/exception-queue"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { KeyValue } from "@/components/ui/rows"
import { PageHeader } from "@/components/ui/page-header"
import { count, day, money } from "@/lib/format"
import {
  accountMap,
  balanceMatrix,
  financeKeys,
  listAssets,
  listBankStatements,
  listBills,
  listPeriods,
  trialBalance,
  unbilledReceipts,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { accountMapGaps } from "@/screens/finance/badges"
import { monthLabel } from "@/screens/finance/chart"

/// What finance has to deal with, led by what is stopping it.
///
/// DESIGN.md is blunt that an overview opens with a queue of problems carrying
/// a severity, an amount and one action — not with vanity tiles. A board of
/// green numbers tells somebody their day is fine; this tells them what their
/// day is. The strip underneath carries the four figures that are worth
/// knowing whether or not anything is wrong.
///
/// Every read here is the same key the screen it links to uses, so opening this
/// page warms those screens and closing it costs nothing.
export function FinanceOverview() {
  const navigate = useNavigate()

  const periods = useQuery({
    queryKey: financeKeys.periods(),
    queryFn: ({ signal }) => listPeriods(signal),
  })
  const map = useQuery({
    queryKey: financeKeys.accountMap(null),
    queryFn: ({ signal }) => accountMap(undefined, signal),
  })
  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal),
  })
  const balance = useQuery({
    queryKey: financeKeys.trialBalance(null, null),
    queryFn: ({ signal }) => trialBalance({}, signal),
  })
  const unbilled = useQuery({
    queryKey: financeKeys.unbilled(),
    queryFn: ({ signal }) => unbilledReceipts(signal),
  })
  const unassessed = useQuery({
    queryKey: financeKeys.assets(true),
    queryFn: ({ signal }) => listAssets({ unassessed: true }, signal),
  })
  const statements = useQuery({
    queryKey: financeKeys.bankStatements(),
    queryFn: ({ signal }) => listBankStatements(signal),
  })
  const cash = useQuery({
    queryKey: financeKeys.balances("10110", null),
    queryFn: ({ signal }) => balanceMatrix("10110", undefined, signal),
  })

  /// Eight reads, one loading sentence and one error sentence.
  ///
  /// `queryState` takes the shape rather than a Query, which is what lets a
  /// board built out of several reads still use the app's single set of
  /// states. Gating each tile on its own read would put eight spinners on one
  /// page; showing the board while half of it is missing would report "nothing
  /// overdue" about a list that had not arrived.
  const board = {
    isPending:
      periods.isPending ||
      map.isPending ||
      bills.isPending ||
      balance.isPending ||
      unbilled.isPending ||
      unassessed.isPending ||
      statements.isPending ||
      cash.isPending,
    isError:
      periods.isError ||
      map.isError ||
      bills.isError ||
      balance.isError ||
      unbilled.isError ||
      unassessed.isError ||
      statements.isError ||
      cash.isError,
    error:
      periods.error ??
      map.error ??
      bills.error ??
      balance.error ??
      unbilled.error ??
      unassessed.error ??
      statements.error ??
      cash.error,
    data: true as const,
    refetch: () => {
      void periods.refetch()
      void map.refetch()
      void bills.refetch()
      void balance.refetch()
      void unbilled.refetch()
      void unassessed.refetch()
      void statements.refetch()
      void cash.refetch()
    },
  }

  const now = new Date()
  const thisYear = now.getFullYear()
  const thisMonth = now.getMonth() + 1

  const go = (to: string) => () => navigate({ to } as never)

  const exceptions = useMemo<Exception[]>(() => {
    const found: Exception[] = []

    if (balance.data && !balance.data.balanced) {
      found.push({
        id: "unbalanced",
        title: "The books do not balance",
        detail:
          "Every entry is checked at COMMIT, so something got past the database.",
        amount: money(
          balance.data.total_debit_minor - balance.data.total_credit_minor
        ),
        severity: "high",
        icon: <Scale className="size-4" />,
        onOpen: go("/finance/ledger"),
      })
    }

    if (map.data) {
      // One derivation, in `badges.ts`, shared with the Account map screen and
      // with the sidebar badge — so the three of them cannot report different
      // numbers for the same gap.
      const gaps = accountMapGaps(map.data).pairs
      if (gaps > 0) {
        found.push({
          id: "unmapped",
          title: "Meanings with no account",
          detail:
            "Every posting that needs one of these is refused, and the refusal names the key.",
          amount: count(gaps),
          severity: "high",
          icon: <GitBranch className="size-4" />,
          onOpen: go("/finance/account-map"),
        })
      }
    }

    if (periods.data) {
      const current = periods.data.find(
        (row) => row.year === thisYear && row.month === thisMonth
      )
      if (current === undefined) {
        found.push({
          id: "month-shut",
          title: `${monthLabel(thisYear, thisMonth)} has not been opened`,
          detail: "Nothing can be posted into a month that does not exist yet.",
          severity: "high",
          icon: <CalendarClock className="size-4" />,
          onOpen: go("/finance/periods"),
        })
      }
      const stale = periods.data.filter(
        (row) =>
          row.status.toUpperCase() === "OPEN" &&
          row.entry_count > 0 &&
          row.year * 12 + row.month < thisYear * 12 + thisMonth
      )
      if (stale.length > 0) {
        const entries = stale.reduce((sum, row) => sum + row.entry_count, 0)
        found.push({
          id: "months-open",
          title:
            stale.length === 1
              ? `${monthLabel(stale[0].year, stale[0].month)} is still open`
              : `${count(stale.length)} past months are still open`,
          detail: "Worked months that nobody has sealed.",
          // Every other row in this queue carries one unit, and its title says
          // which. This one counts months in the title and postings here, so
          // the bare "64" beside "3 past months are still open" was a figure in
          // no stated unit at all — a fourth month, a rupiah amount, or
          // nothing. `amount` takes a node, so the unit goes in it.
          amount: (
            <>
              {count(entries)}{" "}
              <span className="font-normal text-mute">
                {entries === 1 ? "entry" : "entries"}
              </span>
            </>
          ),
          severity: "medium",
          icon: <CalendarClock className="size-4" />,
          onOpen: go("/finance/periods"),
        })
      }
    }

    if (bills.data) {
      const late = bills.data.filter(
        (bill) =>
          bill.status.toUpperCase() !== "POSTED" && bill.days_overdue > 0
      )
      if (late.length > 0) {
        found.push({
          id: "overdue",
          title: `${count(late.length)} bills are past due`,
          detail: "Recorded, not posted, and the due date has gone.",
          amount: money(late.reduce((sum, bill) => sum + bill.total_minor, 0)),
          severity: "high",
          icon: <Receipt className="size-4" />,
          onOpen: go("/finance/bills"),
        })
      }
    }

    if (unbilled.data && unbilled.data.length > 0) {
      found.push({
        id: "unbilled",
        title: `${count(unbilled.data.length)} deliveries with no bill`,
        detail:
          "There is no goods-received-not-invoiced account, so none of it is in the books.",
        amount: money(
          unbilled.data.reduce(
            (sum, row) => sum + row.value_at_order_price_minor,
            0
          )
        ),
        severity: "medium",
        icon: <Receipt className="size-4" />,
        onOpen: go("/finance/bills"),
      })
    }

    if (statements.data) {
      const open = statements.data.reduce(
        (sum, row) => sum + (row.line_count - row.matched_count),
        0
      )
      if (open > 0) {
        found.push({
          id: "unreconciled",
          title: "Bank lines nobody has agreed",
          detail:
            "Either still in transit, or never booked. The two have different answers.",
          amount: count(open),
          severity: "medium",
          icon: <Wallet className="size-4" />,
          onOpen: go("/finance/bank"),
        })
      }
    }

    if (unassessed.data && unassessed.data.length > 0) {
      found.push({
        id: "unassessed",
        title: `${count(unassessed.data.length)} assets have never been assessed`,
        detail:
          "An open control gap: nobody has decided whether to capitalise or expense them.",
        severity: "low",
        icon: <Archive className="size-4" />,
        onOpen: go("/finance/assets"),
      })
    }

    return found
    // `go` is rebuilt every render and is not worth memoising; the reads are
    // what this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    balance.data,
    map.data,
    periods.data,
    bills.data,
    unbilled.data,
    statements.data,
    unassessed.data,
    thisYear,
    thisMonth,
  ])

  const overdue = (bills.data ?? []).filter(
    (bill) => bill.status.toUpperCase() !== "POSTED" && bill.days_overdue > 0
  )
  const exposure = (unbilled.data ?? []).reduce(
    (sum, row) => sum + row.value_at_order_price_minor,
    0
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Overview"
        sub="What is stopping the books, and what they are holding."
      />

      {queryState(board, {
        loading: "Reading the books…",
        render: () => (
          <>
            <ExceptionQueue
              exceptions={exceptions}
              empty="Nothing is blocking a posting: the books balance, every meaning has an account, the month is open and no bill is past due."
            />

            <KpiStrip className="md:grid-cols-2 xl:grid-cols-4">
              <Kpi
                label="Cash & equivalents"
                value={money(cash.data?.grand_total_minor ?? 0)}
                delta={cash.data ? `as at ${day(cash.data.as_of)}` : undefined}
              />
              <Kpi
                label="Bills past due"
                value={money(
                  overdue.reduce((sum, bill) => sum + bill.total_minor, 0)
                )}
                delta={`${count(overdue.length)} invoices`}
                tone={overdue.length > 0 ? "down" : "flat"}
              />
              <Kpi
                label="Unbilled deliveries"
                value={money(exposure)}
                delta="not in the books"
                tone={exposure > 0 ? "down" : "flat"}
              />
              <Kpi
                label="Accounts posted to"
                value={count(balance.data?.rows.length ?? 0)}
                delta={balance.data?.balanced ? "balanced" : "out of balance"}
                tone={balance.data?.balanced ? "up" : "down"}
              />
            </KpiStrip>

            <Card>
              <CardHeader>
                <CardTitle>Where the books stand</CardTitle>
              </CardHeader>
              <div className="px-4 pb-4">
                <KeyValue term="Total debits">
                  {money(balance.data?.total_debit_minor)}
                </KeyValue>
                <KeyValue term="Total credits">
                  {money(balance.data?.total_credit_minor)}
                </KeyValue>
                <KeyValue term="Months opened">
                  {count(periods.data?.length ?? 0)}
                </KeyValue>
                <KeyValue term="Bank statements imported">
                  {count(statements.data?.length ?? 0)}
                </KeyValue>
                <KeyValue term="Locations the books are kept for">
                  {count(map.data?.locations.length ?? 0)}
                </KeyValue>
              </div>
            </Card>
          </>
        ),
      })}
    </PageContent>
  )
}

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
import { ExceptionQueue, type Exception } from "@/components/ui/exception-queue"
import { PageHeader } from "@/components/ui/page-header"
import { count, money } from "@/lib/format"
import {
  acquisitionGap,
  financeKeys,
  listAssets,
  listBankStatements,
  listBills,
  listPeriods,
  trialBalance,
  unbilledReceipts,
} from "@/lib/queries/finance"
import { usePostingReadiness } from "@/screens/finance/badges"
import { monthLabel } from "@/screens/finance/chart"
import {
  ChartCard,
  ChartState,
  LinkCards,
  NumberCards,
  ProfitAndLossChart,
  WorkspaceHeading,
  useLastMonths,
  useMonthlyPnl,
  useNumberCards,
  type LinkCardSpec,
} from "@/screens/finance/workspace"

/// Finance's Home: ERPNext's Accounting workspace (Invoicing on version 16,
/// `accounts/workspace/invoicing`), in its order — the Profit and Loss chart
/// across the top, the number cards, then "Reports & Masters", cards of links
/// to the masters and tools.
///
/// Above them, only when there is something, what is stopping the books.
/// ERPNext puts its onboarding there; ours is the list of gaps that refuse a
/// posting, and a stoppage nobody sees until the till refuses a sale is the
/// one thing this page exists to prevent.
///
/// Every read is under the key the screen it links to uses, so opening Home
/// warms those screens.
export function FinanceOverview() {
  const navigate = useNavigate()
  const months = useLastMonths(12)
  const pnl = useMonthlyPnl(months)
  const cards = useNumberCards()

  const periods = useQuery({
    queryKey: financeKeys.periods(),
    queryFn: ({ signal }) => listPeriods(signal).then((page) => page.rows),
  })
  const readiness = usePostingReadiness()
  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal).then((page) => page.rows),
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
    queryKey: financeKeys.assets(true, null),
    queryFn: ({ signal }) =>
      listAssets({ unassessed: true }, signal).then((page) => page.rows),
  })
  // The cache holds the whole page under this key — Bank Reconciliation's
  // badge, Deposits and Card & EDC Settlement read it that way — so the rows
  // are selected here rather than stored. Storing the array crashed whichever
  // reader arrived second.
  const statements = useQuery({
    queryKey: financeKeys.bankStatements(),
    queryFn: ({ signal }) => listBankStatements(signal),
    select: (page) => page.rows,
  })
  /// Assets the books never bought.
  ///
  /// `fixed_asset` has no acquisition posting rule and never will — an asset is
  /// bought by a supplier bill — so a capitalised asset with no bill line
  /// behind it is a cost that is being depreciated out of a balance nothing
  /// ever put in. It is the one exception on this board that no other screen
  /// can derive, which is why it is worth a tenth read.
  ///
  /// `retry: false`: a node that does not serve this read yet answers 404, and
  /// an absent answer simply adds no row.
  const unbacked = useQuery({
    queryKey: financeKeys.acquisitionGap(),
    queryFn: ({ signal }) => acquisitionGap(signal),
    retry: false,
  })

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
        onOpen: go("/finance/accounting/general-ledger"),
      })
    }

    if (readiness.data) {
      // The server's count, under the key the sidebar badge and the Posting
      // readiness screen read — so the three of them cannot report different
      // numbers for the same gap.
      const gaps = readiness.data.gaps
      if (gaps > 0) {
        found.push({
          id: "unmapped",
          title: "Roles with no account",
          detail:
            "A role, at a site, that no account link reaches. Every posting that needs one is refused, and the refusal names the role.",
          amount: count(gaps),
          severity: "high",
          icon: <GitBranch className="size-4" />,
          onOpen: go("/finance/setup/posting-readiness"),
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
          onOpen: go("/finance/setup/periods"),
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
          onOpen: go("/finance/setup/periods"),
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
          onOpen: go("/finance/payables/bills"),
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
        onOpen: go("/finance/payables/bills"),
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
          onOpen: go("/finance/cash-bank/bank-reconciliation"),
        })
      }
    }

    if (unbacked.data && unbacked.data.assets_without_a_line.length > 0) {
      found.push({
        id: "unbacked",
        title: `${count(unbacked.data.assets_without_a_line.length)} capitalised assets the books never bought`,
        detail:
          "An asset is bought by a supplier bill. These have no bill line behind them, so a cost is being depreciated out of a balance nothing put in.",
        amount: money(unbacked.data.assets_total_minor),
        severity: "medium",
        icon: <Archive className="size-4" />,
        onOpen: go("/finance/assets/capitalization"),
      })
    }

    if (unassessed.data && unassessed.data.length > 0) {
      found.push({
        id: "unassessed",
        title: `${count(unassessed.data.length)} assets have never been assessed`,
        detail:
          "An open control gap: nobody has decided whether to capitalise or expense them.",
        severity: "low",
        icon: <Archive className="size-4" />,
        onOpen: go("/finance/assets/capitalization"),
      })
    }

    return found
    // `go` is rebuilt every render and is not worth memoising; the reads are
    // what this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    balance.data,
    readiness.data,
    periods.data,
    bills.data,
    unbilled.data,
    statements.data,
    unassessed.data,
    unbacked.data,
    thisYear,
    thisMonth,
  ])

  return (
    <PageContent>
      <PageHeader title="Finance" />

      {exceptions.length > 0 && <ExceptionQueue exceptions={exceptions} />}

      <ChartCard title="Profit and Loss" meta="Last 12 months · Monthly">
        <ChartState pending={pnl.pending} failed={pnl.failed}>
          <ProfitAndLossChart rows={pnl.rows} />
        </ChartState>
      </ChartCard>

      <NumberCards cards={cards} />

      <WorkspaceHeading>Reports &amp; Masters</WorkspaceHeading>
      <LinkCards cards={REPORTS_AND_MASTERS} />
    </PageContent>
  )
}

/// ERPNext's link cards, one per group of the Finance menu, in the menu's
/// order and with its rows — so Home is the menu laid out flat, and a link
/// here and a row there never disagree.
const REPORTS_AND_MASTERS: readonly LinkCardSpec[] = [
  {
    title: "Payables",
    links: [
      { label: "Purchase Invoice", to: "/finance/payables/bills" },
      { label: "Accounts Payable", to: "/finance/payables/aging" },
      {
        label: "Accounts Payable Summary",
        to: "/finance/reports/accounts-payable-summary",
      },
    ],
  },
  {
    title: "Payments",
    links: [
      { label: "Payment Entry", to: "/finance/payables/payments" },
      { label: "Journal Entry", to: "/finance/accounting/journal-entries" },
      { label: "BKK", to: "/finance/cash-bank/bkk" },
      { label: "BKM", to: "/finance/cash-bank/bkm" },
      {
        label: "Journal Entry Template",
        to: "/finance/setup/journal-templates",
      },
      { label: "Mode of Payment", to: "/finance/setup/payment-methods" },
    ],
  },
  {
    title: "Banking",
    links: [
      { label: "Bank Account", to: "/finance/cash-bank/bank-accounts" },
      { label: "Giro Board", to: "/finance/cash-bank/giro" },
      { label: "Bank Clearance", to: "/finance/cash-bank/bank-clearance" },
      {
        label: "Bank Transactions",
        to: "/finance/cash-bank/bank-transactions",
      },
      {
        label: "Bank Reconciliation",
        to: "/finance/cash-bank/bank-reconciliation",
      },
    ],
  },
  {
    title: "Financial Reports",
    links: [
      { label: "General Ledger", to: "/finance/accounting/general-ledger" },
      { label: "Trial Balance", to: "/finance/accounting/trial-balance" },
      {
        label: "Profit and Loss Statement",
        to: "/finance/reports/profit-and-loss",
      },
      { label: "Balance Sheet", to: "/finance/reports/balance-sheet" },
      { label: "Cash Flow", to: "/finance/reports/cash-flow" },
    ],
  },
  {
    title: "Assets",
    links: [
      { label: "Asset", to: "/finance/assets/capitalization" },
      { label: "Asset Category", to: "/finance/setup/asset-classes" },
    ],
  },
  {
    title: "Tax Masters",
    links: [
      {
        label: "Tax Withholding Category",
        to: "/finance/tax-setup/withholding",
      },
    ],
  },
  {
    title: "Accounting Masters",
    links: [
      {
        label: "Chart of Accounts",
        to: "/finance/accounting/chart-of-accounts",
      },
      { label: "Accounts Settings", to: "/finance/settings/accounts" },
      { label: "Accounting Period", to: "/finance/setup/periods" },
    ],
  },
]

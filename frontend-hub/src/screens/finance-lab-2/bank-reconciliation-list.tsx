import { useSuspenseQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { ChevronLeft } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import {
  bankStatementsQuery,
  companyBankAccountsQuery,
  moneyOverviewQuery,
} from "@/lib/queries/finance"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { BankReconciliation as ReconcileTool } from "@/screens/finance-lab-2/bank-reconciliation"
import { PairedReconciliation } from "@/screens/finance-lab-2/bank-reconciliation-paired"
import { BANK_POTS } from "@/screens/finance-lab-2/hooks"
import { useUnitName } from "@/screens/finance/hooks"
import { ScreenPending } from "@/screens/finance/pending"

/// Reconciliation, as a list of accounts before it is a table of lines.
///
/// # Why a list first
///
/// The screen used to open straight into the matcher for whichever statement
/// happened to be first, which answers a question nobody asked: reconciliation
/// is a job with a shape — which accounts are done, which are not, and how far
/// from done the rest are — and that shape is not visible from inside one
/// account's lines. So the route lands on the accounts, and the matcher is
/// what a row opens.
///
/// The row a person opens now lands on `bank-reconciliation-paired`'s
/// "Sejajar otomatis" view (owner, 2026-09-29: "bank rekon kita seperti ini
/// kali ya … yg sejajar otomatis") rather than straight into the full
/// matcher — which is still `bank-reconciliation` and is one press away
/// ("Open the full matcher") for whatever the paired view cannot auto-pair.
///
/// Which statement is open lives in the URL under the `statement` sheet key
/// (`lib/sheets.ts`), the same one `bank-transactions` links into from a
/// line's own detail — so a link carrying `?statement=…` opens straight to
/// this account's reconciliation from either screen.
/// One bank account, folded across every statement that has arrived for it.
interface AccountRow {
  readonly key: string
  readonly unit_id: string
  readonly account_code: string
  readonly account_name: string
  readonly bank: string | null
  readonly statements: number
  readonly lines: number
  readonly reconciled: number
  readonly latest: string
  readonly closing: number
  readonly statementId: string
}

export function BankReconciliationList() {
  const statementSheet = useSheet("statement")
  const open = statementSheet.value ?? null
  const [full, setFull] = useState(false)

  // The matcher, for the account somebody pressed Reconcile on. Its own way
  // back sits above it rather than inside it: the matcher was written as a
  // whole screen and does not know it is being shown from a list.
  if (open !== null) {
    return (
      <>
        <div className="flex items-center justify-between px-5 pt-4">
          <Button
            variant="ghost"
            onClick={() => {
              statementSheet.close()
              setFull(false)
            }}
          >
            <ChevronLeft className="size-4" />
            All accounts
          </Button>
          {!full && (
            <Button variant="ghost" size="sm" onClick={() => setFull(true)}>
              Open the full matcher
            </Button>
          )}
        </div>
        {full ? (
          <ReconcileTool statementId={open} />
        ) : (
          <PairedReconciliation
            statementId={open}
            onOpenFullMatcher={() => setFull(true)}
          />
        )}
      </>
    )
  }

  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Banking" title="Bank Reconciliation">
          Reading what has arrived…
        </ScreenPending>
      }
    >
      <ReconciliationAccounts />
    </Suspense>
  )
}

/// The list of accounts the route lands on: the statements that have arrived,
/// folded to one row per account, beside what the books hold for each.
function ReconciliationAccounts() {
  const statementSheet = useSheet("statement")
  const statements = useSuspenseQuery(bankStatementsQuery())
  const overview = useSuspenseQuery(moneyOverviewQuery())
  const unitName = useUnitName()
  const [account, setAccount] = useState("")
  const [month, setMonth] = useState("")
  const [year, setYear] = useState("")

  const described = useSuspenseQuery(companyBankAccountsQuery())

  const rows = statements.data.rows

  /// Which bank a unit's money is at, and only where the answer is not in
  /// doubt — the same rule Bank Transactions follows, for the same reason: a
  /// statement does not carry its bank account id on the wire, so a unit with
  /// two institutions cannot be named without guessing.
  const bankOfUnit = useMemo(() => {
    const seen = new Map<string, string | null>()
    for (const one of described.data) {
      if (one.status === "CLOSED") continue
      const had = seen.get(one.unit_id)
      if (had === undefined) seen.set(one.unit_id, one.bank_name)
      else if (had !== one.bank_name) seen.set(one.unit_id, null)
    }
    return seen
  }, [described.data])

  /// What the books hold, per bank account.
  const books = useMemo(() => {
    const table = new Map<string, number>()
    for (const row of overview.data.rows) {
      if (!BANK_POTS.includes(row.pot)) continue
      table.set(`${row.account_code}@${row.unit_id}`, row.per_books_minor)
    }
    return table
  }, [overview.data])

  const years = useMemo(
    () =>
      [...new Set(rows.map((row) => row.period_start.slice(0, 4)))].sort(
        (a, b) => b.localeCompare(a)
      ),
    [rows]
  )

  /// One row per ACCOUNT, not per statement.
  ///
  /// A statement is a month of one account; the question "is this account
  /// reconciled" spans every month that has arrived. So the statements are
  /// folded together — the counts add up, and the balances come from the most
  /// recent period, because a closing balance is a point in time and adding
  /// two of them means nothing.
  const accounts = useMemo(() => {
    const table = new Map<
      string,
      {
        key: string
        unit_id: string
        account_code: string
        account_name: string
        bank: string | null
        statements: number
        lines: number
        reconciled: number
        latest: string
        closing: number
        statementId: string
      }
    >()
    for (const row of rows) {
      if (month !== "" && row.period_start.slice(5, 7) !== month) continue
      if (year !== "" && row.period_start.slice(0, 4) !== year) continue
      const key = `${row.account_code}@${row.unit_id}`
      if (account !== "" && row.unit_id !== account) continue
      const had = table.get(key)
      if (had === undefined) {
        table.set(key, {
          key,
          unit_id: row.unit_id,
          account_code: row.account_code,
          account_name: row.account_name,
          bank: bankOfUnit.get(row.unit_id) ?? null,
          statements: 1,
          lines: row.line_count,
          reconciled: row.matched_count,
          latest: row.period_end,
          closing: row.closing_minor,
          statementId: row.statement_id,
        })
        continue
      }
      had.statements += 1
      had.lines += row.line_count
      had.reconciled += row.matched_count
      // The newest period wins the balance, and the row it opens.
      if (row.period_end > had.latest) {
        had.latest = row.period_end
        had.closing = row.closing_minor
        had.statementId = row.statement_id
      }
    }
    return [...table.values()].sort(
      (a, b) =>
        (a.bank ?? "").localeCompare(b.bank ?? "") ||
        unitName(a.unit_id).localeCompare(unitName(b.unit_id))
    )
  }, [rows, bankOfUnit, unitName, account, month, year])

  const narrowed = account !== "" || month !== "" || year !== ""

  /// The accounts as a table; on a card the account names it and the four
  /// figures that decide follow. A row opens the account's reconciliation.
  const columns = useMemo<ColumnDef<TableSetup, AccountRow>[]>(
    () => [
      {
        id: "account",
        accessorFn: (row) =>
          `${row.bank ?? row.account_name} · ${unitName(row.unit_id)}`,
        header: "Account",
        size: 280,
        enableSorting: false,
        meta: { card: "title", grow: 240 },
        cell: ({ row }) => (
          <span className="text-ink">
            {row.original.bank ?? row.original.account_name} ·{" "}
            {unitName(row.original.unit_id)}
          </span>
        ),
      },
      {
        id: "lines",
        accessorFn: (row) => row.lines,
        header: "Transactions",
        size: 130,
        enableSorting: false,
        meta: { align: "right", card: "hide", priority: 3 },
        cell: ({ row }) => count(row.original.lines),
      },
      {
        id: "reconciled",
        accessorFn: (row) => row.reconciled,
        header: "Reconciled",
        size: 120,
        enableSorting: false,
        meta: { align: "right", card: "hide", priority: 2 },
        cell: ({ row }) => (
          <span className={row.original.reconciled === 0 ? "text-mute" : ""}>
            {count(row.original.reconciled)}
          </span>
        ),
      },
      {
        id: "pending",
        accessorFn: (row) => row.lines - row.reconciled,
        header: "Pending",
        size: 100,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => {
          const pending = row.original.lines - row.original.reconciled
          return pending === 0 ? (
            <span className="text-mute">0</span>
          ) : (
            <span className="font-medium text-warn-fg">{count(pending)}</span>
          )
        },
      },
      {
        id: "bank",
        accessorFn: (row) => row.closing,
        header: "Bank",
        size: 150,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => money(row.original.closing),
      },
      {
        id: "books",
        accessorFn: (row) => books.get(row.key) ?? 0,
        header: "Books",
        size: 150,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => money(books.get(row.original.key) ?? 0),
      },
      {
        id: "difference",
        accessorFn: (row) => (books.get(row.key) ?? 0) - row.closing,
        header: "Difference",
        size: 150,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => {
          const difference =
            (books.get(row.original.key) ?? 0) - row.original.closing
          return difference === 0 ? (
            <span className="text-mute">0</span>
          ) : (
            <span className="font-medium text-bad-fg">{money(difference)}</span>
          )
        },
      },
      {
        id: "reconcile",
        accessorFn: (row) => row.statementId,
        header: "",
        size: 120,
        enableSorting: false,
        enableHiding: false,
        meta: { align: "right", card: "hide" },
        cell: ({ row }) => (
          <Button
            size="sm"
            variant={
              row.original.lines - row.original.reconciled === 0
                ? "ghost"
                : "primary"
            }
            onClick={(event) => {
              event.stopPropagation()
              statementSheet.open(row.original.statementId)
            }}
          >
            Reconcile
          </Button>
        ),
      },
    ],
    [books, unitName, statementSheet]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: accounts,
        columns,
        getRowId: (row: AccountRow) => row.key,
      }),
      [accounts, columns]
    )
  )

  return (
    <PageContent>
      <PageHeader crumb="Finance · Banking" title="Bank Reconciliation" />

      <div className="flex flex-col gap-4">
        <Toolbar>
          <Select
            aria-label="Bank account"
            value={account}
            onChange={setAccount}
            className="h-control w-56"
          >
            <option value="">All accounts</option>
            {[...new Set(rows.map((row) => row.unit_id))]
              .map((id) => ({
                value: id,
                label:
                  bankOfUnit.get(id) == null
                    ? unitName(id)
                    : `${bankOfUnit.get(id)} — ${unitName(id)}`,
              }))
              .sort((a, b) => a.label.localeCompare(b.label))
              .map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
          </Select>
          <Select
            aria-label="Month"
            value={month}
            onChange={setMonth}
            className="h-control w-36"
          >
            <option value="">All months</option>
            {MONTHS.map((one, index) => (
              <option key={one} value={String(index + 1).padStart(2, "0")}>
                {one}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Year"
            value={year}
            onChange={setYear}
            className="h-control w-28"
          >
            <option value="">All years</option>
            {years.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </Select>
          <Toolbar.Spacer />
          <span className="text-[0.9375rem] text-mute">
            {count(accounts.length)}{" "}
            {accounts.length === 1 ? "account" : "accounts"}
          </span>
        </Toolbar>

        {accounts.length === 0 ? (
          narrowed ? (
            <EmptyState>No account matches these filters.</EmptyState>
          ) : (
            <EmptyState>
              Nothing has been imported yet, so there is nothing to reconcile
              against.
            </EmptyState>
          )
        ) : (
          <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            <DataTable<AccountRow>
              table={table}
              onRowClick={(row) => statementSheet.open(row.statementId)}
              pageScroll
              cardSort={false}
              cardsApart
            />
          </Card>
        )}
      </div>
    </PageContent>
  )
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

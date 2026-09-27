import { useQuery } from "@tanstack/react-query"
import { ChevronLeft } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import { financeKeys, listCompanyBankAccounts } from "@/lib/queries/finance"
import { BankReconciliation as ReconcileTool } from "@/screens/finance-lab-2/bank-reconciliation"
import { BANK_POTS, useMoney, useStatements } from "@/screens/finance-lab-2/hooks"
import { Grid, Td, Th } from "@/screens/finance-lab-2/parts"
import { useSiteName } from "@/screens/finance/hooks"

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
/// The matcher itself is unchanged and still lives in `bank-reconciliation`.
/// This file does not reimplement it; it chooses which one to open.
export function BankReconciliationList() {
  const [open, setOpen] = useState<string | null>(null)
  const statements = useStatements()
  const overview = useMoney()
  const siteName = useSiteName()
  const [account, setAccount] = useState("")
  const [month, setMonth] = useState("")
  const [year, setYear] = useState("")

  const described = useQuery({
    queryKey: financeKeys.companyBankAccounts(null),
    queryFn: ({ signal }) => listCompanyBankAccounts(signal),
    staleTime: 5 * 60_000,
  })

  const rows = useMemo(() => statements.data?.rows ?? [], [statements.data])

  /// Which bank a unit's money is at, and only where the answer is not in
  /// doubt — the same rule Bank Transactions follows, for the same reason: a
  /// statement does not carry its bank account id on the wire, so a unit with
  /// two institutions cannot be named without guessing.
  const bankOfSite = useMemo(() => {
    const seen = new Map<string, string | null>()
    for (const one of described.data ?? []) {
      if (one.status === "CLOSED") continue
      const had = seen.get(one.site_id)
      if (had === undefined) seen.set(one.site_id, one.bank_name)
      else if (had !== one.bank_name) seen.set(one.site_id, null)
    }
    return seen
  }, [described.data])

  /// What the books hold, per bank account.
  const books = useMemo(() => {
    const table = new Map<string, number>()
    for (const row of overview.data?.rows ?? []) {
      if (!BANK_POTS.includes(row.pot)) continue
      table.set(`${row.account_code}@${row.site_id}`, row.per_books_minor)
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
        site_id: string
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
      const key = `${row.account_code}@${row.site_id}`
      if (account !== "" && row.site_id !== account) continue
      const had = table.get(key)
      if (had === undefined) {
        table.set(key, {
          key,
          site_id: row.site_id,
          account_code: row.account_code,
          account_name: row.account_name,
          bank: bankOfSite.get(row.site_id) ?? null,
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
    return [...table.values()].sort((a, b) =>
      (a.bank ?? "").localeCompare(b.bank ?? "") ||
      siteName(a.site_id).localeCompare(siteName(b.site_id))
    )
  }, [rows, bankOfSite, siteName, account, month, year])

  const narrowed = account !== "" || month !== "" || year !== ""

  // The matcher, for the account somebody pressed Reconcile on. Its own way
  // back sits above it rather than inside it: the matcher was written as a
  // whole screen and does not know it is being shown from a list.
  if (open !== null) {
    return (
      <>
        <div className="px-5 pt-4">
          <Button variant="ghost" onClick={() => setOpen(null)}>
            <ChevronLeft className="size-4" />
            All accounts
          </Button>
        </div>
        <ReconcileTool statementId={open} />
      </>
    )
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Cash &amp; Bank"
        title="Bank Reconciliation"
        sub="How far each account is from matching its bank."
      />

      <div className="flex flex-col gap-4">
        <Toolbar>
          <Select
            aria-label="Bank account"
            value={account}
            onChange={setAccount}
            className="h-8 w-56"
          >
            <option value="">All accounts</option>
            {[...new Set(rows.map((row) => row.site_id))]
              .map((id) => ({
                value: id,
                label:
                  bankOfSite.get(id) == null
                    ? siteName(id)
                    : `${bankOfSite.get(id)} — ${siteName(id)}`,
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
            className="h-8 w-36"
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
            className="h-8 w-28"
          >
            <option value="">All years</option>
            {years.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </Select>
        </Toolbar>

        {statements.isPending ? (
          <LoadingState>Reading what has arrived…</LoadingState>
        ) : accounts.length === 0 ? (
          narrowed ? (
            <EmptyState>No account matches these filters.</EmptyState>
          ) : (
            <EmptyState>
              Nothing has been imported yet, so there is nothing to reconcile
              against.
            </EmptyState>
          )
        ) : (
          <Card className="overflow-hidden">
            <Grid>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th align="right" width="7rem">
                    Transactions
                  </Th>
                  <Th align="right" width="7rem">
                    Reconciled
                  </Th>
                  <Th align="right" width="7rem">
                    Pending
                  </Th>
                  <Th align="right" width="10rem">
                    Bank
                  </Th>
                  <Th align="right" width="10rem">
                    Books
                  </Th>
                  <Th align="right" width="10rem">
                    Difference
                  </Th>
                  <Th width="8rem" />
                </tr>
              </thead>
              <tbody>
                {accounts.map((row) => {
                  const pending = row.lines - row.reconciled
                  const held = books.get(row.key) ?? 0
                  const difference = held - row.closing
                  return (
                    <tr key={row.key}>
                      <Td>
                        <span className="text-ink">
                          {row.bank ?? row.account_name} ·{" "}
                          {siteName(row.site_id)}
                        </span>
                      </Td>
                      <Td align="right">{count(row.lines)}</Td>
                      <Td align="right">
                        <span className={row.reconciled === 0 ? "text-mute" : ""}>
                          {count(row.reconciled)}
                        </span>
                      </Td>
                      <Td align="right">
                        {pending === 0 ? (
                          <span className="text-mute">0</span>
                        ) : (
                          <span className="font-medium text-warn-fg">
                            {count(pending)}
                          </span>
                        )}
                      </Td>
                      <Td align="right">{money(row.closing)}</Td>
                      <Td align="right">{money(held)}</Td>
                      <Td align="right">
                        {difference === 0 ? (
                          <span className="text-mute">0</span>
                        ) : (
                          <span className="font-medium text-bad-fg">
                            {money(difference)}
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        <Button
                          size="sm"
                          variant={pending === 0 ? "ghost" : "primary"}
                          onClick={() => setOpen(row.statementId)}
                        >
                          Reconcile
                        </Button>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Grid>
          </Card>
        )}
      </div>
    </PageContent>
  )
}

const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
]

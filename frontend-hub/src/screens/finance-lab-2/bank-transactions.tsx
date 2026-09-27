import { useQueries, useQuery } from "@tanstack/react-query"
import { Search, Upload } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { PageHeader } from "@/components/ui/page-header"
import { Select } from "@/components/ui/field"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import {
  bankStatementLines,
  financeKeys,
  listCompanyBankAccounts,
} from "@/lib/queries/finance"
import { useStatements } from "@/screens/finance-lab-2/hooks"
import { Grid, Td, Th } from "@/screens/finance-lab-2/parts"
import { useSiteName } from "@/screens/finance/hooks"

/// Every line the bank has reported, across every account.
///
/// In ERPNext a Bank Transaction is an ordinary document with an ordinary list
/// view — which is also where its multi-select and bulk actions live, and the
/// reason they are not on the reconciliation screen. The same split holds here:
/// this is the list, the reconciliation tool is one decision at a time.
///
/// # Why there is no statement picker
///
/// There was one, and it was the wrong control: a dropdown reading "Cash In
/// Bank — store-08 · 01 Agu → 31 Agu" made the statement the subject and the
/// lines its contents, so answering "did that transfer to Sinar ever arrive"
/// meant opening forty-two of them in turn. The lines are the subject. Which
/// statement a line came from is a fact ABOUT it, which is why the bank and
/// the account are columns now and the filter is a search across all of them.
///
/// # Why there is no Imports tab either
///
/// It listed the statement documents — period, opening, closing, how many
/// lines were claimed — which is a view of the FILES, not of the banking. A
/// tab whose rows nobody acts on is a report, and this screen is a worklist.
/// The statements are still records and still read by the reconciliation
/// screen, which is where their opening and closing balances actually decide
/// something.
export function BankTransactions() {
  const statements = useStatements()
  const siteName = useSiteName()
  const [account, setAccount] = useState("")
  const [needle, setNeedle] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  // Its own memo so the identity is stable: a fresh [] every render would
  // re-run every memo downstream of it.
  const rows = useMemo(() => statements.data?.rows ?? [], [statements.data])

  /// Our own accounts, for the bank's name.
  ///
  /// The statement carries the LEDGER account — `1102 Cash In Bank` — which is
  /// the same four words on every row and tells nobody which bank. The
  /// institution is on `company_bank_account`, so it is joined here by the
  /// unit the statement belongs to.
  const accounts = useQuery({
    queryKey: financeKeys.companyBankAccounts(null),
    queryFn: ({ signal }) => listCompanyBankAccounts(signal),
    staleTime: 5 * 60_000,
  })

  /// Which bank a unit's money is at, and only where the answer is not in
  /// doubt.
  ///
  /// A site with one account has one bank and the row can say so. Head office
  /// holds three at three institutions and the statement does not carry the
  /// account id on the wire, so naming one of them would be a guess printed as
  /// a fact. Those rows read "—" until the server sends the account down.
  const bankOfSite = useMemo(() => {
    const seen = new Map<string, string | null>()
    for (const one of accounts.data ?? []) {
      if (one.status === "CLOSED") continue
      const had = seen.get(one.site_id)
      // Set once, then poisoned to null by any second institution.
      if (had === undefined) seen.set(one.site_id, one.bank_name)
      else if (had !== one.bank_name) seen.set(one.site_id, null)
    }
    return seen
  }, [accounts.data])

  /// The accounts worth offering: the ones a statement has actually arrived
  /// for. A picker listing fourteen accounts when only twelve have ever been
  /// imported offers two answers that return nothing.
  const accountChoices = useMemo(() => {
    const seen = new Map<string, string>()
    for (const row of rows) {
      if (seen.has(row.site_id)) continue
      const bank = bankOfSite.get(row.site_id)
      seen.set(
        row.site_id,
        bank === undefined || bank === null
          ? siteName(row.site_id)
          : `${bank} — ${siteName(row.site_id)}`
      )
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rows, bankOfSite, siteName])

  /// Every statement's lines, gathered into one list.
  ///
  /// One request per statement, which is what the server offers: the lines
  /// route is keyed by statement. They share the cache with the reconciliation
  /// screen — same key, same rows — so opening both costs nothing twice, and
  /// the two can never disagree about whether a line is claimed.
  const lineQueries = useQueries({
    queries: rows.map((row) => ({
      queryKey: financeKeys.bankLines(row.statement_id),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        bankStatementLines(row.statement_id, signal),
      staleTime: 60_000,
    })),
  })
  const loadingLines = lineQueries.some((one) => one.isPending)

  /// The flat list: the bank's line, plus where it came from.
  const all = useMemo(
    () =>
      rows.flatMap((statement, index) =>
        (lineQueries[index]?.data ?? []).map((line) => ({
          line,
          statement,
          bank: bankOfSite.get(statement.site_id) ?? null,
          place: siteName(statement.site_id),
        }))
      ),
    // `lineQueries` is a new array every render; its DATA is what matters, so
    // the dependency is the concatenated fetch status rather than the array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, bankOfSite, siteName, lineQueries.map((one) => one.dataUpdatedAt).join()]
  )

  /// One box, four fields. Bank, account, description and the reference the
  /// bank printed all answer the same question — "which line was it" — and
  /// splitting them across four controls makes somebody say it four times.
  /// The dates are their own pair because a range is not a word.
  const shown = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return all
      .filter(({ line, statement, bank, place }) => {
        if (account !== "" && statement.site_id !== account) return false
        if (from !== "" && line.value_date < from) return false
        if (to !== "" && line.value_date > to) return false
        if (text === "") return true
        return [
          bank ?? "",
          statement.account_code,
          statement.account_name,
          place,
          line.description,
          line.bank_said,
          line.party_name,
        ]
          .join(" ")
          .toLowerCase()
          .includes(text)
      })
      .sort((a, b) =>
        a.line.value_date === b.line.value_date
          ? a.line.line_number - b.line.line_number
          : b.line.value_date.localeCompare(a.line.value_date)
      )
  }, [all, needle, from, to, account])

  const narrowed =
    needle.trim() !== "" || from !== "" || to !== "" || account !== ""

  return (
    <PageContent>
      <PageHeader
        crumb="Finance lab 2 · Cash &amp; Bank"
        title="Bank Transactions"
        sub="What the bank said happened, and which file said it."
      />

      <div className="flex flex-col gap-4">
        <Toolbar>
          {/* The account first, because it is the question people arrive
              with — "what happened on the BCA account" — and because the
              search box behind it is a free-text guess by comparison. */}
          <Select
            aria-label="Bank account"
            value={account}
            onChange={setAccount}
            className="h-8 w-56"
          >
            <option value="">All accounts</option>
            {accountChoices.map((one) => (
              <option key={one.value} value={one.value}>
                {one.label}
              </option>
            ))}
          </Select>
          <span className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
                <input
                  value={needle}
                  onChange={(event) => setNeedle(event.target.value)}
                  placeholder="Bank, account, description"
                  aria-label="Search bank transactions"
                  className="h-8 w-64 rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.875rem] text-ink outline-none placeholder:text-body focus:border-accent"
                />
              </span>
              {/* A range is two days, so it is two controls. Each draws the
                  calendar `<Day>` draws everywhere else, and the second cannot
                  be set before the first. */}
              <Day
                value={from}
                onChange={setFrom}
                notAfter={to === "" ? null : to}
                placeholder="From"
                label="From date"
                className="h-8 w-36"
              />
              <span aria-hidden className="text-mute">
                →
              </span>
          <Day
            value={to}
            onChange={setTo}
            notBefore={from === "" ? null : from}
            placeholder="To"
            label="To date"
            className="h-8 w-36"
          />
          <Toolbar.Spacer />
          <Button variant="primary" className="h-8">
            <Upload className="size-4" />
            Import statement
          </Button>
        </Toolbar>

        {statements.isPending ? (
          <LoadingState>Reading what has arrived…</LoadingState>
        ) : rows.length === 0 ? (
          <EmptyState>
            Nothing has been imported yet. A statement arrives either from the
            mailbox gateway or from a paste on Finance → Cash &amp; bank.
          </EmptyState>
        ) : loadingLines ? (
          <LoadingState>Reading the statements…</LoadingState>
        ) : (
          <Card className="overflow-hidden">
            {shown.length === 0 ? (
              narrowed ? (
                <EmptyState>No line matches this search.</EmptyState>
              ) : (
                <EmptyState>The statements carry no lines.</EmptyState>
              )
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th width="5.5rem">Date</Th>
                    <Th width="10rem">Bank</Th>
                    <Th>Description</Th>
                    <Th align="right" width="7.5rem">
                      Deposit
                    </Th>
                    <Th align="right" width="7.5rem">
                      Withdrawal
                    </Th>
                    <Th width="9rem">Account</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ line, bank, place }) => (
                    <tr key={line.line_id}>
                      <Td>{day(line.value_date)}</Td>
                      <Td>
                        <span className="text-ink">{bank ?? "—"}</span>
                        <span className="block text-[0.875rem] text-mute">
                          {place}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-ink">{line.description}</span>
                        {(line.party_name || line.bank_said) !== "" &&
                          (line.party_name || line.bank_said) !==
                            line.description && (
                          <span className="block text-[0.875rem] text-mute">
                            {line.party_name || line.bank_said}
                          </span>
                          )}
                      </Td>
                      <Td align="right">
                        {line.credit_minor === 0
                          ? "—"
                          : money(line.credit_minor)}
                      </Td>
                      <Td align="right">
                        {line.debit_minor === 0 ? "—" : money(line.debit_minor)}
                      </Td>
                      {/* Where it was booked, once somebody has booked it.
                          A dash is the honest answer for a line nobody has
                          agreed yet — which is what the Status pill used to
                          say in a word, at the cost of a column. */}
                      <Td>
                        {line.matched_entry_number === null ? (
                          <span className="text-mute">—</span>
                        ) : (
                          <span className="font-mono text-[0.875rem] text-text">
                            {line.matched_entry_number}
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Grid>
            )}
          </Card>
        )}
      </div>
    </PageContent>
  )
}

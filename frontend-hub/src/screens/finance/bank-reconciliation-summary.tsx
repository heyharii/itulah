import { useQueries, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { ExportButton } from "@/components/ui/export-button"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { CellMoney } from "@/components/ui/rows-switch"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { fileSafe, type ExportSheet } from "@/lib/export-xlsx"
import { count, money, span } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  bookOnlyLines,
  financeKeys,
  listBankStatements,
  moneyOverview,
} from "@/lib/queries/finance"
import { Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { isoDay, monthLabel, todayIso } from "@/screens/finance/chart"
import { useUnitName } from "@/screens/finance/hooks"
import { PhoneCard, PhoneList } from "@/components/ui/phone-cards"
import { UnitSelect } from "@/screens/finance/parts"
import { ReportFilters, ReportSummary } from "@/screens/finance/report"
import type { BankStatementRow, BookOnlyLine } from "@itulah/contract"

/// ERPNext's Bank Reconciliation Summary: for one month, every bank account on
/// one line — what the bank says it closed on, what the books say it held that
/// day, the gap between them, and the two kinds of thing that explain a gap.
///
/// # Where each figure comes from
///
/// - **Bank closing balance** — `closing_minor` of the account's statement for
///   the month: the latest one that is still in force (a re-import replaces a
///   statement and leaves the old one behind as history, which nothing should
///   add to anything) and that overlaps the month.
/// - **Book balance** — the ledger balance of that account as at the
///   statement's last day, read from `GET /finance/money?as_of=`. At the
///   STATEMENT's last day and not the month's, because the bank's figure is
///   as of its own period end and a book balance taken a few days later is a
///   difference that was never there.
/// - **Bank lines not matched** — the statement's lines nobody has agreed with
///   a journal line.
/// - **In the books, not on the bank** — postings on the account, up to the
///   statement's last day, that no bank line has claimed
///   (`/bank-statements/{id}/book-only`): a giro that has not cleared, a
///   deposit still on its way. Net of money in over money out, because that
///   net is exactly what the bank closing balance has to be moved by to reach
///   the books.
///
/// # What "Reconciled" means
///
/// Difference nil AND nothing open on either side. Nothing open on one side
/// with a difference left is not reconciled, it is unexplained, and says so.
///
/// An account that holds money at the month's end and has NO statement for it
/// is listed anyway, as "No statement": the report is for finding the account
/// nobody has reconciled, and leaving it out would hide exactly that one.
///
/// If the book-only read is refused (a server older than this screen), its
/// cells draw a dash and the status is decided from the difference and the
/// unmatched lines alone.
export function BankReconciliationSummary() {
  const phone = useLayout() === "phone"
  const navigate = useNavigate()
  const unitName = useUnitName()
  const [month, setMonth] = useState(lastCompleteMonth)
  const [unit, setUnit] = useState("")

  const from = `${month}-01`
  const to = monthEnd(month)

  const statements = useQuery({
    queryKey: [...financeKeys.bankStatements(unit || null), "covering", from],
    queryFn: ({ signal }) => statementsFrom(from, unit, signal),
  })

  // One statement per account and unit: the latest in force that overlaps the
  // month, and when two end the same day the one imported last.
  const picked = useMemo(
    () => pickStatements(statements.data ?? [], from, to),
    [statements.data, from, to]
  )

  // Every date a book balance is needed at: the month's end, for accounts
  // with no statement, and each statement's own last day.
  const dates = useMemo(
    () => [...new Set([to, ...picked.map((row) => row.period_end)])].sort(),
    [to, picked]
  )
  const books = useQueries({
    queries: dates.map((asOf) => ({
      queryKey: financeKeys.money(asOf, unit || null),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        moneyOverview({ as_of: asOf, unit: unit || undefined }, signal),
      staleTime: 30_000,
    })),
  })
  // Quiet when the server is older than this screen: no retry, no error line.
  const unclaimed = useQueries({
    queries: picked.map((row) => ({
      queryKey: financeKeys.bankBookOnly(row.statement_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        bookOnlyLines(row.statement_id, signal),
      retry: false,
      staleTime: 30_000,
    })),
  })

  const pending =
    statements.isPending ||
    books.some((read) => read.isPending) ||
    unclaimed.some((read) => read.isPending)
  const failure = statements.error ?? books.find((read) => read.isError)?.error

  const lines = useMemo((): Line[] => {
    if (pending || failure) return []
    const booksAt = new Map(dates.map((date, i) => [date, books[i]?.data]))
    const found: Line[] = picked.map((statement, i) => {
      const balance =
        booksAt
          .get(statement.period_end)
          ?.rows.find(
            (row) =>
              row.account_code === statement.account_code &&
              row.unit_id === statement.unit_id
          )?.per_books_minor ?? null
      const items = unclaimed[i]?.data
      return build(statement, balance, items)
    })

    // Accounts holding money at the month's end that no statement covers.
    const have = new Set(
      picked.map((row) => `${row.account_code}@${row.unit_id}`)
    )
    for (const row of booksAt.get(to)?.rows ?? []) {
      if (row.pot !== "BANK" || row.semantic_key === "giro_outstanding")
        continue
      if (row.per_books_minor === 0) continue
      if (have.has(`${row.account_code}@${row.unit_id}`)) continue
      found.push({
        key: `${row.account_code}@${row.unit_id}`,
        accountName: row.account_name,
        unitId: row.unit_id,
        statement: null,
        bank: null,
        book: row.per_books_minor,
        difference: null,
        unmatched: null,
        openCount: null,
        openNet: null,
        status: "none",
      })
    }
    return found.sort(
      (a, b) =>
        unitName(a.unitId).localeCompare(unitName(b.unitId)) ||
        a.accountName.localeCompare(b.accountName)
    )
  }, [pending, failure, dates, books, picked, unclaimed, to, unitName])

  const withStatement = lines.filter((line) => line.statement !== null)
  const total = {
    bank: sum(withStatement, (line) => line.bank),
    book: sum(withStatement, (line) => line.book),
    difference: sum(withStatement, (line) => line.difference),
    unmatched: sum(withStatement, (line) => line.unmatched),
    openCount: sum(withStatement, (line) => line.openCount),
    openNet: sum(withStatement, (line) => line.openNet),
  }
  const reconciled = lines.filter((line) => line.status === "done").length

  const note = [
    monthLabel(Number(month.slice(0, 4)), Number(month.slice(5, 7))),
    unit === "" ? "All units" : unitName(unit),
  ].join(" · ")

  const exportSheet = (): ExportSheet | null => {
    if (pending || failure) return null
    return {
      filename: `Bank-Reconciliation-Summary-${month}${unit === "" ? "" : `-${fileSafe(unitName(unit))}`}`,
      sheet: "Reconciliation Summary",
      title: "Bank Reconciliation Summary",
      subtitle: note,
      columns: [
        { header: "Bank Account", kind: "text", width: 30 },
        { header: "Unit", kind: "text", width: 22 },
        { header: "Statement from", kind: "date" },
        { header: "Statement to", kind: "date" },
        { header: "Bank Closing Balance", kind: "money" },
        { header: "Book Balance", kind: "money" },
        { header: "Difference", kind: "money" },
        { header: "Bank Lines Not Matched", kind: "number" },
        { header: "In the Books, Not on the Bank (count)", kind: "number" },
        { header: "In the Books, Not on the Bank (net)", kind: "money" },
        { header: "Status", kind: "text", width: 16 },
      ],
      rows: lines.map((line) => [
        line.accountName,
        unitName(line.unitId),
        line.statement?.period_start ?? null,
        line.statement?.period_end ?? null,
        line.bank,
        line.book,
        line.difference,
        line.unmatched,
        line.openCount,
        line.openNet,
        STATUS[line.status].label,
      ]),
      totalRow: [
        "Total",
        "",
        null,
        null,
        total.bank,
        total.book,
        total.difference,
        total.unmatched,
        total.openCount,
        total.openNet,
        "",
      ],
    }
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Banking"
        title="Bank Reconciliation Summary"
        // On a phone Export is a row of the Filters sheet, not a button at the
        // top of the page.
        actions={
          phone ? undefined : (
            <ExportButton
              build={exportSheet}
              disabled={pending || failure !== undefined || lines.length === 0}
            />
          )
        }
      />

      <ReportFilters note={note}>
        <Select
          value={month}
          onChange={setMonth}
          className="h-control w-48"
          aria-label="Month"
        >
          {recentMonths().map((one) => (
            <option key={one} value={one}>
              {monthLabel(Number(one.slice(0, 4)), Number(one.slice(5, 7)))}
            </option>
          ))}
        </Select>
        <UnitSelect
          value={unit}
          onChange={setUnit}
          emptyLabel="All units"
          className="h-control w-52"
          aria-label="Unit"
        />
        {phone && (
          <ExportButton
            build={exportSheet}
            disabled={pending || failure !== undefined || lines.length === 0}
          />
        )}
      </ReportFilters>

      {pending ? (
        <LoadingState>Reading the statements and the books…</LoadingState>
      ) : failure ? (
        <ErrorState
          error={failure}
          onRetry={() => {
            void statements.refetch()
            for (const read of books) void read.refetch()
          }}
        />
      ) : lines.length === 0 ? (
        <Card>
          <EmptyState>
            No bank statement covers this month, and no bank account holds money
            at its end.
          </EmptyState>
        </Card>
      ) : (
        <>
          <ReportSummary
            items={[
              {
                label: "Reconciled",
                value: null,
                display: `${count(reconciled)} of ${count(lines.length)} accounts`,
              },
              {
                label: "Difference",
                value: total.difference,
                indicator: total.difference !== 0 ? "Red" : undefined,
              },
              {
                label: "Bank lines not matched",
                value: null,
                display: count(total.unmatched),
              },
            ]}
          />

          {phone ? (
            <PhoneList>
              {lines.map((line) => (
                <PhoneCard
                  key={line.key}
                  title={line.accountName}
                  line={
                    <>
                      {unitName(line.unitId)}
                      {line.statement !== null && (
                        <>
                          {" · "}
                          {span(
                            line.statement.period_start,
                            line.statement.period_end
                          )}
                        </>
                      )}
                    </>
                  }
                  lead={line.difference === null ? "—" : money(line.difference)}
                  caption="difference"
                  tone={
                    line.difference === null
                      ? "quiet"
                      : line.difference === 0
                        ? "quiet"
                        : "bad"
                  }
                  foot={
                    <>
                      <div className="tabular-nums">
                        Bank {money(line.bank)} · Book {money(line.book)}
                      </div>
                      {line.unmatched !== null && line.unmatched > 0 && (
                        <div className="text-warn-fg">
                          {count(line.unmatched)} bank{" "}
                          {line.unmatched === 1 ? "line" : "lines"} not matched
                        </div>
                      )}
                      {line.openCount !== null && line.openCount > 0 && (
                        <div className="text-warn-fg">
                          {count(line.openCount)}{" "}
                          {line.openCount === 1 ? "posting" : "postings"} not on
                          the bank · {money(line.openNet)}
                        </div>
                      )}
                    </>
                  }
                  action={
                    <Pill tone={STATUS[line.status].tone}>
                      {STATUS[line.status].label}
                    </Pill>
                  }
                  onOpen={
                    line.statement === null
                      ? undefined
                      : () =>
                          void navigate({
                            to: "/finance/cash-bank/bank-reconciliation",
                            search: { statement: line.statement?.statement_id },
                          } as never)
                  }
                />
              ))}
            </PhoneList>
          ) : (
            <Grid followRows giveUp={[2, 6, 8]}>
              <thead>
                <tr>
                  <Th>Bank account</Th>
                  <Th width="11rem">Statement period</Th>
                  <Th align="right">Bank closing balance</Th>
                  <Th align="right">Book balance</Th>
                  <Th align="right">Difference</Th>
                  <Th align="right" width="8rem">
                    Bank lines not matched
                  </Th>
                  <Th align="right">In the books, not on the bank</Th>
                  <Th width="9.5rem">Status</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr
                    key={line.key}
                    // A row opens that statement's reconciliation. An account
                    // with no statement has nowhere to go, and says so by not
                    // looking pressable.
                    onClick={
                      line.statement === null
                        ? undefined
                        : () =>
                            void navigate({
                              to: "/finance/cash-bank/bank-reconciliation",
                              search: {
                                statement: line.statement?.statement_id,
                              },
                            } as never)
                    }
                    className={
                      line.statement === null ? undefined : "cursor-pointer"
                    }
                  >
                    <Td>
                      <span className="text-ink">{line.accountName}</span>
                      <span className="block text-[0.9375rem] text-mute">
                        {unitName(line.unitId)}
                      </span>
                    </Td>
                    <Td>
                      {line.statement === null ? (
                        <span className="text-mute">—</span>
                      ) : (
                        span(
                          line.statement.period_start,
                          line.statement.period_end
                        )
                      )}
                    </Td>
                    <Td align="right">
                      <CellMoney minor={line.bank} />
                    </Td>
                    <Td align="right">
                      <CellMoney minor={line.book} />
                    </Td>
                    <Td align="right">
                      {line.difference === null ? (
                        <span className="text-mute">—</span>
                      ) : line.difference === 0 ? (
                        <span className="text-mute">0</span>
                      ) : (
                        <span className="font-medium text-bad-fg">
                          <CellMoney minor={line.difference} />
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      {line.unmatched === null ? (
                        <span className="text-mute">—</span>
                      ) : line.unmatched === 0 ? (
                        <span className="text-mute">0</span>
                      ) : (
                        <span className="font-medium text-warn-fg">
                          {count(line.unmatched)}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      {line.openCount === null ? (
                        <span className="text-mute">—</span>
                      ) : line.openCount === 0 ? (
                        <span className="text-mute">0</span>
                      ) : (
                        <>
                          <CellMoney minor={line.openNet} />
                          <span className="block text-[0.9375rem] text-mute">
                            {count(line.openCount)}{" "}
                            {line.openCount === 1 ? "posting" : "postings"}
                          </span>
                        </>
                      )}
                    </Td>
                    <Td>
                      <Pill tone={STATUS[line.status].tone}>
                        {STATUS[line.status].label}
                      </Pill>
                    </Td>
                  </tr>
                ))}
                <TotalRow>
                  <Td>Total</Td>
                  <Td />
                  <Td align="right">{money(total.bank)}</Td>
                  <Td align="right">{money(total.book)}</Td>
                  <Td align="right">{money(total.difference)}</Td>
                  <Td align="right">{count(total.unmatched)}</Td>
                  <Td align="right">
                    {money(total.openNet)}
                    <span className="ml-1.5 font-normal text-mute">
                      · {count(total.openCount)}
                    </span>
                  </Td>
                  <Td />
                </TotalRow>
              </tbody>
            </Grid>
          )}
        </>
      )}
    </PageContent>
  )
}

type Status = "done" | "open" | "differs" | "none"

const STATUS: Readonly<
  Record<Status, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }>
> = {
  done: { label: "Reconciled", tone: "ok" },
  open: { label: "Open items", tone: "warn" },
  differs: { label: "Does not agree", tone: "bad" },
  none: { label: "No statement", tone: "neutral" },
}

interface Line {
  readonly key: string
  readonly accountName: string
  readonly unitId: string
  readonly statement: BankStatementRow | null
  readonly bank: number | null
  readonly book: number | null
  readonly difference: number | null
  readonly unmatched: number | null
  /// Postings in the books no bank line has claimed, and their net. `null`
  /// when the read was refused.
  readonly openCount: number | null
  readonly openNet: number | null
  readonly status: Status
}

function build(
  statement: BankStatementRow,
  book: number | null,
  items: readonly BookOnlyLine[] | undefined
): Line {
  const difference = book === null ? null : book - statement.closing_minor
  const unmatched = statement.line_count - statement.matched_count
  const openCount = items === undefined ? null : items.length
  // Money into the account minus money out of it: what moves the bank's
  // figure to the books'.
  const openNet =
    items === undefined
      ? null
      : items.reduce(
          (net, item) => net + item.deposit_minor - item.withdrawal_minor,
          0
        )
  const nothingOpen = unmatched === 0 && (openCount ?? 0) === 0
  // No book balance at all (the account is not a mapped money account) is
  // not a difference of nil: it cannot be called reconciled or disagreeing.
  const status: Status =
    difference === 0 && nothingOpen
      ? "done"
      : nothingOpen && difference !== null
        ? "differs"
        : "open"
  return {
    key: `${statement.account_code}@${statement.unit_id}`,
    accountName: statement.account_name,
    unitId: statement.unit_id,
    statement,
    bank: statement.closing_minor,
    book,
    difference,
    unmatched,
    openCount,
    openNet,
    status,
  }
}

function sum(
  lines: readonly Line[],
  figure: (line: Line) => number | null
): number {
  return lines.reduce((total, line) => total + (figure(line) ?? 0), 0)
}

/// Statements for the month: those still in force that overlap it, one per
/// account and unit.
function pickStatements(
  rows: readonly BankStatementRow[],
  from: string,
  to: string
): BankStatementRow[] {
  const best = new Map<string, BankStatementRow>()
  for (const row of rows) {
    if (row.superseded_by !== null) continue
    if (row.period_start > to || row.period_end < from) continue
    const key = `${row.account_code}@${row.unit_id}`
    const had = best.get(key)
    if (
      had === undefined ||
      row.period_end > had.period_end ||
      (row.period_end === had.period_end && row.imported_at > had.imported_at)
    ) {
      best.set(key, row)
    }
  }
  return [...best.values()]
}

/// Every statement from the month on, paged. The list is newest period first,
/// so it stops once a whole page is older than the month — statements are a
/// month long, and one that starts earlier and still covers it would sit in
/// the same page as its neighbours.
async function statementsFrom(
  from: string,
  unit: string,
  signal?: AbortSignal
): Promise<BankStatementRow[]> {
  const rows: BankStatementRow[] = []
  let cursor: string | undefined
  // A safety valve, not a ceiling: five pages of 500 is years of statements
  // for every shop.
  for (let page = 0; page < 5; page++) {
    const answer = await listBankStatements(signal, {
      unit: unit === "" ? undefined : unit,
      limit: 500,
      cursor,
    })
    rows.push(...answer.rows)
    const last = answer.rows[answer.rows.length - 1]
    if (
      answer.next_cursor === null ||
      last === undefined ||
      last.period_end < from
    ) {
      break
    }
    cursor = answer.next_cursor
  }
  return rows
}

/// `2026-09` — the month before this one, which is the last that is over and
/// so the last whose statement can have arrived.
function lastCompleteMonth(): string {
  const today = todayIso()
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, "0")}`
}

/// The last two years of months, newest first, starting from the current one
/// so a statement already in for it can be looked at too.
function recentMonths(): string[] {
  const today = todayIso()
  let year = Number(today.slice(0, 4))
  let month = Number(today.slice(5, 7))
  const months: string[] = []
  for (let i = 0; i < 24; i++) {
    months.push(`${year}-${String(month).padStart(2, "0")}`)
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
    }
  }
  return months
}

/// Last day of `2026-09`, built from numbers rather than parsed: a bare date
/// parsed as UTC names the wrong day in Jakarta for the first seven hours.
function monthEnd(month: string): string {
  return isoDay(
    new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)
  )
}

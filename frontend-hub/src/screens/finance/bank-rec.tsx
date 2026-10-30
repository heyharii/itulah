import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Check, ChevronLeft, Download, Printer, Upload } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Textarea } from "@/components/ui/field"
import { FilterChips, type ChipOption } from "@/components/ui/filter-chips"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, Status } from "@/components/ui/pill"
import { CellMoney } from "@/components/ui/rows-switch"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SheetSection,
  TotalsLadder,
} from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { toast } from "@/lib/toast"
import { count, day, dayMonth, money } from "@/lib/format"
import {
  bankStatementLines,
  bankStatementsQuery,
  bankSuggestions,
  bookBankLine,
  bookOnlyLines,
  companyBankAccountsQuery,
  confirmBankMatch,
  financeKeys,
  moneyOverview,
  moneyOverviewQuery,
} from "@/lib/queries/finance"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import {
  AccountAndCategory,
  accountChoiceReady,
  type AccountChoice,
} from "@/screens/finance/parts"
import { ScreenPending } from "@/screens/finance/pending"
import type {
  BankStatementLineRow,
  BankStatementRow,
  BookOnlyLine,
  Suggestion,
} from "@itulah/contract"

/// Cash & Bank › Bank reconciliation: 7Soft's Rekonsiliasi Bank, read as the
/// bank prints it — every line, the running balance, and what the same event
/// is in our books — beside what the books hold that the bank has not seen
/// yet.
///
/// # Where the figures come from
///
/// - The accounts, what the books hold, and the latest bank figure: `GET
///   /money`. One row per bank account per unit; `giro_outstanding` sits in the
///   same pot and is left out, because it is money promised and not money in
///   the bank.
/// - The statement's lines: `GET /bank-statements/{id}/lines`, in the order
///   the bank printed them, with the running balance added here from the
///   statement's own opening figure. Nothing is invented.
/// - "In the books, not at the bank yet": `GET /bank-statements/{id}/book-only`.
/// - A line the bank has and the books do not: `POST /bank-lines/{id}/book`.
///   A pairing the matcher is sure of: `POST /bank-lines/{id}/match`.
///
/// A column whose figure the server does not answer is drawn as `—`.

function hit(query: string, ...texts: readonly (string | null | undefined)[]) {
  const needle = query.trim().toLowerCase()
  if (needle === "") return true
  return texts.some((text) => (text ?? "").toLowerCase().includes(needle))
}

/// "+Rp 20.000" / "−Rp 50.000": a difference says which way it went.
function signedRupiah(minor: number): string {
  return minor > 0 ? `+${money(minor)}` : money(minor)
}

/// A pairing the matcher offers for one bank line, by line id.
type Suggestions = ReadonlyMap<string, readonly Suggestion[]>

/// The account number somebody described, or nothing. An empty string is
/// "nobody has said", not a number.
function describedNumber(
  table: ReadonlyMap<string, string>,
  unit: string,
  code: string
): string | null {
  const one = table.get(`${unit}\t${code}`)
  return one === undefined || one === "" ? null : one
}

function suggestionOf(suggestions: Suggestions, line: BankStatementLineRow) {
  return suggestions.get(line.line_id) ?? []
}

/// The narration the bank printed; a line that has none is named by its
/// reference, and one with neither is still a line.
function lineLabel(line: BankStatementLineRow): string {
  if (line.description.trim() !== "") return line.description
  if (line.reference !== null && line.reference.trim() !== "")
    return line.reference
  return "Bank line"
}

/// What a line is in the books, in the words the prototype uses: Matched, To
/// match (the matcher offers a candidate) or Bank only (nothing in our ledger
/// is this event yet).
function lineWord(
  line: BankStatementLineRow,
  suggestions: Suggestions,
  /// Whether the matcher's own answer has arrived. Before it has, a line is
  /// "to match" and never "bank only": a screen that books a line it could not
  /// check against the books would post the same event twice.
  known = true
): { word: string; tone: "ok" | "info" | "warn" } {
  if (line.unallocated_minor <= 0) return { word: "Matched", tone: "ok" }
  if (
    !known ||
    line.allocated_minor > 0 ||
    line.matched_journal_line_id !== null ||
    suggestionOf(suggestions, line).length > 0
  )
    return { word: "To match", tone: "info" }
  return { word: "Bank only", tone: "warn" }
}

// ---------------------------------------------------------------------------
// The accounts
// ---------------------------------------------------------------------------

interface RecAccount {
  readonly key: string
  readonly unit_id: string
  readonly account_code: string
  readonly account_name: string
  readonly unit_name: string
  /// The account's own number at the bank, when somebody has described it.
  readonly no: string | null
  readonly statementId: string | null
  readonly periodEnd: string | null
  /// What the bank said it held, and what our books say.
  readonly bank: number | null
  readonly books: number
  readonly difference: number | null
  /// Lines on the latest statement nobody has agreed to a journal line.
  readonly toMatch: number
}

export function BankRec() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Cash & Bank"
          title="Bank reconciliation"
        >
          Reading the bank accounts…
        </ScreenPending>
      }
    >
      <BankRecList />
    </Suspense>
  )
}

function BankRecList() {
  const navigate = useNavigate()
  const overview = useSuspenseQuery(moneyOverviewQuery())
  const statements = useSuspenseQuery(bankStatementsQuery())
  const described = useQuery(companyBankAccountsQuery())

  const linked = (useSearch({ strict: false }) as { statement?: string })
    .statement

  const [opened, setOpened] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const numbers = useMemo(() => {
    const table = new Map<string, string>()
    for (const one of described.data ?? [])
      table.set(`${one.unit_id}\t${one.ledger_account_code}`, one.account_no)
    return table
  }, [described.data])

  const rows = useMemo<RecAccount[]>(
    () =>
      overview.data.rows
        .filter(
          (row) => row.pot === "BANK" && row.semantic_key !== "giro_outstanding"
        )
        .map((row) => ({
          key: `${row.unit_id}\t${row.account_code}`,
          unit_id: row.unit_id,
          account_code: row.account_code,
          account_name: row.account_name,
          unit_name: row.unit_name,
          no: describedNumber(numbers, row.unit_id, row.account_code),
          statementId: row.last_statement?.statement_id ?? null,
          periodEnd: row.last_statement?.period_end ?? null,
          bank: row.last_statement?.closing_minor ?? null,
          books: row.per_books_minor,
          difference: row.difference_minor,
          toMatch: row.last_statement?.unmatched_count ?? 0,
        }))
        .sort(
          (a, b) =>
            a.account_name.localeCompare(b.account_name) ||
            a.unit_name.localeCompare(b.unit_name)
        ),
    [overview.data.rows, numbers]
  )

  const linkedRow =
    linked === undefined
      ? undefined
      : statements.data.rows.find((row) => row.statement_id === linked)

  const shownKey =
    opened === null && !dismissed && linkedRow !== undefined
      ? `${linkedRow.unit_id}\t${linkedRow.account_code}`
      : opened
  const openedRow = rows.find((row) => row.key === shownKey) ?? null

  const toMatch = rows.reduce((sum, row) => sum + row.toMatch, 0)
  const different = rows.filter(
    (row) => row.difference !== null && row.difference !== 0
  ).length
  const upload = rows.filter((row) => row.statementId === null).length

  const uploadStatement = () =>
    void navigate({ to: "/finance/cash-bank/bank-transactions" } as never)

  const columns = useMemo<ColumnDef<TableSetup, RecAccount>[]>(
    () => [
      {
        id: "account",
        accessorFn: (row) => row.account_name,
        header: "Account",
        size: 300,
        enableSorting: false,
        meta: { card: "title", grow: 240 },
        cell: ({ row }) => (
          <span className="block truncate">
            <span className="font-medium text-ink">
              {row.original.account_name}
            </span>{" "}
            <span className="text-mute">
              {row.original.no ?? row.original.account_code}
            </span>
          </span>
        ),
      },
      {
        id: "date",
        accessorFn: (row) => row.periodEnd ?? "",
        header: "Statement date",
        size: 140,
        enableSorting: false,
        meta: { card: "meta", priority: 2 },
        cell: ({ row }) =>
          row.original.periodEnd === null ? (
            <span className="text-faint">—</span>
          ) : (
            day(row.original.periodEnd)
          ),
      },
      {
        id: "bank",
        accessorFn: (row) => row.bank,
        header: "Bank",
        size: 170,
        enableSorting: false,
        meta: { align: "right", card: "metric", priority: 1 },
        cell: ({ row }) => <CellMoney minor={row.original.bank} />,
      },
      {
        id: "books",
        accessorFn: (row) => row.books,
        header: "Books",
        size: 170,
        enableSorting: false,
        meta: { align: "right", card: "lead" },
        cell: ({ row }) => <CellMoney minor={row.original.books} />,
      },
      {
        id: "difference",
        accessorFn: (row) => row.difference,
        header: "Difference",
        size: 150,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => {
          const one = row.original.difference
          if (one === null) return <span className="text-faint">—</span>
          if (one === 0) return <span className="text-mute">Rp 0</span>
          return (
            <span className={cn(one < 0 && "text-bad-fg")}>
              {signedRupiah(one)}
            </span>
          )
        },
      },
      {
        id: "match",
        accessorFn: (row) => (row.statementId === null ? null : row.toMatch),
        header: "To match",
        size: 190,
        enableSorting: false,
        meta: { card: "foot" },
        cell: ({ row }) =>
          row.original.statementId === null ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                uploadStatement()
              }}
            >
              <Upload />
              Upload statement
            </Button>
          ) : row.original.toMatch === 0 ? (
            <span className="text-mute">0</span>
          ) : (
            <span className="tabular-nums">{count(row.original.toMatch)}</span>
          ),
      },
    ],
    // `uploadStatement` only reads the router's navigate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: RecAccount) => row.key,
      }),
      [rows, columns]
    )
  )

  if (openedRow !== null)
    return (
      <AccountReconciliation
        account={openedRow}
        statements={statements.data.rows}
        onBack={() => {
          setDismissed(true)
          setOpened(null)
          window.scrollTo(0, 0)
        }}
        onUpload={uploadStatement}
      />
    )

  return (
    <PageContent>
      <PageHeader title="Bank reconciliation" />
      <KpiStrip className="xl:grid-cols-3">
        <Kpi label="Lines to match" value={count(toMatch)} />
        <Kpi label="Accounts with a difference" value={count(different)} />
        <Kpi
          label="Statements to upload"
          value={
            <span className={cn(upload > 0 && "text-warn-fg")}>
              {count(upload)}
            </span>
          }
        />
      </KpiStrip>

      {rows.length === 0 ? (
        <EmptyState>No bank account is mapped yet.</EmptyState>
      ) : (
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <DataTable<RecAccount>
            refresh={[overview, statements]}
            table={table}
            onRowClick={(row) => {
              setOpened(row.key)
              window.scrollTo(0, 0)
            }}
            pageScroll
            cardSort={false}
            cardsApart
            cardLead
          />
        </Card>
      )}
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// One account's statement
// ---------------------------------------------------------------------------

function AccountReconciliation({
  account,
  statements,
  onBack,
  onUpload,
}: {
  account: RecAccount
  statements: readonly BankStatementRow[]
  onBack: () => void
  onUpload: () => void
}) {
  const statement =
    statements.find(
      (row) =>
        row.statement_id === account.statementId && row.superseded_by === null
    ) ??
    statements.find((row) => row.statement_id === account.statementId) ??
    null
  const [show, setShow] = useState<"all" | "to" | "ok">("all")
  const [query, setQuery] = useState("")
  const [openLine, setOpenLine] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)

  const linesRead = useQuery({
    queryKey: financeKeys.bankLines(statement?.statement_id ?? ""),
    queryFn: ({ signal }) =>
      bankStatementLines(statement?.statement_id ?? "", signal),
    enabled: statement !== null,
  })
  const suggestionsRead = useQuery({
    queryKey: financeKeys.bankSuggestions(statement?.statement_id ?? "", true),
    queryFn: ({ signal }) =>
      bankSuggestions(statement?.statement_id ?? "", signal, true),
    enabled: statement !== null,
  })
  const bookOnlyRead = useQuery({
    queryKey: financeKeys.bankBookOnly(statement?.statement_id ?? ""),
    queryFn: ({ signal }) =>
      bookOnlyLines(statement?.statement_id ?? "", signal),
    enabled: statement !== null,
    retry: false,
  })
  const booksAtRead = useQuery({
    queryKey: financeKeys.money(account.periodEnd, null),
    queryFn: ({ signal }) =>
      moneyOverview({ as_of: account.periodEnd ?? undefined }, signal),
    enabled: account.periodEnd !== null,
  })

  const suggestions = useMemo<Suggestions>(() => {
    const table = new Map<string, Suggestion[]>()
    for (const entry of suggestionsRead.data ?? [])
      table.set(entry.line_id, [...entry.suggestions])
    return table
  }, [suggestionsRead.data])

  /// The lines with the running balance the bank prints, from the statement's
  /// own opening figure. Nothing is added up that a statement did not state.
  const lines = useMemo(() => {
    const sorted = [...(linesRead.data ?? [])].sort(
      (a, b) =>
        a.value_date.localeCompare(b.value_date) ||
        a.line_number - b.line_number
    )
    let balance = statement?.opening_minor ?? 0
    return sorted.map((line) => {
      balance += line.credit_minor - line.debit_minor
      return { line, balance }
    })
  }, [linesRead.data, statement?.opening_minor])

  const unmatched = lines.filter(({ line }) => line.unallocated_minor > 0)
  const matched = lines.length - unmatched.length
  const bookOnly = bookOnlyRead.data ?? []
  const bookOnlyShown = bookOnly.filter((line) =>
    hit(
      query,
      line.memo,
      line.entry_number,
      money(line.deposit_minor),
      money(line.withdrawal_minor)
    )
  )

  const searched = lines.filter(({ line }) => {
    if (show === "to" && line.unallocated_minor <= 0) return false
    if (show === "ok" && line.unallocated_minor > 0) return false
    return hit(
      query,
      line.description,
      line.reference,
      line.party_name,
      line.matched_entry_number,
      ...line.allocations.map((one) => one.entry_number),
      money(line.debit_minor),
      money(line.credit_minor)
    )
  })
  const whole = show === "all" && query.trim() === ""

  const books =
    booksAtRead.data?.rows.find(
      (row) =>
        row.account_code === account.account_code &&
        row.unit_id === account.unit_id
    )?.per_books_minor ?? null

  const chips: ChipOption[] = [
    { value: null, label: "All", count: lines.length },
    { value: "to", label: "To match", count: unmatched.length },
    { value: "ok", label: "Matched", count: matched },
  ]

  const opened = lines.find(({ line }) => line.line_id === openLine) ?? null

  return (
    <PageContent>
      <div className="mb-2">
        <Button variant="ghost" onClick={onBack}>
          <ChevronLeft />
          Bank reconciliation
        </Button>
      </div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {account.account_name}
            {account.no !== null && ` · ${account.no}`}
            <Pill tone="neutral">{account.account_code}</Pill>
          </span>
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => setPrinting(true)}>
              <Printer />
              Print
            </Button>
            <Button variant="ghost" onClick={onUpload}>
              <Download />
              Upload statement
            </Button>
          </>
        }
      />

      {statement === null ? (
        <>
          <KpiStrip className="xl:grid-cols-2">
            <Kpi label="Bank" value="—" />
            <Kpi label="Books" value={money(account.books)} />
          </KpiStrip>
          <EmptyState>No statement has arrived yet.</EmptyState>
        </>
      ) : (
        <>
          <KpiStrip className="xl:grid-cols-4">
            <Kpi
              label={`Bank · ${dayMonth(statement.period_end)}`}
              value={money(statement.closing_minor)}
            />
            <Kpi label="Books" value={money(books)} />
            <Kpi
              label="To match"
              value={count(unmatched.length)}
              onClick={() => setShow("to")}
            />
            <Kpi
              label="Matched"
              value={count(matched)}
              onClick={() => setShow("ok")}
            />
          </KpiStrip>

          <Toolbar className="group/bar">
            <FilterChips
              label="Line"
              value={show === "all" ? null : show}
              options={chips}
              onChange={(next) =>
                setShow(next === "to" || next === "ok" ? next : "all")
              }
            />
            <ExpandingSearch
              value={query}
              onChange={setQuery}
              label="Description, document or amount"
            />
            <Toolbar.Spacer />
            <span className="text-[0.9375rem] text-mute tabular-nums">
              {dayMonth(statement.period_start)} – {day(statement.period_end)}
            </span>
          </Toolbar>

          {linesRead.isPending ? (
            <LoadingState>Reading the statement…</LoadingState>
          ) : lines.length === 0 ? (
            <EmptyState>No line matches</EmptyState>
          ) : searched.length === 0 ? (
            <EmptyState>
              {show === "to" ? "Every line is matched" : "No line matches"}
            </EmptyState>
          ) : (
            <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
              <MiniTable
                head={[
                  "Date",
                  { label: "Description", align: "left" },
                  "Debit",
                  "Credit",
                  "Balance",
                  { label: "In the books", align: "right" },
                ]}
              >
                {whole && (
                  <MiniRow>
                    <MiniCell className="text-mute">
                      {dayMonth(statement.period_start)}
                    </MiniCell>
                    <MiniCell className="text-mute">Saldo awal</MiniCell>
                    <MiniCell align="right"> </MiniCell>
                    <MiniCell align="right"> </MiniCell>
                    <MiniCell align="right">
                      {money(statement.opening_minor)}
                    </MiniCell>
                    <MiniCell align="right"> </MiniCell>
                  </MiniRow>
                )}
                {searched.map(({ line, balance }) => {
                  const word = lineWord(
                    line,
                    suggestions,
                    suggestionsRead.isSuccess
                  )
                  return (
                    <MiniRow key={line.line_id}>
                      <MiniCell>{dayMonth(line.value_date)}</MiniCell>
                      <MiniCell>
                        <button
                          type="button"
                          onClick={() => setOpenLine(line.line_id)}
                          className="block max-w-[34rem] truncate text-left text-ink underline-offset-2 hover:underline"
                          title={lineLabel(line)}
                        >
                          {lineLabel(line)}
                        </button>
                      </MiniCell>
                      <MiniCell align="right">
                        {line.debit_minor === 0 ? "" : money(line.debit_minor)}
                      </MiniCell>
                      <MiniCell align="right">
                        {line.credit_minor === 0
                          ? ""
                          : money(line.credit_minor)}
                      </MiniCell>
                      <MiniCell align="right">{money(balance)}</MiniCell>
                      <MiniCell align="right">
                        <LineBooksCell line={line} word={word} />
                      </MiniCell>
                    </MiniRow>
                  )
                })}
                {whole && (
                  <MiniRow>
                    <MiniCell className="font-semibold text-ink"> </MiniCell>
                    <MiniCell className="font-semibold text-ink">
                      {count(lines.length)}{" "}
                      {lines.length === 1 ? "line" : "lines"}
                    </MiniCell>
                    <MiniCell align="right" className="font-semibold text-ink">
                      {money(
                        lines.reduce(
                          (sum, one) => sum + one.line.debit_minor,
                          0
                        )
                      )}
                    </MiniCell>
                    <MiniCell align="right" className="font-semibold text-ink">
                      {money(
                        lines.reduce(
                          (sum, one) => sum + one.line.credit_minor,
                          0
                        )
                      )}
                    </MiniCell>
                    <MiniCell align="right" className="font-semibold text-ink">
                      {money(statement.closing_minor)}
                    </MiniCell>
                    <MiniCell align="right"> </MiniCell>
                  </MiniRow>
                )}
              </MiniTable>
            </Card>
          )}

          {show !== "ok" && bookOnlyShown.length > 0 && (
            <div className="mt-6">
              <SheetSection
                title="In the books, not at the bank yet"
                aside={`${count(bookOnlyShown.length)} ${
                  bookOnlyShown.length === 1 ? "line" : "lines"
                }`}
              >
                <BookOnlyTable lines={bookOnlyShown} />
              </SheetSection>
            </div>
          )}
        </>
      )}

      {opened !== null && opened !== undefined && statement !== null && (
        <LineSheet
          account={account}
          statement={statement}
          line={opened.line}
          balance={opened.balance}
          suggestions={suggestionOf(suggestions, opened.line)}
          suggestionsKnown={suggestionsRead.isSuccess}
          onClose={() => setOpenLine(null)}
        />
      )}

      {printing && statement !== null && (
        <PrintSheet
          account={account}
          statement={statement}
          lines={unmatched.map((one) => ({
            ...one,
            word: lineWord(one.line, suggestions, suggestionsRead.isSuccess),
          }))}
          bookOnly={bookOnly}
          books={books}
          onClose={() => setPrinting(false)}
        />
      )}
    </PageContent>
  )
}

/// The "In the books" column: the entry the line is, or how far it still has
/// to go.
function LineBooksCell({
  line,
  word,
}: {
  line: BankStatementLineRow
  word: { word: string; tone: "ok" | "info" | "warn" }
}) {
  if (word.tone === "ok") {
    const entry =
      line.matched_entry_number ??
      line.allocations[0]?.entry_number ??
      "Matched"
    return (
      <span className="inline-flex items-center gap-1.5 text-ok-fg">
        <Check className="size-4" aria-hidden />
        {entry}
      </span>
    )
  }
  return (
    <span
      className={cn(word.tone === "info" ? "text-info-fg" : "text-warn-fg")}
    >
      {word.word}
    </span>
  )
}

/// The postings on the account nobody has claimed, under the same Debit and
/// Credit heads the statement uses: debit is money out, credit money in.
function BookOnlyTable({ lines }: { lines: readonly BookOnlyLine[] }) {
  const navigate = useNavigate()
  return (
    <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
      <MiniTable
        head={[
          "Date",
          { label: "Description", align: "left" },
          "Debit",
          "Credit",
          { label: "Status", align: "right" },
        ]}
      >
        {lines.map((line) => (
          <MiniRow key={line.journal_line_id}>
            <MiniCell>{dayMonth(line.posting_date)}</MiniCell>
            <MiniCell>
              <button
                type="button"
                onClick={() =>
                  void navigate({
                    to: "/finance/accounting/journal-entries",
                    search: { entry: line.entry_id },
                  } as never)
                }
                className="block max-w-[34rem] truncate text-left text-ink underline-offset-2 hover:underline"
                title={line.memo}
              >
                {line.memo === "" ? line.entry_number : line.memo}
              </button>
            </MiniCell>
            <MiniCell align="right">
              {line.withdrawal_minor === 0 ? "" : money(line.withdrawal_minor)}
            </MiniCell>
            <MiniCell align="right">
              {line.deposit_minor === 0 ? "" : money(line.deposit_minor)}
            </MiniCell>
            <MiniCell align="right">
              <Status tone="info">
                {count(line.days_outstanding)}{" "}
                {line.days_outstanding === 1 ? "day" : "days"} outstanding
              </Status>
            </MiniCell>
          </MiniRow>
        ))}
      </MiniTable>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// One bank line
// ---------------------------------------------------------------------------

function LineSheet({
  account,
  statement,
  line,
  balance,
  suggestions,
  suggestionsKnown,
  onClose,
}: {
  account: RecAccount
  statement: BankStatementRow
  line: BankStatementLineRow
  balance: number
  suggestions: readonly Suggestion[]
  suggestionsKnown: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [picked, setPicked] = useState<AccountChoice | null>(null)
  const [memo, setMemo] = useState("")

  const matched = line.unallocated_minor <= 0
  const canBook =
    suggestionsKnown &&
    !matched &&
    line.allocated_minor === 0 &&
    line.matched_journal_line_id === null &&
    suggestions.length === 0
  const word = matched
    ? { word: "Matched", tone: "ok" as const }
    : canBook
      ? { word: "Bank only", tone: "warn" as const }
      : { word: "To match", tone: "info" as const }
  const amount = line.debit_minor > 0 ? line.debit_minor : line.credit_minor
  const leader = suggestions.find((one) => one.auto_match)

  const refresh = () => {
    void client.invalidateQueries({
      queryKey: financeKeys.bankLines(statement.statement_id),
    })
    void client.invalidateQueries({
      queryKey: financeKeys.bankSuggestions(statement.statement_id, true),
    })
    void client.invalidateQueries({
      queryKey: financeKeys.bankSuggestions(statement.statement_id, false),
    })
    void client.invalidateQueries({
      queryKey: financeKeys.bankBookOnly(statement.statement_id),
    })
    void client.invalidateQueries({ queryKey: financeKeys.bankStatements() })
    void client.invalidateQueries({ queryKey: ["finance", "money"] })
  }

  const match = useMutation({
    mutationFn: () => {
      if (leader === undefined) throw new Error("No candidate to match")
      return confirmBankMatch(line.line_id, {
        journal_line_id: leader.journal_line_id,
        score: leader.score,
        reasons: [...leader.reasons],
        automatic: false,
        allocated_minor: null,
      })
    },
    onSuccess: () => {
      toast.success("Matched", {
        description: `${lineLabel(line)} · ${money(amount)}`,
      })
      refresh()
      onClose()
    },
  })

  const book = useMutation({
    mutationFn: () => {
      if (picked === null) throw new Error("No account chosen")
      return bookBankLine(line.line_id, {
        account_code: picked.account_code,
        category_code: picked.category_code,
        memo: memo.trim(),
        party_name: null,
      })
    },
    onSuccess: (written) => {
      toast.success(`${written.entry_number} posted`, {
        description: `${money(amount)} · ${picked?.name ?? ""}`,
      })
      refresh()
      onClose()
    },
  })

  const primary = matched
    ? undefined
    : leader !== undefined
      ? {
          label: "Confirm match",
          pending: match.isPending,
          onClick: () => match.mutate(),
        }
      : canBook
        ? {
            label: line.debit_minor > 0 ? "Book BKK" : "Book BKM",
            pending: book.isPending,
            disabled: !accountChoiceReady(picked) || memo.trim() === "",
            onClick: () => book.mutate(),
          }
        : undefined

  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      context="Bank reconciliation"
      title={lineLabel(line)}
      id={account.account_code}
      badge={<Pill tone={word.tone}>{word.word}</Pill>}
      size="rail"
      stack
      dirty={canBook && (picked !== null || memo.trim() !== "")}
      footer={
        <SheetFooter
          onCancel={onClose}
          cancelLabel="Close"
          primary={primary}
          error={match.error ?? book.error}
          note={
            !matched && suggestions.length > 0 && leader === undefined
              ? "No candidate is sure enough to confirm here. Open the bank matcher to pick one."
              : canBook && !accountChoiceReady(picked)
                ? "Choose the account this line belongs to."
                : canBook && memo.trim() === ""
                  ? "Say why this line is that account."
                  : undefined
          }
        />
      }
    >
      <Facts>
        <Fact term="Date">{day(line.value_date)}</Fact>
        <Fact term={line.debit_minor > 0 ? "Debit" : "Credit"}>
          {money(amount)}
        </Fact>
        <Fact term="Balance after">{money(balance)}</Fact>
        <Fact term="Statement">
          {account.account_name} · {day(statement.period_end)}
        </Fact>
      </Facts>

      <SheetSection
        title="In the books"
        aside={`${money(line.allocated_minor)} claimed`}
      >
        {matched ? (
          <div className="flex flex-col gap-4">
            <Facts>
              <Fact term="Matched to">
                {line.matched_entry_number ??
                  line.allocations[0]?.entry_number ??
                  "—"}
              </Fact>
              <Fact term="Claimed">{money(line.allocated_minor)}</Fact>
            </Facts>
            {line.match_reasons.length > 0 && (
              <p className="text-[0.9375rem] text-body">
                {line.match_reasons.join(" · ")}
              </p>
            )}
            {line.allocations.length > 1 && (
              <MiniTable
                head={[
                  { label: "Entry", align: "left" },
                  "Claimed",
                  { label: "How", align: "left" },
                ]}
              >
                {line.allocations.map((one) => (
                  <MiniRow key={one.match_id}>
                    <MiniCell>{one.entry_number ?? "—"}</MiniCell>
                    <MiniCell align="right">
                      {money(one.allocated_minor)}
                    </MiniCell>
                    <MiniCell>{one.reasons.join(" · ")}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            )}
          </div>
        ) : canBook ? (
          <div className="flex flex-col gap-4">
            <p className="text-[0.9375rem] text-body">
              Not in the books yet. Book this line as its own{" "}
              {line.debit_minor > 0 ? "BKK" : "BKM"} and it is reconciled in the
              same breath.
            </p>
            <Field label="Account" required>
              <AccountAndCategory value={picked} onChange={setPicked} />
            </Field>
            <Field label="Why this account" required>
              <Textarea
                rows={2}
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="Printed on the entry"
              />
            </Field>
          </div>
        ) : !suggestionsKnown ? (
          <p className="text-[0.9375rem] text-body">
            Reading what the matcher offers for this line…
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[0.9375rem] text-body">
              The matcher offers {count(suggestions.length)}{" "}
              {suggestions.length === 1 ? "candidate" : "candidates"} for this
              line.
            </p>
            {leader !== undefined && (
              <p className="text-[0.9375rem] text-body">
                Its surest candidate agrees: {leader.reasons.join(" · ")}.
              </p>
            )}
          </div>
        )}
      </SheetSection>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// The printout
// ---------------------------------------------------------------------------

function PrintSheet({
  account,
  statement,
  lines,
  bookOnly,
  books,
  onClose,
}: {
  account: RecAccount
  statement: BankStatementRow
  lines: readonly {
    readonly line: BankStatementLineRow
    readonly balance: number
    readonly word: { readonly word: string; readonly tone: string }
  }[]
  bookOnly: readonly BookOnlyLine[]
  books: number | null
  onClose: () => void
}) {
  const difference = books === null ? null : statement.closing_minor - books
  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      context="Bank reconciliation"
      id={account.account_code}
      title={`Rekonsiliasi Bank · ${day(statement.period_end)}`}
      size="wide"
      stack
      footer={
        <SheetFooter
          onCancel={onClose}
          cancelLabel="Close"
          primary={{ label: "Print", onClick: () => window.print() }}
        />
      }
    >
      <Facts>
        <Fact term="Account">
          {account.account_name}
          {account.no === null ? "" : ` · ${account.no}`}
        </Fact>
        <Fact term="Statement">
          {day(statement.period_start)} – {day(statement.period_end)}
        </Fact>
        <Fact term="Imported">{day(statement.imported_at)}</Fact>
        <Fact term="Printed">{day(new Date())}</Fact>
      </Facts>

      <SheetSection title="Reconciliation">
        <TotalsLadder
          rows={[
            {
              label: `Bank · ${day(statement.period_end)}`,
              value: money(statement.closing_minor),
            },
            { label: "− Books", value: money(books) },
          ]}
          total={{
            label: "= Difference",
            value:
              difference === null ? (
                "—"
              ) : difference === 0 ? (
                money(0)
              ) : (
                <span className="text-bad-fg">{signedRupiah(difference)}</span>
              ),
          }}
        />
      </SheetSection>

      {(lines.length > 0 || bookOnly.length > 0) && (
        <SheetSection
          title="To match"
          aside={`${count(lines.length + bookOnly.length)} ${
            lines.length + bookOnly.length === 1 ? "line" : "lines"
          }`}
        >
          <MiniTable
            head={[
              "Date",
              { label: "Description", align: "left" },
              "Debit",
              "Credit",
              { label: "In the books", align: "right" },
            ]}
          >
            {lines.map(({ line, word }) => (
              <MiniRow key={line.line_id}>
                <MiniCell>{dayMonth(line.value_date)}</MiniCell>
                <MiniCell>{lineLabel(line)}</MiniCell>
                <MiniCell align="right">
                  {line.debit_minor === 0 ? "" : money(line.debit_minor)}
                </MiniCell>
                <MiniCell align="right">
                  {line.credit_minor === 0 ? "" : money(line.credit_minor)}
                </MiniCell>
                <MiniCell align="right">{word.word}</MiniCell>
              </MiniRow>
            ))}
            {bookOnly.map((line) => (
              <MiniRow key={line.journal_line_id}>
                <MiniCell>{dayMonth(line.posting_date)}</MiniCell>
                <MiniCell>
                  {line.memo === "" ? line.entry_number : line.memo}
                </MiniCell>
                <MiniCell align="right">
                  {line.withdrawal_minor === 0
                    ? ""
                    : money(line.withdrawal_minor)}
                </MiniCell>
                <MiniCell align="right">
                  {line.deposit_minor === 0 ? "" : money(line.deposit_minor)}
                </MiniCell>
                <MiniCell align="right">{line.entry_number}</MiniCell>
              </MiniRow>
            ))}
          </MiniTable>
        </SheetSection>
      )}
    </Sheet>
  )
}

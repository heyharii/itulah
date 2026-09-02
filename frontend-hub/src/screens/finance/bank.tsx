import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Textarea } from "@/components/ui/field"
import { Meter } from "@/components/ui/meter"
import { KeyValue } from "@/components/ui/rows"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, day, money, moment } from "@/lib/format"
import {
  bankStatementLines,
  bankSuggestions,
  confirmBankMatch,
  financeKeys,
  importBankStatement,
  listBankStatements,
  unmatchBankLine,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  AccountPicker,
  LocationSelect,
  SiteName,
} from "@/screens/finance/parts"
import {
  parseMinor,
  parseStatementPaste,
  todayIso,
} from "@/screens/finance/chart"
import type {
  BankStatementLineRow,
  BankStatementRow,
  Suggestion,
} from "@itulah/contract"

/// Do the bank and the ledger agree?
///
/// # What matching is, and what it is not
///
/// Agreeing that a bank line and a journal line are the same event **posts
/// nothing**. It records that we booked something and the bank confirmed it. A
/// reconciliation tool that posted entries would stop checking the books and
/// start writing them, and the check would be worthless.
///
/// # Why the reasons are shown and the score is not
///
/// The score only orders the candidates; what a person reads before agreeing is
/// which fields actually agreed. And `auto_match` needs a *unique* leader — two
/// identical payments to two suppliers on the same Friday auto-match nothing.
/// That is an ordinary week, not a failure, so the screen says so rather than
/// picking one.
///
/// # An unmatched line with no candidate
///
/// Means one of exactly two things, and the screen has to say both: the payment
/// is still in transit, or we never booked it. Both are a person's problem and
/// they have different answers.

const columns: ColumnDef<TableSetup, BankStatementRow>[] = [
  {
    accessorKey: "account_name",
    header: "Account",
    size: 260,
    cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-2">
        <Tag>{row.original.account_code}</Tag>
        <span className="truncate font-medium text-ink">
          {row.original.account_name}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "site_id",
    header: "Location",
    size: 130,
    // The client's own name for it. The id stays in `title`, because that is
    // what the account codes carry and what a support call will be about.
    cell: ({ row }) => <SiteName id={row.original.site_id} />,
  },
  {
    id: "period",
    accessorFn: (row) => row.period_start,
    header: "Period",
    size: 200,
    cell: ({ row }) => (
      <span className="text-body">
        {day(row.original.period_start)} – {day(row.original.period_end)}
      </span>
    ),
  },
  {
    accessorKey: "closing_minor",
    header: "Closing",
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) => money(row.original.closing_minor),
  },
  {
    id: "agreed",
    accessorFn: (row) =>
      row.line_count === 0 ? 1 : row.matched_count / row.line_count,
    header: "Agreed",
    size: 160,
    cell: ({ row }) => {
      const statement = row.original
      const share =
        statement.line_count === 0
          ? 1
          : statement.matched_count / statement.line_count
      return (
        <span className="flex items-center gap-2">
          <Meter value={share} tone={share === 1 ? "ok" : "accent"} />
          <span className="shrink-0 text-[0.71875rem] text-body tabular-nums">
            {count(statement.matched_count)}/{count(statement.line_count)}
          </span>
        </span>
      )
    },
  },
  {
    id: "unmatched",
    accessorFn: (row) => row.line_count - row.matched_count,
    header: "Unmatched",
    size: 130,
    meta: { align: "right" },
    // The decision metric: a statement fully agreed is done, and anything else
    // is lines somebody has to look at.
    cell: ({ row }) => {
      const open = row.original.line_count - row.original.matched_count
      return open === 0 ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="font-medium text-warn-fg tabular-nums">
          {count(open)}
        </span>
      )
    },
  },
  {
    accessorKey: "imported_at",
    header: "Imported",
    size: 170,
    cell: ({ row }) => moment(row.original.imported_at),
  },
]

export function BankReconciliation() {
  const [query, setQuery] = useState("")
  const [importing, setImporting] = useState(false)
  const statement = useSheet("statement")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "unmatched", desc: true },
  ])

  const statements = useQuery({
    queryKey: financeKeys.bankStatements(),
    queryFn: ({ signal }) => listBankStatements(signal),
  })

  const rows = useMemo(() => statements.data ?? [], [statements.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: BankStatementRow) => row.statement_id,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, query, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Bank reconciliation"
        sub="What the bank says happened, against what we booked. Agreeing posts nothing."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            <Button variant="dark" onClick={() => setImporting(true)}>
              Import statement
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        {queryState(statements, {
          loading: "Loading the statements…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No bank statement has been imported yet, so there is nothing to
                check the books against.
              </EmptyState>
            ) : (
              <DataTable<BankStatementRow>
                table={table}
                onRowClick={(row) => statement.open(row.statement_id)}
                isSelected={(row) => row.statement_id === statement.value}
                empty="No statement matches that search."
                className="max-h-[calc(100vh-14rem)]"
              />
            ),
        })}
      </Card>

      <ReconcileSheet id={statement.value ?? null} onClose={statement.close} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
    </PageContent>
  )
}

/// One statement's lines, and the ledger lines they might be.
function ReconcileSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()

  const statements = useQuery({
    queryKey: financeKeys.bankStatements(),
    queryFn: ({ signal }) => listBankStatements(signal),
    enabled: id !== null,
  })
  const lines = useQuery({
    queryKey: financeKeys.bankLines(id ?? ""),
    queryFn: ({ signal }) => bankStatementLines(id!, signal),
    enabled: id !== null,
  })
  const suggestions = useQuery({
    queryKey: financeKeys.bankSuggestions(id ?? ""),
    queryFn: ({ signal }) => bankSuggestions(id!, signal),
    // Scoring every unmatched line against the ledger is the expensive read
    // here, so it waits for the lines rather than racing them.
    enabled: id !== null && lines.isSuccess,
  })

  const statement = statements.data?.find((row) => row.statement_id === id)

  const invalidate = () => {
    // Agreeing or un-agreeing changes the lines, the scores that were computed
    // around them, and the statement's matched count. It changes no balance,
    // which is why the ledger keys are deliberately left alone.
    client.invalidateQueries({ queryKey: financeKeys.bankLines(id ?? "") })
    client.invalidateQueries({
      queryKey: financeKeys.bankSuggestions(id ?? ""),
    })
    client.invalidateQueries({ queryKey: financeKeys.bankStatements() })
  }

  const confirm = useMutation({
    mutationFn: (input: { lineId: string; suggestion: Suggestion }) =>
      confirmBankMatch(input.lineId, {
        journal_line_id: input.suggestion.journal_line_id,
        score: input.suggestion.score,
        reasons: [...input.suggestion.reasons],
        // Recorded so that an auto-match somebody later undoes is evidence the
        // threshold is wrong.
        automatic: input.suggestion.auto_match,
      }),
    onSuccess: invalidate,
  })

  const undo = useMutation({
    mutationFn: (lineId: string) => unmatchBankLine(lineId),
    onSuccess: invalidate,
  })

  const byLine = useMemo(() => {
    const map = new Map<string, readonly Suggestion[]>()
    for (const row of suggestions.data ?? [])
      map.set(row.line_id, row.suggestions)
    return map
  }, [suggestions.data])

  const unmatched = (lines.data ?? []).filter(
    (line) => line.matched_journal_line_id === null
  )
  const matched = (lines.data ?? []).filter(
    (line) => line.matched_journal_line_id !== null
  )

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "bank_statement", id }}
      onOpenChange={(next) => !next && onClose()}
      id={statement?.account_code}
      title={statement?.account_name ?? "Bank statement"}
      className="w-[36rem]"
    >
      {queryState(lines, {
        loading: "Loading the statement…",
        render: () => (
          <div className="flex flex-col gap-5">
            {(confirm.isError || undo.isError) && (
              <Banner tone="bad">
                {(confirm.error ?? undo.error) instanceof Error
                  ? ((confirm.error ?? undo.error) as Error).message
                  : "The change was refused."}
              </Banner>
            )}

            {statement && (
              <>
                <Facts>
                  <Fact term="Location">
                    <SiteName id={statement.site_id} />
                  </Fact>
                  <Fact term="Period">
                    {day(statement.period_start)} – {day(statement.period_end)}
                  </Fact>
                  <Fact term="Imported by">{statement.imported_by}</Fact>
                  <Fact term="Imported at">
                    {moment(statement.imported_at)}
                  </Fact>
                </Facts>

                <div>
                  <KeyValue term="Opening">
                    {money(statement.opening_minor)}
                  </KeyValue>
                  <KeyValue term="Closing">
                    {money(statement.closing_minor)}
                  </KeyValue>
                  <KeyValue term="Agreed">
                    {count(statement.matched_count)} of{" "}
                    {count(statement.line_count)}
                  </KeyValue>
                </div>
              </>
            )}

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                Still to agree
                {unmatched.length > 0 && (
                  <span className="ml-1.5 text-mute tabular-nums">
                    {count(unmatched.length)}
                  </span>
                )}
              </h4>
              {unmatched.length === 0 ? (
                <p className="text-meta text-body">
                  Every line the bank reported has been agreed against a line in
                  our own books.
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {unmatched.map((line) => (
                    <UnmatchedLine
                      key={line.line_id}
                      line={line}
                      suggestions={byLine.get(line.line_id) ?? []}
                      scoring={suggestions.isPending}
                      busy={confirm.isPending}
                      onAccept={(suggestion) =>
                        confirm.mutate({ lineId: line.line_id, suggestion })
                      }
                    />
                  ))}
                </div>
              )}
            </div>

            {matched.length > 0 && (
              <div>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Agreed
                  <span className="ml-1.5 text-mute tabular-nums">
                    {count(matched.length)}
                  </span>
                </h4>
                <div className="flex flex-col gap-1.5">
                  {matched.map((line) => (
                    <div
                      key={line.line_id}
                      className="flex items-center gap-2.5 rounded-inner border border-hairline px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.78125rem] text-ink">
                          {line.description}
                        </span>
                        <span className="block text-[0.65625rem] text-mute">
                          {day(line.value_date)} ·{" "}
                          {line.matched_entry_number ?? "an entry"}
                          {line.match_reasons.length > 0
                            ? ` · ${line.match_reasons.join(", ")}`
                            : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-[0.78125rem] tabular-nums">
                        {money(
                          line.debit_minor === 0
                            ? line.credit_minor
                            : line.debit_minor
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant="quiet"
                        disabled={undo.isPending}
                        onClick={() => undo.mutate(line.line_id)}
                      >
                        Undo
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ),
      })}
    </Sheet>
  )
}

function UnmatchedLine({
  line,
  suggestions,
  scoring,
  busy,
  onAccept,
}: {
  line: BankStatementLineRow
  suggestions: readonly Suggestion[]
  scoring: boolean
  busy: boolean
  onAccept: (suggestion: Suggestion) => void
}) {
  // Three candidates. Past that the list stops being a decision and starts
  // being a search, and a search wants the ledger, not this panel.
  const top = suggestions.slice(0, 3)

  return (
    <div className="rounded-inner border border-hairline p-3">
      <div className="flex items-start gap-2.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[0.8125rem] text-ink">
            {line.description}
          </span>
          <span className="block text-[0.65625rem] text-mute">
            {day(line.value_date)}
            {line.reference ? ` · ${line.reference}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-[0.8125rem] font-medium tabular-nums">
          {line.debit_minor === 0
            ? money(line.credit_minor)
            : money(line.debit_minor)}
        </span>
        <Pill tone={line.debit_minor === 0 ? "ok" : "warn"}>
          {line.debit_minor === 0 ? "In" : "Out"}
        </Pill>
      </div>

      {scoring ? (
        <p className="mt-2 text-[0.71875rem] text-mute">
          Scoring against the ledger…
        </p>
      ) : top.length === 0 ? (
        <p className="mt-2 text-[0.71875rem] text-body">
          Nothing in our books looks like this. Either it is still in transit,
          or we never booked it — and those have different answers.
        </p>
      ) : (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {top.map((suggestion) => (
            <div
              key={suggestion.journal_line_id}
              className="flex items-center gap-2.5 border-t border-hairline pt-2"
            >
              <span className="min-w-0 flex-1">
                {/* The reasons, in words. The score only orders them. */}
                <span className="block text-[0.71875rem] text-text">
                  {suggestion.reasons.join(" · ")}
                </span>
                {/* Text, not a link, and it has to stay text. A `Suggestion`
                    carries `journal_line_id` — the line, not the entry — and
                    nothing in this app is addressed by a journal *line*: the
                    journal sheet opens on an `entry_id`, which the suggestion
                    does not carry and no endpoint will trade for it. Linking
                    the line id to the entry sheet would 404 on a click; the
                    same gap keeps `matched_entry_number` above unlinked, where
                    the number is the entry's own and the id still is not.
                    Closing it means `Suggestion` growing an entry id in
                    `cloud/http/finance.rs`. */}
                <span className="block font-mono text-[0.65625rem] text-mute">
                  {suggestion.journal_line_id}
                </span>
              </span>
              {suggestion.auto_match && <Pill tone="ok">Clear match</Pill>}
              <Button
                size="sm"
                variant={suggestion.auto_match ? "soft" : "ghost"}
                disabled={busy}
                onClick={() => onAccept(suggestion)}
              >
                {suggestion.auto_match ? "Accept" : "Match"}
              </Button>
            </div>
          ))}
          {top.length > 1 && !top[0].auto_match && (
            <p className="text-[0.65625rem] text-mute">
              More than one candidate fits, so nothing was matched
              automatically. Two identical payments on the same day is an
              ordinary week.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/// Loading what the bank says happened.
///
/// The banks here export CSV and nothing else, so this takes a paste rather
/// than a file: five columns, one line per row. A row that cannot be read is
/// named with its line number instead of being skipped — an import that
/// silently drops the one line somebody was looking for is worse than one that
/// refuses.
///
/// `accountName` is on the draft beside `accountCode` even though only the code
/// is sent: the picker answers with both, and splitting the pair would let the
/// panel show one account's name over another's code.
interface StatementDraft {
  accountCode: string
  accountName: string
  siteId: string
  start: string
  end: string
  opening: string
  closing: string
  source: string
  paste: string
}

/// The account, the site, the window, two readable balances, and at least one
/// line to load. A statement missing any of those is not a statement.
function statementReady(draft: StatementDraft): boolean {
  return (
    draft.accountCode !== "" &&
    draft.siteId.trim() !== "" &&
    draft.start !== "" &&
    draft.end !== "" &&
    parseMinor(draft.opening) !== null &&
    parseMinor(draft.closing) !== null &&
    parseStatementPaste(draft.paste).lines.length > 0
  )
}

function ImportSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  // What the request answered, not what was typed into it.
  const [receipt, setReceipt] = useState<string | null>(null)

  const load = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: StatementDraft) =>
      importBankStatement({
        account_code: draft.accountCode,
        site_id: draft.siteId.trim(),
        period_start: draft.start,
        period_end: draft.end,
        opening_minor: parseMinor(draft.opening) ?? 0,
        closing_minor: parseMinor(draft.closing) ?? 0,
        source_name: draft.source.trim() === "" ? null : draft.source.trim(),
        lines: parseStatementPaste(draft.paste).lines.map((line) => ({
          ...line,
        })),
      }),
    onSuccess: (outcome) => {
      setReceipt(
        outcome.duplicates === 0
          ? `${count(outcome.inserted)} lines loaded.`
          : `${count(outcome.inserted)} lines loaded, ${count(outcome.duplicates)} already present under this account and left alone.`
      )
      // Only the paste is cleared: the account, the site and the period are the
      // next month's too, and re-picking them is the tedious half of this.
      form.setFieldValue("paste", "")
      // Importing writes no journal entry — it only gives the reconciler
      // something to check against.
      client.invalidateQueries({ queryKey: financeKeys.bankStatements() })
    },
  })

  const form = useForm({
    defaultValues: {
      accountCode: "",
      accountName: "",
      siteId: "",
      start: "",
      end: todayIso(),
      opening: "",
      closing: "",
      source: "",
      paste: "",
    } as StatementDraft,
    onSubmit: ({ value }) => load.mutate(value),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Import a bank statement"
      className="w-[34rem]"
      footer={
        <form.Subscribe
          selector={(state) => ({
            read: parseStatementPaste(state.values.paste).lines.length,
            ready: statementReady(state.values),
          })}
        >
          {(state) => (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[0.71875rem] text-mute tabular-nums">
                {state.read === 0
                  ? "Nothing to load yet"
                  : `${count(state.read)} lines read`}
              </span>
              <Button
                variant="dark"
                disabled={!state.ready || load.isPending}
                onClick={() => form.handleSubmit()}
              >
                {load.isPending ? "Loading…" : "Load"}
              </Button>
            </div>
          )}
        </form.Subscribe>
      }
    >
      <form
        // The button is in the sheet's footer, outside this element, so its
        // disabled state cannot block an Enter keypress.
        onSubmit={(event) => {
          event.preventDefault()
          if (statementReady(form.state.values) && !load.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-3.5"
      >
        {receipt && (
          <Banner tone="ok" onDismiss={() => setReceipt(null)}>
            {receipt}
          </Banner>
        )}
        {load.isError && (
          <Banner tone="bad">
            {load.error instanceof Error
              ? load.error.message
              : "The statement was refused."}
          </Banner>
        )}

        <div>
          <span className="mb-1.5 block text-[0.78125rem] font-medium text-text">
            Bank account
          </span>
          <form.Subscribe
            selector={(state) => ({
              code: state.values.accountCode,
              name: state.values.accountName,
            })}
          >
            {(picked) =>
              picked.code === "" ? (
                <AccountPicker
                  onPick={(account) => {
                    form.setFieldValue("accountCode", account.account_code)
                    form.setFieldValue("accountName", account.name)
                  }}
                  seed="10110"
                  placeholder="Which account is this statement for"
                />
              ) : (
                <div className="flex items-center gap-2 rounded-inner border border-hairline px-3 py-2">
                  <Tag>{picked.code}</Tag>
                  <span className="min-w-0 flex-1 truncate text-[0.78125rem] text-ink">
                    {picked.name}
                  </span>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      form.setFieldValue("accountCode", "")
                      form.setFieldValue("accountName", "")
                    }}
                  >
                    Change
                  </Button>
                </div>
              )
            }
          </form.Subscribe>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <form.Field name="siteId">
            {(field) => (
              <Field label="Location">
                {/* The statement belongs to one bank account at one location,
                    and the id is not a thing anybody knows by heart. */}
                <LocationSelect
                  value={field.state.value}
                  onChange={(next) => field.handleChange(next)}
                  emptyLabel="Choose a location"
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="source">
            {(field) => (
              <Field
                label="Source"
                hint="The file or the bank's own name for it."
              >
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="start">
            {(field) => (
              <Field label="Period start">
                <Input
                  type="date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="end">
            {(field) => (
              <Field label="Period end">
                <Input
                  type="date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="opening">
            {(field) => (
              <Field
                label="Opening balance"
                problem={
                  field.state.value.trim() !== "" &&
                  parseMinor(field.state.value) === null
                    ? "Not a number."
                    : undefined
                }
              >
                <Input
                  inputMode="numeric"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="0"
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="closing">
            {(field) => (
              <Field
                label="Closing balance"
                problem={
                  field.state.value.trim() !== "" &&
                  parseMinor(field.state.value) === null
                    ? "Not a number."
                    : undefined
                }
              >
                <Input
                  inputMode="numeric"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="0"
                />
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="paste">
          {(field) => (
            <Field
              label="Lines"
              hint="One per row: date, description, reference, debit, credit. Commas, semicolons or tabs."
            >
              <Textarea
                rows={8}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="2026-09-01,Transfer BCA,TRX0091,0,4500000"
                className="font-mono text-[0.71875rem]"
              />
            </Field>
          )}
        </form.Field>

        <form.Subscribe
          selector={(state) => parseStatementPaste(state.values.paste).problems}
        >
          {(problems) =>
            problems.length > 0 && (
              <Banner tone="warn">
                <span className="block">
                  {count(problems.length)} rows could not be read and are not in
                  the count below. They are named rather than dropped:
                </span>
                {problems.map((problem) => (
                  <span key={problem} className="mt-1 block">
                    {problem}
                  </span>
                ))}
              </Banner>
            )
          }
        </form.Subscribe>
      </form>
    </Sheet>
  )
}

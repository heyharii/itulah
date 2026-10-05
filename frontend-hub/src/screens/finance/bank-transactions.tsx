import { useForm } from "@tanstack/react-form"
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Fragment, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import {
  bankStatementLines,
  financeKeys,
  importBankStatement,
  listCompanyBankAccounts,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import {
  parseMinor,
  parseStatementPaste,
  todayIso,
} from "@/screens/finance/chart"
import { useUnitName } from "@/screens/finance/hooks"
import { AccountPicker, UnitSelect } from "@/screens/finance/parts"
import { Code, Grid, Note, Td, Th } from "@/screens/finance-final/parts"
import { useStatements } from "@/screens/finance-lab-2/hooks"
import type { BankStatementLineRow, BankStatementRow } from "@itulah/contract"

/// ERPNext's Bank Transaction list: every statement line the bank has ever
/// reported, reconciled or not — the flat log this app did not have before,
/// beside `bank-reconciliation`'s own list of accounts and their difference.
///
/// The owner asked for it directly: "dan jg ada menu bank transactions …
/// jadi bisa jadi upload transaction tapi belum recon" (2026-09-29) — a
/// place to land what the bank sent BEFORE anybody sits down to agree it
/// against the books. Uploading and reconciling are two different afternoons
/// and two different screens; this is the first one.
///
/// # Why this reads statements rather than a line endpoint of its own
///
/// There is no `GET` that returns every line across every statement — lines
/// are only served per statement (`/bank-statements/{id}/lines`), because
/// that is the shape `bank-reconciliation` needed and nothing has asked for
/// the merged view until now. So this screen does the merge itself: it reads
/// every statement the filters narrow to and fetches each one's lines, the
/// same fan-out `finance-final/transactions` already does per money account.
/// A dedicated flat endpoint would replace it outright and is the honest fix
/// once the line count outgrows this.
export function BankTransactions() {
  const [unit, setUnit] = useState("")
  const [month, setMonth] = useState("")
  const [year, setYear] = useState("")
  const [status, setStatus] = useState<"" | "UNRECONCILED" | "RECONCILED">("")
  const [needle, setNeedle] = useState("")
  const [uploading, setUploading] = useState(false)
  const [openLine, setOpenLine] = useState<MergedLine | null>(null)

  const statements = useStatements()
  const unitName = useUnitName()

  const described = useQuery({
    queryKey: financeKeys.companyBankAccounts(null),
    queryFn: ({ signal }) => listCompanyBankAccounts(signal),
    staleTime: 5 * 60_000,
  })

  // Which bank a unit's money is at — the same rule `bank-reconciliation`
  // follows, for the same reason: a statement does not carry its bank
  // account id on the wire, so a unit with two institutions cannot be named
  // without guessing.
  const bankOfUnit = useMemo(() => {
    const seen = new Map<string, string | null>()
    for (const one of described.data ?? []) {
      if (one.status === "CLOSED") continue
      const had = seen.get(one.unit_id)
      if (had === undefined) seen.set(one.unit_id, one.bank_name)
      else if (had !== one.bank_name) seen.set(one.unit_id, null)
    }
    return seen
  }, [described.data])

  const allRows = useMemo(() => statements.data?.rows ?? [], [statements.data])

  // Narrowed to the account and, roughly, the period — before a single line
  // is fetched. A statement whose whole period falls outside the chosen
  // month never has to be asked for its lines.
  const scoped = useMemo(
    () =>
      allRows.filter((row) => {
        if (unit !== "" && row.unit_id !== unit) return false
        if (year !== "" && !overlapsYear(row, year)) return false
        if (month !== "" && !overlapsMonth(row, year, month)) return false
        return true
      }),
    [allRows, unit, year, month]
  )

  const lines = useQueries({
    queries: scoped.map((statement) => ({
      queryKey: financeKeys.bankLines(statement.statement_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        bankStatementLines(statement.statement_id, signal),
    })),
    combine: (answers) => ({
      isPending: answers.some((one) => one.isPending),
      isError: answers.some((one) => one.isError),
      error: answers.find((one) => one.isError)?.error,
      rows: answers.flatMap((one, at) => {
        const statement = scoped[at]
        return (one.data ?? []).map((line): MergedLine => ({
          line,
          statementId: statement.statement_id,
          accountCode: statement.account_code,
          accountName: statement.account_name,
          unitId: statement.unit_id,
          bank: bankOfUnit.get(statement.unit_id) ?? null,
        }))
      }),
    }),
  })

  const shown = useMemo(() => {
    // Typed over what a person reads off the statement: the description, who
    // the other side was, and the bank's reference.
    const text = needle.trim().toLowerCase()
    return lines.rows
      .filter((row) => {
        if (
          text !== "" &&
          ![row.line.description, row.line.party_name, row.line.reference].some(
            (field) => (field ?? "").toLowerCase().includes(text)
          )
        )
          return false
        if (year !== "" && row.line.value_date.slice(0, 4) !== year)
          return false
        if (month !== "" && row.line.value_date.slice(5, 7) !== month)
          return false
        const reconciled = row.line.unallocated_minor === 0
        if (status === "RECONCILED" && !reconciled) return false
        if (status === "UNRECONCILED" && reconciled) return false
        return true
      })
      .sort((a, b) => b.line.value_date.localeCompare(a.line.value_date))
  }, [lines.rows, needle, year, month, status])

  const banksShown = new Set(shown.map((row) => row.bank ?? row.accountName))
    .size

  const deposits = shown.reduce((sum, row) => sum + row.line.credit_minor, 0)
  const withdrawals = shown.reduce((sum, row) => sum + row.line.debit_minor, 0)

  const years = useMemo(
    () =>
      [...new Set(allRows.map((row) => row.period_start.slice(0, 4)))].sort(
        (a, b) => b.localeCompare(a)
      ),
    [allRows]
  )
  const units = useMemo(
    () =>
      [...new Set(allRows.map((row) => row.unit_id))]
        .map((id) => ({
          value: id,
          label:
            bankOfUnit.get(id) == null
              ? unitName(id)
              : `${bankOfUnit.get(id)} — ${unitName(id)}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [allRows, bankOfUnit, unitName]
  )

  const view = {
    isPending: statements.isPending || (scoped.length > 0 && lines.isPending),
    isError: statements.isError || lines.isError,
    error: statements.error ?? lines.error,
    data: statements.data === undefined ? undefined : true,
    refetch: () => {
      void statements.refetch()
    },
  }

  const narrowed =
    needle.trim() !== "" ||
    unit !== "" ||
    month !== "" ||
    year !== "" ||
    status !== ""

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Banking"
        title="Bank Transactions"
        actions={
          <Button variant="primary" onClick={() => setUploading(true)}>
            Upload statement
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        <Toolbar>
          <Input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            aria-label="Search"
            className="h-control w-64"
          />
          <Select
            aria-label="Bank account"
            value={unit}
            onChange={setUnit}
            className="h-control w-56"
          >
            <option value="">All accounts</option>
            {units.map((one) => (
              <option key={one.value} value={one.value}>
                {one.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Status"
            value={status}
            onChange={(next) => setStatus(next as typeof status)}
            className="h-control w-40"
          >
            <option value="">Every status</option>
            <option value="UNRECONCILED">Unreconciled</option>
            <option value="RECONCILED">Reconciled</option>
          </Select>
          <Select
            aria-label="Month"
            value={month}
            onChange={setMonth}
            className="h-control w-36"
          >
            <option value="">Every month</option>
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
            className="h-control w-32"
          >
            <option value="">Every year</option>
            {years.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </Select>
          <Toolbar.Spacer />
          <span className="text-[0.875rem] text-mute">
            {count(shown.length)} lines · {money(deposits)} in ·{" "}
            {money(withdrawals)} out
          </span>
        </Toolbar>

        {/* The account is a column only when there is more than one to tell
            apart. */}
        {queryState(view, {
          loading: "Reading the statements…",
          render: () =>
            allRows.length === 0 ? (
              <Card>
                <EmptyState>
                  No bank statement has been uploaded yet. Upload one and its
                  lines land here, whether or not anybody has agreed them
                  against the books.
                </EmptyState>
              </Card>
            ) : shown.length === 0 ? (
              <Card>
                <EmptyState>
                  {needle.trim() !== ""
                    ? `No line matches “${needle.trim()}”.`
                    : narrowed
                      ? "No line matches these filters."
                      : "Nothing to show."}
                </EmptyState>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <Grid>
                  <thead>
                    <tr>
                      <Th width="8rem">Date</Th>
                      <Th>Description</Th>
                      <Th align="right" width="10rem">
                        Debit
                      </Th>
                      <Th align="right" width="10rem">
                        Credit
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row, index) => {
                      const month = row.line.value_date.slice(0, 7)
                      const first =
                        index === 0 ||
                        shown[index - 1].line.value_date.slice(0, 7) !== month
                      return (
                        <Fragment key={row.line.line_id}>
                          {first && <MonthRow month={month} />}
                          <TransactionRow
                            row={row}
                            showBank={banksShown > 1}
                            onOpen={() => setOpenLine(row)}
                          />
                        </Fragment>
                      )
                    })}
                  </tbody>
                </Grid>
              </Card>
            ),
        })}
      </div>

      <LineSheet line={openLine} onClose={() => setOpenLine(null)} />
      <UploadSheet open={uploading} onClose={() => setUploading(false)} />
    </PageContent>
  )
}

/// A whole statement's window is outside the chosen year.
function overlapsYear(row: BankStatementRow, year: string): boolean {
  return (
    row.period_start.slice(0, 4) <= year && row.period_end.slice(0, 4) >= year
  )
}

/// A whole statement's window is outside the chosen month, in the chosen
/// year (or any year, when none is chosen — narrower than exact, but a
/// statement never spans more than a handful of weeks, so this rarely keeps
/// more than the one month meant).
function overlapsMonth(
  row: BankStatementRow,
  year: string,
  month: string
): boolean {
  const from = `${year || row.period_start.slice(0, 4)}-${month}-01`
  const to = `${year || row.period_end.slice(0, 4)}-${month}-31`
  return row.period_start <= to && row.period_end >= from
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

/// One bank statement line, with the statement it came from — which the row
/// on its own does not carry.
interface MergedLine {
  readonly line: BankStatementLineRow
  readonly statementId: string
  readonly accountCode: string
  readonly accountName: string
  readonly unitId: string
  readonly bank: string | null
}

/// The month a run of lines belongs to, once, instead of a year on every
/// date.
function MonthRow({ month }: { month: string }) {
  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  })
  return (
    <tr>
      <td
        colSpan={4}
        className="bg-soft px-3.5 py-2 text-[0.875rem] font-medium text-body"
      >
        {label}
      </td>
    </tr>
  )
}

/// An internal journal number is how the books remember a match, not
/// something anyone reads a bank line by.
const INTERNAL = /^JV-/

function TransactionRow({
  row,
  showBank,
  onOpen,
}: {
  row: MergedLine
  showBank: boolean
  onOpen: () => void
}) {
  const { line } = row
  const reconciled = line.unallocated_minor === 0
  const reference =
    line.reference !== null && !INTERNAL.test(line.reference)
      ? line.reference
      : null
  const note = [line.party_name, reference].filter(
    (part) => part !== null && part !== ""
  )
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer transition-colors hover:bg-soft"
    >
      <Td className="py-4 pr-8 whitespace-nowrap text-body">
        {new Date(`${line.value_date}T00:00:00`).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
        })}
      </Td>
      <Td className="max-w-0 py-4">
        <span className="block truncate text-ink" title={line.description}>
          {line.description}
        </span>
        {(note.length > 0 || !reconciled || showBank) && (
          <span className="block truncate text-[0.875rem] text-mute">
            {[...note, showBank ? (row.bank ?? row.accountName) : null]
              .filter(Boolean)
              .join(" · ")}
            {!reconciled && (
              <span className="text-warn-fg">
                {note.length > 0 || showBank ? " · " : ""}
                Not matched yet
              </span>
            )}
          </span>
        )}
      </Td>
      <Td align="right" className="py-4 whitespace-nowrap tabular-nums">
        {line.debit_minor > 0 ? (
          <span className="text-ink">{money(line.debit_minor)}</span>
        ) : (
          <span className="text-hairline-strong">·</span>
        )}
      </Td>
      <Td align="right" className="py-4 whitespace-nowrap tabular-nums">
        {line.credit_minor > 0 ? (
          <span className="font-medium text-ok-fg">
            {money(line.credit_minor)}
          </span>
        ) : (
          <span className="text-hairline-strong">·</span>
        )}
      </Td>
    </tr>
  )
}

/// Dot and word, colour spent only on the exception: an unreconciled line is
/// the one worth a person's attention, and one already agreed reads as
/// quietly settled rather than a second kind of good news.
function StatusDot({ reconciled }: { reconciled: boolean }) {
  return (
    <Status tone={reconciled ? "neutral" : "warn"}>
      {reconciled ? "Reconciled" : "Unreconciled"}
    </Status>
  )
}

// ---------------------------------------------------------------------------
// One line's facts, and the way into reconciling it
// ---------------------------------------------------------------------------

function LineSheet({
  line,
  onClose,
}: {
  line: MergedLine | null
  onClose: () => void
}) {
  return (
    <Sheet
      open={line !== null}
      onOpenChange={(next) => !next && onClose()}
      title="Bank transaction"
      className="w-[28rem]"
    >
      {line === null ? null : (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="Date">{day(line.line.value_date)}</Fact>
            <Fact term="Description">{line.line.description}</Fact>
            <Fact term="Reference">{line.line.reference ?? "—"}</Fact>
            <Fact term="Bank account">
              {line.bank ?? line.accountName}
              {" · "}
              <Code>{line.accountCode}</Code>
            </Fact>
            <Fact term="Amount">
              {line.line.credit_minor > 0
                ? `${money(line.line.credit_minor)} in`
                : `${money(line.line.debit_minor)} out`}
            </Fact>
            <Fact term="Status">
              <StatusDot reconciled={line.line.unallocated_minor === 0} />
            </Fact>
            {line.line.allocations.length > 0 && (
              <Fact term="Matched to">
                <div className="flex flex-col gap-1">
                  {line.line.allocations.map((claim) => (
                    <span key={claim.match_id} className="text-body">
                      <Code>{claim.entry_number ?? "an entry"}</Code>{" "}
                      {money(claim.allocated_minor)}
                      {claim.reasons.length > 0 &&
                        ` · ${claim.reasons.join(", ")}`}
                    </span>
                  ))}
                </div>
              </Fact>
            )}
            {line.line.note !== "" && <Fact term="Note">{line.line.note}</Fact>}
          </Facts>

          <AppLink
            to="/finance/cash-bank/bank-reconciliation"
            sheet={{ key: "statement", value: line.statementId }}
            variant="primary"
            className="self-start"
          >
            Reconcile
          </AppLink>
        </div>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Uploading a statement
// ---------------------------------------------------------------------------

/// The draft a person fills before `importBankStatement` can be sent.
///
/// The banks here export CSV and nothing else, and the server takes parsed
/// lines rather than a file (`ImportStatementRequest.lines`), so this is a
/// paste and not a file picker — `parseStatementPaste` is the same reader
/// `finance/bank.tsx`'s own import sheet already uses, kept rather than
/// reinvented so a CSV pasted here reads exactly the same five columns.
interface StatementDraft {
  accountCode: string
  accountName: string
  unitId: string
  start: string
  end: string
  opening: string
  closing: string
  source: string
  paste: string
}

function statementReady(draft: StatementDraft): boolean {
  return (
    draft.accountCode !== "" &&
    draft.unitId.trim() !== "" &&
    draft.start !== "" &&
    draft.end !== "" &&
    parseMinor(draft.opening) !== null &&
    parseMinor(draft.closing) !== null &&
    parseStatementPaste(draft.paste).lines.length > 0
  )
}

function UploadSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()

  const load = useMutation({
    mutationFn: (draft: StatementDraft) =>
      importBankStatement({
        account_code: draft.accountCode,
        unit_id: draft.unitId.trim(),
        period_start: draft.start,
        period_end: draft.end,
        opening_minor: parseMinor(draft.opening) ?? 0,
        closing_minor: parseMinor(draft.closing) ?? 0,
        source_name: draft.source.trim() === "" ? null : draft.source.trim(),
        lines: parseStatementPaste(draft.paste).lines.map((line) => ({
          ...line,
        })),
      }),
    onSuccess: () => {
      form.reset()
      onClose()
      // Uploading writes no journal entry — it only gives lines to read here
      // and candidates for `bank-reconciliation` to score. Both screens read
      // the same statement list, so one invalidation reaches both.
      void client.invalidateQueries({ queryKey: financeKeys.bankStatements() })
      void client.invalidateQueries({ queryKey: ["finance", "money"] })
    },
  })

  const form = useForm({
    defaultValues: {
      accountCode: "",
      accountName: "",
      unitId: "",
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
      title="Upload a bank statement"
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
              <span className="text-[0.875rem] text-mute tabular-nums">
                {state.read === 0
                  ? "Nothing to load yet"
                  : `${count(state.read)} lines read`}
              </span>
              <Button
                variant="primary"
                pending={load.isPending}
                disabled={!state.ready}
                onClick={() => form.handleSubmit()}
              >
                {load.isPending ? "Uploading…" : "Upload"}
              </Button>
            </div>
          )}
        </form.Subscribe>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (statementReady(form.state.values) && !load.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-3.5"
      >
        {load.isError && (
          <Banner tone="bad">
            The statement could not be uploaded. Check the account, the period
            and the lines below, then try again.
          </Banner>
        )}

        <div>
          <span className="mb-1.5 block text-[0.875rem] font-medium text-text">
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
                />
              ) : (
                <div className="flex items-center gap-2 rounded-inner border border-hairline px-3 py-2">
                  <Code>{picked.code}</Code>
                  <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink">
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
          <form.Field name="unitId">
            {(field) => (
              <Field label="Unit" required>
                <UnitSelect
                  value={field.state.value}
                  onChange={(next) => field.handleChange(next)}
                  emptyLabel="Choose a unit"
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
              <Field label="Period start" required>
                <Day
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="end">
            {(field) => (
              <Field label="Period end" required>
                <Day
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="opening">
            {(field) => (
              <Field
                label="Opening balance"
                required
                problem={
                  field.state.value.trim() !== "" &&
                  parseMinor(field.state.value) === null
                    ? "Not a number."
                    : undefined
                }
              >
                <Money
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                  signed
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="closing">
            {(field) => (
              <Field
                label="Closing balance"
                required
                problem={
                  field.state.value.trim() !== "" &&
                  parseMinor(field.state.value) === null
                    ? "Not a number."
                    : undefined
                }
              >
                <Money
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                  signed
                />
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="paste">
          {(field) => (
            <Field
              label="Lines"
              required
              hint="One per row: date, description, reference, debit, credit. Commas, semicolons or tabs — paste the rekening koran CSV as it comes."
            >
              <Textarea
                rows={8}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                className="font-mono text-[0.875rem]"
              />
            </Field>
          )}
        </form.Field>

        <form.Subscribe
          selector={(state) => parseStatementPaste(state.values.paste).problems}
        >
          {(problems) =>
            problems.length > 0 && (
              <Note>
                <span className="block">
                  {count(problems.length)} rows could not be read and are not in
                  the count above:
                </span>
                {problems.map((problem) => (
                  <span key={problem} className="mt-1 block">
                    {problem}
                  </span>
                ))}
              </Note>
            )
          }
        </form.Subscribe>
      </form>
    </Sheet>
  )
}

import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { ChevronLeft } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Money, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue, SubHead } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  LoadingState,
  Problem,
} from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, day, money, moment } from "@/lib/format"
import {
  bankStatementLines,
  bankSuggestions,
  bookBankLine,
  confirmBankMatch,
  financeKeys,
  importBankStatement,
  listBankStatements,
  moneyOverview,
  unmatchBankLine,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  MONEY_FAMILIES,
  parseMinor,
  parseStatementPaste,
  todayIso,
} from "@/screens/finance/chart"
import { useAsOf, useMeaningLabel } from "@/screens/finance/hooks"
import {
  AccountPicker,
  Amount,
  AsOfControl,
  LocationSelect,
  RankedBars,
  SiteName,
} from "@/screens/finance/parts"
import type {
  BankStatementLineRow,
  BankStatementRow,
  MoneyAccountRow,
  Suggestion,
} from "@itulah/contract"

/// Where the money is, and whether the bank agrees.
///
/// # Why this is a list of accounts and no longer a list of statements
///
/// It was a table of imported statements, which is the shape of the *work* and
/// not the shape of the question. A treasurer does not open this screen to see
/// what has been uploaded; they open it to see what the company is holding and
/// where the books and the bank have stopped agreeing. A statement list cannot
/// answer that, because the accounts nobody has uploaded a statement for — the
/// cash drawers, the card receivables, the bank nobody got round to — are
/// exactly the ones that are missing from it.
///
/// So the list is `GET /money`: one row per mapped money account per location,
/// with the last statement beside it. Reconciliation is now the drill-in from a
/// row, which is also where it belongs — agreeing lines is what you do *about*
/// a difference, not the reason you came.
///
/// # What matching is, and what it is not
///
/// Agreeing that a bank line and a journal line are the same event **posts
/// nothing**. It records that we booked something and the bank confirmed it.
///
/// **Booking** one does post. That is the other half, and it is a different
/// act: the bank did something we never recorded — a monthly charge, interest
/// credited — and somebody has to say which account it belongs to. The memo is
/// required because it is the only record of that judgement.
///
/// # Why the reasons are shown and the score is not
///
/// The score only orders the candidates; what a person reads before agreeing is
/// which fields actually agreed. And `auto_match` needs a *unique* leader — two
/// identical payments to two suppliers on the same Friday auto-match nothing.
/// That is an ordinary week, not a failure, so the screen says so rather than
/// picking one.

// ---------------------------------------------------------------------------
// The accounts
// ---------------------------------------------------------------------------

/// One money account, said the way a person says it: the meaning, then which
/// bank.
///
/// "Bank giro · BCA" and not `bank_giro`. The qualifier is part of the identity
/// and not a note — `bank_savings` at one site legitimately holds one account
/// per bank, and "which bank" is the whole of what tells them apart.
function Meaning({ row }: { row: MoneyAccountRow }) {
  const label = useMeaningLabel()
  return (
    <span className="min-w-0 truncate font-medium text-ink">
      {label(row.semantic_key)}
      {row.qualifier !== "" && (
        <span className="font-normal text-mute"> · {row.qualifier}</span>
      )}
    </span>
  )
}

const columns: ColumnDef<TableSetup, MoneyAccountRow>[] = [
  {
    id: "meaning",
    // The label and the qualifier both, so the search box finds "BCA" and
    // "giro". The raw key is deliberately not searchable: nobody types
    // `bank_giro`, and a hit on it would be a hit on a word not on screen.
    accessorFn: (row) => `${row.semantic_key} ${row.qualifier}`,
    header: "Meaning",
    size: 190,
    cell: ({ row }) => <Meaning row={row.original} />,
  },
  {
    accessorKey: "account_name",
    header: "Account",
    size: 250,
    // The client's own name, never translated, with the code beside it — the
    // thing an accountant quotes down a telephone.
    cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-2">
        <Tag>{row.original.account_code}</Tag>
        <span className="truncate text-text">{row.original.account_name}</span>
      </span>
    ),
  },
  {
    accessorKey: "site_id",
    header: "Location",
    size: 120,
    // The client's own name for it. The id stays in `title`, because that is
    // what the account codes carry and what a support call will be about.
    cell: ({ row }) => <SiteName id={row.original.site_id} />,
  },
  {
    accessorKey: "per_books_minor",
    header: "Per books",
    size: 150,
    meta: { align: "right" },
    // In the account's own sign and deliberately unflipped: `giro_outstanding`
    // is a liability and comes back negative, which is what it is. A report
    // decides how to present a balance; a balance does not decide for it.
    cell: ({ row }) => (
      <Amount
        minor={row.original.per_books_minor}
        muteZero
        className="font-medium text-ink"
      />
    ),
  },
  {
    id: "statement",
    accessorFn: (row) => row.last_statement?.closing_minor ?? null,
    header: "Last statement",
    size: 175,
    meta: { align: "right" },
    // Absent is a real answer and not a zero: there is no statement for a cash
    // drawer, and there is none for a bank nobody has uploaded one for either.
    cell: ({ row }) => {
      const last = row.original.last_statement
      if (last === null) return <span className="text-faint">—</span>
      return (
        <span className="inline-flex flex-col items-end">
          <span className="text-body tabular-nums">
            {money(last.closing_minor)}
          </span>
          <span className="text-[0.65625rem] text-mute">
            to {day(last.period_end)}
          </span>
        </span>
      )
    },
  },
  {
    id: "difference",
    accessorFn: (row) => row.difference_minor ?? 0,
    header: "Difference",
    size: 140,
    meta: { align: "right" },
    // Tinted only when it is non-zero, and drawn as a dash when there is no
    // statement at all: "we agree" and "there is nothing to agree with" are
    // different answers and must not render the same.
    cell: ({ row }) => {
      const difference = row.original.difference_minor
      if (difference === null) return <span className="text-faint">—</span>
      if (difference === 0)
        return <span className="text-mute tabular-nums">Rp 0</span>
      return (
        <span className="font-medium text-bad-fg tabular-nums">
          {money(difference)}
        </span>
      )
    },
  },
  {
    id: "unmatched",
    accessorFn: (row) => row.last_statement?.unmatched_count ?? 0,
    header: "Unmatched",
    size: 120,
    meta: { align: "right" },
    // The number that says whether the difference beside it is explained: a
    // difference with no unmatched lines behind it is a real disagreement, and
    // one with six is simply unfinished work.
    cell: ({ row }) => {
      const last = row.original.last_statement
      if (last === null || last.unmatched_count === 0)
        return <span className="text-faint">—</span>
      return <Pill tone="warn">{count(last.unmatched_count)}</Pill>
    },
  },
]

export function BankReconciliation() {
  const [query, setQuery] = useState("")
  const [site, setSite] = useState("")
  const [importing, setImporting] = useState(false)
  const asOf = useAsOf()
  // The money account whose statements are open. `account` and not a key of
  // this screen's own: a row here IS one of the client's accounts, addressed by
  // the same code the Ledger and the Chart of accounts address it by, so the
  // parameter that names one there names the same one here. `lib/sheets.ts` is
  // a shared registry and a second key meaning "an account code" would be two
  // names for one thing — the exact drift it exists to prevent.
  const account = useSheet("account")
  const statement = useSheet("statement")

  const money = useQuery({
    queryKey: financeKeys.money(asOf.value, site || null),
    queryFn: ({ signal }) =>
      moneyOverview({ as_of: asOf.value, site: site || undefined }, signal),
  })

  const rows = useMemo(() => money.data?.rows ?? [], [money.data])

  // Every statement, for the one job the list above cannot do: a link carrying
  // only `?statement=` — from a colleague, or from the address bar after a
  // reload — has to find the account it belongs to before the sheet can open on
  // it. Under the key the sheet itself uses, so it is one request either way.
  const statements = useQuery({
    queryKey: financeKeys.bankStatements(),
    queryFn: ({ signal }) => listBankStatements(signal),
  })

  const openCode =
    account.value ??
    (statement.value === undefined
      ? undefined
      : statements.data?.find((row) => row.statement_id === statement.value)
          ?.account_code)

  // What is still to agree, across every account on screen. Counted from the
  // rows rather than fetched: each carries its last statement's unmatched
  // count, which is the same figure the statement list used to add up.
  const unagreed = rows.reduce(
    (sum, row) => sum + (row.last_statement?.unmatched_count ?? 0),
    0
  )
  const disagreeing = rows.filter(
    (row) => row.difference_minor !== null && row.difference_minor !== 0
  ).length

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Cash & bank"
        sub="Every place money sits, what the books say, and what the bank last said."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            <Button variant="primary" onClick={() => setImporting(true)}>
              Import statement
            </Button>
          </>
        }
      />

      <Toolbar>
        <AsOfControl asOf={asOf} />
        <LocationSelect
          value={site}
          onChange={setSite}
          className="h-8 w-44"
          aria-label="Location"
        />
        <Toolbar.Spacer />
        {/* The effective answer, in words, always. A date box filled with today
            and one left blank look identical to a reader — and here the date
            does real work: the statement beside each row is the last one whose
            period ended on or before it. */}
        <span className="text-[0.71875rem] text-mute">
          {asOf.chip}
          {site === "" ? " · every location" : " · "}
          {site !== "" && <SiteName id={site} />}
          {" · "}
          <span
            className={
              disagreeing > 0
                ? "font-medium text-bad-fg tabular-nums"
                : "font-medium text-ink tabular-nums"
            }
          >
            {count(disagreeing)}
          </span>{" "}
          disagree ·{" "}
          <span
            className={
              unagreed > 0
                ? "font-medium text-warn-fg tabular-nums"
                : "font-medium text-ink tabular-nums"
            }
          >
            {count(unagreed)}
          </span>{" "}
          lines nobody has agreed
        </span>
      </Toolbar>

      {queryState(money, {
        loading: "Reading where the money is…",
        render: () =>
          rows.length === 0 ? (
            <Card>
              <EmptyState>
                {site === ""
                  ? "No meaning that money sits under has an account behind it yet. Until the account map answers cash and bank, there is nowhere for this screen to look."
                  : "Nothing is mapped for this location. Widen the location filter to see the rest."}
              </EmptyState>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Grouped, and visibly. One flat list puts a cash drawer beside
                  a card receivable with nothing to say they are different
                  kinds of thing — and giro outstanding, which is a liability,
                  three rows under a bank balance somebody might add it to. */}
              {MONEY_FAMILIES.map((family) => (
                <MoneyFamily
                  key={family.id}
                  family={family}
                  rows={rows}
                  query={query}
                  selected={account.value ?? null}
                  onOpen={(row) => account.open(row.account_code)}
                />
              ))}
            </div>
          ),
      })}

      <AccountSheet
        code={openCode ?? null}
        rows={rows}
        pending={money.isPending}
        statement={statement}
        onClose={() => {
          // Both, and in this order: leaving the account behind while a
          // statement id stayed in the URL would reopen the sheet on the next
          // render with nothing above it.
          statement.close()
          account.close()
        }}
      />
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
    </PageContent>
  )
}

/// One family of money accounts: a card, its own table, and its own ranking.
///
/// A component rather than four blocks in the screen above, because each family
/// needs a table instance and a sort of its own — and hooks in a loop over a
/// list, even a constant one, is the rule React does not bend.
function MoneyFamily({
  family,
  rows,
  query,
  selected,
  onOpen,
}: {
  family: (typeof MONEY_FAMILIES)[number]
  rows: readonly MoneyAccountRow[]
  query: string
  selected: string | null
  onOpen: (row: MoneyAccountRow) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "per_books_minor", desc: true },
  ])
  /// Whether this family is showing the accounts nothing has happened in.
  ///
  /// It had an inner scroll region a fixed 22rem tall, which cut the list off
  /// mid-row: Cash showed eight of its forty-two accounts and the other
  /// thirty-four were behind a scrollbar that is invisible on a Mac until
  /// somebody starts scrolling. So the card looked complete and was not — and
  /// the fix is not a taller box, because forty-two accounts of which
  /// twenty-eight are an empty petty-cash tin at a shop is not a list anybody
  /// wants to read either.
  ///
  /// The same restraint the ageing on Supplier bills settled on, with the cut
  /// made on what a row SAYS rather than on where it happens to fall: whole
  /// rows, a count of what is not drawn, and a way to see them.
  const [all, setAll] = useState(false)

  const mine = useMemo(
    () => rows.filter((row) => family.keys.includes(row.semantic_key)),
    [rows, family]
  )

  /// Rows worth reading: money in it, or a statement against it.
  ///
  /// Two clauses and not one, because a balance of zero is not the whole
  /// question. A balance of zero with a statement beside it is a reconciled
  /// account and belongs on screen;
  /// a balance of zero with nothing beside it is an account the client mapped
  /// and has never used, and there are dozens of those — one per shop, per
  /// meaning. Unmatched lines need no clause of their own: they live on the
  /// last statement, so an account with any is already kept by the second.
  const telling = useMemo(
    () =>
      mine.filter(
        (row) => row.per_books_minor !== 0 || row.last_statement !== null
      ),
    [mine]
  )

  // A search is its own narrowing, and a stricter one. Hiding a quiet account
  // from somebody who has typed its code would read as a broken search box,
  // which is worse than a long list they asked for.
  const searching = query.trim() !== ""
  const folded = !all && !searching
  const shown = folded ? telling : mine
  const quiet = mine.length - telling.length

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: shown,
        columns,
        getRowId: (row: MoneyAccountRow) => row.account_code,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
      }),
      [shown, query, sorting]
    )
  )

  /// The largest ten by magnitude, and no more.
  ///
  /// Fourteen locations times three cash meanings is forty-two tracks, which is
  /// a list and not a comparison. Magnitude and not value, because a family can
  /// hold a liability: `giro_outstanding` is negative and a track cannot draw a
  /// negative, so the bar is scaled on the size and the figure keeps its sign —
  /// the same bargain `<RankedBars>` makes everywhere.
  const bars = useMemo(
    () =>
      mine
        .filter((row) => row.per_books_minor !== 0)
        .sort(
          (a, b) => Math.abs(b.per_books_minor) - Math.abs(a.per_books_minor)
        )
        .slice(0, 10)
        .map((row) => ({
          key: row.account_code,
          label: <SiteName id={row.site_id} className="text-mute" />,
          value: row.per_books_minor,
        })),
    [mine]
  )

  const held = mine.reduce((sum, row) => sum + row.per_books_minor, 0)

  // A family with no mapped account at all is not drawn. It is not a fact about
  // the money — it is a fact about the account map, and the map's own screen
  // says it in a form somebody can act on.
  if (mine.length === 0) return null

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{family.label}</CardTitle>
        <span className="text-[0.71875rem] text-mute">
          {family.note}
          {" · "}
          <span className="font-medium text-ink tabular-nums">
            {money(held)}
          </span>
          {/* What is not on screen, said on the card rather than left to a
              scrollbar. "34 more at zero" is a fact about the account map — the
              client mapped a petty-cash tin at every shop — and a reader who
              knows it is not looking for a row that is missing. */}
          {folded && quiet > 0 && <> · {count(quiet)} more at zero</>}
        </span>
      </CardHeader>
      <div className="border-t border-hairline">
        <DataTable<MoneyAccountRow>
          table={table}
          onRowClick={onOpen}
          isSelected={(row) => row.account_code === selected}
          empty={
            folded
              ? "Nothing in this family holds a balance or has a statement against it."
              : "No account in this family matches that search."
          }
        />
      </div>
      {/* Below the table and never inside it: the count is about the list, and
          a control that scrolls away with the rows it governs is one nobody
          finds. */}
      {quiet > 0 && !searching && (
        <div className="border-t border-hairline px-4 py-2">
          <Button size="sm" variant="quiet" onClick={() => setAll(!all)}>
            {all
              ? `Show the ${count(telling.length)} worth reading`
              : `Show all ${count(mine.length)}`}
          </Button>
        </div>
      )}
      {bars.length > 0 && (
        <div className="border-t border-hairline px-4 py-3">
          <SubHead
            aside={bars.length === 10 ? "the ten largest" : "largest first"}
          >
            Per books, by account
          </SubHead>
          <RankedBars rows={bars} empty="Nothing is held in this family." />
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// One account, and the statements against it
// ---------------------------------------------------------------------------

/// One money account: what the books say, and every statement imported against
/// it — with the reconcile session one click further in.
///
/// Two levels in one sheet rather than two stacked sheets. A statement is not a
/// record you navigate *to* from here; it is the evidence for the row you are
/// already looking at, and a second veil over the first would say otherwise.
/// Both levels are in the URL, so `?account=…&statement=…` opens the reconcile
/// session with the way back already drawn above it.
function AccountSheet({
  code,
  rows,
  pending,
  statement,
  onClose,
}: {
  code: string | null
  rows: readonly MoneyAccountRow[]
  /// Whether the reading the row would come from is still in flight. "We have
  /// not asked yet" and "there is no such account" are different answers, and a
  /// deep link that flashed the second before settling on the first would tell
  /// somebody their link was broken.
  pending: boolean
  statement: ReturnType<typeof useSheet<"statement">>
  onClose: () => void
}) {
  const statements = useQuery({
    queryKey: financeKeys.bankStatements(),
    queryFn: ({ signal }) => listBankStatements(signal),
    enabled: code !== null,
  })

  const account = rows.find((row) => row.account_code === code)

  // Every statement ever imported against this account at this location — not
  // only the one `GET /money` names. That one is the latest on or before the
  // reporting date; the rest are last month's, and they are what somebody
  // chasing a difference actually opens.
  const mine = (statements.data ?? [])
    .filter(
      (row) =>
        row.account_code === code &&
        (account === undefined || row.site_id === account.site_id)
    )
    .sort((a, b) => b.period_end.localeCompare(a.period_end))

  const open = mine.find((row) => row.statement_id === statement.value)

  return (
    <Sheet
      open={code !== null}
      onOpenChange={(next) => !next && onClose()}
      id={code ?? undefined}
      title={account?.account_name ?? "Money account"}
      className="w-[38rem]"
    >
      {account === undefined ? (
        pending ? (
          <LoadingState>Reading where the money is…</LoadingState>
        ) : (
          <EmptyState>
            No money account on this reading has that code. It may be mapped at
            another location, or as at another date.
          </EmptyState>
        )
      ) : open !== undefined ? (
        <div className="flex flex-col gap-4">
          {/* The way back, and it is a crumb rather than a close: the sheet
              itself did not change, only which half of it is on screen. */}
          <button
            type="button"
            onClick={statement.close}
            className="flex items-center gap-1 self-start text-[0.71875rem] text-mute transition-colors hover:text-accent"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
            All statements for this account
          </button>
          <Reconcile statement={open} />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="Meaning">
              <Meaning row={account} />
            </Fact>
            <Fact term="Location">
              <SiteName id={account.site_id} />
            </Fact>
            <Fact term="Account">{account.account_name}</Fact>
            <Fact term="Ledger">
              <AppLink
                to="/finance/ledger"
                sheet={{ key: "account", value: account.account_code }}
                className="font-mono text-id text-accent hover:underline"
              >
                {account.account_code}
              </AppLink>
            </Fact>
          </Facts>

          <div>
            <KeyValue term="Per books">
              {money(account.per_books_minor)}
            </KeyValue>
            <KeyValue term="Last statement">
              {account.last_statement === null
                ? "—"
                : `${money(account.last_statement.closing_minor)} to ${day(account.last_statement.period_end)}`}
            </KeyValue>
            <KeyValue term="Difference">
              {account.difference_minor === null ? (
                "—"
              ) : account.difference_minor === 0 ? (
                "Rp 0"
              ) : (
                <span className="text-bad-fg">
                  {money(account.difference_minor)}
                </span>
              )}
            </KeyValue>
          </div>

          <div>
            <SubHead aside={mine.length > 0 ? "newest first" : undefined}>
              Statements
            </SubHead>
            {mine.length === 0 ? (
              <p className="text-[0.71875rem] text-body">
                Nothing has been imported for this account, so there is nothing
                to check the books against. A cash drawer never has one; a bank
                account with no statement is unfinished work.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {mine.map((row) => {
                  const unmatched = row.line_count - row.matched_count
                  return (
                    <button
                      key={row.statement_id}
                      type="button"
                      onClick={() => statement.open(row.statement_id)}
                      className="flex items-center gap-2.5 rounded-inner border border-hairline px-3 py-2 text-left transition-colors hover:bg-soft"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.78125rem] text-ink">
                          {day(row.period_start)} – {day(row.period_end)}
                        </span>
                        <span className="block text-[0.65625rem] text-mute">
                          {count(row.matched_count)} of {count(row.line_count)}{" "}
                          agreed · imported {moment(row.imported_at)}
                        </span>
                      </span>
                      <span className="shrink-0 text-[0.78125rem] tabular-nums">
                        {money(row.closing_minor)}
                      </span>
                      {unmatched > 0 && (
                        <Pill tone="warn">{count(unmatched)}</Pill>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Sheet>
  )
}

/// One statement's lines, and the ledger lines they might be.
function Reconcile({ statement }: { statement: BankStatementRow }) {
  const client = useQueryClient()
  const id = statement.statement_id

  const lines = useQuery({
    queryKey: financeKeys.bankLines(id),
    queryFn: ({ signal }) => bankStatementLines(id, signal),
  })
  const suggestions = useQuery({
    queryKey: financeKeys.bankSuggestions(id),
    queryFn: ({ signal }) => bankSuggestions(id, signal),
    // Scoring every unmatched line against the ledger is the expensive read
    // here, so it waits for the lines rather than racing them.
    enabled: lines.isSuccess,
  })

  const invalidate = () => {
    // Agreeing or un-agreeing changes the lines, the scores that were computed
    // around them, and the statement's matched count. It changes no balance,
    // which is why the ledger keys are deliberately left alone.
    client.invalidateQueries({ queryKey: financeKeys.bankLines(id) })
    client.invalidateQueries({ queryKey: financeKeys.bankSuggestions(id) })
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

  /// The entry each line booked in *this* session wrote.
  ///
  /// `BankStatementLineRow` carries `matched_entry_number` but no entry id, and
  /// the journal sheet opens on an id — so a line agreed before this page
  /// loaded can only be linked to the register, where its number is searchable.
  /// The POST answers with both, so a line booked here and now gets the link
  /// that actually opens the entry it just wrote, which is the moment somebody
  /// most wants to look at it.
  const [booked, setBooked] = useState<ReadonlyMap<string, string>>(new Map())

  const book = useMutation({
    mutationFn: (input: {
      lineId: string
      accountCode: string
      memo: string
    }) =>
      bookBankLine(input.lineId, {
        account_code: input.accountCode,
        memo: input.memo.trim(),
      }).then((receipt) => ({ ...receipt, lineId: input.lineId })),
    onSuccess: (receipt) => {
      setBooked((seen) => new Map(seen).set(receipt.lineId, receipt.entry_id))
      // This one DOES post. An entry moves the balances, both statements and
      // the trial balance, so nothing narrower than the namespace is honest —
      // and `/money` itself is now wrong by the amount just booked.
      client.invalidateQueries({ queryKey: financeKeys.all })
    },
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
    <div className="flex flex-col gap-5">
      <Problem error={confirm.error ?? undo.error ?? book.error} />

      <Facts>
        <Fact term="Period">
          {day(statement.period_start)} – {day(statement.period_end)}
        </Fact>
        <Fact term="Imported by">{statement.imported_by}</Fact>
        <Fact term="Imported at">{moment(statement.imported_at)}</Fact>
      </Facts>

      <div>
        <KeyValue term="Opening">{money(statement.opening_minor)}</KeyValue>
        <KeyValue term="Closing">{money(statement.closing_minor)}</KeyValue>
        <KeyValue term="Agreed">
          {count(statement.matched_count)} of {count(statement.line_count)}
        </KeyValue>
      </div>

      {queryState(lines, {
        loading: "Loading the statement…",
        render: () => (
          <>
            <div>
              <SubHead
                aside={
                  unmatched.length > 0
                    ? `${count(unmatched.length)} left`
                    : undefined
                }
              >
                Still to agree
              </SubHead>
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
                      busy={confirm.isPending || book.isPending}
                      onAccept={(suggestion) =>
                        confirm.mutate({ lineId: line.line_id, suggestion })
                      }
                      onBook={(accountCode, memo) =>
                        book.mutate({ lineId: line.line_id, accountCode, memo })
                      }
                    />
                  ))}
                </div>
              )}
            </div>

            {matched.length > 0 && (
              <div>
                <SubHead aside={`${count(matched.length)} agreed`}>
                  Agreed
                </SubHead>
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
                          <EntryLink
                            number={line.matched_entry_number}
                            id={booked.get(line.line_id)}
                          />
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
          </>
        ),
      })}
    </div>
  )
}

/// The entry an agreed line points at.
///
/// A link to the *entry* when we know its id — which is only true for a line
/// booked in this session, because `BankStatementLineRow` carries the number
/// and not the id. Otherwise a link to the register, where that number is what
/// the search box takes. Never a dead number: "JV-00000101" with nothing behind
/// it is a reference somebody has to go and find by hand.
function EntryLink({
  number,
  id,
}: {
  number: string | null
  id: string | undefined
}) {
  if (number === null) return <>an entry</>
  return (
    <AppLink
      to="/finance/journal"
      sheet={id === undefined ? undefined : { key: "entry", value: id }}
      className="font-mono text-accent hover:underline"
    >
      {number}
    </AppLink>
  )
}

function UnmatchedLine({
  line,
  suggestions,
  scoring,
  busy,
  onAccept,
  onBook,
}: {
  line: BankStatementLineRow
  suggestions: readonly Suggestion[]
  scoring: boolean
  busy: boolean
  onAccept: (suggestion: Suggestion) => void
  onBook: (accountCode: string, memo: string) => void
}) {
  // Three candidates. Past that the list stops being a decision and starts
  // being a search, and a search wants the ledger, not this panel.
  const top = suggestions.slice(0, 3)
  const [booking, setBooking] = useState(false)

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
      ) : (
        <>
          {top.length === 0 ? (
            <p className="mt-2 text-[0.71875rem] text-body">
              Nothing in our books looks like this. Either it is still in
              transit, or we never booked it — and those have different answers.
              If it is the second, book it.
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
                    {/* Text, not a link, and it has to stay text. A
                        `Suggestion` carries `journal_line_id` — the line, not
                        the entry — and nothing in this app is addressed by a
                        journal *line*: the journal sheet opens on an
                        `entry_id`, which the suggestion does not carry and no
                        endpoint will trade for it. Closing it means
                        `Suggestion` growing an entry id in
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

          {/* The third answer, beside the other two rather than under a menu.
              Accept and Match both say "the books already have this"; this one
              says they do not, and it is the only control on this screen that
              writes an entry. */}
          {booking ? (
            <BookLine
              busy={busy}
              onCancel={() => setBooking(false)}
              onBook={onBook}
            />
          ) : (
            <div className="mt-2 border-t border-hairline pt-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBooking(true)}
              >
                Book it
              </Button>
              <span className="ml-2 text-[0.65625rem] text-mute">
                The bank did something we never recorded. This posts an entry.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/// Naming the other side of a line the books never had.
///
/// A bank charge goes to bank charges, interest credited to interest income —
/// a postable, active account chosen by the person reading the statement. The
/// memo is required by the server and is not a formality: it is the only record
/// of the judgement somebody made, and a bank line booked with no explanation
/// is the entry an auditor asks about first.
function BookLine({
  busy,
  onCancel,
  onBook,
}: {
  busy: boolean
  onCancel: () => void
  onBook: (accountCode: string, memo: string) => void
}) {
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [memo, setMemo] = useState("")
  const ready = code !== "" && memo.trim() !== ""

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-hairline pt-2.5">
      {code === "" ? (
        <AccountPicker
          placeholder="Which account is the other side of this"
          // Headings and retired accounts are shown and refused rather than
          // hidden: somebody who cannot find the account they are looking at
          // assumes the search is broken. The server refuses the same two.
          accept={(account) => (account.is_active ? null : "retired")}
          onPick={(account) => {
            setCode(account.account_code)
            setName(account.name)
          }}
        />
      ) : (
        <span className="flex min-w-0 items-center gap-2">
          <Tag>{code}</Tag>
          <span className="min-w-0 flex-1 truncate text-[0.78125rem] text-ink">
            {name}
          </span>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              setCode("")
              setName("")
            }}
          >
            Change
          </Button>
        </span>
      )}

      <Field
        label="Why this account"
        hint="Required. It is the only record of the judgement."
      >
        <Input
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="Monthly administration charge"
        />
      </Field>

      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!ready || busy}
          onClick={() => onBook(code, memo)}
        >
          {busy ? "Booking…" : "Book it"}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Importing
// ---------------------------------------------------------------------------

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
      // something to check against. `/money` moves anyway: the row for this
      // account now has a last statement, and therefore a difference.
      client.invalidateQueries({ queryKey: financeKeys.bankStatements() })
      client.invalidateQueries({ queryKey: ["finance", "money"] })
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
                variant="primary"
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
        <Problem error={load.error} />

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
              <Field label="Period end">
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
                <Money
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                  signed
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

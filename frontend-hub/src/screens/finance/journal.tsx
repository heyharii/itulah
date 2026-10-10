import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Plus, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  NoAccessState,
  NoMatch,
} from "@/components/ui/states"
import { useFilters } from "@/lib/filters"
import { count, day, label, money, moment } from "@/lib/format"
import {
  financeKeys,
  journalEntry,
  listJournal,
  postManualEntry,
  reverseEntry,
  type ManualLine,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { useWindow } from "@/screens/finance/hooks"
import {
  AccountAndCategory,
  accountChoiceReady,
  UnitName,
  UnitSelect,
  WindowControl,
  type AccountChoice,
} from "@/screens/finance/parts"
import { parseMinor, todayIso } from "@/screens/finance/chart"
import { idempotencyKey } from "@itulah/contract/client"
import type { JournalEntryRow } from "@itulah/contract"

/// Every entry in the books.
///
/// # Why a reversal is a link and not a status
///
/// Both entries are real and both stay. The journal is append-only: a wrong
/// entry is not edited or deleted, it is answered by its mirror. Marking the
/// original "cancelled" would suggest it went away, and it did not — it is
/// still in the ledger, still in every balance up to the reversal date, and
/// still the record of what somebody actually did.
///
/// So the list carries the *fact* that an entry has been answered, and the
/// sheet carries which entry answered it.
///
/// # Why the source filter is a select and not a segmented control
///
/// A segment filters one dataset, which is exactly what this does, and six
/// pills would have been the right shape on a bare toolbar. This toolbar
/// already carries two date boxes and a location select, and six more pills
/// wrap onto a second row — a filter bar that reflows as somebody reads it is
/// worse than one control that does not. The kinds are also not a closed set
/// of six: the schema allows `SALE_DAY`, `STOCK_COUNT` and `TRANSFER` too, and
/// the day the till starts writing them a select grows an option where a
/// segmented control needs a redesign.

/// What wrote an entry. The values are the schema's own — `journal_entry`
/// carries a CHECK over exactly these — and the labels are what a person
/// calls them.
///
/// Five of the eight, and the three that are missing are missing on purpose:
/// `SALE_DAY`, `STOCK_COUNT` and `TRANSFER` are written by the till and the
/// warehouse and none of them has ever appeared in these books. An option
/// that always answers "nothing" is a filter that reads as broken.
const SOURCE_KINDS: readonly { value: string; label: string }[] = [
  { value: "", label: "All sources" },
  { value: "MANUAL", label: "Manual" },
  { value: "SUPPLIER_INVOICE", label: "Supplier invoice" },
  { value: "PAYMENT", label: "Payment" },
  { value: "DEPRECIATION", label: "Depreciation" },
  { value: "REVERSAL", label: "Reversal" },
]

const columns: ColumnDef<TableSetup, JournalEntryRow>[] = [
  {
    accessorKey: "entry_number",
    header: "Entry",
    size: 150,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.entry_number}
      </span>
    ),
  },
  {
    accessorKey: "posting_date",
    header: "Posted",
    size: 120,
    cell: ({ row }) => day(row.original.posting_date),
  },
  {
    accessorKey: "source_kind",
    header: "Source",
    size: 160,
    cell: ({ row }) => (
      <Pill tone={row.original.source_kind === "MANUAL" ? "warn" : "neutral"}>
        {label(row.original.source_kind)}
      </Pill>
    ),
  },
  {
    accessorKey: "memo",
    header: "Memo",
    size: 300,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-text">{row.original.memo ?? "—"}</span>
    ),
  },
  {
    id: "answered",
    accessorFn: (row) =>
      row.reversed_by !== null ? 2 : row.reversal_of !== null ? 1 : 0,
    header: "Answered",
    size: 130,
    enableSorting: false,
    // The decision metric, and why the list leads with it: an entry that has
    // been reversed, or that is itself a reversal, is the one somebody is
    // looking for when they open this screen.
    //
    // It is also the only question on this list nothing else can ask: the
    // toolbar narrows by window, source and location on the wire, and the
    // search box reads the memo. Whether an entry was answered is derived from
    // two nullable fields and appears nowhere the server can be asked about.
    // The three arms are named rather than left as 0/1/2 — the accessor's
    // numbers are a sort order, not a vocabulary.
    meta: {
      filter: {
        kind: "option",
        format: (value) =>
          value === "2" ? "Reversed" : value === "1" ? "Reversal" : "Neither",
      },
    },
    cell: ({ row }) =>
      row.original.reversed_by !== null ? (
        <Pill tone="bad">Reversed</Pill>
      ) : row.original.reversal_of !== null ? (
        <Pill tone="info">Reversal</Pill>
      ) : (
        <span className="text-faint">—</span>
      ),
  },
  {
    accessorKey: "line_count",
    header: "Lines",
    size: 90,
    enableSorting: false,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.line_count),
  },
  {
    accessorKey: "total_minor",
    header: "Total",
    size: 150,
    meta: {
      align: "right",
      // Minor units on the wire, whole rupiah in the box: somebody hunting the
      // entries over ten million types 10000000.
      filter: { kind: "number", unit: "Rp" },
    },
    // Sorted on the minor integer and never on the rendered string: "Rp
    // 1.234.567" sorts a million between ten and eleven.
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        {money(row.original.total_minor)}
      </span>
    ),
  },
]

/// How many entries one page of the register asks for. A step, not a
/// ceiling: the table asks for the next page as its last rows scroll into view.
const PAGE = 100

/// The columns the server can order by, and the word it knows each one as.
/// Every other column carries `enableSorting: false`: sorting the pages in
/// hand and calling it the register is the mistake infinite scroll invites.
const SORTS: Record<string, string> = {
  entry_number: "number",
  posting_date: "date",
  source_kind: "kind",
  total_minor: "total",
}

export function Journal() {
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState("")
  const [unit, setUnit] = useState("")
  const [composing, setComposing] = useState(false)
  const entry = useSheet("entry")
  const range = useWindow()
  const [sorting, setSorting] = useState<SortingState>([
    { id: "posting_date", desc: true },
  ])

  /// Debounced, because every keystroke is a round trip over the register.
  const needle = useDebounced(query.trim(), 400)
  const by = sorting[0]
  const scope = {
    from: range.from,
    to: range.to,
    kind: kind || undefined,
    unit: unit || undefined,
    q: needle === "" ? undefined : needle,
    sort: by === undefined ? undefined : SORTS[by.id],
    dir: by?.desc === true ? "desc" : undefined,
    limit: PAGE,
  }

  // The window, the source, the location, the search and the order all go on
  // the wire, and none is applied here — so every page is a page of the
  // answer, and the register reads on to its end as somebody scrolls.
  const entries = useInfiniteQuery({
    queryKey: [
      ...financeKeys.journal(range.from, range.to, kind || null, unit || null),
      "pages",
      scope,
    ],
    queryFn: ({ pageParam, signal }) =>
      listJournal({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // The previous answer stays on screen while the next is fetched. Without
    // it every keystroke empties the table to a loading line.
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => entries.data?.pages.flatMap((page) => page.rows) ?? [],
    [entries.data]
  )
  // How many entries the window, the search and the filters match, from the
  // server — never the length of the pages loaded so far.
  const matched = entries.data?.pages[0]?.total ?? 0

  const filters = useFilters(columns)
  /// Whether the search or a column clause is narrowing the register —
  /// "nothing was posted" and "nothing matches" have different fixes.
  const narrowed = needle !== "" || filters.filters.length > 0
  const clearNarrowing = () => {
    setQuery("")
    filters.clear()
  }

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: JournalEntryRow) => row.entry_id,
        state: {
          columnFilters: filters.columnFilters,
          sorting,
        },
        // The rows arrive in the order the request asked for, and the search
        // box is the server's. Doing either again here would do it to the
        // pages in hand and call it the register.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Journal"
        sub="Append-only. A wrong entry is answered by its mirror, never edited away."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 w-48"
            />
            <Button variant="primary" onClick={() => setComposing(true)}>
              New entry
            </Button>
          </>
        }
      />

      <Toolbar>
        <WindowControl range={range} />
        {/* Wrapped for the reason `<UnitSelect>` is: `<Select>` draws a
            `w-full` span around the native control, and in a wrapping toolbar
            that claims the whole row. */}
        <span className="inline-flex w-48 shrink-0">
          <Select
            value={kind}
            onChange={(next) => setKind(next)}
            className="h-8 w-48"
            aria-label="Source"
          >
            {SOURCE_KINDS.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </Select>
        </span>
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-8 w-44"
          aria-label="Unit"
        />
        {/* Only two columns are offered here, and the three controls to the
            left are the reason: window, source and location all go on the
            wire, so a second copy of any of them in the panel would be two
            answers to one question. What is left is what the wire cannot
            carry, and it narrows the pages loaded — the table keeps reading
            while a clause leaves its end in view. */}
        <FilterPanel model={filters} table={table} />
        <Toolbar.Spacer />
        {/* The window is stated rather than implied, and so is everything else
            narrowing the list, and how many entries the server found. */}
        <span className="text-[0.875rem] text-mute">
          {range.chip}
          {kind !== "" &&
            ` · ${SOURCE_KINDS.find((row) => row.value === kind)?.label}`}
          {unit !== "" && " · "}
          {unit !== "" && <UnitName id={unit} />}
          {entries.data !== undefined &&
            ` · ${count(matched)} ${matched === 1 ? "entry" : "entries"} in it`}
        </span>
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(entries, {
          loading: "Loading the journal…",
          // Every `GET /api/v1/finance/…` is behind SUPERVISOR, so a cashier
          // signed into the hub is refused here rather than served an empty
          // register — and an empty register is exactly what a refusal would
          // otherwise look like.
          refused: (
            <NoAccessState
              what="the journal"
              reach="Reading the books takes a supervisor's sign-in; posting to them, head office's."
            />
          ),
          render: () =>
            rows.length === 0 && narrowed ? (
              <NoMatch what="entries" onClear={clearNarrowing} />
            ) : rows.length === 0 ? (
              <EmptyState>
                No entry was posted between {day(range.from)} and{" "}
                {day(range.to)}
                {kind === "" ? "" : " by that source"}. The window is always set
                now, so this does not say the books are empty — widen it to tell
                the two apart.
              </EmptyState>
            ) : (
              <DataTable<JournalEntryRow>
                table={table}
                onRowClick={(row) => entry.open(row.entry_id)}
                isSelected={(row) => row.entry_id === entry.value}
                // What the column clauses leave of the pages in hand. The
                // table keeps asking for pages while this shows, so it is only
                // final once the register has been read to its end.
                empty={<NoMatch what="entries" onClear={clearNarrowing} />}
                more={entries}
                className="max-h-[calc(100dvh-17rem)]"
              />
            ),
        })}
      </Card>

      <EntrySheet id={entry.value ?? null} onClose={entry.close} />
      <ComposerSheet open={composing} onClose={() => setComposing(false)} />
    </PageContent>
  )
}

/// One entry, its lines, and the two things an auditor asks it by name: who
/// posted it and what answered it.
function EntrySheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [receipt, setReceipt] = useState<string | null>(null)

  const detail = useQuery({
    queryKey: financeKeys.entry(id ?? ""),
    queryFn: ({ signal }) => journalEntry(id!, signal),
    enabled: id !== null,
  })

  const reverse = useMutation({
    mutationFn: () => reverseEntry(id!, reason.trim()),
    onSuccess: (posted) => {
      setReason("")
      setReceipt(posted.entry_number)
      // A reversal writes a new entry and marks the old one answered, so both
      // the register and this entry are stale. Every balance, statement and
      // trial balance moved too — hence the whole namespace, which is the one
      // case where a prefix invalidation is the honest answer.
      client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const answered = detail.data?.entry.reversed_by !== null

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "journal", id }}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.entry.entry_number}
      title={detail.data?.entry.memo ?? "Journal entry"}
      footer={
        detail.data && !answered ? (
          <div className="flex flex-col gap-2">
            <Textarea
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.875rem] text-mute">
                The reason is the only record of why.
              </span>
              <Button
                variant="danger"
                pending={reverse.isPending}
                disabled={reason.trim() === ""}
                onClick={() => reverse.mutate()}
              >
                {reverse.isPending ? "Reversing…" : "Reverse"}
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      {queryState(detail, {
        loading: "Loading the entry…",
        render: ({ entry, lines }) => (
          <div className="flex flex-col gap-5">
            {receipt && (
              <Banner tone="ok" onDismiss={() => setReceipt(null)}>
                Reversed by {receipt}. Both entries stay in the books.
              </Banner>
            )}
            {reverse.isError && (
              <Banner tone="bad">
                {reverse.error instanceof Error
                  ? reverse.error.message
                  : "The reversal was refused."}
              </Banner>
            )}

            <div className="flex flex-wrap gap-1.5">
              <Pill tone={entry.source_kind === "MANUAL" ? "warn" : "neutral"}>
                {label(entry.source_kind)}
              </Pill>
              {entry.reversal_of !== null && <Pill tone="info">Reversal</Pill>}
              {entry.reversed_by !== null && <Pill tone="bad">Reversed</Pill>}
            </div>

            <Facts>
              <Fact term="Posting date">{day(entry.posting_date)}</Fact>
              <Fact term="Currency">{entry.currency}</Fact>
              <Fact term="Posted by">{entry.posted_by}</Fact>
              <Fact term="Posted at">{moment(entry.posted_at)}</Fact>
              {entry.source_id && (
                <Fact term="Source record">
                  <span className="font-mono text-id">{entry.source_id}</span>
                </Fact>
              )}
              {entry.reversal_of && (
                <Fact term="Reverses">
                  <span className="font-mono text-id">{entry.reversal_of}</span>
                </Fact>
              )}
              {entry.reversed_by && (
                <Fact term="Reversed by">
                  <span className="font-mono text-id">{entry.reversed_by}</span>
                </Fact>
              )}
            </Facts>

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                Lines
              </h4>
              <MiniTable head={["Account", "Unit", "Debit", "Credit"]}>
                {lines.map((line) => (
                  <tr
                    key={line.line_number}
                    className="border-t border-hairline"
                  >
                    <td className="py-2 pr-2">
                      <span className="block text-[0.875rem] text-ink">
                        {line.account_name}
                        {/* The category is what the account code used to say
                            on its own. Without it an expense entry is eight
                            lines all reading "Beban umum & administrasi". */}
                        {line.category_name !== null && (
                          <span
                            className="text-mute"
                            title={line.category_code ?? undefined}
                          >
                            {" · "}
                            {line.category_name}
                          </span>
                        )}
                      </span>
                      {/* No dead ends: the question a line raises is "what else
                          is in that account", and the ledger is the answer. The
                          same `account` key every other finance screen opens
                          with, so the link works from either direction. */}
                      <AppLink
                        to="/finance/ledger"
                        sheet={{ key: "account", value: line.account_code }}
                        className="font-mono text-[0.875rem] text-mute hover:text-accent hover:underline"
                      >
                        {line.account_code}
                      </AppLink>
                      {line.memo && (
                        <span className="block text-[0.875rem] text-mute">
                          {line.memo}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right text-[0.875rem] text-body">
                      <UnitName id={line.unit_id} />
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {line.debit_minor === 0 ? (
                        <span className="text-faint">—</span>
                      ) : (
                        money(line.debit_minor)
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {line.credit_minor === 0 ? (
                        <span className="text-faint">—</span>
                      ) : (
                        money(line.credit_minor)
                      )}
                    </td>
                  </tr>
                ))}
              </MiniTable>

              {/* The two sides summed from this entry's own lines — which is a
                  restatement of one document and not of the books, so it is
                  safe here in a way a page-level total never is. The final row
                  is the server's own figure. */}
              <TotalsLadder
                className="mt-3"
                rows={[
                  {
                    label: "Debits",
                    value: money(
                      lines.reduce((sum, line) => sum + line.debit_minor, 0)
                    ),
                  },
                  {
                    label: "Credits",
                    value: money(
                      lines.reduce((sum, line) => sum + line.credit_minor, 0)
                    ),
                  },
                ]}
                total={{
                  label: "Entry total",
                  value: money(entry.total_minor),
                }}
              />
            </div>
          </div>
        ),
      })}
    </Sheet>
  )
}

/// A line being written, before it is anything the server would accept.
///
/// There is no per-line memo here, and the payload sends `null` for it. The
/// server accepts one — an existing entry's lines display theirs — but this
/// composer has never had a box for it, and a field on the draft that nothing
/// can fill is not a feature, it is a `null` with extra steps.
/// `account` is a pair — the code and the category its family asks for — and
/// not a code on its own. Since the chart collapsed to forty accounts, 6301 is
/// one line of the profit and loss and has not yet said what the money went
/// on; the category is what two account codes used to say between them, and
/// the database refuses a line that carries only half of it.
interface DraftLine {
  account: AccountChoice | null
  /// Whose books the line is in: a unit id.
  unit_id: string
  debit: string
  credit: string
}

function blankLine(): DraftLine {
  return {
    account: null,
    unit_id: "",
    debit: "",
    credit: "",
  }
}

interface EntryDraft {
  postingDate: string
  memo: string
  lines: DraftLine[]
}

/// What the draft adds up to, and whether it is postable.
///
/// A line with no account, no unit, or nothing but zeros is one somebody
/// started and has not finished; it is not an error and it is not a line.
function entryTotals(draft: EntryDraft) {
  const usable = draft.lines
    .map((line) => ({
      line,
      debit: line.debit.trim() === "" ? 0 : parseMinor(line.debit),
      credit: line.credit.trim() === "" ? 0 : parseMinor(line.credit),
    }))
    .filter(
      (row) =>
        row.line.account !== null &&
        row.line.unit_id.trim() !== "" &&
        row.debit !== null &&
        row.credit !== null &&
        (row.debit > 0 || row.credit > 0)
    )
  const debits = usable.reduce((sum, row) => sum + (row.debit ?? 0), 0)
  const credits = usable.reduce((sum, row) => sum + (row.credit ?? 0), 0)
  /// Otherwise-finished rows whose account declares a family and whose
  /// category is still empty. The one refusal this form can see coming.
  const uncategorised = usable.filter(
    (row) => !accountChoiceReady(row.line.account)
  )
  return {
    usable,
    debits,
    credits,
    uncategorised,
    balanced:
      usable.length >= 2 &&
      debits === credits &&
      debits > 0 &&
      uncategorised.length === 0,
  }
}

/// Writing an entry by hand.
///
/// # Why the composer is not in the URL
///
/// Which record is open belongs in the address bar; a half-written entry does
/// not. A link to `?compose=true` promises a draft it cannot restore, and the
/// person who follows it gets an empty form where they expected somebody
/// else's work.
///
/// # Why the balance check is here and also in the database
///
/// It is here so the Post button does not offer to do something that will be
/// refused. It is in the database — a deferred constraint trigger at COMMIT —
/// because that is the check that actually holds, and this one exists only to
/// be polite about it. The same is true of a closed period: the refusal comes
/// back as the trigger's own sentence, quoted verbatim.
function ComposerSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [receipt, setReceipt] = useState<string | null>(null)
  // Minted once per composer, not per attempt: a retry after a dropped
  // connection must land the same entry, and generating the key inside the
  // request would defeat the whole mechanism.
  const [key, setKey] = useState(() => idempotencyKey())

  const post = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: EntryDraft) =>
      postManualEntry(
        {
          posting_date: draft.postingDate,
          memo: draft.memo.trim() === "" ? null : draft.memo.trim(),
          lines: entryTotals(draft).usable.map((row): ManualLine => ({
            account: {
              kind: "account",
              account_code: row.line.account!.account_code,
              // `null` when the account declares no family: that is the
              // answer, not the absence of one.
              category_code: row.line.account!.category_code,
            },
            unit_id: row.line.unit_id.trim(),
            debit_minor: row.debit ?? 0,
            credit_minor: row.credit ?? 0,
            // No box writes one. See `DraftLine`.
            memo: null,
          })),
        },
        key
      ),
    onSuccess: (posted) => {
      setReceipt(posted.entry_number)
      // The entry, not the day: a morning of hand-written entries all post on
      // the same date.
      form.setFieldValue("lines", [blankLine(), blankLine()])
      form.setFieldValue("memo", "")
      setKey(idempotencyKey())
      // A posting moves the register, every balance, both statements and the
      // trial balance. There is no narrower honest answer.
      client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const form = useForm({
    defaultValues: {
      postingDate: todayIso(),
      memo: "",
      lines: [blankLine(), blankLine()],
    } as EntryDraft,
    onSubmit: ({ value }) => post.mutate(value),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New journal entry"
      className="w-[34rem]"
      footer={
        /* The second `dark` button in this file, and the one exception the
           rule allows: a composer is a modal surface on the white veil, so its
           submit and the header's "New entry" are never on screen together.
           Two black CTAs a reader can see at once is what the rule forbids. */
        <form.Subscribe selector={(state) => entryTotals(state.values)}>
          {(totals) => (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[0.875rem] text-mute tabular-nums">
                {totals.balanced
                  ? `Balanced at ${money(totals.debits)}`
                  : totals.usable.length === 0
                    ? "No usable line yet"
                    : `Debits ${money(totals.debits)} · credits ${money(totals.credits)}`}
              </span>
              <Button
                variant="primary"
                pending={post.isPending}
                disabled={!totals.balanced}
                onClick={() => form.handleSubmit()}
              >
                {post.isPending ? "Posting…" : "Post entry"}
              </Button>
            </div>
          )}
        </form.Subscribe>
      }
    >
      <form
        // The button is in the sheet's footer, outside this element, so its
        // disabled state cannot block an Enter keypress — and an unbalanced
        // entry must never reach the deferred constraint.
        onSubmit={(event) => {
          event.preventDefault()
          if (entryTotals(form.state.values).balanced && !post.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-4"
      >
        {receipt && (
          <Banner tone="ok" onDismiss={() => setReceipt(null)}>
            Posted as {receipt}.
          </Banner>
        )}
        {post.isError && (
          <Banner tone="bad">
            {post.error instanceof Error
              ? post.error.message
              : "The entry was refused."}
          </Banner>
        )}

        <div className="grid grid-cols-2 gap-3">
          <form.Field name="postingDate">
            {(field) => (
              <Field label="Posting date" required>
                <Day
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="memo">
            {(field) => (
              <Field label="Memo" hint="What this entry is for.">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="lines" mode="array">
          {(lines) => (
            <div className="flex flex-col gap-3">
              {lines.state.value.map((line, index) => (
                <div
                  key={index}
                  className="rounded-inner border border-hairline p-3"
                >
                  <div className="mb-2 flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <AccountAndCategory
                        value={line.account}
                        onChange={(next) =>
                          form.setFieldValue(`lines[${index}].account`, next)
                        }
                        categoryLabel={`Category on line ${index + 1}`}
                        explain
                      />
                    </span>
                    {lines.state.value.length > 2 && (
                      <Button
                        size="sm"
                        variant="quiet"
                        aria-label="Remove line"
                        onClick={() => lines.removeValue(index)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <form.Field name={`lines[${index}].unit_id`}>
                      {(field) => (
                        <Field label="Unit">
                          {/* A pick from the units, never typed: a line posted
                              to a unit that does not exist is refused by the
                              server, which is the right refusal to never have
                              to see. */}
                          <UnitSelect
                            value={field.state.value}
                            onChange={(next) => field.handleChange(next)}
                            emptyLabel="Choose a unit"
                          />
                        </Field>
                      )}
                    </form.Field>
                    <form.Field name={`lines[${index}].debit`}>
                      {(field) => (
                        <Field label="Debit">
                          <Money
                            value={field.state.value}
                            onChange={field.handleChange}
                          />
                        </Field>
                      )}
                    </form.Field>
                    <form.Field name={`lines[${index}].credit`}>
                      {(field) => (
                        <Field label="Credit">
                          <Money
                            value={field.state.value}
                            onChange={field.handleChange}
                          />
                        </Field>
                      )}
                    </form.Field>
                  </div>
                </div>
              ))}

              <Button
                variant="soft"
                className="self-start"
                onClick={() => lines.pushValue(blankLine())}
              >
                <Plus />
                Add line
              </Button>
            </div>
          )}
        </form.Field>
      </form>
    </Sheet>
  )
}

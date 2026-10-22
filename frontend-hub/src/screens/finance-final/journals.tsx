import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Textarea } from "@/components/ui/field"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { ListFilters } from "@/components/ui/list-filters"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, Status } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { CellMoney } from "@/components/ui/rows-switch"
import { Toolbar } from "@/components/ui/segmented"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  NoAccessState,
  NoMatch,
} from "@/components/ui/states"
import { useFilterState, type FilterField } from "@/lib/filters"
import { count, day, label, money, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  journalEntry,
  listJournal,
  listJournalTemplates,
  postManualEntry,
  reverseEntry,
  type ManualLine,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { useDebounced } from "@/lib/use-debounced"
import {
  Code,
  DebitCredit,
  Grid,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { todayIso } from "@/screens/finance/chart"
import {
  useCategoriesByFamily,
  useSettledWindow,
} from "@/screens/finance/hooks"
import { JournalLinesGrid } from "@/screens/finance/journal-lines-grid"
import {
  blankLine,
  byUnit,
  draftFromTemplate,
  draftTotals,
  type DraftLine,
} from "@/screens/finance/journal-lines"
import { UnitName, UnitSelect, WindowControl } from "@/screens/finance/parts"
import { idempotencyKey } from "@itulah/contract/client"
import { ScreenPending } from "@/screens/finance/pending"
import type { JournalEntryRow, JournalLineView } from "@itulah/contract"

/// The book every other screen in this module writes into.
///
/// ERPNext's Journal Entry, list and form, with our one dimension on the line.
///
/// # Why the register does not have an Account column
///
/// Because ERPNext's does not either, and for the same reason: the accounts are
/// a child table. A Journal Entry list view carries the document — type, date,
/// total, status — and the rows it is made of live in the form. Our register
/// answers the same way: `JournalEntryRow` has an entry number, a total and a
/// line count, and no account and no unit anywhere on it. Filling those two
/// columns would mean one `GET /journal/{id}` per row, which is how a list gets
/// slow without anybody being able to point at the reason. So a row opens.
///
/// # Why the unit is a column on the LINE and not on the entry
///
/// It is the module's whole argument. The client's legacy chart carries the
/// location inside the account code — fourteen copies of `Cash on Hand`, and a
/// 14×14 grid of accounts for the entries that move money between two units.
/// Here `journal_line.unit_id` is a dimension on the posting, so one account
/// serves all fourteen and an entry that touches two units is simply an entry
/// whose lines carry two different units. That is a fact about the lines, and
/// there is no honest way to print it as one value on the header: an entry
/// settling Bandung's and Cikupa's bills belongs to both.
///
/// # Why "who posted this" is on the face of the list
///
/// Most of this book is not hand-written. Depreciation runs write it, supplier
/// invoices write it, the bank reconciliation writes it — 44, 24 and 1 of the
/// first hundred entries here against 30 by a person. "Who can I ask about
/// this entry" is therefore the first question anybody has, and the answer is
/// not the username: it is whether a human chose those accounts at all.
/// ERPNext folds that into `voucher_type` and does not separate the types a
/// person picks from the ones the system stamps — which confuses its own users.
/// This list splits them.
///
/// # Reverse, and the absence of Cancel
///
/// ERPNext gives an accountant both: Cancel voids a voucher, Reverse posts a
/// new opposite one and leaves the original standing. We have only the second,
/// deliberately — `journal_entry` is append-only and there is no cancel
/// endpoint at all. The sheet says so where somebody is about to press it,
/// because "this never should have existed" and "this was right then and is
/// wrong now" are different intents and only one of them is available.

/// One page of the register. The list scrolls on — this is the size of a
/// step, not a ceiling.
const PAGE = 100

/// The register's columns. The server orders it, so none of them sorts; on a
/// card the number leads, the type names it, the memo follows when there is
/// one, and the total stands at the right with the status in the foot.
const columns: ColumnDef<TableSetup, JournalEntryRow>[] = [
  {
    id: "date",
    accessorFn: (row) => row.posting_date,
    header: "Date",
    size: 120,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => day(row.original.posting_date),
  },
  {
    id: "entry",
    accessorFn: (row) => row.entry_number,
    header: "Entry",
    size: 140,
    enableSorting: false,
    meta: { card: "id" },
    cell: ({ row }) => (
      <span className="font-mono text-[0.9375rem] text-ink">
        {row.original.entry_number}
      </span>
    ),
  },
  {
    id: "memo",
    accessorFn: (row) => row.memo,
    header: "Memo",
    size: 220,
    enableSorting: false,
    meta: { card: "meta", grow: 200 },
    cell: ({ row }) => (
      <span
        className={cn(
          "block truncate",
          row.original.memo === null ? "text-faint" : "text-body"
        )}
        title={row.original.memo ?? undefined}
      >
        {row.original.memo ?? "—"}
      </span>
    ),
  },
  {
    id: "type",
    accessorFn: (row) => row.source_kind,
    header: "Type",
    size: 170,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <>
        {label(row.original.source_kind)}
        {byHand(row.original) && <span className="text-mute"> · by hand</span>}
      </>
    ),
  },
  {
    id: "posted_by",
    accessorFn: (row) => row.posted_by,
    header: "Posted by",
    size: 140,
    enableSorting: false,
    meta: { card: "foot", priority: 3 },
    cell: ({ row }) => (
      <span
        className="block truncate"
        title={`${row.original.posted_by} · ${moment(row.original.posted_at)}`}
      >
        {row.original.posted_by}
      </span>
    ),
  },
  {
    id: "total",
    accessorFn: (row) => row.total_minor,
    header: "Total debit",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "lead" },
    cell: ({ row }) => <CellMoney minor={row.original.total_minor} />,
  },
  {
    id: "status",
    accessorFn: (row) => (row.reversed_by !== null ? "Reversed" : "Posted"),
    header: "Status",
    size: 110,
    enableSorting: false,
    // ERPNext's docstatus column. A reversal already says so under Type, so
    // only the entry it undid carries a word of its own here.
    meta: { card: "status" },
    cell: ({ row }) =>
      row.original.reversed_by !== null ? (
        <Status tone="bad">Reversed</Status>
      ) : (
        <Status tone="ok">Posted</Status>
      ),
  },
]

export function Journals() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Payments" title="Journal Entry">
          Reading the calendar…
        </ScreenPending>
      }
    >
      <JournalsScreen />
    </Suspense>
  )
}

/// The type of an entry, asked of the list the way every list is asked: its
/// answers (and their counts) are the server's, so they are filled in below,
/// once the first page is in.
const KIND_FIELD: FilterField = {
  column: "kind",
  label: "Entry type",
  spec: { kind: "option", single: true, format: (value) => label(value) },
}

function JournalsScreen() {
  const range = useSettledWindow()
  const filterState = useFilterState([KIND_FIELD])
  const kind =
    filterState.filters.find((one) => one.column === "kind")?.values[0] ?? ""
  const [unit, setUnit] = useState("")
  const [needle, setNeedle] = useState("")
  // In the URL rather than in state, so a link from a bill, a deposit or a
  // money movement (`?entry=`) opens the entry it names.
  const reading = useSheet("entry")
  const [composing, setComposing] = useState(false)
  const phone = useLayout() === "phone"
  // "Start a journal from this template" lands here with `?journalTemplate=`.
  const fromTemplate = useSheet("journalTemplate")
  const templates = useQuery({
    queryKey: financeKeys.journalTemplates(),
    queryFn: ({ signal }) => listJournalTemplates(signal),
    enabled: fromTemplate.value !== undefined,
  })
  const categories = useCategoriesByFamily()
  const template = templates.data?.find(
    (one) => one.template_id === fromTemplate.value
  )
  const initial = useMemo(() => {
    // Waits for the categories: a line's category family is read back from
    // them, and the composer's state is seeded once.
    if (template === undefined || categories.isPending) return null
    const familyOf = (code: string) =>
      categories.families.find((group) =>
        group.rows.some((row) => row.category_code === code)
      )?.family ?? null
    const drafted = draftFromTemplate(template.lines, familyOf)
    return {
      name: template.name,
      memo: template.memo ?? "",
      lines: drafted.lines,
      skipped: drafted.skipped,
    }
  }, [template, categories.isPending, categories.families])

  // Window, type, unit and the search all go on the wire, and the key carries
  // all four — a register narrowed in the browser is a slice of whatever pages
  // it happens to hold, which answers a different question and looks
  // identical.
  const q = useDebounced(needle.trim(), 300)
  const entries = useInfiniteQuery({
    queryKey: [
      ...financeKeys.journal(range.from, range.to, kind || null, unit || null),
      "pages",
      q,
    ],
    queryFn: ({ pageParam, signal }) =>
      listJournal(
        {
          from: range.from,
          to: range.to,
          kind: kind || undefined,
          unit: unit || undefined,
          q: q || undefined,
          limit: PAGE,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => entries.data?.pages.flatMap((page) => page.rows) ?? [],
    [entries.data]
  )
  const head = entries.data?.pages[0]

  const matched = head?.total ?? rows.length
  // The server's own counts per type, over the window. They deliberately
  // ignore the unit filter — the node counts each facet against the window
  // alone — so the strip is labelled as a fact about the window and not about
  // the list below it.
  const kinds = head?.facets.kinds ?? []
  const kindModel: typeof filterState = {
    ...filterState,
    fields: [
      {
        ...KIND_FIELD,
        spec: {
          ...KIND_FIELD.spec,
          counted: kinds.map((facet) => ({
            value: facet.value,
            count: facet.count,
          })),
        },
      },
    ],
  }

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: JournalEntryRow) => row.entry_id,
      }),
      [rows]
    )
  )

  return (
    <PageContent>
      {/* The one action stands in the head; a phone has the + at the thumb. */}
      <PageHeader
        crumb="Finance · Payments"
        title="Journal Entry"
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setComposing(true)}>
              New entry
            </Button>
          )
        }
      />
      <Fab label="New entry" onClick={() => setComposing(true)} />

      <Toolbar className="group/bar">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search entries"
        />
        <WindowControl range={range} />
        <ListFilters model={kindModel} />
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
        <Toolbar.Spacer />
        <span className="text-[0.9375rem] text-mute">
          {range.chip}
          {kind !== "" && ` · ${label(kind)}`}
          {unit !== "" && " · "}
          {unit !== "" && <UnitName id={unit} />}
          {` · ${count(matched)} ${matched === 1 ? "entry" : "entries"}`}
        </span>
      </Toolbar>

      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(entries, {
          loading: "Reading the register…",
          // Every GET under /finance is behind a supervisor's sign-in, and a
          // refusal served as an empty register is the one failure a reader
          // cannot tell from an empty month.
          refused: (
            <NoAccessState
              what="the journal"
              reach="Reading the books takes a supervisor's sign-in; posting to them, head office's."
            />
          ),
          render: () =>
            rows.length === 0 && q === "" ? (
              <EmptyState>
                Nothing posted between {day(range.from)} and {day(range.to)}
                {kind === "" ? "" : ` by ${label(kind).toLowerCase()}`}. The
                window is always set, so this is not a statement about the books
                — widen it to tell the two apart.
              </EmptyState>
            ) : rows.length === 0 ? (
              <NoMatch what="entries" onClear={() => setNeedle("")} />
            ) : (
              <DataTable<JournalEntryRow>
                refresh={[entries]}
                table={table}
                onRowClick={(entry) => reading.open(entry.entry_id)}
                isSelected={(entry) => entry.entry_id === reading.value}
                more={entries}
                // The server's figure over everything the window and the
                // filters match, not a sum of the rows above — which would
                // grow as somebody scrolled and shrink as they searched.
                summary={{
                  date: "Total",
                  memo: `${count(matched)} ${matched === 1 ? "entry" : "entries"}`,
                  total: money(head?.total_minor ?? null),
                }}
                pageScroll
                cardSort={false}
                cardsApart
                cardLead
              />
            ),
        })}
      </Card>

      <EntryPanel
        id={reading.value ?? null}
        onClose={reading.close}
        onOpen={(id) => reading.open(id)}
      />
      <ComposerPanel
        // A new template is a new draft: the composer's state starts from it.
        key={initial === null ? "blank" : fromTemplate.value}
        open={composing || initial !== null}
        initial={initial}
        onClose={() => {
          setComposing(false)
          if (fromTemplate.value !== undefined) fromTemplate.close()
        }}
      />
    </PageContent>
  )
}

/// A person chose these accounts, or a posting rule did.
///
/// `MANUAL` is the only kind a human writes directly; `REVERSAL` is written by
/// the server when somebody presses Reverse, which is a person's decision
/// carried out by a rule — so it reads as neither and gets its own tone.
function byHand(entry: JournalEntryRow): boolean {
  return entry.source_kind === "MANUAL"
}

function toneOf(entry: JournalEntryRow): "warn" | "info" | "neutral" {
  if (entry.source_kind === "MANUAL") return "warn"
  if (entry.source_kind === "REVERSAL") return "info"
  return "neutral"
}

// ---------------------------------------------------------------------------
// One entry
// ---------------------------------------------------------------------------

/// The form behind a register row: its lines, their units, and the one action
/// this book allows against a posted entry.
function EntryPanel({
  id,
  onClose,
  onOpen,
}: {
  id: string | null
  onClose: () => void
  /// Following `Reverses` / `Reversed by` to the other entry, without leaving
  /// the screen. Both entries are real and the question a reversal raises is
  /// always about the other one.
  onOpen: (id: string) => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [postingDate, setPostingDate] = useState("")
  const [receipt, setReceipt] = useState<string | null>(null)

  const detail = useQuery({
    queryKey: financeKeys.entry(id ?? ""),
    queryFn: ({ signal }) => journalEntry(id ?? "", signal),
    enabled: id !== null,
  })

  const reverse = useMutation({
    mutationFn: () =>
      reverseEntry(
        id ?? "",
        reason.trim(),
        postingDate === "" ? undefined : postingDate
      ),
    onSuccess: (posted) => {
      setReason("")
      setReceipt(posted.entry_number)
      // A reversal writes a new entry, marks this one answered and moves every
      // balance, statement and trial balance with it. The whole namespace is
      // the only honest invalidation.
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const entry = detail.data?.entry
  const answered = entry?.reversed_by != null

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReceipt(null)
          setReason("")
          setPostingDate("")
          onClose()
        }
      }}
      // The number is the crumb's second half, the memo the title; the status
      // and the count of lines stand on the caption line under it.
      id={entry?.entry_number}
      title={
        entry?.memo ?? (entry ? label(entry.source_kind) : "Journal entry")
      }
      caption={
        entry === undefined
          ? undefined
          : `${answered ? "Reversed" : "Posted"} · ${count(detail.data?.lines.length ?? 0)} ${detail.data?.lines.length === 1 ? "line" : "lines"}`
      }
      size="wide"
      footer={
        entry === undefined ? undefined : (
          <SheetFooter
            onCancel={onClose}
            cancelLabel={answered ? "Close" : "Cancel"}
            note={
              answered ? undefined : "The reason is the only record of why."
            }
            primary={
              answered
                ? undefined
                : {
                    label: "Reverse",
                    tone: "danger",
                    pending: reverse.isPending,
                    pendingLabel: "Reversing…",
                    disabled: reason.trim() === "",
                    onClick: () => reverse.mutate(),
                  }
            }
          />
        )
      }
    >
      {queryState(detail, {
        loading: "Reading the entry…",
        render: ({ entry: header, lines }) => {
          const units = byUnit(lines)
          const interUnit = units.length > 1
          const debits = lines.reduce((sum, line) => sum + line.debit_minor, 0)
          const credits = lines.reduce(
            (sum, line) => sum + line.credit_minor,
            0
          )

          return (
            <div className="flex flex-col gap-5">
              {receipt !== null && (
                <Banner tone="ok" onDismiss={() => setReceipt(null)}>
                  Reversed by {receipt}. Both entries stay in the books — this
                  one is still in every balance up to the reversal&rsquo;s date.
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
                <Pill tone={toneOf(header)}>{label(header.source_kind)}</Pill>
                <Pill tone={byHand(header) ? "warn" : "neutral"}>
                  {byHand(header) ? "Written by hand" : "Posted by the system"}
                </Pill>
                {header.reversal_of !== null && (
                  <Pill tone="info">Reversal</Pill>
                )}
                {header.reversed_by !== null && (
                  <Pill tone="bad">Reversed</Pill>
                )}
                {interUnit && <Pill tone="accent">Inter-unit</Pill>}
              </div>

              <Facts>
                <Fact term="Posting date">{day(header.posting_date)}</Fact>
                <Fact term="Currency">{header.currency}</Fact>
                <Fact term="Posted by">{header.posted_by}</Fact>
                <Fact term="Posted at">{moment(header.posted_at)}</Fact>
                {header.source_id !== null && (
                  <Fact term="Source record">
                    <span className="font-mono text-[0.9375rem]">
                      {header.source_id}
                    </span>
                  </Fact>
                )}
                {header.reversal_of !== null && (
                  <Fact term="Reverses">
                    <button
                      type="button"
                      className="font-mono text-[0.9375rem] text-accent hover:underline"
                      onClick={() => onOpen(header.reversal_of ?? "")}
                    >
                      the entry it answers
                    </button>
                  </Fact>
                )}
                {header.reversed_by !== null && (
                  <Fact term="Reversed by">
                    <button
                      type="button"
                      className="font-mono text-[0.9375rem] text-accent hover:underline"
                      onClick={() => onOpen(header.reversed_by ?? "")}
                    >
                      the entry that answered it
                    </button>
                  </Fact>
                )}
              </Facts>

              <div>
                <SubHead aside={`${count(lines.length)} lines`}>
                  Accounting entries
                </SubHead>
                <Grid>
                  <thead>
                    <tr>
                      <Th width="3rem">#</Th>
                      <Th>Account</Th>
                      <Th width="9rem">Unit</Th>
                      <Th align="right" width="9rem">
                        Debit
                      </Th>
                      <Th align="right" width="9rem">
                        Credit
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line: JournalLineView) => (
                      <tr key={line.line_number}>
                        <Td className="text-mute">{line.line_number}</Td>
                        <Td>
                          <span className="block text-ink">
                            {line.account_name}
                            {/* What the line WAS. With forty accounts in the
                                chart the name above is a row of the statement
                                and this is the thing the reader came for, so
                                it sits on the same line rather than under the
                                code — an entry whose eight lines all read
                                "Beban umum & administrasi" is an entry nobody
                                can check. */}
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
                          <Code>{line.account_code}</Code>
                          {line.memo !== null && (
                            <span className="block text-[0.9375rem] text-mute">
                              {line.memo}
                            </span>
                          )}
                        </Td>
                        <Td>
                          {/* One account, named once; the unit beside it. Never
                              "Cash on Hand — Store 04", which is the shape of
                              chart this module exists to stop. */}
                          <UnitName id={line.unit_id} />
                          {/* Who the balance is with, on an affiliate leg. */}
                          {line.counter_unit_id !== null && (
                            <span className="block text-[0.9375rem] text-mute">
                              with <UnitName id={line.counter_unit_id} />
                            </span>
                          )}
                        </Td>
                        <DebitCredit
                          debit={line.debit_minor}
                          credit={line.credit_minor}
                        />
                      </tr>
                    ))}
                    <TotalRow>
                      <Td />
                      <Td>Total</Td>
                      <Td />
                      <Td align="right">{money(debits)}</Td>
                      <Td align="right">{money(credits)}</Td>
                    </TotalRow>
                  </tbody>
                </Grid>
              </div>

              {interUnit && (
                <p className="text-[0.9375rem] text-body">
                  <b className="text-ink">
                    This entry moves money between units.
                  </b>{" "}
                  {units.map((unit, index) => (
                    <span key={unit.unit_id}>
                      {index > 0 && ", "}
                      <UnitName id={unit.unit_id} />{" "}
                      {unit.net_minor > 0 ? "up" : "down"}{" "}
                      {money(Math.abs(unit.net_minor))}
                    </span>
                  ))}
                  . Each unit&rsquo;s own books are left unbalanced.
                </p>
              )}

              {answered ? (
                <p className="text-[0.9375rem] text-body">
                  Already reversed. It stays in the books up to the date its
                  reversal was posted.
                </p>
              ) : (
                <div className="flex flex-col gap-2 border-t border-hairline pt-4">
                  <SubHead aside="posts a new entry">Reverse</SubHead>
                  {/* ERPNext offers Cancel as well, and it means something
                      different: Cancel voids the voucher, Reverse writes the
                      opposite one and leaves the original standing. There is no
                      cancel endpoint on this ledger at all, so the only thing
                      this button can do is the second — and it says so, because
                      somebody reaching for it may have wanted the first. */}
                  <p className="text-[0.9375rem] text-body">
                    This posts a <b>new entry</b> with the debits and credits
                    exchanged and leaves {header.entry_number} exactly as it is.
                    It is not a cancellation; nothing in this book can be
                    cancelled.
                  </p>
                  <Textarea
                    rows={2}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <Field
                    label="Posting date"
                    hint="Empty posts the mirror today."
                    className="w-44"
                  >
                    <Day value={postingDate} onChange={setPostingDate} />
                  </Field>
                </div>
              )}
            </div>
          )
        },
      })}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Writing one
// ---------------------------------------------------------------------------

/// Writing an entry by hand — ERPNext's Journal Entry form, with the unit on
/// every row.
///
/// # Why the balance is checked here as well as in the database
///
/// So the button does not offer to do something that will be refused. The check
/// that holds is a deferred constraint trigger at COMMIT; this one exists only
/// to be polite about it, and the same is true of a closed month, whose refusal
/// arrives as the trigger's own sentence and is quoted verbatim.
///
/// # Why the per-unit figure is a warning and not a refusal
///
/// Because the server allows it. `journal_entry_balances` checks the entry, not
/// the unit, so an entry may debit head office and credit Store 04 and be
/// perfectly postable while neither unit's own books foot. ERPNext's answer is
/// an offsetting account posted automatically per dimension; a hand-written
/// entry gets no such leg here, so the honest thing is to show the reader
/// what they are about to leave behind and let them decide.
function ComposerPanel({
  open,
  onClose,
  initial,
}: {
  open: boolean
  onClose: () => void
  /// A journal template to start from: its memo and its lines, which the
  /// person then checks, dates and posts like any other entry.
  initial?: {
    readonly name: string
    readonly memo: string
    readonly lines: DraftLine[]
    readonly skipped: number
  } | null
}) {
  const client = useQueryClient()
  const [postingDate, setPostingDate] = useState(todayIso)
  const [memo, setMemo] = useState(initial?.memo ?? "")
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initial ? initial.lines : [blankLine(), blankLine()]
  )
  const [receipt, setReceipt] = useState<string | null>(null)
  // Minted once per composer and not per attempt: a retry after a dropped
  // connection must land the same entry, and generating the key inside the
  // request would defeat the whole mechanism.
  const [key, setKey] = useState(idempotencyKey)

  const totals = draftTotals(lines)

  const post = useMutation({
    mutationFn: () =>
      postManualEntry(
        {
          posting_date: postingDate,
          memo: memo.trim() === "" ? null : memo.trim(),
          lines: totals.usable.map((row): ManualLine => ({
            account: {
              kind: "account",
              account_code: row.line.account!.account_code,
              // `null` for an account that declares no family, which is the
              // answer and not the absence of one: the trigger refuses a
              // line carrying a category its account cannot take.
              category_code: row.line.account!.category_code,
            },
            unit_id: row.line.unit_id,
            debit_minor: row.debit,
            credit_minor: row.credit,
            memo: null,
          })),
        },
        key
      ),
    onSuccess: (posted) => {
      setReceipt(posted.entry_number)
      setLines([blankLine(), blankLine()])
      setMemo("")
      setKey(idempotencyKey())
      // A posting moves the register, every balance, both statements and the
      // trial balance. There is no narrower honest answer.
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReceipt(null)
          onClose()
        }
      }}
      title="New journal entry"
      caption={initial ? `From the template “${initial.name}”` : undefined}
      size="wide"
      footer={
        <SheetFooter
          onCancel={() => {
            setReceipt(null)
            onClose()
          }}
          note={
            totals.balanced
              ? `Balanced at ${money(totals.debits)}`
              : totals.usable.length === 0
                ? "No usable row yet — a row needs an account, a unit and a figure"
                : totals.uncategorised.length > 0
                  ? `${count(totals.uncategorised.length)} ${totals.uncategorised.length === 1 ? "row needs" : "rows need"} a category — the account is one line of the statement, the category is what it was for`
                  : `Debits ${money(totals.debits)} · credits ${money(totals.credits)}`
          }
          primary={{
            label: "Post entry",
            pending: post.isPending,
            pendingLabel: "Posting…",
            disabled: !totals.balanced,
            onClick: () => post.mutate(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {initial && initial.skipped > 0 && (
          <Banner tone="warn">
            {count(initial.skipped)}{" "}
            {initial.skipped === 1
              ? "line of the template names"
              : "lines of the template name"}{" "}
            a posting role rather than an account, and cannot be drawn here. Add{" "}
            {initial.skipped === 1 ? "it" : "them"} by hand.
          </Banner>
        )}
        {receipt !== null && (
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

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Posting date" required hint="The month this lands in.">
            <Day value={postingDate} onChange={setPostingDate} />
          </Field>
          <Field label="Memo" hint="What this entry is for.">
            <Input
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
            />
          </Field>
        </div>

        <JournalLinesGrid lines={lines} onChange={setLines} />

        {totals.adrift.length > 0 && (
          <p className="text-[0.9375rem] text-body">
            <b className="text-ink">This would be an inter-unit entry.</b> It
            leaves{" "}
            {totals.adrift.map((unit, index) => (
              <span key={unit.unit_id}>
                {index > 0 && ", "}
                <UnitName id={unit.unit_id} />{" "}
                {unit.net_minor > 0 ? "up" : "down"}{" "}
                {money(Math.abs(unit.net_minor))}
              </span>
            ))}
            . It will post, but each unit&rsquo;s own books stay unbalanced.
          </p>
        )}
      </div>
    </Sheet>
  )
}

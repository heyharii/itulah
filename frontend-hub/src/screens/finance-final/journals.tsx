import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Panel } from "@/components/ui/dialog"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  NoAccessState,
  NoMatch,
  Truncated,
} from "@/components/ui/states"
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
import {
  Code,
  DebitCredit,
  Grid,
  Note,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { parseMinor, todayIso } from "@/screens/finance/chart"
import { useWindow } from "@/screens/finance/hooks"
import {
  AccountAndCategory,
  accountChoiceReady,
  LocationSelect,
  SiteName,
  WindowControl,
  type AccountChoice,
} from "@/screens/finance/parts"
import { idempotencyKey } from "@itulah/contract/client"
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
/// Here `journal_line.site_id` is a dimension on the posting, so one account
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

/// What this screen asks the register for. The server's ceiling, not a page
/// size: nothing here pages, so this is also the number past which the register
/// stops being able to answer the question it appears to answer.
const CAP = 200

export function Journals() {
  const range = useWindow()
  const [kind, setKind] = useState("")
  const [site, setSite] = useState("")
  const [needle, setNeedle] = useState("")
  const [reading, setReading] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)

  // Window, type and unit all go on the wire, and the key carries all three —
  // a register narrowed in the browser is a slice of the newest 200 entries of
  // every kind, which answers a different question and looks identical.
  const entries = useQuery({
    queryKey: financeKeys.journal(
      range.from,
      range.to,
      kind || null,
      site || null
    ),
    queryFn: ({ signal }) =>
      listJournal(
        {
          from: range.from,
          to: range.to,
          kind: kind || undefined,
          site: site || undefined,
          limit: CAP,
        },
        signal
      ),
  })

  const rows = useMemo(() => entries.data?.rows ?? [], [entries.data])
  // The search box is the one narrowing that stays here. `financeKeys.journal`
  // has no slot for a search term, so sending `q` on the wire would file two
  // different searches under one cache entry — the second reader would get the
  // first one's answer. It narrows what is drawn and says so.
  const shown = useMemo(() => {
    const text = needle.trim().toLowerCase()
    if (text === "") return rows
    return rows.filter(
      (row) =>
        row.entry_number.toLowerCase().includes(text) ||
        (row.memo ?? "").toLowerCase().includes(text) ||
        row.posted_by.toLowerCase().includes(text)
    )
  }, [rows, needle])

  const matched = entries.data?.total ?? rows.length
  // The server's own counts per type, over the window. They deliberately
  // ignore the unit filter — the node counts each facet against the window
  // alone — so the strip is labelled as a fact about the window and not about
  // the list below it.
  const kinds = entries.data?.facets.kinds ?? []

  return (
    <PageContent>
      <PageHeader
        crumb="Finance final · Accounting"
        title="Journals"
        sub="Entries posted by hand, and every entry the system posted for itself."
        actions={
          <>
            <Input
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              placeholder="Search what is loaded"
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
        <span className="inline-flex w-44 shrink-0">
          <Select
            value={kind}
            onChange={setKind}
            className="h-8 w-44"
            aria-label="Entry type"
          >
            <option value="">Every type</option>
            {kinds.map((facet) => (
              <option key={facet.value} value={facet.value}>
                {label(facet.value)}
              </option>
            ))}
          </Select>
        </span>
        <LocationSelect
          value={site}
          onChange={setSite}
          className="h-8 w-44"
          emptyLabel="Every unit"
          aria-label="Unit"
        />
        <Toolbar.Spacer />
        <span className="text-[0.71875rem] text-mute">
          {range.chip}
          {kind !== "" && ` · ${label(kind)}`}
          {site !== "" && " · "}
          {site !== "" && <SiteName id={site} />}
          {matched > rows.length
            ? ` · the newest ${CAP} of ${count(matched)} entries`
            : ` · ${count(matched)} ${matched === 1 ? "entry" : "entries"}`}
        </span>
      </Toolbar>

      {/* Who wrote this window's entries, before anybody scrolls. The counts
          are the server's, over the window, and each one sets the type filter
          — the fastest way to the answer "show me only what a person keyed". */}
      {kinds.length > 0 && (
        <div className="mb-3.5 flex flex-wrap items-center gap-1.5 text-[0.71875rem]">
          <span className="text-mute">In this window:</span>
          {kinds.map((facet) => (
            <button
              key={facet.value}
              type="button"
              onClick={() => setKind(kind === facet.value ? "" : facet.value)}
              className={
                kind === facet.value
                  ? "rounded-full border border-accent/40 bg-soft-2 px-2 py-0.5 text-ink"
                  : "rounded-full border border-hairline-2 px-2 py-0.5 text-body hover:bg-soft-2 hover:text-ink"
              }
            >
              {label(facet.value)}{" "}
              <span className="text-mute tabular-nums">
                {count(facet.count)}
              </span>
            </button>
          ))}
          <span className="text-mute">
            · counted over the window, whatever unit is chosen
          </span>
        </div>
      )}

      {matched > rows.length && <Truncated limit={CAP} noun="entries" />}

      <div className="flex flex-col gap-4">
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
            rows.length === 0 ? (
              <EmptyState>
                Nothing posted between {day(range.from)} and {day(range.to)}
                {kind === "" ? "" : ` by ${label(kind).toLowerCase()}`}. The
                window is always set, so this is not a statement about the books
                — widen it to tell the two apart.
              </EmptyState>
            ) : shown.length === 0 ? (
              <NoMatch
                what="entries"
                held={rows.length}
                onClear={() => setNeedle("")}
              />
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th width="6.5rem">Date</Th>
                    <Th>Entry</Th>
                    <Th width="11rem">Type</Th>
                    <Th width="9rem">Posted by</Th>
                    <Th align="right" width="5rem">
                      Lines
                    </Th>
                    <Th align="right" width="9.5rem">
                      Total debit
                    </Th>
                    <Th width="7rem">Answered</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((entry) => (
                    <tr
                      key={entry.entry_id}
                      onClick={() => setReading(entry.entry_id)}
                      className="cursor-pointer hover:bg-soft"
                    >
                      <Td>{day(entry.posting_date)}</Td>
                      <Td>
                        <span className="block font-mono text-[0.75rem] text-ink">
                          {entry.entry_number}
                        </span>
                        <span className="block truncate text-[0.6875rem] text-mute">
                          {entry.memo ?? "no memo"}
                        </span>
                      </Td>
                      <Td>
                        <Pill tone={toneOf(entry)}>
                          {label(entry.source_kind)}
                        </Pill>
                        <span className="mt-0.5 block text-[0.6875rem] text-mute">
                          {byHand(entry) ? "written by hand" : "by the system"}
                        </span>
                      </Td>
                      <Td>
                        <span title={moment(entry.posted_at)}>
                          {entry.posted_by}
                        </span>
                      </Td>
                      <Td align="right">{count(entry.line_count)}</Td>
                      <Td align="right">
                        <span className="font-medium text-ink">
                          {money(entry.total_minor)}
                        </span>
                      </Td>
                      <Td>
                        {entry.reversed_by !== null ? (
                          <Pill tone="bad">Reversed</Pill>
                        ) : entry.reversal_of !== null ? (
                          <Pill tone="info">Reversal</Pill>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                  {/* The server's figure over everything the window and the
                      filters match, not a sum of the rows above — which would
                      grow as somebody scrolled and shrink as they searched. */}
                  <TotalRow>
                    <Td />
                    <Td>Total debit</Td>
                    <Td className="font-normal text-mute" align="center">
                      every entry the filters match
                    </Td>
                    <Td />
                    <Td align="right">{count(matched)}</Td>
                    <Td align="right">
                      {money(entries.data?.total_minor ?? 0)}
                    </Td>
                    <Td />
                  </TotalRow>
                </tbody>
              </Grid>
            ),
        })}

        <Note>
          <b>The unit is on the line, not on the entry.</b> Open any row and the
          lines carry a <b>Unit</b> column — that is{" "}
          <code>journal_line.site_id</code>, not null on any posting. An entry
          whose lines name two units is the case the client&rsquo;s legacy chart
          expressed with a 14×14 grid of inter-unit accounts; here it is one
          account and two units. Note what the ledger does <i>not</i> have:
          there is no <code>counter_site_id</code> column on{" "}
          <code>journal_line</code> — the counter unit is the other lines of the
          same entry, read off the form — and the balance check is per entry,
          not per unit, so an entry can balance overall and still leave each
          unit&rsquo;s own books short. The composer says so while it is being
          written.
        </Note>
      </div>

      <EntryPanel
        id={reading}
        onClose={() => setReading(null)}
        onOpen={(id) => setReading(id)}
      />
      <ComposerPanel open={composing} onClose={() => setComposing(false)} />
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

/// What each unit is left holding by one entry.
///
/// Debits less credits, per unit. Zero everywhere is an entry each unit could
/// close its own books on; anything else is an inter-unit entry, and the two
/// numbers are what the client's grid of inter-unit accounts used to carry.
function byUnit(
  lines: readonly {
    site_id: string
    debit_minor: number
    credit_minor: number
  }[]
): { site_id: string; net_minor: number }[] {
  const table = new Map<string, number>()
  for (const line of lines) {
    table.set(
      line.site_id,
      (table.get(line.site_id) ?? 0) + line.debit_minor - line.credit_minor
    )
  }
  return [...table.entries()]
    .map(([site_id, net_minor]) => ({ site_id, net_minor }))
    .sort((a, b) => b.net_minor - a.net_minor)
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
    <Panel
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReceipt(null)
          setReason("")
          setPostingDate("")
          onClose()
        }
      }}
      title={entry?.entry_number ?? "Journal entry"}
      sub={entry?.memo ?? "The lines this entry posted, and the unit on each."}
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
                    <span className="font-mono text-[0.75rem]">
                      {header.source_id}
                    </span>
                  </Fact>
                )}
                {header.reversal_of !== null && (
                  <Fact term="Reverses">
                    <button
                      type="button"
                      className="font-mono text-[0.75rem] text-accent hover:underline"
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
                      className="font-mono text-[0.75rem] text-accent hover:underline"
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
                            <span className="block text-[0.6875rem] text-mute">
                              {line.memo}
                            </span>
                          )}
                        </Td>
                        <Td>
                          {/* One account, named once; the unit beside it. Never
                              "Cash on Hand — Store 04", which is the shape of
                              chart this module exists to stop. */}
                          <SiteName id={line.site_id} />
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
                <Note>
                  <b>This entry moves money between units.</b>{" "}
                  {units.map((unit, index) => (
                    <span key={unit.site_id}>
                      {index > 0 && ", "}
                      <SiteName id={unit.site_id} />{" "}
                      {unit.net_minor > 0 ? "up" : "down"}{" "}
                      {money(Math.abs(unit.net_minor))}
                    </span>
                  ))}
                  . The entry balances; each unit&rsquo;s own books do not, and
                  nothing posts the pair that would settle that between them.
                  This is the case the legacy chart carried a 14×14 grid of
                  accounts for.
                </Note>
              )}

              {answered ? (
                <Note>
                  This entry has already been answered by its mirror. It is not
                  edited, deleted or hidden — it is still the record of what
                  somebody did, and still in every balance up to the date its
                  reversal was posted.
                </Note>
              ) : (
                <div className="flex flex-col gap-2 border-t border-hairline pt-4">
                  <SubHead aside="posts a new entry">Reverse</SubHead>
                  {/* ERPNext offers Cancel as well, and it means something
                      different: Cancel voids the voucher, Reverse writes the
                      opposite one and leaves the original standing. There is no
                      cancel endpoint on this ledger at all, so the only thing
                      this button can do is the second — and it says so, because
                      somebody reaching for it may have wanted the first. */}
                  <p className="text-[0.71875rem] text-body">
                    This posts a <b>new entry</b> with the debits and credits
                    exchanged and leaves {header.entry_number} exactly as it is.
                    It is not a cancellation; nothing in this book can be
                    cancelled.
                  </p>
                  <Textarea
                    rows={2}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Why this entry is being reversed"
                  />
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <Field
                      label="Posting date"
                      hint="Empty posts the mirror today."
                      className="w-44"
                    >
                      <Day
                        value={postingDate}
                        onChange={setPostingDate}
                        placeholder="Today"
                      />
                    </Field>
                    <div className="flex items-center gap-2">
                      <span className="text-[0.71875rem] text-mute">
                        The reason is the only record of why.
                      </span>
                      <Button
                        variant="danger"
                        disabled={reason.trim() === "" || reverse.isPending}
                        onClick={() => reverse.mutate()}
                      >
                        {reverse.isPending ? "Reversing…" : "Reverse"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        },
      })}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Writing one
// ---------------------------------------------------------------------------

/// A line being typed, before it is anything the server would take. Amounts are
/// text until they are submitted — a half-typed number is not a number.
///
/// `account` is a pair and not a code. With forty accounts in the chart, 6301
/// is one line of the profit and loss and says nothing about what the money
/// went on; the category beside it is what used to be the difference between
/// two account codes, and the database refuses the line without it. Holding
/// them as one field is what stops a row ever carrying one half of the answer.
interface DraftLine {
  account: AccountChoice | null
  site_id: string
  debit: string
  credit: string
}

function blankLine(): DraftLine {
  return {
    account: null,
    site_id: "",
    debit: "",
    credit: "",
  }
}

/// What a draft adds up to, whether the server would take it, and what it would
/// leave each unit holding.
///
/// A line with no account, no unit or nothing but zeros is one somebody started
/// and has not finished: not an error, and not yet a line.
function draftTotals(lines: readonly DraftLine[]) {
  const usable = lines
    .map((line) => ({
      line,
      debit: line.debit.trim() === "" ? 0 : (parseMinor(line.debit) ?? 0),
      credit: line.credit.trim() === "" ? 0 : (parseMinor(line.credit) ?? 0),
    }))
    .filter(
      (row) =>
        row.line.account !== null &&
        row.line.site_id !== "" &&
        (row.debit > 0 || row.credit > 0)
    )
  const debits = usable.reduce((sum, row) => sum + row.debit, 0)
  const credits = usable.reduce((sum, row) => sum + row.credit, 0)
  const units = byUnit(
    usable.map((row) => ({
      site_id: row.line.site_id,
      debit_minor: row.debit,
      credit_minor: row.credit,
    }))
  )
  /// Rows with an account chosen and no category, where the account's family
  /// asks for one.
  ///
  /// Counted over `usable` and not over every row, for the same reason the
  /// totals are: a row somebody has started and not finished is not an error
  /// yet. A row that is otherwise complete and is missing its category is,
  /// and it is the one refusal a composer can see coming — the trigger's
  /// sentence names the account and lists five legal codes, which is a fine
  /// message to never have to read.
  const uncategorised = usable.filter(
    (row) => !accountChoiceReady(row.line.account)
  )
  return {
    usable,
    debits,
    credits,
    uncategorised,
    /// Units this entry would leave carrying something — empty when each unit's
    /// own books foot.
    adrift: units.filter((unit) => unit.net_minor !== 0),
    balanced:
      usable.length >= 2 &&
      debits === credits &&
      debits > 0 &&
      uncategorised.length === 0,
  }
}

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
/// an offsetting account posted automatically per dimension; we have no such
/// rule and no `counter_site_id`, so the honest thing is to show the reader
/// what they are about to leave behind and let them decide.
function ComposerPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [postingDate, setPostingDate] = useState(todayIso)
  const [memo, setMemo] = useState("")
  const [lines, setLines] = useState<DraftLine[]>(() => [
    blankLine(),
    blankLine(),
  ])
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
            site_id: row.line.site_id,
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

  const setLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((was) =>
      was.map((line, at) => (at === index ? { ...line, ...patch } : line))
    )

  return (
    <Panel
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReceipt(null)
          onClose()
        }
      }}
      title="New journal entry"
      sub="Two sides, and a unit on each of them."
    >
      <div className="flex flex-col gap-4">
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
          <Field label="Posting date" hint="The month this lands in.">
            <Day value={postingDate} onChange={setPostingDate} />
          </Field>
          <Field label="Memo" hint="What this entry is for.">
            <Input
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              placeholder="Optional, and the only prose on the entry"
            />
          </Field>
        </div>

        <div>
          <SubHead aside={`${count(lines.length)} rows`}>
            Accounting entries
          </SubHead>
          <Grid>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th width="10rem">Unit</Th>
                <Th align="right" width="8.5rem">
                  Debit
                </Th>
                <Th align="right" width="8.5rem">
                  Credit
                </Th>
                <Th width="2.5rem" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <Td>
                    <AccountAndCategory
                      value={line.account}
                      onChange={(next) => setLine(index, { account: next })}
                      categoryLabel={`Category on row ${index + 1}`}
                    />
                  </Td>
                  <Td>
                    <LocationSelect
                      value={line.site_id}
                      onChange={(next) => setLine(index, { site_id: next })}
                      emptyLabel="Choose a unit"
                      className="h-8"
                      aria-label="Unit"
                    />
                  </Td>
                  <Td align="right">
                    <Money
                      label={`Debit on row ${index + 1}`}
                      value={line.debit}
                      onChange={(next) => setLine(index, { debit: next })}
                      placeholder="0"
                      className="h-8"
                    />
                  </Td>
                  <Td align="right">
                    <Money
                      label={`Credit on row ${index + 1}`}
                      value={line.credit}
                      onChange={(next) => setLine(index, { credit: next })}
                      placeholder="0"
                      className="h-8"
                    />
                  </Td>
                  <Td>
                    {lines.length > 2 && (
                      <Button
                        size="sm"
                        variant="quiet"
                        aria-label={`Remove row ${index + 1}`}
                        onClick={() =>
                          setLines((was) => was.filter((_, at) => at !== index))
                        }
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
              <TotalRow>
                <Td>Total</Td>
                <Td />
                <Td align="right">{money(totals.debits)}</Td>
                <Td align="right">{money(totals.credits)}</Td>
                <Td />
              </TotalRow>
            </tbody>
          </Grid>
          <Button
            variant="soft"
            className="mt-2.5"
            onClick={() => setLines((was) => [...was, blankLine()])}
          >
            <Plus />
            Add row
          </Button>
        </div>

        {totals.adrift.length > 0 && (
          <Note>
            <b>This would be an inter-unit entry.</b> It leaves{" "}
            {totals.adrift.map((unit, index) => (
              <span key={unit.site_id}>
                {index > 0 && ", "}
                <SiteName id={unit.site_id} />{" "}
                {unit.net_minor > 0 ? "up" : "down"}{" "}
                {money(Math.abs(unit.net_minor))}
              </span>
            ))}
            . The database checks that the <i>entry</i> balances, not that each
            unit does, so this will post — and nothing else will post the pair
            that settles it between them.
          </Note>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-hairline pt-3">
          <span className="text-[0.71875rem] text-mute tabular-nums">
            {totals.balanced
              ? `Balanced at ${money(totals.debits)}`
              : totals.usable.length === 0
                ? "No usable row yet — a row needs an account, a unit and a figure"
                : totals.uncategorised.length > 0
                  ? `${count(totals.uncategorised.length)} ${totals.uncategorised.length === 1 ? "row needs" : "rows need"} a category — the account is one line of the statement, the category is what it was for`
                  : `Debits ${money(totals.debits)} · credits ${money(totals.credits)}`}
          </span>
          <Button
            variant="primary"
            disabled={!totals.balanced || post.isPending}
            onClick={() => post.mutate()}
          >
            {post.isPending ? "Posting…" : "Post entry"}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

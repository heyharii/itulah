import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, RotateCcw } from "lucide-react"
import type { JournalEntryDetail, JournalEntryRow } from "@itulah/contract"
import type { ColumnDef } from "@tanstack/react-table"

import { api } from "@/lib/api"
import { Button } from "@/kit/button"
import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Tabs } from "@/kit/tabs"
import { Tag } from "@/kit/tag"
import { Truncated } from "@/kit/notice"
import { Empty, Failed, Loading } from "@/kit/state"
import { amount, count, day, rp } from "@/lib/format"
import { useBoundedList } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import type { TableSetup } from "@/lib/table"
import { Facts, DayField, SitePicker, SiteName } from "@/modules/finance/parts"

/// The journal — every entry in the books, whatever wrote it.
///
/// ## Append-only, so a reversal is a link and not a status
///
/// Both entries are real and both stay. A wrong entry is never edited or
/// deleted; it is answered by its mirror. Marking the original "cancelled"
/// would suggest it went away, and it did not — it is still in the ledger,
/// still in every balance up to the reversal date, and still the record of what
/// somebody actually did. So the list carries the FACT that an entry has been
/// answered, and the panel carries which entry answered it.
///
/// ## Why there is no search box on this screen
///
/// `GET /finance/journal` takes a window, a source kind, a location and a limit
/// — and no `q`. A box that filtered the rows already fetched would be
/// searching **the newest 200 entries**, not the journal, and the difference is
/// invisible at exactly the moment it matters: somebody hunting an entry from
/// April types its number, finds nothing, and concludes it was never posted.
///
/// Narrowing the window is the honest way to find an entry here, and it goes on
/// the wire. The gap is the endpoint's: it has no `q`, no cursor and no total,
/// so this screen also cannot say "200 of how many" — hence the strip above the
/// table whenever the answer reached the cap.
///
/// ## Why this screen draws no summary figures
///
/// Because adding entry totals together is not a figure anybody uses. A bill
/// and the payment that settles it both move the payable, so a sum over a page
/// of entries counts the same money twice — and it would be a sum over the
/// newest 200 in any case. What the books come to is the trial balance's
/// question, and it is answered once, there.

/// The server's cap on this endpoint — `limit.clamp(1, 1000)` in
/// `journal_register`, asked for at 200 because that is a register somebody
/// scrolls rather than a report they read.
const PAGE = 200

/// What wrote an entry. The values are the schema's own — `journal_entry`
/// carries a CHECK over exactly these — and the labels are what a person calls
/// them.
///
/// The list is what these books actually contain plus `PAYMENT` and `REVERSAL`,
/// which they will. `SALE_DAY`, `STOCK_COUNT` and `TRANSFER` are left out: they
/// are written by the till and the warehouse and none has ever appeared here, and
/// a filter that always answers "nothing" reads as broken.
const SOURCES: readonly { value: string; label: string }[] = [
  { value: "", label: "Everything" },
  { value: "MANUAL", label: "Manual" },
  { value: "SUPPLIER_INVOICE", label: "Supplier bill" },
  { value: "PAYMENT", label: "Payment" },
  { value: "DEPRECIATION", label: "Depreciation" },
  { value: "BANK_STATEMENT", label: "Bank line" },
  { value: "REVERSAL", label: "Reversal" },
]

const SOURCE_LABEL: Record<string, string> = Object.fromEntries(
  SOURCES.filter((source) => source.value !== "").map((source) => [
    source.value,
    source.label,
  ]),
)

export function JournalScreen() {
  const url = useQueryState()
  const from = url.one("from")
  const to = url.one("to")
  const kind = url.one("kind")
  const site = url.one("site")
  const openId = url.one("entry")

  // No default window, deliberately. The old screen opened on the current
  // month, which made an empty table mean two different things — "nothing was
  // posted in September" and "the books are empty" — and the reader could not
  // tell which without widening a control they had not noticed was set.
  const list = useBoundedList<JournalEntryRow>({
    key: ["finance", "journal"],
    path: "/api/v1/finance/journal",
    params: {
      from: from || null,
      to: to || null,
      kind: kind || null,
      site: site || null,
    },
    limit: PAGE,
  })

  const columns: ColumnDef<TableSetup, JournalEntryRow>[] = [
    {
      id: "entry",
      header: "Entry",
      size: 17,
      // No priority: the entry number is what somebody quotes, and a register
      // that hides it is not a register.
      meta: { icon: <FileText className="size-[15px]" />, min: 170 },
      cell: ({ row }) => (
        <>
          <span className="text-ink block truncate font-mono font-medium">
            {row.original.entry_number}
          </span>
          <span className="text-label text-ink-4 block">
            {day(row.original.posting_date)}
          </span>
        </>
      ),
    },
    {
      id: "source",
      header: "Written by",
      size: 15,
      meta: { min: 150 },
      cell: ({ row }) => {
        const source = row.original.source_kind
        return (
          <>
            {/* Manual is the one kind that means a person typed the entry from
                nothing, so it is the one kind drawn as a state rather than as a
                label. Everything else was written by a document. */}
            <Tag tone={source === "MANUAL" ? "warn" : "neutral"}>
              {SOURCE_LABEL[source] ?? source}
            </Tag>
          </>
        )
      },
    },
    {
      id: "memo",
      header: "Memo",
      size: 30,
      meta: { priority: 4, min: 220 },
      cell: ({ row }) => (
        <span className="text-ink-2 block truncate">
          {row.original.memo ?? "—"}
        </span>
      ),
    },
    {
      id: "answered",
      header: "Answered",
      size: 13,
      meta: { min: 130 },
      cell: ({ row }) => {
        const entry = row.original
        if (entry.reversed_by !== null) return <Tag tone="bad">Reversed</Tag>
        if (entry.reversal_of !== null) return <Tag tone="info">Reversal</Tag>
        return <span className="text-ink-4">—</span>
      },
    },
    {
      id: "lines",
      header: "Lines",
      size: 8,
      meta: { align: "right", priority: 2, min: 90 },
      cell: ({ row }) => (
        <span className="text-ink-3 tabular-nums">
          {count(row.original.line_count)}
        </span>
      ),
    },
    {
      id: "posted_by",
      header: "Posted by",
      size: 13,
      meta: { priority: 1, min: 130 },
      cell: ({ row }) => (
        <span className="text-ink-3 truncate">{row.original.posted_by}</span>
      ),
    },
    {
      id: "total",
      header: "Each side",
      size: 14,
      // Never dropped, and named "each side" rather than "total": an entry's
      // total is its debits, which equal its credits — the database checks it
      // at COMMIT — so one figure describes both. "Total" invites somebody to
      // read it as debits plus credits, which would be twice the money.
      meta: { align: "right", min: 130 },
      cell: ({ row }) => (
        <span className="text-ink font-medium tabular-nums">
          {amount(row.original.total_minor)}
        </span>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="General Ledger &amp; Closing"
        title="Journal"
        description="Every entry in the books, and what wrote it. Append-only: a wrong entry is answered by its mirror, never edited away."
      />

      <Tabs
        label="Written by"
        value={kind}
        onChange={(value) => url.set({ kind: value || null }, false)}
        tabs={SOURCES.map((source) => ({
          value: source.value,
          label: source.label,
        }))}
      />

      {/* `during`, not `as at`: these are movements. Every other finance screen
          that draws a position says so in the same words — see kit/scope.tsx
          for why the three sentences are never paraphrased apart. */}
      <ScopeLine
        scope={{
          kind: "during",
          period:
            from === "" && to === ""
              ? "every period on file"
              : `${from === "" ? "the beginning" : day(from)} — ${to === "" ? "today" : day(to)}`,
        }}
        unit={site === "" ? undefined : site}
        note={`the newest ${count(PAGE)} in it`}
      />

      <Toolbar
        trailing={
          list.query.isPending
            ? "Loading…"
            : `${count(list.rows.length)} entries on screen`
        }
      >
        <DayField
          label="From"
          value={from}
          onChange={(value) => url.set({ from: value || null })}
        />
        <DayField
          label="To"
          value={to}
          onChange={(value) => url.set({ to: value || null })}
        />
        <SitePicker
          value={site}
          onChange={(value) => url.set({ site: value || null }, false)}
        />
        {(from !== "" || to !== "") && (
          <Button
            variant="quiet"
            onClick={() => url.set({ from: null, to: null }, false)}
          >
            Whole register
          </Button>
        )}
      </Toolbar>

      {list.truncated && <Truncated limit={PAGE} noun="entries" />}

      {list.query.isError ? (
        <Failed
          what="the journal"
          error={list.query.error}
          onRetry={() => void list.query.refetch()}
        />
      ) : list.query.isPending ? (
        <Loading cols={7} />
      ) : list.rows.length === 0 ? (
        <Empty
          what="journal entries"
          detail={
            from === "" && to === "" && kind === "" && site === ""
              ? "Nothing has been posted at all. Until a month is opened and something is posted into it, the books are empty."
              : "Nothing was posted under this window, source and unit. Widen the window to tell an empty period from empty books."
          }
        />
      ) : (
        <Table
          columns={columns}
          rows={list.rows as JournalEntryRow[]}
          rowId={(row) => row.entry_id}
          caption="Journal register"
          onRowClick={(row) =>
            url.set(
              { entry: row.entry_id === openId ? null : row.entry_id },
              false,
            )
          }
          isOpen={(row) => row.entry_id === openId}
          foot={{
            entry: (
              <>
                <b className="text-ink">{count(list.rows.length)}</b> entries,
                newest first
              </>
            ),
            // Deliberately NOT a sum of the column above it. See the note at
            // the top of this file: entries double-count the money they move
            // between them, and this page of them is the newest 200 in any
            // case.
            total: "no total — see the trial balance",
          }}
        />
      )}

      <EntrySheet
        id={openId}
        onClose={() => url.set({ entry: null }, false)}
      />
    </div>
  )
}

/// One entry, its lines, and the two things an auditor asks it by name: who
/// posted it, and what answered it.
function EntrySheet({ id, onClose }: { id: string; onClose: () => void }) {
  const client = useQueryClient()
  // The only `useState` in this module, and the reason is that a reversal's
  // reason is a DRAFT: it is not a view of anything, nobody wants to send a
  // link to it, and putting a half-typed sentence in the address bar would add
  // a history entry per keystroke. The URL holds what you are looking at; this
  // is what you are writing.
  const [reason, setReason] = useState("")

  const detail = useQuery({
    queryKey: ["finance", "journal", "entry", id] as const,
    enabled: id !== "",
    queryFn: ({ signal }) =>
      api.get<JournalEntryDetail>(`/api/v1/finance/journal/${id}`, signal),
  })

  const reverse = useMutation({
    mutationFn: () =>
      api.post<{ entry_id: string; entry_number: string }>(
        `/api/v1/finance/journal/${id}/reverse`,
        { reason: reason.trim() },
      ),
    onSuccess: () => {
      setReason("")
      // A reversal writes a NEW entry and marks the old one answered, so the
      // register and this entry are both stale — and so is every balance, every
      // statement and the trial balance. Invalidating the whole finance prefix
      // is the honest answer here rather than a list of six keys that will be
      // seven next month.
      void client.invalidateQueries({ queryKey: ["finance"] })
    },
  })

  if (id === "") return null

  const entry = detail.data?.entry
  const answered = entry?.reversed_by !== null && entry !== undefined

  return (
    <Sheet
      open
      onClose={onClose}
      width="record"
      title={entry?.memo ?? (detail.isPending ? "Loading…" : "Journal entry")}
      subtitle={
        entry && (
          <>
            <span className="font-mono">{entry.entry_number}</span> ·{" "}
            {day(entry.posting_date)}
          </>
        )
      }
      foot={
        entry === undefined ? (
          <Button onClick={onClose}>Close</Button>
        ) : answered ? (
          <>
            <span className="text-label text-ink-4 flex-1">
              Already answered by its mirror. Both entries stay in the books.
            </span>
            <Button onClick={onClose}>Close</Button>
          </>
        ) : (
          <>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why this entry is being reversed"
              aria-label="Reason for the reversal"
              className="h-ctl rounded-ctl border-line-2 bg-canvas text-ctl text-ink placeholder:text-ink-4 focus-within:border-blue min-w-0 flex-1 border px-2.5 outline-none"
            />
            <Button
              variant="primary"
              icon={<RotateCcw className="size-4" />}
              disabled={reason.trim() === "" || reverse.isPending}
              onClick={() => reverse.mutate()}
            >
              {reverse.isPending ? "Reversing…" : "Reverse"}
            </Button>
          </>
        )
      }
    >
      {detail.isError ? (
        <Failed
          what="this entry"
          error={detail.error}
          onRetry={() => void detail.refetch()}
        />
      ) : detail.data === undefined || entry === undefined ? (
        <Loading rows={5} cols={4} />
      ) : (
        <div className="flex flex-col gap-5 p-[18px]">
          {reverse.isError && (
            <p className="rounded-ctl bg-bad-wash text-ctl text-bad-ink px-3 py-2">
              {reverse.error instanceof Error
                ? reverse.error.message
                : "The reversal was refused."}
            </p>
          )}
          {reverse.isSuccess && (
            <p className="rounded-ctl bg-ok-wash text-ctl text-ok-ink px-3 py-2">
              Reversed by{" "}
              <b className="font-medium">{reverse.data.entry_number}</b>. Both
              entries stay in the books.
            </p>
          )}

          <div className="flex flex-wrap gap-1.5">
            <Tag tone={entry.source_kind === "MANUAL" ? "warn" : "neutral"}>
              {SOURCE_LABEL[entry.source_kind] ?? entry.source_kind}
            </Tag>
            {entry.reversal_of !== null && <Tag tone="info">Reversal</Tag>}
            {entry.reversed_by !== null && <Tag tone="bad">Reversed</Tag>}
          </div>

          <Facts
            rows={[
              ["Posting date", day(entry.posting_date)],
              ["Currency", entry.currency],
              ["Posted by", entry.posted_by],
              ["Posted at", entry.posted_at.slice(0, 19).replace("T", " ")],
              // Each side, once. Debits equal credits by construction — the
              // database checks it at COMMIT — so two identical figures side by
              // side would only invite somebody to add them.
              ["Debits, and credits", rp(entry.total_minor)],
              entry.source_id === null
                ? null
                : [
                    "Source record",
                    <span key="src" className="font-mono">
                      {entry.source_id}
                    </span>,
                  ],
              entry.reversal_of === null
                ? null
                : [
                    "Reverses",
                    <span key="rev" className="font-mono">
                      {entry.reversal_of}
                    </span>,
                  ],
              entry.reversed_by === null
                ? null
                : [
                    "Reversed by",
                    <span key="by" className="font-mono">
                      {entry.reversed_by}
                    </span>,
                  ],
            ]}
          />

          <div>
            <h4 className="text-cell text-ink mb-2 font-semibold">Lines</h4>
            <table className="w-full">
              <caption className="sr-only">
                The lines of entry {entry.entry_number}
              </caption>
              <thead>
                <tr className="border-line border-b">
                  <th
                    scope="col"
                    className="text-label text-ink-4 py-1 text-left font-normal"
                  >
                    Account
                  </th>
                  <th
                    scope="col"
                    className="text-label text-ink-4 py-1 text-right font-normal"
                  >
                    Debit
                  </th>
                  <th
                    scope="col"
                    className="text-label text-ink-4 py-1 text-right font-normal"
                  >
                    Credit
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.data.lines.map((line) => (
                  <tr key={line.line_number} className="border-line border-b">
                    <td className="py-2 pr-2">
                      <span className="text-ctl text-ink block">
                        {line.account_name}
                      </span>
                      <span className="text-label text-ink-4 flex items-center gap-2">
                        <span className="font-mono">{line.account_code}</span>
                        <SiteName id={line.site_id} />
                      </span>
                      {line.memo !== null && (
                        <span className="text-label text-ink-3 block truncate">
                          {line.memo}
                        </span>
                      )}
                    </td>
                    <td className="text-ctl text-ink-2 py-2 text-right align-top tabular-nums">
                      {line.debit_minor === 0 ? "" : amount(line.debit_minor)}
                    </td>
                    <td className="text-ctl text-ink-2 py-2 text-right align-top tabular-nums">
                      {line.credit_minor === 0 ? "" : amount(line.credit_minor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-meta text-ink-4 mt-auto">
            Nothing on this panel can be edited. A wrong entry is answered by
            its mirror, which is what the button below writes — the original
            stays exactly as posted, and both are in every balance from their
            own dates.
          </p>
        </div>
      )}
    </Sheet>
  )
}

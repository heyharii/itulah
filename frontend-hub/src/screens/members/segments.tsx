import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Meter } from "@/components/ui/meter"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import {
  describeSegment,
  memberKeys,
  memberSegments,
  retireSegment,
  savedSegmentKeys,
  savedSegments,
  type SavedSegment,
  type SegmentBook,
  type SegmentRow,
} from "@/lib/queries/members"
import { useCatalogue } from "@/lib/queries/reports"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { describeDefinition } from "@/screens/members/definition"
import { SegmentForm } from "@/screens/members/segment-form"

/// Segments — the directory, read as six groups instead of a thousand rows.
///
/// **They are derived on every read, never stored.** A segment is a statement
/// about behaviour, and behaviour changes without anybody touching the
/// member's row: somebody moves from Active to Lapsing because ninety days
/// went by, not because a cashier did anything. A stored segment is therefore
/// wrong from the day after it is written, and wrong *silently* — which is the
/// worst failure a marketing list has, because the campaign still sends.
///
/// **They are exhaustive and mutually exclusive**, so the six counts add up to
/// the directory and a reader can check the arithmetic. That rules out the
/// overlapping kind — "big spenders", "people who buy outerwear" — which are
/// real questions that belong to a query builder rather than to a fixed list.
/// What is here is the axis every retailer starts from, because it is the one
/// that says who to talk to: how long since they last came in.
///
/// **Every count is a link.** A segment nobody can open is a number to quote
/// in a meeting; a segment that opens the directory filtered to it is a list
/// somebody can work through. The two windows the definitions are written in
/// terms of come from the server with the counts, so this screen never states
/// a threshold it does not have from the same answer it is drawing.
///
/// # One grid, both kinds
///
/// Segments somebody wrote down — "lapsing, and has spent at least five
/// million" — sit in the SAME grid as the six, on the owner's instruction
/// (2026-09-13). They used to have their own section and their own paragraph
/// explaining that the six add up to the directory and these do not.
///
/// That distinction is real and it is still true; what was wrong was making a
/// reader learn it before they could read a card. A written card is told apart
/// by having Edit and Retire on it, which is the difference that matters to
/// somebody using the screen — and nothing here invites the six to be added
/// up in the first place, because each card carries a share of the directory
/// rather than a slice of a pie the page draws.
///
/// What is stored for a written segment is still only its conditions. Who is
/// in it is worked out on every read, by the same query the directory uses —
/// so the rule at the top of this file holds for every card in the grid.

/// Order is fixed by the server's `SEGMENT_ORDER` and the book arrives in it —
/// newest relationship to oldest, then the two that are not about recency at
/// all. Not re-sorted here: a group that moved position because it grew would
/// make the screen unreadable week to week.
function share(row: SegmentRow, book: SegmentBook): number {
  if (book.member_count === 0) return 0
  return row.members / book.member_count
}

/// Which way a segment reads. The same mapping the directory's pills use, and
/// deliberately not derived from the count: a segment is not bad because it is
/// big, it is bad because of what it says about the people in it.
function tone(key: string) {
  switch (key) {
    case "NEW":
      return "new" as const
    case "ACTIVE":
      return "ok" as const
    case "LAPSING":
      return "warn" as const
    case "LAPSED":
      return "bad" as const
    case "NEVER":
      return "warn" as const
    default:
      return "neutral" as const
  }
}

export function Segments() {
  const book = useQuery({
    queryKey: memberKeys.segments(),
    queryFn: ({ signal }) => memberSegments(signal),
  })
  const saved = useQuery({
    queryKey: savedSegmentKeys.list(),
    queryFn: ({ signal }) => savedSegments(signal),
  })

  /// Which segment is being written, in the URL like every other sheet in this
  /// app. `new` is the sentinel for one that does not exist yet — a half-
  /// written segment is not a record, so there is no id to name it by, and a
  /// flag beside the id would be two keys that can disagree.
  const editing = useSheet("segmentEdit")
  const writing = editing.value === "new"
  const edited = saved.data?.find((one) => one.segment_id === editing.value)

  return (
    <PageContent>
      <PageHeader
        crumb="Members"
        title="Segments"
        sub="The directory grouped by how long since somebody last came in, worked out on every read."
        actions={
          <Button variant="primary" onClick={() => editing.open("new")}>
            New segment
          </Button>
        }
      />

      {queryState(book, {
        loading: "Counting the directory…",
        render: (data) =>
          data.member_count === 0 && data.unenrolled_count === 0 ? (
            <Card className="overflow-hidden">
              <EmptyState>
                Nobody has been enrolled and no sale has named a customer, so
                there is nothing to group. A segment is a reading of the
                directory — it cannot exist before the directory does.
              </EmptyState>
            </Card>
          ) : (
            <Book
              book={data}
              saved={saved.data ?? []}
              onEdit={(id) => editing.open(id)}
            />
          ),
      })}

      {(writing || edited !== undefined) && (
        <SegmentForm
          open
          // Keyed so switching from one saved segment to another rebuilds the
          // form rather than leaving the previous one's clauses in its state.
          key={editing.value}
          editing={edited}
          onClose={editing.close}
          onSaved={editing.close}
        />
      )}
    </PageContent>
  )
}

function WrittenCard({
  saved,
  columns,
  onEdit,
  onRetire,
  retiring,
}: {
  saved: SavedSegment
  columns: readonly { readonly key: string; readonly label: string }[]
  onEdit: () => void
  onRetire: () => void
  retiring: boolean
}) {
  const tally = saved.tally
  const portion =
    tally && tally.member_count > 0 ? tally.members / tally.member_count : 0

  return (
    <Card className="flex flex-col gap-3.5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* `neutral`, always. The six are tinted by what they say about the
              people in them; a written segment says whatever its author meant,
              and a colour would be this screen inventing an opinion. */}
          <Pill tone="neutral">{saved.name}</Pill>
          <div className="mt-2 text-[1.375rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {tally ? count(tally.members) : "—"}
          </div>
        </div>
        <div className="flex w-24 shrink-0 flex-col items-end gap-1.5">
          <span className="text-[0.71875rem] text-mute tabular-nums">
            {tally === undefined
              ? "—"
              : `${Math.round(portion * 100)}% of members`}
          </span>
          <Meter value={portion} tone="accent" />
        </div>
      </div>

      {/* The conditions, in the words the form would accept back. A card that
          only showed a name would make somebody open the editor to find out
          what the list actually is. */}
      <p className="text-[0.78125rem] leading-relaxed text-body">
        {describeDefinition(saved.definition, columns)}
      </p>
      {saved.purpose && (
        <p className="text-[0.78125rem] leading-relaxed text-mute">
          {saved.purpose}
        </p>
      )}

      {tally && (
        <MiniTable
          head={[
            { label: "Measure", align: "left" },
            { label: "Value", align: "right" },
          ]}
        >
          <MiniRow>
            <MiniCell>Spent</MiniCell>
            <MiniCell align="right">{money(tally.spent_minor)}</MiniCell>
          </MiniRow>
          <MiniRow>
            <MiniCell>Average each</MiniCell>
            <MiniCell align="right">
              {money(tally.average_spend_minor)}
            </MiniCell>
          </MiniRow>
          <MiniRow>
            <MiniCell>Last purchase</MiniCell>
            <MiniCell align="right">{day(tally.last_purchase_at)}</MiniCell>
          </MiniRow>
        </MiniTable>
      )}

      <div className="flex items-center gap-2">
        {tally !== undefined && tally.members > 0 && (
          <AppLink
            to="/members"
            sheet={{ key: "segmentId", value: saved.segment_id }}
            variant="ghost"
          >
            Open the list
          </AppLink>
        )}
        {saved.editable && (
          <>
            <Button variant="ghost" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="ghost" disabled={retiring} onClick={onRetire}>
              {retiring ? "Retiring…" : "Retire"}
            </Button>
          </>
        )}
        <span className="ml-auto text-[0.6875rem] text-mute tabular-nums">
          v{saved.version}
        </span>
      </div>
    </Card>
  )
}

function Book({
  book,
  saved,
  onEdit,
}: {
  book: SegmentBook
  saved: readonly SavedSegment[]
  onEdit: (id: string) => void
}) {
  const client = useQueryClient()
  const catalogue = useCatalogue()
  const columns = useMemo(
    () =>
      catalogue.data?.datasets.find((one) => one.name === "member")
        ?.dimensions ?? [],
    [catalogue.data]
  )
  const retire = useMutation({
    mutationFn: (id: string) => retireSegment(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: savedSegmentKeys.all })
    },
  })

  const windows = {
    active_days: book.active_days,
    lapsing_days: book.lapsing_days,
  }

  /// The three that mean somebody is still a customer, against the three that
  /// mean they are not. Computed here rather than asked of the server because
  /// it is a reading of the same six numbers, and a screen that asked for a
  /// seventh figure could show one that disagreed with the six below it.
  const reachable = book.segments
    .filter((row) => row.key === "NEW" || row.key === "ACTIVE")
    .reduce((total, row) => total + row.members, 0)
  const spent = book.segments.reduce((total, row) => total + row.spent_minor, 0)

  return (
    <>
      <KpiStrip>
        <Kpi label="Enrolled" value={count(book.member_count)} />
        <Kpi label="Buying now" value={count(reachable)} />
        <Kpi label="Member spend" value={money(spent)} />
        <Kpi label="Active within" value={`${count(book.active_days)} days`} />
        <Kpi label="Lapsed after" value={`${count(book.lapsing_days)} days`} />
        <Kpi
          label="Not enrolled"
          value={count(book.unenrolled_count)}
          delta={money(book.unenrolled_spent_minor)}
        />
      </KpiStrip>

      {/* One grid, both kinds — see the note at the top of this file. The six
          come first because they are the whole directory and a written segment
          is a question asked of it. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {book.segments.map((row) => (
          <SegmentCard key={row.key} row={row} book={book} windows={windows} />
        ))}
        {saved.map((one) => (
          <WrittenCard
            key={one.segment_id}
            saved={one}
            columns={columns}
            onEdit={() => onEdit(one.segment_id)}
            onRetire={() => retire.mutate(one.segment_id)}
            retiring={retire.isPending && retire.variables === one.segment_id}
          />
        ))}
      </div>
    </>
  )
}

function SegmentCard({
  row,
  book,
  windows,
}: {
  row: SegmentRow
  book: SegmentBook
  /// The two thresholds the segment sentences are written in terms of, passed
  /// down rather than re-read off `book` in each card: the definition lives on
  /// the server, and one place per screen is where it should arrive.
  windows: { readonly active_days: number; readonly lapsing_days: number }
}) {
  const described = describeSegment(row.key, windows)
  const portion = share(row, book)

  return (
    <Card className="flex flex-col gap-3.5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Pill tone={tone(row.key)}>{described.label}</Pill>
          <div className="mt-2 text-[1.375rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {count(row.members)}
          </div>
        </div>
        {/* The share of the whole directory, drawn the one way this app draws
            a proportion. Percent is stated beside the bar because a bar alone
            is unreadable below about a tenth. */}
        <div className="flex w-24 shrink-0 flex-col items-end gap-1.5">
          <span className="text-[0.71875rem] text-mute tabular-nums">
            {book.member_count === 0
              ? "—"
              : `${Math.round(portion * 100)}% of members`}
          </span>
          <Meter
            value={portion}
            tone={tone(row.key) === "bad" ? "bad" : "accent"}
          />
        </div>
      </div>

      <p className="text-[0.78125rem] leading-relaxed text-body">
        {described.meaning}
      </p>

      <MiniTable
        head={[
          { label: "Measure", align: "left" },
          { label: "Value", align: "right" },
        ]}
      >
        <MiniRow>
          <MiniCell>Spent</MiniCell>
          <MiniCell align="right">{money(row.spent_minor)}</MiniCell>
        </MiniRow>
        <MiniRow>
          <MiniCell>Sales</MiniCell>
          <MiniCell align="right">{count(row.transaction_count)}</MiniCell>
        </MiniRow>
        <MiniRow>
          {/* Per member, not per sale — the figure that says whether a segment
              is worth a campaign at all. A thousand lapsed members averaging
              nothing are not worth a message; two hundred averaging a million
              are. */}
          <MiniCell>Average each</MiniCell>
          <MiniCell align="right">{money(row.average_spend_minor)}</MiniCell>
        </MiniRow>
        <MiniRow>
          <MiniCell>Last purchase</MiniCell>
          <MiniCell align="right">{day(row.last_purchase_at)}</MiniCell>
        </MiniRow>
      </MiniTable>

      {row.members > 0 && (
        <AppLink
          to="/members"
          sheet={{ key: "segment", value: row.key }}
          variant="ghost"
          className="self-start"
        >
          Open the list
        </AppLink>
      )}
    </Card>
  )
}

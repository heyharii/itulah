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
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
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
import { Strays } from "@/screens/members/strays"

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
/// # The second half of the screen
///
/// Below the six sits the other kind: segments somebody wrote down. Those are
/// the overlapping questions this screen used to refuse — "lapsing, and has
/// spent at least five million" — and they are kept in their own section,
/// under their own heading, for one reason that is not tidiness: **the six add
/// up to the directory and these do not**. Drawn in one grid, the arithmetic
/// that makes the six checkable would silently stop holding, and a reader
/// would have no way of telling which numbers they were allowed to add.
///
/// What is stored for a written segment is still only its conditions. Who is
/// in it is worked out on every read, by the same query the directory uses —
/// so the rule at the top of this file is not weakened by anything below it.

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
        sub="The directory read as six groups, by how long since somebody last came in. Worked out on every read, never stored."
        actions={
          <Button variant="dark" onClick={() => editing.open("new")}>
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
            <Book book={data} />
          ),
      })}

      <Written
        saved={saved.data ?? []}
        loading={saved.isPending}
        onWrite={() => editing.open("new")}
        onEdit={(id) => editing.open(id)}
      />

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

/// Segments somebody wrote down.
///
/// Its own section, its own heading, and deliberately not the same grid as the
/// six above. These overlap each other and do not add up to the directory: a
/// member can be in three of them or in none, and two counts here cannot be
/// added the way the six can. A screen that drew both kinds identically would
/// be inviting exactly that addition.
function Written({
  saved,
  loading,
  onWrite,
  onEdit,
}: {
  saved: readonly SavedSegment[]
  loading: boolean
  onWrite: () => void
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

  return (
    <div className="mt-6">
      <SubHead aside={loading ? "…" : `${count(saved.length)} written`}>
        Segments you have written
      </SubHead>
      {/* Said once, under the heading, because it is the one thing a reader
          could get wrong from the layout: these cards look like the six above
          and do not behave like them. The six divide the directory; these cut
          across it, so a member can be in several or in none and two of these
          counts are not addable. */}
      <p className="-mt-1 mb-3 text-[0.78125rem] leading-relaxed text-mute">
        These overlap each other and the six above. A member can be in several
        of them or in none, so unlike the six, these counts do not add up to
        anything.
      </p>

      {loading ? (
        // Not the empty state while the answer is still coming. "You have
        // written none" and "we have not asked yet" are different sentences,
        // and flashing the first one invites somebody to write a second copy
        // of a segment they already have.
        <Card className="overflow-hidden">
          <EmptyState>Reading the segments you have written…</EmptyState>
        </Card>
      ) : saved.length === 0 ? (
        <Card className="overflow-hidden">
          <EmptyState
            action={
              <Button variant="soft" onClick={onWrite}>
                Write one
              </Button>
            }
          >
            The six above are the whole directory, divided by one question. A
            written segment answers a different shape of question — "lapsing,
            and has spent at least five million" — which overlaps them and is
            nobody's whole population.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
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
      )}
    </div>
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

function Book({ book }: { book: SegmentBook }) {
  /// Who the last KPI is counting. In the URL like every sheet here, so "look
  /// at the people we are crediting points to who cannot see them" is a link
  /// somebody can be sent.
  const strays = useSheet("strays")
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

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {book.segments.map((row) => (
          <SegmentCard key={row.key} row={row} book={book} windows={windows} />
        ))}
      </div>

      <Card className="mt-4 p-5">
        <SubHead aside={`${count(book.unenrolled_count)} shoppers`}>
          Named on a sale, not enrolled
        </SubHead>
        {/* Not a seventh segment, and the card is separate so it cannot be
            read as one: these people are not members, so they are not in the
            counts above. They are here because leaving them out would make the
            directory look like the whole customer base — and because they are
            the only group on this screen with an obvious next action. */}
        <p className="text-[0.78125rem] leading-relaxed text-body">
          The till has written these customer numbers onto sales, but no card
          was ever enrolled against them. They are not members and are not
          counted above. Between them they have spent{" "}
          <span className="text-ink tabular-nums">
            {money(book.unenrolled_spent_minor)}
          </span>
          , which is spend the scheme currently cannot see.
        </p>
        {book.unenrolled_count > 0 && (
          <div className="mt-3.5">
            {/* The action the sentence above has been promising. Enrolling one
                of these numbers attaches its whole history in the same breath,
                because a member and their sales are joined on the card number
                rather than copied together. */}
            <Button onClick={() => strays.open(true)}>See who they are</Button>
          </div>
        )}
      </Card>

      <Strays open={strays.isOpen} onClose={() => strays.close()} />
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

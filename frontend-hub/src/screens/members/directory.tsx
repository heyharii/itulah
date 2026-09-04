import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { UserPlus, X } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, day, money } from "@/lib/format"
import {
  describeSegment,
  listMembers,
  memberKeys,
  memberSegments,
  savedSegmentKeys,
  savedSegments,
  SEGMENT_ORDER,
  type MemberRow,
  type SegmentKey,
} from "@/lib/queries/members"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { EnrolCard, IssueCode } from "@/screens/members/counter"

/// The member directory — everybody holding a card, and what they have done
/// with it.
///
/// Until this screen there was no way to find a member you could not already
/// name. The only member reads were `/api/v1/customer/{id}/…`, which answer
/// questions about ONE shopper whose card number you are holding, and the
/// screen that used them keyed itself on an id somebody typed in from memory.
/// A loyalty scheme nobody can list is a foreign key, not a scheme.
///
/// **What a row is worth reading for.** Not the name — most of them have none,
/// because a shopper who will not give one still gets a card. It is the four
/// numbers to the right: how many times they have come in, what they have
/// spent, what the shop has already given back in promotions, and what the
/// shop still owes them on vouchers. The last is the one nobody expects to
/// find on a customer list, and it is the one that turns a directory into
/// something a manager can act on.
///
/// **Segment goes to the server; the search box does not.** A segment changes
/// which population is being read, so it is a query the database answers. The
/// search box narrows what is already on screen, which is instant and costs
/// nothing — at the price stated in the toolbar: it can only find somebody
/// inside the page that was loaded. When a directory outgrows that, `q` moves
/// to the server, which already takes it.

/// One read, big enough that the client-side search is honest for a real
/// membership, and capped where the server caps it.
const PAGE = 1_000

/// Tint by how far gone somebody is, not by how much they are worth.
///
/// `NEVER` is deliberately `warn` and not `neutral`: a card handed out and
/// never used is a failure of the enrolment, and drawing it as an ordinary
/// state hides the single most fixable thing on this screen.
function segmentTone(key: SegmentKey) {
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
    case "BLOCKED":
      return "neutral" as const
  }
}

/// "42 days ago", or the honest absence of an answer.
///
/// `null` is not a large number and must not sort as one: somebody who has
/// never bought is a different case from somebody who bought two years ago,
/// and a column that renders both as "—" would file them together.
function lastSeen(row: MemberRow): string {
  if (row.days_since_purchase === null) return "Never"
  if (row.days_since_purchase === 0) return "Today"
  if (row.days_since_purchase === 1) return "Yesterday"
  return `${count(row.days_since_purchase)} days ago`
}

function columnsFor(
  windows: {
    readonly active_days: number
    readonly lapsing_days: number
  } | null
): ColumnDef<TableSetup, MemberRow>[] {
  return [
    {
      id: "member",
      accessorFn: (row) => `${row.member_id} ${row.display_name ?? ""}`,
      header: "Member",
      size: 260,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2">
          <Tag>{row.original.member_id}</Tag>
          <span className="truncate text-[0.8125rem] text-ink">
            {/* No name is the ordinary case, not a gap in the data — a shopper
                who will not give one still gets a card, and a required name is
                a required lie. Said in words rather than left blank. */}
            {row.original.display_name ?? (
              <span className="text-mute">No name given</span>
            )}
          </span>
        </span>
      ),
    },
    {
      id: "segment",
      accessorFn: (row) => row.segment,
      header: "Segment",
      size: 130,
      cell: ({ row }) => (
        <Pill tone={segmentTone(row.original.segment)}>
          {windows === null
            ? row.original.segment
            : describeSegment(row.original.segment, windows).label}
        </Pill>
      ),
    },
    {
      id: "sales",
      accessorFn: (row) => row.transaction_count,
      header: "Sales",
      size: 90,
      meta: { align: "right" },
      cell: ({ row }) =>
        row.original.transaction_count === 0 ? (
          <span className="text-mute">—</span>
        ) : (
          <span className="tabular-nums">
            {count(row.original.transaction_count)}
          </span>
        ),
    },
    {
      id: "spent",
      accessorFn: (row) => row.spent_minor,
      header: "Spent",
      size: 130,
      meta: { align: "right" },
      cell: ({ row }) => (
        <span className="tabular-nums">{money(row.original.spent_minor)}</span>
      ),
    },
    {
      id: "saved",
      accessorFn: (row) => row.saved_minor,
      header: "Saved",
      size: 120,
      meta: { align: "right" },
      // What the shop has already given this person in promotions. Beside
      // spend it answers the question a loyalty scheme exists to ask — whether
      // the discount bought the custom — and neither figure means much alone.
      cell: ({ row }) =>
        row.original.saved_minor === 0 ? (
          <span className="text-mute">—</span>
        ) : (
          <span className="text-body tabular-nums">
            {money(row.original.saved_minor)}
          </span>
        ),
    },
    {
      id: "vouchers",
      accessorFn: (row) => row.voucher_balance_minor,
      header: "On voucher",
      size: 130,
      meta: { align: "right" },
      // Money the shop owes this person specifically. It is a liability, so it
      // is drawn even when the rest of the row is empty.
      cell: ({ row }) =>
        row.original.voucher_balance_minor === 0 ? (
          <span className="text-mute">—</span>
        ) : (
          <span className="text-ink tabular-nums">
            {money(row.original.voucher_balance_minor)}
          </span>
        ),
    },
    {
      id: "seen",
      // Sorted on the number, drawn as a sentence. `null` sorts last, which is
      // where "never bought" belongs in a column about recency.
      accessorFn: (row) => row.days_since_purchase ?? Number.MAX_SAFE_INTEGER,
      header: "Last seen",
      size: 130,
      meta: { align: "right" },
      cell: ({ row }) => (
        <span
          className={
            row.original.days_since_purchase === null
              ? "text-mute"
              : "text-body tabular-nums"
          }
        >
          {lastSeen(row.original)}
        </span>
      ),
    },
    {
      id: "paired",
      accessorFn: (row) => (row.paired ? 1 : 0),
      header: "App",
      size: 100,
      // The difference between a customer the shop can reach and one it can
      // only serve. Not a fault when it is absent — most cards never pair —
      // which is why the unpaired case is neutral rather than a warning.
      cell: ({ row }) =>
        row.original.paired ? (
          <Pill tone="info">Paired</Pill>
        ) : (
          <span className="text-mute">Card only</span>
        ),
    },
  ]
}

export function Members() {
  /// What was typed. In the URL like every other search box in this app: a
  /// filtered directory is a thing people send each other, and a `useState`
  /// box cannot be sent.
  const search = useSheet("q")
  /// Which segment is being read. Also in the URL, and that is the whole
  /// mechanism behind the Segments screen: every count there is a link to a
  /// directory narrowed to it, so the arithmetic can be checked rather than
  /// believed.
  const segment = useSheet("segment")
  /// A *written* segment, narrowing the same list by a definition somebody
  /// saved. A separate key from the six above because they are separate
  /// things: those are derived and their names are a closed set, this is an id
  /// the server resolves. The clauses are never in the URL — a link carrying
  /// them would be a copy that stops agreeing with the definition the moment
  /// somebody edits it, and the list would then disagree with the count on the
  /// card that linked here.
  const written = useSheet("segmentId")
  const open = useSheet("member")
  /// The counter's sheet. In the URL like the rest, so "enrol a card" is
  /// something a manager can send to somebody standing at a till.
  const enrolling = useSheet("enrol")
  const [sorting, setSorting] = useState<SortingState>([])

  const directory = useQuery({
    queryKey: memberKeys.directory({
      segment: segment.value,
      segmentId: written.value,
    }),
    queryFn: ({ signal }) =>
      listMembers(
        {
          segment: segment.value,
          segmentId: written.value,
          limit: PAGE,
        },
        signal
      ),
  })

  /// The written segment's own row, for the chip that says what the list is
  /// narrowed by. Read from the saved list rather than from the link, so the
  /// name on screen is the name it has now.
  const saved = useQuery({
    queryKey: savedSegmentKeys.list(),
    queryFn: ({ signal }) => savedSegments(signal),
    enabled: written.value !== undefined,
  })
  const narrowedBy = saved.data?.find((one) => one.segment_id === written.value)

  /// Only for the two window lengths, which the segment names are written in
  /// terms of. The server owns the definition — 90 days and 180 today — and a
  /// screen that hard-coded them would be the second copy that drifts.
  const book = useQuery({
    queryKey: memberKeys.segments(),
    queryFn: ({ signal }) => memberSegments(signal),
  })

  const windows = useMemo(
    () =>
      book.data
        ? {
            active_days: book.data.active_days,
            lapsing_days: book.data.lapsing_days,
          }
        : null,
    [book.data]
  )

  const columns = useMemo(() => columnsFor(windows), [windows])
  const rows = useMemo(() => directory.data?.members ?? [], [directory.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: MemberRow) => row.member_id,
        state: { globalFilter: search.value ?? "", sorting },
        onSortingChange: setSorting,
      }),
      [rows, columns, search.value, sorting]
    )
  )

  const selected = rows.find((row) => row.member_id === open.value) ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="Members"
        title="Members"
        sub="Everybody holding a card, what they have spent, and how long since they last came in."
        actions={
          <>
            <Input
              value={search.value ?? ""}
              onChange={(event) =>
                event.target.value === ""
                  ? search.close()
                  : search.open(event.target.value)
              }
              placeholder="Card number or name"
              className="h-8 w-56"
            />
            {/* The one act this screen was missing. Until it existed the
                directory could list members and the shopper's app could sign
                them in, and nothing anywhere could create one — the chain was
                broken at its first link. */}
            <Button variant="dark" onClick={() => enrolling.open(true)}>
              <UserPlus />
              Enrol a card
            </Button>
          </>
        }
      />

      <Toolbar>
        <Segmented
          options={[
            { value: "ALL", label: "Everyone" },
            ...SEGMENT_ORDER.map((key) => ({
              value: key,
              label:
                windows === null ? key : describeSegment(key, windows).label,
            })),
          ]}
          value={segment.value ?? "ALL"}
          onChange={(next) =>
            next === "ALL" ? segment.close() : segment.open(next as SegmentKey)
          }
        />
        {written.value !== undefined && (
          /* Named and dismissible. A list narrowed by something the reader
             cannot see is the failure this whole feature would otherwise
             introduce: the six are visible in the strip above, and a written
             one has to be just as visible or the count below is unexplained. */
          <button
            type="button"
            onClick={() => written.close()}
            className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-soft-2 px-3 text-[0.75rem] text-ink transition-colors hover:bg-soft-3"
          >
            <span className="text-mute">Segment</span>
            {narrowedBy?.name ?? "…"}
            <X className="size-3.5 text-line-ico" />
          </button>
        )}
        <Toolbar.Spacer />
        <span className="text-[0.75rem] text-mute tabular-nums">
          {/* Two different numbers, and the difference is the point: the second
              is everybody enrolled, so a filtered list can say what it is a
              fraction of. */}
          {count(rows.length)} shown ·{" "}
          {count(directory.data?.member_count ?? 0)} enrolled
          {rows.length === PAGE && " · first 1,000 only"}
        </span>
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(directory, {
          loading: "Reading the directory…",
          render: (data) =>
            data.members.length === 0 ? (
              <EmptyState>
                {written.value !== undefined
                  ? "Nobody matches that segment's conditions today. It is worked out on every read, so it empties and fills on its own."
                  : segment.value === undefined
                    ? "Nobody has been enrolled yet. Enrol a card above, against a number the shopper is already holding."
                    : "No member is in that segment today. It is a statement about behaviour, so it empties and fills on its own."}
              </EmptyState>
            ) : (
              <DataTable<MemberRow>
                table={table}
                onRowClick={(row) => open.open(row.member_id)}
                isSelected={(row) => row.member_id === open.value}
                empty="No member on this page matches that search."
                className="max-h-[calc(100vh-17rem)]"
              />
            ),
        })}
      </Card>

      <MemberSheet
        member={selected}
        windows={windows}
        onClose={() => open.close()}
      />

      <EnrolCard open={enrolling.isOpen} onClose={() => enrolling.close()} />
    </PageContent>
  )
}

// ---------------------------------------------------------------------------

/// One member, as the directory already knows them.
///
/// Everything here came down with the list, so opening a member costs nothing
/// and works offline of any further request. What it deliberately does NOT do
/// is show their transactions: those are a different read against a different
/// route, they can run to hundreds of rows, and Store Ops already has a screen
/// built for exactly that. The link at the foot goes there with the card
/// number already in it.
function MemberSheet({
  member,
  windows,
  onClose,
}: {
  member: MemberRow | null
  windows: {
    readonly active_days: number
    readonly lapsing_days: number
  } | null
  onClose: () => void
}) {
  const segment =
    member && windows ? describeSegment(member.segment, windows) : null

  return (
    <Sheet
      open={member !== null}
      onOpenChange={(next) => !next && onClose()}
      id={member?.member_id}
      title={member?.display_name ?? "No name given"}
    >
      {member && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Pill tone={segmentTone(member.segment)}>
              {segment?.label ?? member.segment}
            </Pill>
            {segment && (
              <p className="text-[0.78125rem] leading-relaxed text-body">
                {segment.meaning}
              </p>
            )}
          </div>

          <Facts>
            <Fact term="Joined">{day(member.joined_on)}</Fact>
            <Fact term="Last seen">{lastSeen(member)}</Fact>
            <Fact term="Sales">{count(member.transaction_count)}</Fact>
            <Fact term="Spent">{money(member.spent_minor)}</Fact>
            <Fact term="Saved">{money(member.saved_minor)}</Fact>
            <Fact term="Points">{count(member.points_earned_total)}</Fact>
            <Fact term="First bought">{day(member.first_purchase_at)}</Fact>
            <Fact term="On voucher">{money(member.voucher_balance_minor)}</Fact>
          </Facts>

          {/* The act that turns a card into somebody who can see their own
              points. Here rather than at the foot with the links because it is
              a write, and a write belongs above the places this sheet sends
              you. Already-paired members still get it: a new phone is the
              ordinary reason somebody asks. */}
          <div className="flex flex-col gap-2">
            {member.paired && (
              <p className="text-[0.78125rem] leading-relaxed text-body">
                A phone is already paired to this card. Issuing a code pairs
                another — which is what a replaced handset needs, and is also
                what somebody else's phone would need, so ask for the card.
              </p>
            )}
            {/* Keyed, and it is load-bearing: this sheet stays mounted when
                somebody clicks the next row, so an unkeyed panel would hand a
                code requested for one member to whatever member is on screen
                when the reply lands. See `IssueCode`. */}
            <IssueCode
              key={member.member_id}
              memberId={member.member_id}
              blocked={member.blocked_at !== null}
            />
          </div>

          {member.blocked_at !== null && (
            // Blocked, not deleted, and the sheet has to say which: the sales
            // stay attributed to this row, and deleting it would leave them
            // pointing at a member nobody can look up.
            <p className="text-[0.78125rem] leading-relaxed text-bad">
              Membership stopped on {day(member.blocked_at)}. Their sales stay
              attributed to this card, which is why the row is blocked rather
              than removed.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <AppLink
              to="/storeops/customer"
              sheet={{ key: "member", value: member.member_id }}
              variant="ghost"
            >
              Their transactions
            </AppLink>
            {member.voucher_balance_minor > 0 && (
              <AppLink to="/commercial/vouchers" variant="ghost">
                Their vouchers
              </AppLink>
            )}
          </div>
        </div>
      )}
    </Sheet>
  )
}

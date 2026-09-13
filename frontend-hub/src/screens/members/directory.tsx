import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { X } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState, NoMatch, Truncated } from "@/components/ui/states"
import { useFilters } from "@/lib/filters"
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
import { IssueCode } from "@/screens/members/counter"

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
/// because a shopper who will not give one still gets a card. It is the retail
/// figures to the right: spend, transactions, average transaction, units,
/// units per transaction, and what they hold in points. Those are the numbers
/// a buyer and a shop manager already talk in, and together they say something
/// spend alone does not — two members who have spent the same amount over four
/// visits and over forty are different customers.
///
/// **Enrolling is not done here** (2026-09-13). A card is a physical object
/// somebody is holding out across a counter, and the person who can see it is
/// the cashier. Head office enrolling a number it cannot see is how a scheme
/// acquires cards nobody ever collected. What stays here is the pairing code,
/// which is read down a phone line to a member who already has one.
///
/// **Segment goes to the server; the search box does not.** A segment changes
/// which population is being read, so it is a query the database answers. The
/// search box narrows what is already on screen, which is instant and costs
/// nothing — at a price the banner states the moment it is being paid: it can
/// only find somebody inside the page that was loaded. When a directory
/// outgrows that, `q` moves to the server, which already takes it.

/// One read, big enough that the client-side search is honest for a real
/// membership, and capped where the server caps it.
///
/// Named once so the request and the banner below cannot drift apart, and
/// named a ceiling rather than a page because nothing here asks for a second
/// one: past this number the directory stops being able to answer the question
/// it appears to answer.
const CAP = 1_000

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

/// A basket size. One decimal, because "2" and "2,4" units a transaction are
/// different findings and only the second is true.
function decimal(value: number): string {
  return value.toLocaleString("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
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

/// Takings over receipts, and pieces over receipts. Both are the retail
/// figures — ATV and UPT — and both are worked out here rather than sent,
/// because the two parts are already on the row and a third number on the wire
/// is a third number that can disagree with them.
///
/// Zero receipts is not a zero average, it is no average: somebody holding a
/// card who has never bought has no basket to have a size.
function per(total: number, transactions: number): number | null {
  // `isFinite` and not just the zero check: an older server that has not been
  // rebuilt with `units_total` on the wire sends nothing at all for it, and
  // `undefined / 5` is `NaN` — which renders as the word NaN in a column of
  // rupiah. A missing numerator is the same answer as no transactions: there
  // is no average to state.
  if (!Number.isFinite(total) || transactions === 0) return null
  return total / transactions
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
      size: 200,
      // The card number is no longer a tag beside the name. On a scheme where
      // most shoppers give no name it was a tag on every row saying `cust-1`,
      // which is a column of noise — so the number is the identity only where
      // there is no name to be the identity instead, and the sheet carries it
      // either way.
      // No pill for a stopped membership: `BLOCKED` is one of the six, so the
      // Segment column beside this one already says it, and two "Stopped"
      // chips on one row read as two different facts.
      cell: ({ row }) => (
        <span className="block truncate text-[0.8125rem] text-ink">
          {row.original.display_name ?? row.original.member_id}
        </span>
      ),
    },
    {
      id: "segment",
      accessorFn: (row) => row.segment,
      header: "Segment",
      size: 120,
      cell: ({ row }) => (
        <Pill tone={segmentTone(row.original.segment)}>
          {windows === null
            ? row.original.segment
            : describeSegment(row.original.segment, windows).label}
        </Pill>
      ),
    },
    {
      id: "spent",
      accessorFn: (row) => row.spent_minor,
      header: "Spend",
      size: 130,
      // Minor units on the wire, whole rupiah in the box: a manager picking
      // out the members worth a call types 5000000 and means five million.
      meta: {
        align: "right",
        filter: { kind: "number", unit: "Rp" },
      },
      cell: ({ row }) => (
        <span className="font-medium text-ink tabular-nums">
          {money(row.original.spent_minor)}
        </span>
      ),
    },
    {
      id: "sales",
      accessorFn: (row) => row.transaction_count,
      header: "Transactions",
      size: 110,
      meta: { align: "right", filter: { kind: "number", unit: "sales" } },
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
      id: "atv",
      // Sorted on the number and drawn as money. `null` — never bought — sorts
      // to the bottom rather than reading as the cheapest shopper in the
      // scheme, which is what a zero here would have said.
      accessorFn: (row) => per(row.spent_minor, row.transaction_count) ?? -1,
      header: "Avg transaction",
      size: 140,
      meta: { align: "right", filter: { kind: "number", unit: "Rp" } },
      cell: ({ row }) => {
        const average = per(
          row.original.spent_minor,
          row.original.transaction_count
        )
        return average === null ? (
          <span className="text-mute">—</span>
        ) : (
          <span className="text-body tabular-nums">
            {money(Math.round(average))}
          </span>
        )
      },
    },
    {
      id: "units",
      accessorFn: (row) => row.units_total,
      header: "Units",
      size: 90,
      meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
      cell: ({ row }) =>
        row.original.units_total === 0 ? (
          <span className="text-mute">—</span>
        ) : (
          <span className="tabular-nums">{count(row.original.units_total)}</span>
        ),
    },
    {
      id: "upt",
      accessorFn: (row) => per(row.units_total, row.transaction_count) ?? -1,
      header: "UPT",
      size: 80,
      // Units per transaction. Not filterable — a shopper's basket size is read
      // across the row against their spend, not narrowed by on its own.
      meta: { align: "right" },
      cell: ({ row }) => {
        const upt = per(row.original.units_total, row.original.transaction_count)
        return upt === null ? (
          <span className="text-mute">—</span>
        ) : (
          <span className="text-body tabular-nums">{decimal(upt)}</span>
        )
      },
    },
    {
      id: "points",
      accessorFn: (row) => row.points_balance,
      header: "Points",
      size: 100,
      // What is on the card NOW, which is the figure somebody at a counter is
      // being asked for — not the lifetime total, which is a fact about the
      // past and cannot be spent. The lifetime total is in the sheet.
      meta: { align: "right", filter: { kind: "number", unit: "pts" } },
      cell: ({ row }) => (
        <span
          className={
            row.original.points_balance < 0
              ? "font-medium text-bad tabular-nums"
              : row.original.points_balance === 0
                ? "text-mute"
                : "font-medium text-ink tabular-nums"
          }
        >
          {row.original.points_balance === 0
            ? "—"
            : count(row.original.points_balance)}
        </span>
      ),
    },
    {
      id: "redeemed",
      accessorFn: (row) => row.points_spent_total,
      header: "Points spent",
      size: 110,
      meta: { align: "right" },
      cell: ({ row }) =>
        row.original.points_spent_total === 0 ? (
          <span className="text-mute">—</span>
        ) : (
          <span className="text-body tabular-nums">
            {count(row.original.points_spent_total)}
          </span>
        ),
    },
    {
      id: "seen",
      // Sorted on the number, drawn as a sentence. `null` sorts last, which is
      // where "never bought" belongs in a column about recency.
      accessorFn: (row) => row.days_since_purchase ?? Number.MAX_SAFE_INTEGER,
      header: "Last purchase",
      size: 130,
      // Days, because that is what the accessor holds — and somebody who has
      // never bought rides at the far end of it rather than dropping out, the
      // same bargain the sort above makes. "At least 90 days" therefore means
      // "including the ones who never came back", which is what a reader
      // hunting lapsed members means by it.
      meta: {
        align: "right",
        filter: { kind: "number", unit: "days" },
      },
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
  const [sorting, setSorting] = useState<SortingState>([])

  /// The search now runs on the SERVER, over the card number and the name.
  /// It was running in the browser over whatever the first thousand rows
  /// happened to be, which is a search of the page rather than of the scheme —
  /// and the membership this is built for is larger than the page. The table's
  /// own `globalFilter` stays below: every row the server sent already matches,
  /// so it narrows nothing further and is one fewer thing to move.
  const directory = useQuery({
    queryKey: memberKeys.directory({
      segment: segment.value,
      segmentId: written.value,
      q: search.value,
    }),
    queryFn: ({ signal }) =>
      listMembers(
        {
          segment: segment.value,
          segmentId: written.value,
          q: search.value,
          limit: CAP,
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

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: MemberRow) => row.member_id,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: search.value ?? "",
          sorting,
        },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, search.value, sorting]
    )
  )

  const selected = rows.find((row) => row.member_id === open.value) ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="Members"
        title="Members"
        sub="Everybody holding a card, and what they buy."
        actions={
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
        {/* Segment is deliberately not among the questions in here. The strip
            to the left asks it on the WIRE, over the whole membership; a
            second copy in the panel would ask it in the browser over the first
            thousand rows, and the two would disagree the day the scheme
            outgrows the page. */}
        <FilterPanel model={filters} table={table} />
        <Toolbar.Spacer />
        <span className="text-[0.75rem] text-mute tabular-nums">
          {/* Two different numbers, and the difference is the point: the second
              is everybody enrolled, so a filtered list can say what it is a
              fraction of. */}
          {count(rows.length)} shown ·{" "}
          {count(directory.data?.member_count ?? 0)} enrolled
        </span>
      </Toolbar>

      {/* This replaced a "· first 1,000 only" tacked onto the chip above, which
          was the same fact whispered: it sat in grey nine-point type at the end
          of a line whose first half is a count, where it read as a caption
          rather than as a warning that the count is not one. Only when the
          answer came back exactly as large as the question — a shorter one
          proves there was nothing more to send. */}
      {/* The server now says how many there really are, so the banner appears
          when the answer is short of the truth rather than merely as long as
          the question — which was a proxy that could not tell a full page from
          a full scheme. */}
      {(directory.data?.total ?? 0) > rows.length && (
        <Truncated limit={CAP} noun="members" />
      )}

      <Card className="overflow-hidden">
        {queryState(directory, {
          // No refusal state, and the absence is the finding: `required_role`
          // sends every GET outside `/finance` and the admin prefixes to
          // CASHIER, the lowest role there is, so `GET /members` cannot answer
          // 403 to anybody holding a session at all. A state nobody can reach
          // would be a claim that somebody can.
          loading: "Reading the directory…",
          render: (data) =>
            data.members.length === 0 ? (
              <EmptyState>
                {written.value !== undefined
                  ? "Nobody matches that segment's conditions today. It is worked out on every read, so it empties and fills on its own."
                  : segment.value === undefined
                    ? "Nobody has been enrolled yet. Cards are enrolled at a till, against a number the shopper is already holding."
                    : "No member is in that segment today. It is a statement about behaviour, so it empties and fills on its own."}
              </EmptyState>
            ) : (
              <DataTable<MemberRow>
                table={table}
                onRowClick={(row) => open.open(row.member_id)}
                isSelected={(row) => row.member_id === open.value}
                // The held count is the loaded rows and not `member_count`: the
                // search runs over what is on this page, and answering "there
                // are 4.812 members and none of them match" would be true of
                // the scheme and false of the search that was actually run.
                empty={
                  <NoMatch
                    what="members"
                    held={rows.length}
                    onClear={() => search.close()}
                  />
                }
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
  const atv =
    member === null ? null : per(member.spent_minor, member.transaction_count)
  const upt =
    member === null ? null : per(member.units_total, member.transaction_count)

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

          {/* The whole record, including the four figures the table dropped:
              the card number itself, what promotions gave back, what the shop
              still owes on vouchers, and whether a phone is paired. A row is a
              scan; this is the answer to a question about one person. */}
          <Facts>
            <Fact term="Card">{member.member_id}</Fact>
            <Fact term="Joined">{day(member.joined_on)}</Fact>
            <Fact term="First bought">{day(member.first_purchase_at)}</Fact>
            <Fact term="Last purchase">{lastSeen(member)}</Fact>
            <Fact term="Spend">{money(member.spent_minor)}</Fact>
            <Fact term="Transactions">{count(member.transaction_count)}</Fact>
            <Fact term="Avg transaction">
              {atv === null ? "—" : money(Math.round(atv))}
            </Fact>
            <Fact term="Units">{count(member.units_total)}</Fact>
            <Fact term="UPT">{upt === null ? "—" : decimal(upt)}</Fact>
            <Fact term="Points held">{count(member.points_balance)}</Fact>
            <Fact term="Points earned">
              {count(member.points_earned_total)}
            </Fact>
            <Fact term="Points spent">{count(member.points_spent_total)}</Fact>
            <Fact term="Saved by promotions">{money(member.saved_minor)}</Fact>
            <Fact term="On voucher">{money(member.voucher_balance_minor)}</Fact>
            <Fact term="App">{member.paired ? "Paired" : "Card only"}</Fact>
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
              to="/sales/customer"
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

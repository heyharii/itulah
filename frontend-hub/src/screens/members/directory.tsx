import {
  useInfiniteQuery,
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useHydrated } from "@tanstack/react-router"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { X } from "lucide-react"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SheetSection,
} from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  SheetEmpty,
  SheetError,
  SheetLoading,
  SheetQuery,
} from "@/components/ui/sheet-states"
import { EmptyState, LoadingState, NoMatch } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { isComplete, useFilters } from "@/lib/filters"
import { count, day, EMPTY, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import {
  describeSegment,
  memberDirectoryQuery,
  MEMBERS_PAGE,
  memberQuery,
  memberRedemptionsQuery,
  memberSegmentsQuery,
  savedSegmentKeys,
  savedSegments,
  SEGMENT_ORDER,
  type MemberQuery,
  type MemberRow,
  type MemberSort,
  type SegmentKey,
} from "@/lib/queries/members"
import { toServerFilters } from "@/lib/queries/reports"
import { customerTransactions, storeopsKeys } from "@/lib/queries/storeops"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import {
  CardFigure,
  CardFoot,
  CardName,
  Fig,
  Sentence,
} from "@/components/ui/phone-cards"
import { IssueCode } from "@/screens/members/counter"
import { MemberReceiptSheet } from "@/screens/sales/customer"
import type {
  CustomerTransaction,
  RedeemRequest,
  RedeemRequestStatus,
} from "@itulah/contract"

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
/// **Everything that narrows or orders the list goes to the server.** The
/// directory is read a page at a time as the table scrolls, so a search, a
/// filter chip or a sort run in the browser would be run over the pages
/// already loaded and would quietly miss everybody below them. The segment
/// strip, the search box, the filter chips and the column sorts are all
/// parameters of the one request; the table only draws what came back.

/// Table column → the `member` dataset dimension the server filters it by.
///
/// Only the columns listed here carry a filter. Avg transaction and UPT are
/// worked out on the row rather than being dimensions of the dataset, so the
/// server has nothing to narrow them by — and a chip on them would narrow the
/// loaded rows only.
const FILTER_COLUMN: Readonly<Record<string, string>> = {
  spent: "spent_minor",
  sales: "transaction_count",
  units: "units_total",
  points: "points_balance",
  seen: "days_since_purchase",
}

/// Table column → the server's sort. Segment is not among them: its codes
/// have no order worth reading, and the strip above already groups by it.
const SORTS: Readonly<Record<string, MemberSort>> = {
  member: "name",
  phone: "card",
  spent: "spent",
  sales: "transactions",
  atv: "atv",
  units: "units",
  upt: "upt",
  points: "points",
  redeemed: "points_spent",
  seen: "last_purchase",
}

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

/// `L` and `P` as the till takes them, in words. `null` for a member the till
/// never asked.
function genderWord(gender: MemberRow["gender"]): string | null {
  if (gender === "L") return "Male"
  if (gender === "P") return "Female"
  return null
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
      meta: { card: "hide" },
      // The card number is no longer a tag beside the name. On a scheme where
      // most shoppers give no name it was a tag on every row saying `cust-1`,
      // which is a column of noise — so the number is the identity only where
      // there is no name to be the identity instead, and the sheet carries it
      // either way.
      // No pill for a stopped membership: `BLOCKED` is one of the six, so the
      // Segment column beside this one already says it, and two "Stopped"
      // chips on one row read as two different facts.
      cell: ({ row }) => (
        <span className="block truncate text-[0.9375rem] text-ink">
          {row.original.display_name ?? row.original.member_id}
        </span>
      ),
    },
    // What the till registers, in the order it asks for it (client, 23 Oct
    // 2026). The phone is the card number of a member registered at a till.
    // Address and birth place are in the sheet only: a column of them would
    // be a column of sentences.
    {
      id: "phone",
      accessorFn: (row) => row.member_id,
      header: "Phone",
      size: 140,
      meta: { card: "hide", priority: 2 },
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.member_id}</span>
      ),
    },
    {
      id: "gender",
      accessorFn: (row) => genderWord(row.gender) ?? "",
      header: "Gender",
      size: 90,
      enableSorting: false,
      meta: { card: "hide", priority: 3 },
      cell: ({ row }) => {
        const word = genderWord(row.original.gender)
        return word === null ? (
          <span className="text-mute">—</span>
        ) : (
          <span>{word}</span>
        )
      },
    },
    {
      id: "birth",
      accessorFn: (row) => row.birth_date ?? "",
      header: "Birth Date",
      size: 120,
      enableSorting: false,
      meta: { card: "hide", priority: 3 },
      cell: ({ row }) =>
        row.original.birth_date === null ? (
          <span className="text-mute">—</span>
        ) : (
          <span className="tabular-nums">{day(row.original.birth_date)}</span>
        ),
    },
    {
      id: "email",
      accessorFn: (row) => row.email ?? "",
      header: "Email",
      size: 200,
      enableSorting: false,
      meta: { card: "hide", priority: 3 },
      cell: ({ row }) =>
        row.original.email === null ? (
          <span className="text-mute">—</span>
        ) : (
          <span className="block truncate">{row.original.email}</span>
        ),
    },
    {
      id: "segment",
      accessorFn: (row) => row.segment,
      header: "Segment",
      size: 120,
      enableSorting: false,
      meta: { card: "hide" },
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
        card: "hide",
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
      meta: {
        align: "right",
        card: "hide",
        filter: { kind: "number", unit: "sales" },
      },
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
      header: "Avg Transaction",
      size: 140,
      // Sorted by the server, not filtered by it: see `FILTER_COLUMN`.
      meta: { align: "right", card: "hide" },
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
      meta: {
        align: "right",
        card: "hide",
        filter: { kind: "number", unit: "pcs" },
      },
      cell: ({ row }) =>
        row.original.units_total === 0 ? (
          <span className="text-mute">—</span>
        ) : (
          <span className="tabular-nums">
            {count(row.original.units_total)}
          </span>
        ),
    },
    {
      id: "upt",
      accessorFn: (row) => per(row.units_total, row.transaction_count) ?? -1,
      header: "UPT",
      size: 80,
      // Units per transaction. Not filterable — a shopper's basket size is read
      // across the row against their spend, not narrowed by on its own.
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => {
        const upt = per(
          row.original.units_total,
          row.original.transaction_count
        )
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
      meta: {
        align: "right",
        card: "hide",
        filter: { kind: "number", unit: "pts" },
      },
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
      header: "Points Spent",
      size: 110,
      meta: { align: "right", card: "hide" },
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
      header: "Last Purchase",
      size: 130,
      // Days, filtered by the server. Somebody who has never bought has no
      // number of days at all, so "at least 90 days" does NOT include them —
      // "is empty" is the clause that finds them, and the Never bought
      // segment is the strip's way of saying the same.
      meta: {
        align: "right",
        card: "hide",
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
    // Four columns that exist only on a card (`cardLead`; a phone): who, what
    // they have spent as the figure with their transactions under it, a foot
    // with the points on the card and when they last bought, and where they
    // stand as a pill (owner, 2026-10-06).
    {
      id: "head",
      accessorFn: (row) => row.display_name ?? row.member_id,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "title" },
      cell: ({ row }) => (
        <CardName
          name={row.original.display_name ?? row.original.member_id}
          // The number is the identity only where there is no name to be it.
          code={
            row.original.display_name === null
              ? undefined
              : row.original.member_id
          }
        />
      ),
    },
    {
      id: "lead",
      accessorFn: (row) => row.spent_minor,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      cell: ({ row }) => (
        <CardFigure
          value={money(row.original.spent_minor)}
          caption={`${count(row.original.transaction_count)} ${row.original.transaction_count === 1 ? "transaction" : "transactions"}`}
          tone={row.original.spent_minor === 0 ? "quiet" : undefined}
        />
      ),
    },
    {
      id: "foot",
      accessorFn: (row) => row.points_balance,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      cell: ({ row }) => (
        <CardFoot>
          {count(row.original.points_balance)} points
          <br />
          Last purchase {lastSeen(row.original).toLowerCase()}
        </CardFoot>
      ),
    },
    {
      id: "tag",
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { align: "right", card: "status" },
      cell: ({ row }) => (
        <Pill tone={segmentTone(row.original.segment)}>
          {windows === null
            ? row.original.segment
            : describeSegment(row.original.segment, windows).label}
        </Pill>
      ),
    },
  ]
}

export function Members() {
  return (
    <PageContent>
      <PageHeader
        crumb="Members"
        title="Members"
        sub="Everybody holding a card, and what they buy."
      />

      <Suspense fallback={<LoadingState>Reading the directory…</LoadingState>}>
        <MemberBook />
      </Suspense>
    </PageContent>
  )
}

/// The directory with everything drawn from it: the segment strip and the
/// filter chips on the segment windows the server names, the counts, the
/// table, and the drawer over the bottom bar on a phone. The page's head and
/// its search stand outside, so they paint before the directory arrives.
function MemberBook() {
  const phone = useLayout() === "phone"
  // The dock is the browser's: a boundary that streams in after the page has
  // hydrated finds the dock already there and would draw into it, where the
  // server drew nothing.
  const hydrated = useHydrated()
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
  /// Empty is the server's house order: spend, most first.
  const [sorting, setSorting] = useState<SortingState>([])

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
  const { data: book } = useSuspenseQuery(memberSegmentsQuery())

  const windows = useMemo(
    () => ({
      active_days: book.active_days,
      lapsing_days: book.lapsing_days,
    }),
    [book.active_days, book.lapsing_days]
  )

  const columns = useMemo(() => columnsFor(windows), [windows])

  /// The chips, read from the URL. Only the model is used — the table is not
  /// handed `columnFilters`, because the server has already applied them.
  const filters = useFilters(columns)

  /// The chips as the server's clauses, on the dataset's own column names.
  /// Unfinished ones stay on screen and off the wire: a half-typed "between"
  /// is not a narrower list.
  const serverFilters = useMemo(
    () =>
      toServerFilters(
        filters.filters.flatMap((clause) => {
          const column = FILTER_COLUMN[clause.column]
          return column !== undefined && isComplete(clause)
            ? [{ ...clause, column }]
            : []
        })
      ).filters,
    [filters.filters]
  )

  /// Debounced, because every keystroke is a request over the whole scheme.
  const needle = useDebounced((search.value ?? "").trim(), 300)

  const scope = useMemo<MemberQuery>(() => {
    const by = sorting[0]
    const sort = by === undefined ? undefined : SORTS[by.id]
    // "Last purchase" is drawn as days ago, and fewer days is a LATER
    // purchase — so the column's ascending is the server's descending.
    const desc =
      by === undefined ? undefined : by.id === "seen" ? !by.desc : by.desc
    return {
      segment: segment.value,
      segmentId: written.value,
      q: needle === "" ? undefined : needle,
      sort,
      dir: sort === undefined ? undefined : desc ? "desc" : "asc",
      filters: serverFilters,
      limit: MEMBERS_PAGE,
    }
  }, [segment.value, written.value, needle, sorting, serverFilters])

  /// Read for the question as it was a moment ago while a new one is on its
  /// way, so a keystroke or a chip does not blank the table to a loading line.
  const asked = useDeferredValue(scope)
  const directory = useSuspenseInfiniteQuery(memberDirectoryQuery(asked))

  const rows = useMemo(
    () => directory.data.pages.flatMap((page) => page.members),
    [directory.data]
  )
  const head = directory.data.pages[0]
  const narrowed = needle !== "" || serverFilters.length > 0

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: MemberRow) => row.member_id,
        state: {
          sorting,
          // The card's own columns are drawn on a phone and never on a desk.
          columnVisibility: {
            head: phone,
            lead: phone,
            foot: phone,
            tag: phone,
          },
        },
        // The rows arrive in the order the request asked for. Sorting them
        // again here would sort the pages in hand and call it the directory.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, columns, sorting, phone]
    )
  )

  /// The row as the list already holds it. A member opened from a link is not
  /// necessarily among the loaded pages; the sheet reads that one itself.
  const selected = rows.find((row) => row.member_id === open.value)

  return (
    <>
      {/* A phone's one line of what the list holds, and the written segment it
          is narrowed by, which has no home in the drawer. */}
      {phone && (
        <Sentence>
          <Fig>{count(head?.total ?? 0)}</Fig> found,{" "}
          <Fig>{count(head?.member_count ?? 0)}</Fig> enrolled.
          {written.value !== undefined && (
            <>
              {" "}
              Segment{" "}
              <span className="text-ink">{narrowedBy?.name ?? "…"}</span>.{" "}
              <button
                type="button"
                onClick={() => written.close()}
                className="text-accent underline underline-offset-2"
              >
                Show everyone
              </button>
            </>
          )}
        </Sentence>
      )}

      {!phone && (
        <>
          <SubTabs
            tabs={[
              {
                value: "ALL",
                label: (
                  <span>
                    Everyone
                    <span className="ml-1.5 text-body tabular-nums">
                      {count(book.member_count)}
                    </span>
                  </span>
                ),
              },
              ...SEGMENT_ORDER.map((key) => ({
                value: key,
                label: (
                  <span>
                    {describeSegment(key, windows).label}
                    <span className="ml-1.5 text-body tabular-nums">
                      {count(
                        book.segments.find((one) => one.key === key)?.members ??
                          0
                      )}
                    </span>
                  </span>
                ),
              })),
            ]}
            value={segment.value ?? "ALL"}
            onChange={(next) =>
              next === "ALL"
                ? segment.close()
                : segment.open(next as SegmentKey)
            }
          />
          <Toolbar>
            {written.value !== undefined && (
              /* Named and dismissible. A list narrowed by something the reader
             cannot see is the failure this whole feature would otherwise
             introduce: the six are visible in the strip above, and a written
             one has to be just as visible or the count below is unexplained. */
              <button
                type="button"
                onClick={() => written.close()}
                className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-soft-2 px-3 text-[0.9375rem] text-ink transition-colors hover:bg-soft-3"
              >
                <span className="text-mute">Segment</span>
                {narrowedBy?.name ?? "…"}
                <X className="size-3.5 text-line-ico" />
              </button>
            )}
            {/* Segment is deliberately not among the questions in here: the
            tabs above already ask it, and two places to set one
            question is two answers to reconcile. */}
            <FilterPanel
              model={filters}
              search={{
                value: search.value ?? "",
                onChange: (next) =>
                  next === "" ? search.close() : search.open(next),
                label: "Search members",
              }}
            />
            <Toolbar.Spacer />
            <span className="text-[0.9375rem] text-mute tabular-nums">
              {/* Two different numbers, and the difference is the point: the first
              is everybody the search, segment and chips match — the server's
              count, not the rows loaded so far — and the second is everybody
              enrolled, so a filtered list can say what it is a fraction of. */}
              {count(head?.total ?? 0)} found · {count(head?.member_count ?? 0)}{" "}
              enrolled
            </span>
          </Toolbar>
        </>
      )}

      <Card
        aria-busy={asked !== scope || undefined}
        className="list-swap overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
      >
        {/* No refusal state, and the absence is the finding: `required_role`
            sends every GET outside `/finance` and the admin prefixes to
            CASHIER, the lowest role there is, so `GET /members` cannot answer
            403 to anybody holding a session at all. A state nobody can reach
            would be a claim that somebody can. */}
        {rows.length === 0 && narrowed ? (
          // Held only when nothing else narrows: with a segment applied
          // too, the whole scheme is not what the search was run over.
          <NoMatch
            what="members"
            held={
              segment.value === undefined && written.value === undefined
                ? head?.member_count
                : undefined
            }
            onClear={() => {
              search.close()
              filters.clear()
            }}
          />
        ) : rows.length === 0 ? (
          <EmptyState>
            {written.value !== undefined
              ? "Nobody matches that segment's conditions today. It is worked out on every read, so it empties and fills on its own."
              : segment.value === undefined
                ? "Nobody has been enrolled yet. Cards are enrolled at a POS, against a number the shopper is already holding."
                : "No member is in that segment today. It is a statement about behaviour, so it empties and fills on its own."}
          </EmptyState>
        ) : (
          <DataTable<MemberRow>
            refresh={[directory]}
            table={table}
            onRowClick={(row) => open.open(row.member_id)}
            isSelected={(row) => row.member_id === open.value}
            more={directory}
            cardSort={false}
            cardsApart
            cardLead
            className="max-h-[calc(100dvh-17rem)]"
          />
        )}
      </Card>

      {/* On a phone the segment is the status button of the drawer over the
          bottom bar, beside the search, the filters and the sort. */}
      {hydrated && (
        <DockTools
          search={{
            value: search.value ?? "",
            onChange: (next) =>
              next === "" ? search.close() : search.replace(next),
            label: "Search Members",
          }}
          filter={{
            count: filters.filters.length,
            panel: { model: filters, table },
          }}
          sort={dockSortOf(table)}
          status={{
            value: segment.value ?? "ALL",
            options: [
              { value: "ALL", label: "Everyone" },
              ...SEGMENT_ORDER.map((key) => ({
                value: key,
                label:
                  windows === null ? key : describeSegment(key, windows).label,
              })),
            ],
            onChange: (next) =>
              next === "ALL"
                ? segment.close()
                : segment.open(next as SegmentKey),
          }}
        />
      )}

      <MemberSheet
        memberId={open.value}
        row={selected}
        windows={windows}
        onClose={() => open.close()}
      />
    </>
  )
}

// ---------------------------------------------------------------------------

/// One member: what the till registered, what they hold, what they have done
/// with it, and the two histories behind those figures — every purchase and
/// every redemption.
///
/// The facts come down with the list when the member is on it, so opening a
/// row costs nothing. When the sheet was opened from a link and the list has
/// not loaded the page they are on, the sheet reads the member itself
/// (`GET /api/v1/members/{id}`). The histories are always their own reads: each
/// can run to hundreds of rows, and a purchase opens its receipt in a sheet
/// over this one.
function MemberSheet({
  memberId,
  row,
  windows,
  onClose,
}: {
  memberId: string | undefined
  /// The row as the directory already holds it, if it does.
  row: MemberRow | undefined
  windows: {
    readonly active_days: number
    readonly lapsing_days: number
  } | null
  onClose: () => void
}) {
  /// The same key the Sales screen's Member page opens a receipt by.
  const receipt = useSheet("sale")
  const found = useQuery({
    ...memberQuery(memberId ?? ""),
    enabled: memberId !== undefined && row === undefined,
  })
  const member = row ?? found.data ?? null
  const segment =
    member && windows ? describeSegment(member.segment, windows) : null

  return (
    <>
      <Sheet
        open={memberId !== undefined}
        onOpenChange={(next) => !next && onClose()}
        size="rail"
        stack
        id={memberId}
        title={
          member === null ? "Member" : (member.display_name ?? "No name given")
        }
        badge={
          member === null ? undefined : (
            <Pill tone={segmentTone(member.segment)}>
              {segment?.label ?? member.segment}
            </Pill>
          )
        }
      >
        {memberId === undefined ? null : member === null ? (
          found.isError ? (
            <SheetError
              error={found.error}
              onRetry={() => void found.refetch()}
            />
          ) : (
            <SheetLoading what="member" />
          )
        ) : (
          <MemberBody member={member} onOpenSale={receipt.open} />
        )}
      </Sheet>

      {/* Over the member, never without one: a receipt left in the address
          after its member is shut would open on its own the next time. */}
      <MemberReceiptSheet
        customerId={memberId ?? ""}
        saleId={memberId === undefined ? null : (receipt.value ?? null)}
        onClose={receipt.close}
      />
    </>
  )
}

/// The sheet's sections, in the order they are asked about: who they are, what
/// they have spent, what they hold, the act that gives their phone access, and
/// then the histories.
function MemberBody({
  member,
  onOpenSale,
}: {
  member: MemberRow
  onOpenSale: (saleId: string) => void
}) {
  const atv = per(member.spent_minor, member.transaction_count)
  const upt = per(member.units_total, member.transaction_count)

  return (
    <>
      {/* What the POS registers at F5 and shows on a lookup. */}
      <Facts>
        <Fact term="Phone number">{member.member_id}</Fact>
        <Fact term="Name">{member.display_name ?? EMPTY}</Fact>
        <Fact term="Gender">{genderWord(member.gender) ?? EMPTY}</Fact>
        <Fact term="Birth place">{member.birth_place ?? EMPTY}</Fact>
        <Fact term="Birth date">
          {member.birth_date === null ? EMPTY : day(member.birth_date)}
        </Fact>
        <Fact term="Joined">{day(member.joined_on)}</Fact>
        <Fact term="Points balance">{count(member.points_balance)}</Fact>
        <Fact term="Status">
          {member.blocked_at === null
            ? "Active"
            : `Blocked since ${day(member.blocked_at)}`}
        </Fact>
        <Fact term="Email" wide>
          {member.email ?? EMPTY}
        </Fact>
        <Fact term="Address" wide>
          {member.address ?? EMPTY}
        </Fact>
      </Facts>

      {/* The figures the table dropped: what promotions gave back, what the
          shop still owes on vouchers, and whether a phone is paired. A row is
          a scan; this is the answer to a question about one person. */}
      <SheetSection title="Spending">
        <Facts>
          <Fact term="Spend">{money(member.spent_minor)}</Fact>
          <Fact term="Transactions">{count(member.transaction_count)}</Fact>
          <Fact term="Avg transaction">
            {atv === null ? "—" : money(Math.round(atv))}
          </Fact>
          <Fact term="Units">{count(member.units_total)}</Fact>
          <Fact term="UPT">{upt === null ? "—" : decimal(upt)}</Fact>
          <Fact term="Saved by promotions">{money(member.saved_minor)}</Fact>
          <Fact term="First bought">{day(member.first_purchase_at)}</Fact>
          <Fact term="Last purchase">{lastSeen(member)}</Fact>
        </Facts>
      </SheetSection>

      <SheetSection title="Points and vouchers">
        <Facts>
          <Fact term="Points earned">{count(member.points_earned_total)}</Fact>
          <Fact term="Points spent">{count(member.points_spent_total)}</Fact>
          <Fact term="On voucher">{money(member.voucher_balance_minor)}</Fact>
          <Fact term="App">{member.paired ? "Paired" : "Not paired"}</Fact>
        </Facts>
      </SheetSection>

      {/* The act that turns a card into somebody who can see their own
          points. Here rather than at the foot with the links because it is a
          write, and a write belongs above the places this sheet sends you.
          Already-paired members still get it: a new phone is the ordinary
          reason somebody asks. */}
      <div className="flex flex-col gap-2">
        {member.paired && (
          <p className="text-[0.9375rem] leading-relaxed text-body">
            A phone is already paired to this card. Issuing a code pairs another
            — which is what a replaced handset needs, and is also what somebody
            else's phone would need, so ask for the card.
          </p>
        )}
        {/* Keyed, and it is load-bearing: this sheet stays mounted when
            somebody clicks the next row, so an unkeyed panel would hand a
            code requested for one member to whatever member is on screen when
            the reply lands. See `IssueCode`. */}
        <IssueCode
          key={member.member_id}
          memberId={member.member_id}
          blocked={member.blocked_at !== null}
        />
      </div>

      {/* Keyed for the same reason: the next row is a different history. */}
      <MemberTransactions
        key={`sales-${member.member_id}`}
        memberId={member.member_id}
        total={member.transaction_count}
        onOpen={onOpenSale}
      />
      <MemberRedemptions
        key={`redemptions-${member.member_id}`}
        memberId={member.member_id}
      />

      <div className="flex flex-wrap gap-2">
        <AppLink
          to="/sales/customer"
          sheet={{ key: "member", value: member.member_id }}
          variant="ghost"
        >
          Their transactions
        </AppLink>
        <AppLink
          to="/members/points-ledger"
          sheet={{ key: "customer", value: member.member_id }}
          variant="ghost"
        >
          Points ledger
        </AppLink>
        {member.voucher_balance_minor > 0 && (
          <AppLink to="/commercial/vouchers" variant="ghost">
            Their vouchers
          </AppLink>
        )}
      </div>
    </>
  )
}

/// Their purchases, newest first, a page at a time.
///
/// The Sales screen's Member page reads the same endpoint with the same cursor
/// and the same page size, under the same key when nothing narrows it — so a
/// member read here is already in hand there, and the other way round. A row
/// opens the receipt.
function MemberTransactions({
  memberId,
  total,
  onOpen,
}: {
  memberId: string
  /// Completed purchases, from the member's row.
  total: number
  onOpen: (saleId: string) => void
}) {
  const history = useInfiniteQuery({
    queryKey: storeopsKeys.customerHistory(memberId),
    queryFn: ({ pageParam, signal }) =>
      customerTransactions(
        memberId,
        {
          limit: 25,
          beforeOccurredAt: pageParam?.at,
          beforeSaleId: pageParam?.id,
        },
        signal
      ),
    initialPageParam: undefined as { at: string; id: string } | undefined,
    getNextPageParam: (last) =>
      last.next_before_occurred_at !== null && last.next_before_sale_id !== null
        ? { at: last.next_before_occurred_at, id: last.next_before_sale_id }
        : undefined,
  })
  const sales = useMemo<CustomerTransaction[]>(
    () => history.data?.pages.flatMap((page) => page.transactions) ?? [],
    [history.data]
  )

  return (
    <SheetSection
      title="Transactions"
      aside={total === 0 ? undefined : count(total)}
    >
      <SheetQuery query={history} what="transactions">
        {() =>
          sales.length === 0 ? (
            <SheetEmpty>No purchases yet</SheetEmpty>
          ) : (
            <>
              <MiniTable
                head={[
                  "Date",
                  { label: "Store", align: "left" },
                  { label: "Receipt", align: "left" },
                  "Total",
                  "Points",
                ]}
              >
                {sales.map((sale) => (
                  <MiniRow key={sale.sale_id}>
                    <MiniCell>
                      <button
                        type="button"
                        onClick={() => onOpen(sale.sale_id)}
                        className="record-link text-left tabular-nums"
                      >
                        {day(sale.occurred_at)}
                      </button>
                      {sale.status === "VOIDED" && (
                        <span className="block text-mute">Voided</span>
                      )}
                    </MiniCell>
                    <MiniCell>{sale.site_name ?? sale.site_id}</MiniCell>
                    <MiniCell className="tabular-nums">
                      {sale.receipt_no ?? <span className="text-mute">—</span>}
                    </MiniCell>
                    <MiniCell align="right" className="font-medium text-ink">
                      {money(sale.total_minor)}
                    </MiniCell>
                    <MiniCell align="right">
                      {sale.points_earned === 0 ? (
                        <span className="text-mute">—</span>
                      ) : (
                        count(sale.points_earned)
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
              {history.hasNextPage && (
                <div>
                  <Button
                    variant="ghost"
                    pending={history.isFetchingNextPage}
                    onClick={() => void history.fetchNextPage()}
                  >
                    Show more
                  </Button>
                </div>
              )}
            </>
          )
        }
      </SheetQuery>
    </SheetSection>
  )
}

/// Each status in its own word and tone. A request that ran out or was called
/// off is neutral: nothing is owed on it and nothing needs doing.
const REDEMPTION_STATUS: Readonly<
  Record<
    RedeemRequestStatus,
    { readonly label: string; readonly tone: "ok" | "warn" | "neutral" }
  >
> = {
  PENDING: { label: "Pending", tone: "warn" },
  CONFIRMED: { label: "Confirmed", tone: "ok" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
}

/// What they asked to turn into vouchers, newest first, and what became of
/// each: where it was asked, by whom, and — for a confirmed one — how it was
/// approved. Never the code itself; the server does not send it.
function MemberRedemptions({ memberId }: { memberId: string }) {
  const requests = useQuery(memberRedemptionsQuery(memberId))
  const nameOf = useNameOfLogin()

  return (
    <SheetSection
      title="Redemptions"
      aside={
        requests.data === undefined || requests.data.length === 0
          ? undefined
          : count(requests.data.length)
      }
    >
      <SheetQuery query={requests} what="redemptions">
        {(list: RedeemRequest[]) =>
          list.length === 0 ? (
            <SheetEmpty>No redemptions yet</SheetEmpty>
          ) : (
            <MiniTable
              head={[
                "Date",
                { label: "Store", align: "left" },
                "Points",
                "Value",
                { label: "Status", align: "left" },
              ]}
            >
              {list.map((request) => {
                const status = REDEMPTION_STATUS[request.status]
                return (
                  <MiniRow key={request.request_id}>
                    <MiniCell className="tabular-nums">
                      {day(request.requested_at)}
                    </MiniCell>
                    <MiniCell>
                      {request.store_name ?? (
                        <span className="text-mute">—</span>
                      )}
                      {request.asked_by !== null && (
                        <span className="block text-mute">
                          Asked by {nameOf(request.asked_by)}
                        </span>
                      )}
                    </MiniCell>
                    <MiniCell align="right">{count(request.points)}</MiniCell>
                    <MiniCell align="right" className="font-medium text-ink">
                      {money(request.value_minor)}
                    </MiniCell>
                    <MiniCell>
                      <Pill tone={status.tone}>{status.label}</Pill>
                      {request.status === "CONFIRMED" && (
                        <span className="mt-1 block text-mute">
                          {request.approved_in_app
                            ? "Via the app"
                            : "Via WhatsApp code"}
                        </span>
                      )}
                    </MiniCell>
                  </MiniRow>
                )
              })}
            </MiniTable>
          )
        }
      </SheetQuery>
    </SheetSection>
  )
}

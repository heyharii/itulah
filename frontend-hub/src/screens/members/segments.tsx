import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ConfirmButton } from "@/components/ui/dialog"
import { Fab } from "@/components/ui/fab"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { CardFigure, CardFoot } from "@/components/ui/phone-cards"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  describeSegment,
  memberSegmentsQuery,
  retireSegment,
  savedSegmentKeys,
  savedSegmentsQuery,
  type SavedSegment,
  type SegmentBook,
  type SegmentRow,
} from "@/lib/queries/members"
import { useCatalogue } from "@/lib/queries/reports"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
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
/// # One table, both kinds
///
/// Segments somebody wrote down — "lapsing, and has spent at least five
/// million" — sit in the SAME table as the six, on the owner's instruction
/// (2026-09-13). They used to have their own section and their own paragraph
/// explaining that the six add up to the directory and these do not.
///
/// That distinction is real and it is still true; what was wrong was making a
/// reader learn it before they could read a row. A written segment is told
/// apart by having Edit and Retire in its sheet, which is the difference that
/// matters to somebody using the screen — and nothing here invites the six to
/// be added up in the first place, because each row carries a share of the
/// directory rather than a slice of a pie the page draws.
///
/// A row opens the segment as a sheet (what it means, what its members spent,
/// and the way into the directory narrowed to it). What is stored for a
/// written segment is still only its conditions. Who is in it is worked out on
/// every read, by the same query the directory uses — so the rule at the top
/// of this file holds for every row in the table.

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
  // On a phone New segment is the round plus in the drawer over the bottom bar,
  // not a button at the top.
  const phone = useLayout() === "phone"
  /// Which segment is being written, in the URL like every other sheet in this
  /// app. `new` is the sentinel for one that does not exist yet — a half-
  /// written segment is not a record, so there is no id to name it by, and a
  /// flag beside the id would be two keys that can disagree.
  const editing = useSheet("segmentEdit")

  return (
    <PageContent>
      <PageHeader
        crumb="Members"
        title="Segments"
        sub="The directory grouped by how long since somebody last came in, worked out on every read."
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => editing.open("new")}>
              New segment
            </Button>
          )
        }
      />

      <Fab label="New segment" onClick={() => editing.open("new")} />

      <Suspense fallback={<LoadingState>Counting the directory…</LoadingState>}>
        <SegmentsOverview />
      </Suspense>
    </PageContent>
  )
}

/// The six segments and the ones somebody wrote, with the form that writes
/// them. Read together: the table draws both.
function SegmentsOverview() {
  const editing = useSheet("segmentEdit")
  const writing = editing.value === "new"
  const { data } = useSuspenseQuery(memberSegmentsQuery())
  const { data: saved } = useSuspenseQuery(savedSegmentsQuery())
  const edited = saved.find((one) => one.segment_id === editing.value)

  return (
    <>
      {data.member_count === 0 && data.unenrolled_count === 0 ? (
        <Card className="overflow-hidden">
          <EmptyState>
            Nobody has been enrolled and no sale has named a customer, so there
            is nothing to group. A segment is a reading of the directory — it
            cannot exist before the directory does.
          </EmptyState>
        </Card>
      ) : (
        <Book book={data} saved={saved} onEdit={(id) => editing.open(id)} />
      )}

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
    </>
  )
}

/// One row of the table: a segment of the six, or one somebody wrote — told
/// apart only by `saved`.
interface Line {
  readonly id: string
  readonly name: string
  readonly tone: ReturnType<typeof tone>
  /// What it means, in words: the server's sentence for the six, the
  /// conditions for a written one.
  readonly meaning: string
  readonly purpose: string | null
  readonly members: number | null
  /// Of the whole directory, 0–1.
  readonly share: number | null
  readonly spent: number | null
  /// Receipts: only the six carry them.
  readonly sales: number | null
  readonly average: number | null
  readonly last: string | null
  /// The directory, narrowed to it.
  readonly list: {
    readonly key: "segment" | "segmentId"
    readonly value: string
  }
  readonly saved: SavedSegment | null
}

const lineId = (line: Line) => line.id

const percent = (share: number | null) =>
  share === null ? "—" : `${Math.round(share * 100)}%`

const columns: ColumnDef<TableSetup, Line>[] = [
  {
    id: "segment",
    accessorFn: (row) => row.name,
    header: "Segment",
    size: 220,
    enableSorting: false,
    meta: { card: "hide" },
    // `neutral` for a written one. The six are tinted by what they say about
    // the people in them; a written segment says whatever its author meant,
    // and a colour would be this screen inventing an opinion.
    cell: ({ row }) => (
      <Pill tone={row.original.tone}>{row.original.name}</Pill>
    ),
  },
  {
    id: "members",
    accessorFn: (row) => row.members,
    header: "Members",
    size: 110,
    enableSorting: false,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) =>
      row.original.members === null ? "—" : count(row.original.members),
  },
  {
    id: "share",
    accessorFn: (row) => row.share,
    header: "% of Members",
    size: 130,
    enableSorting: false,
    meta: { align: "right", card: "hide", priority: 3 },
    cell: ({ row }) => percent(row.original.share),
  },
  {
    id: "spent",
    accessorFn: (row) => row.spent,
    header: "Spent",
    size: 160,
    enableSorting: false,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) =>
      row.original.spent === null ? "—" : money(row.original.spent),
  },
  {
    id: "sales",
    accessorFn: (row) => row.sales,
    header: "Sales",
    size: 100,
    enableSorting: false,
    meta: { align: "right", card: "hide", priority: 3 },
    cell: ({ row }) =>
      row.original.sales === null ? "—" : count(row.original.sales),
  },
  {
    // Per member, not per sale — the figure that says whether a segment is
    // worth a campaign at all. A thousand lapsed members averaging nothing
    // are not worth a message; two hundred averaging a million are.
    id: "average",
    accessorFn: (row) => row.average,
    header: "Average Each",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "hide", priority: 2 },
    cell: ({ row }) =>
      row.original.average === null ? "—" : money(row.original.average),
  },
  {
    id: "last",
    accessorFn: (row) => row.last,
    header: "Last Purchase",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "hide", priority: 2 },
    cell: ({ row }) => day(row.original.last),
  },
  // Three columns that exist only on a card (`cardLead`; a phone): the
  // segment, its members as the figure, and what is under it.
  {
    id: "head",
    accessorFn: (row) => row.name,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <Pill tone={row.original.tone}>{row.original.name}</Pill>
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.members,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <CardFigure
        value={
          row.original.members === null ? "—" : count(row.original.members)
        }
        caption={row.original.members === 1 ? "member" : "members"}
        tone={row.original.members === 0 ? "quiet" : undefined}
      />
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.spent,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <CardFoot>
        {percent(row.original.share)} of members
        {row.original.spent === null
          ? ""
          : ` · Spent ${money(row.original.spent)}`}
        <br />
        Last purchase {day(row.original.last)}
      </CardFoot>
    ),
  },
]

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
  const phone = useLayout() === "phone"
  const catalogue = useCatalogue()
  const dimensions = useMemo(
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
  /// The segment whose sheet is open.
  const [opened, setOpened] = useState<string | null>(null)

  /// The three that mean somebody is still a customer, against the three that
  /// mean they are not. Computed here rather than asked of the server because
  /// it is a reading of the same six numbers, and a screen that asked for a
  /// seventh figure could show one that disagreed with the six below it.
  const reachable = book.segments
    .filter((row) => row.key === "NEW" || row.key === "ACTIVE")
    .reduce((total, row) => total + row.members, 0)
  const spent = book.segments.reduce((total, row) => total + row.spent_minor, 0)

  /// The six first because they are the whole directory and a written segment
  /// is a question asked of it.
  const lines = useMemo<Line[]>(
    () => [
      ...book.segments.map((row) => {
        const described = describeSegment(row.key, {
          active_days: book.active_days,
          lapsing_days: book.lapsing_days,
        })
        return {
          id: row.key,
          name: described.label,
          tone: tone(row.key),
          meaning: described.meaning,
          purpose: null,
          members: row.members,
          share: book.member_count === 0 ? null : share(row, book),
          spent: row.spent_minor,
          sales: row.transaction_count,
          average: row.average_spend_minor,
          last: row.last_purchase_at,
          list: { key: "segment" as const, value: row.key },
          saved: null,
        }
      }),
      ...saved.map((one) => {
        const tally = one.tally
        return {
          id: one.segment_id,
          name: one.name,
          tone: "neutral" as const,
          meaning: describeDefinition(one.definition, dimensions),
          purpose: one.purpose,
          members: tally?.members ?? null,
          share:
            tally === undefined || tally.member_count === 0
              ? null
              : tally.members / tally.member_count,
          spent: tally?.spent_minor ?? null,
          sales: null,
          average: tally?.average_spend_minor ?? null,
          last: tally?.last_purchase_at ?? null,
          list: { key: "segmentId" as const, value: one.segment_id },
          saved: one,
        }
      }),
    ],
    [book, saved, dimensions]
  )
  const line = lines.find((one) => one.id === opened) ?? null

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: lines,
        columns,
        getRowId: lineId,
        // The order is fixed (see `share` above), not something to re-sort.
        manualSorting: true,
        // The card's own columns are drawn on a phone and never on a desk.
        state: { columnVisibility: { head: phone, lead: phone, foot: phone } },
      }),
      [lines, phone]
    )
  )

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

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <DataTable<Line>
          table={table}
          onRowClick={(row) => setOpened(row.id)}
          isSelected={(row) => row.id === opened}
          cardSort={false}
          cardsApart
          cardLead
        />
      </Card>

      <Sheet
        open={line !== null}
        onOpenChange={(next) => !next && setOpened(null)}
        title={line?.name ?? ""}
        caption={
          line === null
            ? undefined
            : `${line.members === null ? "—" : count(line.members)} ${line.members === 1 ? "member" : "members"}${line.saved === null ? "" : ` · v${line.saved.version}`}`
        }
        size="rail"
        stack
        footer={
          line === null ? undefined : (
            <SheetFooter
              danger={
                line.saved?.editable === true ? (
                  <ConfirmButton
                    label={
                      retire.isPending && retire.variables === line.id
                        ? "Retiring…"
                        : "Retire segment"
                    }
                    title={`Retire ${line.name}?`}
                    description="It is removed from this screen, and there is no button to bring it back. Its members are not touched."
                    confirmLabel="Retire"
                    tone="danger"
                    variant="danger"
                    pending={retire.isPending && retire.variables === line.id}
                    onConfirm={() => {
                      retire.mutate(line.id)
                      setOpened(null)
                    }}
                  />
                ) : undefined
              }
              secondary={
                line.saved?.editable === true ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setOpened(null)
                      onEdit(line.id)
                    }}
                  >
                    Edit
                  </Button>
                ) : undefined
              }
              primary={
                line.members !== null && line.members > 0 ? (
                  <AppLink to="/members" sheet={line.list} variant="primary">
                    Open the list
                  </AppLink>
                ) : undefined
              }
            />
          )
        }
      >
        {line !== null && (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-[0.9375rem] leading-relaxed text-body">
                {line.meaning}
              </p>
              {line.purpose !== null && line.purpose !== "" && (
                <p className="text-[0.9375rem] leading-relaxed text-mute">
                  {line.purpose}
                </p>
              )}
            </div>
            <Facts>
              <Fact term="Members">
                {line.members === null ? "—" : count(line.members)}
              </Fact>
              <Fact term="% of members">{percent(line.share)}</Fact>
              <Fact term="Spent">
                {line.spent === null ? "—" : money(line.spent)}
              </Fact>
              {line.sales !== null && (
                <Fact term="Sales">{count(line.sales)}</Fact>
              )}
              <Fact term="Average each">
                {line.average === null ? "—" : money(line.average)}
              </Fact>
              <Fact term="Last purchase">{day(line.last)}</Fact>
            </Facts>
          </>
        )}
      </Sheet>
    </>
  )
}

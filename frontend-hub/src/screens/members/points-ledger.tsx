import { useSuspenseInfiniteQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Tag } from "@/components/ui/tag"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  describeEntryType,
  pointsLedgerQuery,
  type PointsEntry,
} from "@/lib/queries/points"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { CardFigure, CardFoot, CardName } from "@/components/ui/phone-cards"

/// Points Ledger — every movement, newest first.
///
/// ## This is the record; Points is the summary of it
///
/// `points_account.balance_points` is a cache. These entries are what it is a
/// cache OF, and the database refuses an entry of zero — a row that moves
/// nothing explains nothing. So every line here is a real change with a cause
/// attached, and the balance next door is derivable from this list and never
/// the other way round.
///
/// ## Signed, always
///
/// An award and a reversal are drawn with their sign and their colour, not as
/// two columns and not as absolute values with a type beside them. A column of
/// positives where some of them mean the opposite is the shape that makes a
/// balance impossible to check by eye — the same rule the voucher ledger
/// follows, for the same reason.
/// Which record caused the entry. Exactly one is set, enforced by three partial
/// unique indexes — which is also what stops one sale awarding points twice.
function causeOf(entry: PointsEntry): { what: string; id: string } | null {
  if (entry.sale_id !== null) return { what: "Sale", id: entry.sale_id }
  if (entry.return_id !== null) return { what: "Return", id: entry.return_id }
  if (entry.redemption_id !== null)
    return { what: "Redemption", id: entry.redemption_id }
  return null
}

const columns: ColumnDef<TableSetup, PointsEntry>[] = [
  {
    id: "when",
    accessorFn: (row) => row.created_at,
    header: "When",
    size: 170,
    enableSorting: false,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="text-[0.9375rem] text-body">
        {moment(row.original.created_at)}
      </span>
    ),
  },
  {
    id: "member",
    accessorFn: (row) => row.display_name ?? row.customer_id,
    header: "Member",
    size: 200,
    enableSorting: false,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="block truncate text-ink">
        {row.original.display_name ?? row.original.customer_id}
      </span>
    ),
  },
  {
    id: "what",
    accessorFn: (row) => describeEntryType(row.entry_type),
    header: "What",
    size: 220,
    enableSorting: false,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <>
        <span className="text-body">
          {describeEntryType(row.original.entry_type)}
        </span>
        {row.original.reason !== null && (
          <span className="block truncate text-[0.9375rem] text-mute">
            {row.original.reason}
          </span>
        )}
      </>
    ),
  },
  {
    id: "points",
    accessorFn: (row) => row.points,
    header: "Points",
    size: 110,
    enableSorting: false,
    meta: { align: "right", card: "hide" },
    // Signed and coloured, so the column reads as arithmetic rather than as a
    // list of magnitudes.
    cell: ({ row }) => (
      <span
        className={
          row.original.points < 0
            ? "text-bad tabular-nums"
            : "text-ok tabular-nums"
        }
      >
        {row.original.points < 0 ? "−" : "+"}
        {count(Math.abs(row.original.points))}
      </span>
    ),
  },
  {
    id: "cause",
    accessorFn: (row) => causeOf(row)?.what ?? "",
    header: "Caused by",
    size: 160,
    enableSorting: false,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => {
      const cause = causeOf(row.original)
      return cause === null ? (
        // An adjustment names no record, and that is exactly when the actor
        // matters: somebody did this by hand.
        <span className="text-[0.9375rem] text-mute">
          by {row.original.actor}
        </span>
      ) : (
        <span className="flex flex-col items-end leading-tight">
          <Pill tone="neutral">{cause.what}</Pill>
          <span className="font-mono text-[0.9375rem] text-mute">
            {cause.id.slice(0, 8)}
          </span>
        </span>
      )
    },
  },
  // Four columns that exist only on a card (`cardLead`; a phone): who and what
  // it was, the signed points as the figure, when, and what caused it.
  {
    id: "head",
    accessorFn: (row) => row.display_name ?? row.customer_id,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <CardName
        name={row.original.display_name ?? row.original.customer_id}
        line={
          <>
            {describeEntryType(row.original.entry_type)}
            {row.original.reason !== null && ` · ${row.original.reason}`}
          </>
        }
      />
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.points,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <CardFigure
        value={`${row.original.points < 0 ? "−" : "+"}${count(Math.abs(row.original.points))}`}
        caption="points"
        tone={row.original.points < 0 ? "bad" : undefined}
      />
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.created_at,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <CardFoot>
        {moment(row.original.created_at)}
        {causeOf(row.original) === null ? ` · by ${row.original.actor}` : ""}
      </CardFoot>
    ),
  },
  {
    id: "tag",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) => {
      const cause = causeOf(row.original)
      return cause === null ? null : <Pill tone="neutral">{cause.what}</Pill>
    },
  },
]

export function PointsLedger() {
  // A phone draws a card per movement, with the signed points as the figure.
  const phone = useLayout() === "phone"
  const customer = useSheet("customer")

  return (
    <PageContent>
      <PageHeader
        crumb="Members"
        title="Points Ledger"
        sub="Every points movement and what caused it. The balances on Points are a summary of this list, never the other way round."
        actions={
          customer.value === undefined || phone ? undefined : (
            <button
              type="button"
              onClick={customer.close}
              className="text-[0.9375rem] text-mute underline underline-offset-2 hover:text-ink"
            >
              Show every member
            </button>
          )
        }
      />

      {customer.value !== undefined && (
        <p className="mb-4 flex items-center gap-2 text-meta text-mute">
          Narrowed to <Tag>{customer.value}</Tag>
          <AppLink to="/members/points" className="text-accent">
            Back to balances
          </AppLink>
          {phone && (
            <button
              type="button"
              onClick={customer.close}
              className="text-accent underline underline-offset-2"
            >
              Show every member
            </button>
          )}
        </p>
      )}

      <Suspense
        fallback={<LoadingState>Reading the points ledger…</LoadingState>}
      >
        <LedgerBook customer={customer.value ?? null} />
      </Suspense>
    </PageContent>
  )
}

/// The movements, newest first. One member's when `customer` is named.
function LedgerBook({ customer }: { customer: string | null }) {
  // A phone draws a card per movement, with the signed points as the figure.
  const phone = useLayout() === "phone"

  /// Newest first, a page at a time as the foot of the list comes into view.
  const list = useSuspenseInfiniteQuery(pointsLedgerQuery(customer))

  const entries = useMemo(
    () => list.data.pages.flatMap((page) => page.items),
    [list.data]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: entries,
        columns,
        getRowId: (row: PointsEntry) => row.entry_id,
        // Newest first, as the server's cursor is built on it.
        manualSorting: true,
        // The card's own columns are drawn on a phone and never on a desk.
        state: {
          columnVisibility: {
            head: phone,
            lead: phone,
            foot: phone,
            tag: phone,
          },
        },
      }),
      [entries, phone]
    )
  )

  return (
    <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
      {entries.length === 0 ? (
        <EmptyState>
          {customer === null
            ? "No points have ever moved. The ledger exists and is empty — which is not the same as loyalty being switched off, and is what you would expect before the first sale awards any."
            : "This member has no entries. Their balance, if they have one, came from nowhere — which is a fault worth reporting rather than an empty page."}
        </EmptyState>
      ) : (
        <DataTable<PointsEntry>
          refresh={[list]}
          table={table}
          more={list}
          cardSort={false}
          cardsApart
          cardLead
        />
      )}
    </Card>
  )
}

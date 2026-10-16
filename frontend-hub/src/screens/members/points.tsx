import { useSuspenseInfiniteQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { pointsAccountsQuery, type PointsAccount } from "@/lib/queries/points"
import { tableSetup, type TableSetup } from "@/lib/table"
import { CardFigure, CardFoot, CardName } from "@/components/ui/phone-cards"

/// Points — what the business owes its members.
///
/// ## The two figures, side by side, on purpose
///
/// **Balance** is the cached account row, which is the number a till reads.
/// **From entries** is what the ledger actually adds up to. They are drawn
/// together and a row where they disagree is marked, because a screen showing
/// only the cache would be the last place anybody found out the two had drifted
/// — and one showing only the sum would hide that the number the counter is
/// using is wrong.
///
/// Nothing here repairs the difference. A GET that quietly corrected a balance
/// would destroy the evidence of whatever wrote it.
///
/// ## Why this screen cannot spend anything
///
/// There is no action on it, and that is the locked V1 rule rather than an
/// omission: points leave an account in exactly one way, by becoming a voucher,
/// and that happens at the counter. So this is a register, and the thing that
/// moves it lives on the Ledger next door.
const columns: ColumnDef<TableSetup, PointsAccount>[] = [
  {
    id: "member",
    accessorFn: (row) => `${row.customer_id} ${row.display_name ?? ""}`,
    header: "Member",
    size: 260,
    enableSorting: false,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <>
        <span className="block truncate text-ink">
          {row.original.display_name ?? row.original.customer_id}
        </span>
        <span className="block font-mono text-[0.9375rem] text-mute">
          {row.original.customer_id}
        </span>
      </>
    ),
  },
  {
    id: "balance",
    accessorFn: (row) => row.balance_points,
    header: "Balance",
    size: 130,
    enableSorting: false,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        {count(row.original.balance_points)}
      </span>
    ),
  },
  {
    id: "ledger",
    accessorFn: (row) => row.ledger_sum,
    header: "From Entries",
    size: 190,
    enableSorting: false,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) =>
      row.original.reconciles ? (
        <span className="text-mute tabular-nums">
          {count(row.original.ledger_sum)}
        </span>
      ) : (
        <span className="flex items-center justify-end gap-1.5">
          <span className="text-bad tabular-nums">
            {count(row.original.ledger_sum)}
          </span>
          <Pill tone="bad">does not match</Pill>
        </span>
      ),
  },
  {
    id: "entries",
    accessorFn: (row) => row.entries,
    header: "Entries",
    size: 110,
    enableSorting: false,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => (
      <span className="tabular-nums">{count(row.original.entries)}</span>
    ),
  },
  {
    id: "moved",
    accessorFn: (row) => row.last_movement ?? "",
    header: "Last Movement",
    size: 170,
    enableSorting: false,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => (
      <span className="text-[0.9375rem] text-mute">
        {row.original.last_movement === null
          ? "never"
          : moment(row.original.last_movement)}
      </span>
    ),
  },
  // Four columns that exist only on a card (`cardLead`; a phone): who, the
  // balance as the figure, what the entries say, and a flag where the two
  // disagree.
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
        code={
          row.original.display_name === null
            ? undefined
            : row.original.customer_id
        }
      />
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.balance_points,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <CardFigure
        value={count(row.original.balance_points)}
        caption="points"
        tone={row.original.balance_points === 0 ? "quiet" : undefined}
      />
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.entries,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <CardFoot>
        {count(row.original.entries)}{" "}
        {row.original.entries === 1 ? "entry" : "entries"}
        {row.original.reconciles
          ? ""
          : ` · ${count(row.original.ledger_sum)} from entries`}
        <br />
        Last movement{" "}
        {row.original.last_movement === null
          ? "never"
          : moment(row.original.last_movement)}
      </CardFoot>
    ),
  },
  {
    id: "tag",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) =>
      row.original.reconciles ? null : <Pill tone="bad">does not match</Pill>,
  },
]

export function Points() {
  return (
    <PageContent>
      <PageHeader
        crumb="Members"
        title="Points"
        sub="What each member holds. A point is money the business owes a shopper, so this is a liability register — not a discount."
      />

      <Suspense
        fallback={<LoadingState>Reading the points accounts…</LoadingState>}
      >
        <PointsBook />
      </Suspense>
    </PageContent>
  )
}

/// The figures and the accounts, read together: the figures are the server's
/// counts over the whole book, which ride on every page.
function PointsBook() {
  // A phone draws the accounts as cards, with the balance as the figure.
  const phone = useLayout() === "phone"
  const navigate = useNavigate()
  /// The account book a page at a time, largest balance first, the next page
  /// asked for as the foot of the list comes into view.
  const list = useSuspenseInfiniteQuery(pointsAccountsQuery())

  const accounts = useMemo(
    () => list.data.pages.flatMap((page) => page.items),
    [list.data]
  )
  /// The book-wide figures ride on every page; the first one is enough.
  const head = list.data.pages[0]
  const drifted = head?.accounts_not_reconciling ?? 0

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: accounts,
        columns,
        getRowId: (row: PointsAccount) => row.customer_id,
        // The book arrives largest balance first; sorting the pages in hand
        // would call a screenful the book.
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
      [accounts, phone]
    )
  )

  return (
    <>
      <KpiStrip>
        {/* All three are the server's counts over the whole book, not sums
            of the rows loaded so far — they are true before the list below
            has been scrolled to its end. */}
        <Kpi label="Accounts" value={count(head?.account_count ?? 0)} />
        <Kpi
          label="Points outstanding"
          value={count(head?.outstanding_points ?? 0)}
        />
        <Kpi
          label="Not reconciling"
          value={count(drifted)}
          tone={drifted > 0 ? "down" : "flat"}
        />
      </KpiStrip>

      {drifted > 0 && (
        <Banner tone="warn" className="mb-4">
          {count(drifted)} account{drifted === 1 ? " has" : "s have"} a cached
          balance that does not match their own entries. The entries are the
          record and the cache is what a till reads, so those members are being
          quoted a figure the ledger does not support. Nothing here repairs it —
          a fault this shape has a cause, and correcting the number would hide
          it.
        </Banner>
      )}

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {accounts.length === 0 ? (
          <EmptyState>
            No member holds any points. The account and ledger tables exist and
            are empty — nothing has been earned, which is not the same as
            loyalty being switched off.
          </EmptyState>
        ) : (
          <DataTable<PointsAccount>
            refresh={[list]}
            table={table}
            // Straight into that member's own entries. No dead ends: the
            // balance and the movements behind it are one click apart in
            // both directions.
            onRowClick={(row) =>
              void navigate({
                to: "/members/points-ledger",
                search: { customer: row.customer_id },
              } as never)
            }
            more={list}
            cardSort={false}
            cardsApart
            cardLead
          />
        )}
      </Card>
    </>
  )
}

import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { BarSeries, type ChartSeries } from "@/components/ui/chart"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Money, Textarea } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
  TotalsLadder,
} from "@/components/ui/rows"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  NoAccessState,
  NoMatch,
  Problem,
  Truncated,
} from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count, day, label, money, toneFor } from "@/lib/format"
import {
  billDetail,
  financeKeys,
  listBills,
  listPayments,
  payablesAging,
  postBill,
  recordBill,
  unbilledReceipts,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  EXPENSE_LINE_CLASSES,
  parseMinor,
  todayIso,
} from "@/screens/finance/chart"
import { useAsOf, useSupplierName } from "@/screens/finance/hooks"
import {
  AccountPicker,
  AsOfControl,
  LocationSelect,
  SiteName,
  SupplierName,
  SupplierPicker,
} from "@/screens/finance/parts"
import { ApiError } from "@itulah/contract/client"
import type {
  PayablesAgingRow,
  RecordBillLine,
  SupplierBill,
  UnbilledReceipt,
} from "@itulah/contract"

/// What is late, and what has arrived that nobody has been billed for.
///
/// # Why recording and posting are two acts
///
/// A bill arrives, gets queried, gets held. Only when somebody decides it may
/// be paid does it go into the books. Collapsing the two would mean the act of
/// writing an invoice down were also the act of accepting it.
///
/// # Why the second list is on this screen
///
/// The client keeps no goods-received-not-invoiced account, so a delivery with
/// no bill against it is sitting in the warehouse and nowhere in the books at
/// all. At month end inventory *and* payables both understate by it. It is not
/// a balance and it is not posted anywhere — this list is the only place that
/// exposure is ever seen, which is why it lives beside the bills rather than
/// on a screen of its own that nobody would open.

/// `days_overdue` is negative until the due date passes, and is derived on
/// every read — a stored age would be wrong by morning.
function isLate(bill: SupplierBill): boolean {
  return bill.status.toUpperCase() !== "POSTED" && bill.days_overdue > 0
}

/// How old the money is, in the buckets an accountant already thinks in.
///
/// # Why this is the server's report and no longer the browser's
///
/// The five bars used to be `listBills({})` bucketed here on `days_overdue`,
/// and they were wrong in two ways that looked right. They aged the *whole
/// invoice* rather than what is still outstanding on it, so a bill nine
/// tenths paid stood as tall as one nobody had touched. And they could only
/// ever report today: an ageing asked "as at the end of last month" has to
/// un-count every payment made since, which needs a query over both sides and
/// cannot be done from a list of bills alone.
///
/// `GET /payables-aging` answers both, and it answers them the same way the
/// books do — the total agrees with `trade_payable` because both move only
/// when a bill or a payment posts.
///
/// # Why it lives here and not in Reports
///
/// It is the list somebody works *from* when deciding who to pay this week,
/// not a statement of the books. It is filed with the workflow that produces
/// it, one screen away from the payment it leads to.
const AGE_SERIES: readonly ChartSeries[] = [
  { key: "total", label: "Outstanding", tone: "accent" },
]

/// The five buckets, in the order they are read, and where each one lives on
/// the wire. Declared once so the bars, the table's columns and its cells
/// cannot drift apart.
const AGE_BUCKETS: readonly {
  readonly key: keyof AgingBucketFigures
  readonly label: string
  readonly title: string
}[] = [
  { key: "not_due_minor", label: "Not due", title: "Not due yet" },
  { key: "days_1_30_minor", label: "1–30", title: "1–30 days late" },
  { key: "days_31_60_minor", label: "31–60", title: "31–60 days late" },
  { key: "days_61_90_minor", label: "61–90", title: "61–90 days late" },
  { key: "days_over_90_minor", label: "90+", title: "More than 90 days late" },
]

/// The bucket fields alone, so the table above can be indexed with a key the
/// compiler has checked rather than with a string.
type AgingBucketFigures = Omit<PayablesAgingRow["buckets"], "total_minor">

/// How many suppliers the ageing card shows before it asks.
///
/// Five, because the point of the card is "who to pay this week" and nobody
/// pays the fourteenth-heaviest supplier this week. The rest are one press
/// away.
const SUPPLIERS_SHOWN = 5

/// How late a supplier's oldest open bill is.
///
/// Negative until the due date passes, exactly as `days_overdue` is on a bill
/// — so "in 11 days" and "29 days late" are two readings of one number, and
/// neither is drawn as the other.
function OldestDays({ days }: { days: number }) {
  if (days <= 0) {
    return (
      <span className="text-mute tabular-nums">
        {days === 0 ? "due today" : `in ${-days}d`}
      </span>
    )
  }
  return (
    <span className="font-medium text-bad-fg tabular-nums">{count(days)}d</span>
  )
}

const billColumns: ColumnDef<TableSetup, SupplierBill>[] = [
  {
    accessorKey: "invoice_number",
    header: "Invoice",
    size: 150,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.invoice_number}
      </span>
    ),
  },
  {
    id: "supplier",
    accessorFn: (row) => row.supplier_name ?? row.supplier_id,
    header: "Supplier",
    size: 240,
    // The narrowing payables is actually read with — "everything we owe PT
    // Maju" — and a closed set, so it is picked from a counted list rather
    // than typed. The accessor already prefers the name over the id, which is
    // what keeps uuids out of the picker.
    meta: { filter: { kind: "option" } },
    // The id stays in `title`, the way a site id does: it is what a support
    // conversation and every cross-screen link will be about. `<SupplierName>`
    // and not the raw field, so a bill recorded before the name was carried
    // resolves out of the supplier list instead of drawing its uuid.
    cell: ({ row }) => (
      <SupplierName
        id={row.original.supplier_id}
        name={row.original.supplier_name}
        className="block truncate font-medium text-ink"
      />
    ),
  },
  {
    accessorKey: "site_id",
    header: "Location",
    size: 130,
    // The client's own name for it. The id stays in `title`, because that is
    // what the account codes carry and what a support call will be about.
    cell: ({ row }) => <SiteName id={row.original.site_id} />,
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 130,
    meta: { filter: { kind: "option", format: label } },
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.status)}>
        {label(row.original.status)}
      </Pill>
    ),
  },
  {
    accessorKey: "due_date",
    header: "Due",
    size: 120,
    // "Due before the end of the month" is how a payment run is planned, and
    // the as-of box above answers a different question — it dates the ageing
    // report, not the list.
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.due_date),
  },
  {
    accessorKey: "total_minor",
    header: "Total",
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="text-body tabular-nums">
        {money(row.original.total_minor)}
      </span>
    ),
  },
  {
    accessorKey: "paid_minor",
    header: "Paid",
    size: 140,
    meta: { align: "right" },
    // What has actually left the bank against this bill — POSTED payments
    // only, summed on read. A bill nobody has paid draws a dash rather than
    // "Rp 0" fourteen rows in a row.
    cell: ({ row }) =>
      row.original.paid_minor === 0 ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="text-body tabular-nums">
          {money(row.original.paid_minor)}
        </span>
      ),
  },
  {
    accessorKey: "outstanding_minor",
    header: "Outstanding",
    size: 150,
    // The figure this screen is about, so the only money column offered:
    // Total and Paid are the two halves of it and a panel with all three is
    // one nobody reads.
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    // The figure this screen is about, so it is the one drawn in ink. A bill
    // with a draft payment against it shows the draft's reservation under the
    // number rather than in a tooltip — it is why the bill will not take
    // another allocation, and a bill that looks payable and is not reads as
    // broken.
    cell: ({ row }) => {
      const bill = row.original
      const reserved = bill.allocated_minor - bill.paid_minor
      return (
        <span className="inline-flex flex-col items-end">
          <span className="font-medium text-ink tabular-nums">
            {money(bill.outstanding_minor)}
          </span>
          {reserved > 0 && (
            <span className="text-[0.65625rem] text-warn-fg tabular-nums">
              {money(reserved)} in draft
            </span>
          )}
        </span>
      )
    },
  },
  {
    accessorKey: "days_overdue",
    header: "Overdue",
    size: 110,
    // The decision metric. Negative is "due in n days", so "is at least 1" is
    // late and "is at most 0" is not yet — which is why it is a number here
    // rather than a late/not-late pill.
    meta: { align: "right", filter: { kind: "number", unit: "days" } },
    // The decision metric, and the reason this list overrides the server's
    // order: the invoice date is when the bill was recorded, not the order it
    // has to be paid in.
    cell: ({ row }) => {
      const bill = row.original
      if (!isLate(bill)) {
        return (
          <span className="text-mute tabular-nums">
            {bill.days_overdue < 0 ? `in ${-bill.days_overdue}d` : "—"}
          </span>
        )
      }
      return (
        <span className="font-medium text-bad-fg tabular-nums">
          {count(bill.days_overdue)}d
        </span>
      )
    },
  },
]

/// One bill's own read, held under its own key.
///
/// `GET /bills` sends `lines: null` on every row on purpose — a hundred rows
/// drawing a hundred and one queries is how a list gets slow without anybody
/// being able to point at the reason — so what an expense bill was *for* is
/// only ever readable one bill at a time.
///
/// `enabled` is the whole cost control: this is called for expense rows and for
/// an open sheet, never for the merchandise list, and an expense bill is a
/// small minority of the book. `retry: false` because the two ways this fails
/// are a bill that is not there and a node that does not answer the per-bill
/// read, and asking either of them three times changes nothing.
function useBill(id: string | null, enabled = true) {
  return useQuery({
    queryKey: financeKeys.bill(id ?? ""),
    queryFn: ({ signal }) => billDetail(id!, signal),
    enabled: id !== null && enabled,
    retry: false,
    staleTime: 60_000,
  })
}

/// Whether a failure is "this node does not serve that read yet".
///
/// A 404 on the per-bill read is not an error to put in front of somebody: it
/// is a capability this deployment has not got, and the screen says so quietly
/// once rather than drawing a red banner per row. Anything else is a real
/// failure and is shown as one.
function isMissingRead(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

/// How many things an expense bill was for.
///
/// A component and not a column value, for the same reason `<SiteName>` is one:
/// the figure needs a read, a cell is a React element, and this keeps the
/// column definitions module-level constants. A dash while it is loading and a
/// dash when the node cannot answer — the count is a convenience, and a table
/// that refuses to draw because one column could not be filled is worse than
/// one that admits the gap.
function LineCount({ id }: { id: string }) {
  const bill = useBill(id)
  const lines = bill.data?.lines
  if (lines === undefined || lines === null) {
    return <span className="text-faint">—</span>
  }
  return <span className="text-body tabular-nums">{count(lines.length)}</span>
}

/// The expense list: the same columns as merchandise, plus what the bill was
/// for. Spliced in before Status rather than appended, so the two figures a
/// reader compares — what it was for, and what it came to — are not at opposite
/// ends of a wide row.
const expenseColumns: ColumnDef<TableSetup, SupplierBill>[] = [
  ...billColumns.slice(0, 3),
  {
    id: "lines",
    header: "Lines",
    size: 80,
    meta: { align: "right" },
    cell: ({ row }) => <LineCount id={row.original.invoice_id} />,
  },
  ...billColumns.slice(3),
]

const unbilledColumns: ColumnDef<TableSetup, UnbilledReceipt>[] = [
  {
    accessorKey: "receipt_number",
    header: "Receipt",
    size: 160,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.receipt_number}
      </span>
    ),
  },
  {
    accessorKey: "supplier_id",
    header: "Supplier",
    size: 220,
    // A delivery carries no supplier name on the wire, only the id — and a
    // uuid in a column headed "Supplier" is a cell nobody can read.
    // `<SupplierName>` looks it up out of the bill list this screen already
    // holds and falls back to the id for a supplier we have never been billed
    // by, which is the only honest thing to draw for one.
    cell: ({ row }) => (
      <SupplierName
        id={row.original.supplier_id}
        className="font-medium text-ink"
      />
    ),
  },
  {
    accessorKey: "site_id",
    header: "Location",
    size: 130,
    // The client's own name for it. The id stays in `title`, because that is
    // what the account codes carry and what a support call will be about.
    cell: ({ row }) => <SiteName id={row.original.site_id} />,
  },
  {
    accessorKey: "arrived_at",
    header: "Arrived",
    size: 120,
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.arrived_at),
  },
  {
    accessorKey: "line_count",
    header: "Lines",
    size: 90,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.line_count),
  },
  {
    accessorKey: "value_at_order_price_minor",
    header: "At order price",
    size: 170,
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    // Accepted quantity times the agreed price. What the delivery is worth if
    // the supplier bills what was agreed — deliberately not a bookable figure.
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        {money(row.original.value_at_order_price_minor)}
      </span>
    ),
  },
  {
    accessorKey: "days_waiting",
    header: "Waiting",
    size: 110,
    // The decision metric here, and the column's own warn threshold is the
    // clause somebody wants: more than thirty days without an invoice is a
    // supplier to telephone.
    meta: { align: "right", filter: { kind: "number", unit: "days" } },
    cell: ({ row }) => (
      <span
        className={
          row.original.days_waiting > 30
            ? "font-medium text-warn-fg tabular-nums"
            : "text-body tabular-nums"
        }
      >
        {count(row.original.days_waiting)}d
      </span>
    ),
  },
]

/// Which of the three lists is on screen.
///
/// Merchandise and Expenses are two *datasets* and not two filters on one, which
/// is why they are sub-tabs: they are settled out of different payables, they
/// are posted by different rules, and only one of them says what it was for. A
/// segmented control here would have claimed they were one list narrowed.
type BillTab = "merchandise" | "expenses" | "unbilled"

/// What the bill read asks for, named here rather than left to the default
/// inside `listBills` — a ceiling the screen cannot see is one the banner
/// below would eventually disagree with.
///
/// It is not a page size. The location filter, the merchandise/expense split,
/// the search box and every column heading all narrow what is already here, so
/// this is the number past which two of the three tabs are about a slice. The
/// third is not: `GET /finance/unbilled` takes no limit and answers whole.
const CAP = 200

export function SupplierBills() {
  const [tab, setTab] = useState<BillTab>("merchandise")
  const [query, setQuery] = useState("")
  const [site, setSite] = useState("")
  const [recording, setRecording] = useState(false)
  /// Whether the ageing's supplier table is showing all of them.
  ///
  /// It had an inner scroll region with a fixed height, which cut the fifth row
  /// through the middle — a table that ends in half a row reads as broken
  /// rather than as scrollable, and the scrollbar it depends on is invisible on
  /// a Mac until somebody starts scrolling. Five whole rows and a count is the
  /// same restraint without the lie.
  const [allSuppliers, setAllSuppliers] = useState(false)
  const bill = useSheet("bill")
  const asOf = useAsOf()
  const [billSort, setBillSort] = useState<SortingState>([
    { id: "days_overdue", desc: true },
  ])
  const [expenseSort, setExpenseSort] = useState<SortingState>([
    { id: "days_overdue", desc: true },
  ])
  const [waitSort, setWaitSort] = useState<SortingState>([
    { id: "days_waiting", desc: true },
  ])

  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({ limit: CAP }, signal),
  })
  const unbilled = useQuery({
    queryKey: financeKeys.unbilled(),
    queryFn: ({ signal }) => unbilledReceipts(signal),
  })
  const aging = useQuery({
    queryKey: financeKeys.payablesAging(asOf.value, site || null),
    queryFn: ({ signal }) =>
      payablesAging({ as_of: asOf.value, site: site || undefined }, signal),
  })

  // The location filter is applied here and not on the wire: `GET /bills`
  // takes a status, a supplier and a limit, and no site. The ageing beside it
  // *is* narrowed on the server, which is why one control drives two things
  // that look the same and are not — and why the chip says which date and
  // which location the report on screen belongs to.
  // Both bill lists come out of one read and one cache key. `GET /bills` takes
  // no `kind`, and asking for one would be a second loading state and a second
  // cache entry for a partition of a list already in memory — the same argument
  // that took `?unassessed=true` off the asset register.
  const atSite = useMemo(
    () =>
      (bills.data ?? []).filter((row) => site === "" || row.site_id === site),
    [bills.data, site]
  )
  const billRows = useMemo(
    () => atSite.filter((row) => row.kind !== "EXPENSE"),
    [atSite]
  )
  const expenseRows = useMemo(
    () => atSite.filter((row) => row.kind === "EXPENSE"),
    [atSite]
  )
  const waitRows = useMemo(
    () =>
      (unbilled.data ?? []).filter(
        (row) => site === "" || row.site_id === site
      ),
    [unbilled.data, site]
  )

  /// Read off the answer and never off either tab's rows, which the location
  /// filter and the kind split have already thinned. Four expense bills out of
  /// a full two hundred is still four out of an unknown number of them.
  const truncated = (bills.data ?? []).length >= CAP

  /// Every `GET /api/v1/finance/…` is behind SUPERVISOR, so a cashier signed
  /// into the hub is refused all three of these lists rather than served empty
  /// ones — and an empty payables screen is the single most reassuring wrong
  /// answer this app can give.
  const refused = (
    <NoAccessState
      what="what the company owes its suppliers"
      reach="Reading finance takes a supervisor's sign-in; recording and posting a bill, head office's."
    />
  )

  /// Three lists, one panel, two keys.
  ///
  /// One panel because there is only ever one — it is the shell's right column
  /// and a single URL flag, so the tab decides which model it is driving
  /// rather than each tab drawing its own.
  ///
  /// Two keys because two of the three are the same dataset. Merchandise and
  /// Expenses are one read split by kind and share every column id, so a
  /// clause set on one is meaningful on the other and rides across in `?f=`.
  /// Unbilled deliveries are a different shape entirely — no status, no
  /// supplier name, a different date — and share `?f=` with nobody: on one key
  /// its clauses and the bills' would take turns overwriting each other, since
  /// each model writes back only the clauses it recognises.
  const billFilters = useFilters(billColumns)
  const expenseFilters = useFilters(expenseColumns)
  const waitFilters = useFilters(unbilledColumns, "f2")

  const billTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: billRows,
        columns: billFilters.columns,
        getRowId: (row: SupplierBill) => row.invoice_id,
        state: {
          columnFilters: billFilters.columnFilters,
          globalFilter: query,
          sorting: billSort,
        },
        onSortingChange: setBillSort,
        onGlobalFilterChange: setQuery,
      }),
      [
        billRows,
        billFilters.columns,
        billFilters.columnFilters,
        query,
        billSort,
      ]
    )
  )

  const expenseTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: expenseRows,
        columns: expenseFilters.columns,
        getRowId: (row: SupplierBill) => row.invoice_id,
        state: {
          columnFilters: expenseFilters.columnFilters,
          globalFilter: query,
          sorting: expenseSort,
        },
        onSortingChange: setExpenseSort,
        onGlobalFilterChange: setQuery,
      }),
      [
        expenseRows,
        expenseFilters.columns,
        expenseFilters.columnFilters,
        query,
        expenseSort,
      ]
    )
  )

  const waitTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: waitRows,
        columns: waitFilters.columns,
        getRowId: (row: UnbilledReceipt) => row.receipt_id,
        state: {
          columnFilters: waitFilters.columnFilters,
          globalFilter: query,
          sorting: waitSort,
        },
        onSortingChange: setWaitSort,
        onGlobalFilterChange: setQuery,
      }),
      [
        waitRows,
        waitFilters.columns,
        waitFilters.columnFilters,
        query,
        waitSort,
      ]
    )
  )

  const exposure = waitRows.reduce(
    (sum, row) => sum + row.value_at_order_price_minor,
    0
  )

  // Five bars, and always all five: a gap at 61–90 is a fact about the
  // payables, not a reason to close the space up and let the eye read the
  // remaining bars as if they were adjacent ages.
  const ageing = useMemo(() => {
    const total = aging.data?.total
    const suppliers = aging.data?.suppliers ?? []
    return {
      owed: total?.total_minor ?? 0,
      suppliers,
      // The server's own order — heaviest first — so the five that are shown
      // are the five worth acting on.
      shownSuppliers: allSuppliers
        ? suppliers
        : suppliers.slice(0, SUPPLIERS_SHOWN),
      rows: AGE_BUCKETS.map((bucket) => ({
        bucket: bucket.label,
        total: total?.[bucket.key] ?? 0,
      })),
    }
  }, [aging.data, allSuppliers])

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Supplier bills"
        sub="What has been invoiced, what has been posted, and what arrived with no invoice at all."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            <Button variant="primary" onClick={() => setRecording(true)}>
              Record bill
            </Button>
          </>
        }
      />

      <Toolbar>
        <AsOfControl asOf={asOf} />
        <LocationSelect
          value={site}
          onChange={setSite}
          className="h-8 w-44"
          aria-label="Location"
        />
        {/* Whichever list is on screen. Location is not among the questions
            inside it: the select beside this already narrows all three, and
            the ageing card below is narrowed on the SERVER by the same value —
            a second copy in the panel would move the table and leave the
            report above it describing somewhere else. */}
        <FilterPanel
          model={
            tab === "unbilled"
              ? waitFilters
              : tab === "expenses"
                ? expenseFilters
                : billFilters
          }
          table={
            tab === "unbilled"
              ? waitTable
              : tab === "expenses"
                ? expenseTable
                : billTable
          }
        />
        <Toolbar.Spacer />
        {/* The effective answer, in words, always. A date box filled with
            today and one left blank look identical to a reader; the sentence
            is what says which report is on screen. */}
        <span className="text-[0.71875rem] text-mute">
          {asOf.chip}
          {site === "" ? " · every location" : " · "}
          {site !== "" && <SiteName id={site} />}
        </span>
      </Toolbar>

      {/* Three datasets, not three slices of one. Goods for resale and the
          electricity bill are settled out of different payables and posted by
          different rules; an unbilled receipt is a document the supplier has
          not sent at all. */}
      <SubTabs
        value={tab}
        onChange={(next) => setTab(next as BillTab)}
        tabs={[
          { value: "merchandise", label: "Merchandise" },
          {
            value: "expenses",
            label: `Expenses${expenseRows.length > 0 ? ` · ${expenseRows.length}` : ""}`,
          },
          {
            value: "unbilled",
            label: `Unbilled deliveries${waitRows.length > 0 ? ` · ${waitRows.length}` : ""}`,
          },
        ]}
      />

      {tab === "merchandise" ? (
        <>
          {/* Only when something is owed. With every bill settled the chart
              would be five empty buckets announcing that there is nothing to
              age, which the table below says on its own. */}
          {ageing.owed > 0 && (
            <Card className="mb-3">
              <CardHeader>
                <CardTitle>Ageing</CardTitle>
                {/* Which population, said on the card. The sidebar badge
                    beside "Supplier bills" counts something else — bills that
                    are past due and *not posted* — and two numbers on one
                    screen that disagree without saying why is how somebody
                    stops trusting both. */}
                <span className="text-[0.71875rem] text-mute">
                  Every bill with something still owed on it, posted and draft,
                  across {count(ageing.suppliers.length)} suppliers ·{" "}
                  <span className="font-medium text-ink tabular-nums">
                    {money(ageing.owed)}
                  </span>
                </span>
              </CardHeader>
              <div className="px-4 pb-3.5">
                <BarSeries
                  rows={ageing.rows}
                  series={AGE_SERIES}
                  format={money}
                  labelOf={(bucket) => bucket}
                  titleOf={(bucket) =>
                    AGE_BUCKETS.find((row) => row.label === bucket)?.title ??
                    bucket
                  }
                  className="h-[9.5rem]"
                />

                {/* The same report, supplier by supplier — the half of an
                    ageing somebody actually acts on. Heaviest first, which is
                    the server's own order and the order it is read in. */}
                <div className="mt-3 border-t border-hairline pt-3">
                  <SubHead aside="Heaviest first">By supplier</SubHead>
                  {/* Five rows, then a count. An ageing runs to as many rows
                      as there are suppliers and a card that grows with the
                      list pushes the bills table off the bottom of the screen
                      — but the fix for that is to stop early on a row
                      boundary, not to cut the list mid-row behind a scrollbar
                      nobody can see until they scroll. */}
                  <div>
                    <MiniTable
                      head={[
                        "Supplier",
                        "Oldest",
                        ...AGE_BUCKETS.map((bucket) => bucket.label),
                        "Total",
                      ]}
                    >
                      {ageing.shownSuppliers.map((row) => (
                        <MiniRow key={row.supplier_id}>
                          <MiniCell>
                            <SupplierName
                              id={row.supplier_id}
                              name={row.supplier_name}
                              className="block truncate text-ink"
                            />
                            <span className="text-[0.65625rem] text-mute">
                              {count(row.bill_count)}{" "}
                              {row.bill_count === 1 ? "bill" : "bills"}
                            </span>
                          </MiniCell>
                          <MiniCell align="right">
                            <OldestDays days={row.oldest_days} />
                          </MiniCell>
                          {AGE_BUCKETS.map((bucket) => (
                            <MiniCell key={bucket.key} align="right">
                              {row.buckets[bucket.key] === 0 ? (
                                <span className="text-faint">—</span>
                              ) : (
                                money(row.buckets[bucket.key])
                              )}
                            </MiniCell>
                          ))}
                          <MiniCell
                            align="right"
                            className="font-medium text-ink"
                          >
                            {money(row.buckets.total_minor)}
                          </MiniCell>
                        </MiniRow>
                      ))}
                    </MiniTable>
                  </div>
                  {ageing.suppliers.length > ageing.shownSuppliers.length && (
                    <Button
                      size="sm"
                      variant="quiet"
                      className="mt-1.5"
                      onClick={() => setAllSuppliers(true)}
                    >
                      Show all {count(ageing.suppliers.length)} suppliers
                    </Button>
                  )}
                  {allSuppliers &&
                    ageing.suppliers.length > SUPPLIERS_SHOWN && (
                      <Button
                        size="sm"
                        variant="quiet"
                        className="mt-1.5"
                        onClick={() => setAllSuppliers(false)}
                      >
                        Show the heaviest {count(SUPPLIERS_SHOWN)}
                      </Button>
                    )}
                  <p className="mt-2 text-[0.71875rem] text-mute">
                    The server's own ageing, wound back to the date above: what
                    is still outstanding on each bill, not what the invoice was
                    for. It agrees with{" "}
                    <AppLink
                      to="/finance/account-map"
                      className="text-accent hover:underline"
                    >
                      trade payable
                    </AppLink>{" "}
                    in the books, because both move only when a bill or a
                    payment posts.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Under the ageing rather than over it, because the ageing is the
              server's own and is not capped — the warning belongs to the list
              it is true of, and putting it at the top of the page would have
              read as being about both. */}
          {truncated && <Truncated limit={CAP} noun="bills" />}

          <Card className="overflow-hidden">
            {queryState(bills, {
              loading: "Loading the bills…",
              refused,
              render: () =>
                billRows.length === 0 ? (
                  <EmptyState>
                    {site === ""
                      ? "No supplier invoice has been recorded yet."
                      : "No supplier invoice has been recorded at this location. Widen the location filter to see the rest."}
                  </EmptyState>
                ) : (
                  <DataTable<SupplierBill>
                    table={billTable}
                    onRowClick={(row) => bill.open(row.invoice_id)}
                    isSelected={(row) => row.invoice_id === bill.value}
                    // The count is what separates "nothing has been invoiced
                    // here" — the sentence above — from "plenty has, and none
                    // of it matches what you typed".
                    empty={
                      <NoMatch
                        what="bills"
                        held={billRows.length}
                        onClear={() => setQuery("")}
                      />
                    }
                    // The ageing card takes the top of the page, so the
                    // table's own scroll region gives it back rather than
                    // running off the bottom of the window.
                    className={
                      ageing.owed > 0
                        ? "max-h-[calc(100vh-38rem)]"
                        : "max-h-[calc(100vh-21rem)]"
                    }
                  />
                ),
            })}
          </Card>
        </>
      ) : tab === "expenses" ? (
        <>
          {/* What the tab is for, said once. An expense bill is the only bill
              on this screen that says what it was for, and the only one whose
              posting debits an account somebody chose rather than one a rule
              decided. */}
          <Banner tone="info" className="mb-3">
            Costs rather than goods for resale — rent, electricity, a repair,
            and the capital purchases an asset is bought by. Each one names the
            accounts its cost belongs to, and those lines are what the posting
            debits. They settle out of{" "}
            <AppLink
              to="/finance/account-map"
              sheet={{ key: "mapping", value: "non_merchandise_payable" }}
              className="text-accent hover:underline"
            >
              non-merchandise payable
            </AppLink>
            , not trade payable.
          </Banner>
          {/* The same read, so the same warning — and it is worse here: the
              merchandise bills are the bulk of the answer, so the expenses are
              the rows most likely to be the ones that fell past the cap. */}
          {truncated && <Truncated limit={CAP} noun="bills" className="mb-3" />}
          <Card className="overflow-hidden">
            {queryState(bills, {
              loading: "Loading the bills…",
              refused,
              render: () =>
                expenseRows.length === 0 ? (
                  <EmptyState>
                    {site === ""
                      ? "No expense bill has been recorded yet. Record one with “Record bill” and switch its kind to Expense."
                      : "No expense bill has been recorded at this location. Widen the location filter to see the rest."}
                  </EmptyState>
                ) : (
                  <DataTable<SupplierBill>
                    table={expenseTable}
                    onRowClick={(row) => bill.open(row.invoice_id)}
                    isSelected={(row) => row.invoice_id === bill.value}
                    empty={
                      <NoMatch
                        what="expense bills"
                        held={expenseRows.length}
                        onClear={() => setQuery("")}
                      />
                    }
                    className="max-h-[calc(100vh-25rem)]"
                  />
                ),
            })}
          </Card>
        </>
      ) : (
        <>
          <Banner tone="warn" className="mb-3">
            Not a balance. The client keeps no goods-received-not-invoiced
            account, so none of this is in the books: at month end inventory and
            payables both understate by{" "}
            <span className="font-semibold tabular-nums">
              {money(exposure)}
            </span>
            . The figure is accepted quantity at the agreed price — what the
            supplier will charge if they charge what was agreed.
          </Banner>
          {/* No `<Truncated>` on this tab, and that is the finding rather than
              an omission: `unbilledReceipts()` sends no `limit`, so the
              exposure in the banner above is a total. Drawing the warning here
              too would have taught a reader to discount a figure that is
              sound. */}
          <Card className="overflow-hidden">
            {queryState(unbilled, {
              loading: "Looking for unbilled deliveries…",
              refused,
              render: () =>
                waitRows.length === 0 ? (
                  <EmptyState>
                    {site === ""
                      ? "Every delivery has a bill against it. Nothing is sitting in the warehouse that the books do not know about."
                      : "Every delivery to this location has a bill against it. Widen the location filter to see the rest."}
                  </EmptyState>
                ) : (
                  <DataTable<UnbilledReceipt>
                    table={waitTable}
                    empty={
                      <NoMatch
                        what="deliveries"
                        held={waitRows.length}
                        onClear={() => setQuery("")}
                      />
                    }
                    className="max-h-[calc(100vh-25rem)]"
                  />
                ),
            })}
          </Card>
        </>
      )}

      <BillSheet id={bill.value ?? null} onClose={bill.close} />
      <RecordSheet open={recording} onClose={() => setRecording(false)} />
    </PageContent>
  )
}

/// One bill, and the one decision it is waiting on.
///
/// There is no per-bill read on the node, so this selects out of the list the
/// table already holds — same query key, so it costs nothing and cannot
/// disagree with the row that was clicked.
function BillSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  // The sheet's title is a string and not an element, so the one place in this
  // module that cannot use `<SupplierName>` calls what it calls.
  const supplierName = useSupplierName()

  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal),
    enabled: id !== null,
  })

  // What has been paid against it. The whole register under the key the
  // Payments screen owns, filtered here — there is no per-bill payments
  // endpoint, and asking for one supplier's payments would still not answer
  // "this invoice" because a payment can settle several bills at once.
  const payments = useQuery({
    queryKey: financeKeys.payments(null, null, null),
    queryFn: ({ signal }) => listPayments({ limit: 200 }, signal),
    enabled: id !== null,
  })

  const bill = bills.data?.find((row) => row.invoice_id === id)

  // What the bill was for, read one bill at a time. Only for an expense bill:
  // a merchandise bill has no lines by construction — what it debits is decided
  // by the posting rule, not by the person keying it — so asking would be a
  // request whose only possible answer is an empty array.
  const detail = useBill(id, bill?.kind === "EXPENSE")
  const lines = detail.data?.lines ?? bill?.lines ?? null

  const against = (payments.data ?? [])
    .map((payment) => ({
      payment,
      allocation: payment.allocations.find((row) => row.invoice_id === id),
    }))
    .filter(
      (
        row
      ): row is {
        payment: (typeof row)["payment"]
        allocation: NonNullable<(typeof row)["allocation"]>
      } => row.allocation !== undefined
    )

  const post = useMutation({
    mutationFn: () => postBill(id!),
    onSuccess: () => {
      // Posting a bill writes a journal entry, so the register, the balances,
      // both statements and the trial balance all moved with it.
      client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const posted = bill?.status?.toUpperCase() === "POSTED"

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "bill", id }}
      onOpenChange={(next) => !next && onClose()}
      id={bill?.invoice_number}
      title={
        bill === undefined
          ? "Bill"
          : (bill.supplier_name ?? supplierName(bill.supplier_id))
      }
      footer={
        bill && !posted ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.71875rem] text-mute">
              Posts on the invoice date unless the month is closed.
            </span>
            <Button
              variant="primary"
              disabled={post.isPending}
              onClick={() => post.mutate()}
            >
              {post.isPending ? "Posting…" : "Post to the books"}
            </Button>
          </div>
        ) : undefined
      }
    >
      {queryState(bills, {
        loading: "Loading the bill…",
        render: () =>
          bill === undefined ? (
            <EmptyState>
              No bill is recorded under that id on this list.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              {post.isError && (
                <Banner tone="bad">
                  {post.error instanceof Error
                    ? post.error.message
                    : "The bill could not be posted."}
                </Banner>
              )}

              <div className="flex flex-wrap gap-1.5">
                <Pill tone={toneFor(bill.status)}>{label(bill.status)}</Pill>
                {/* Which kind, always — it decides what the posting debits,
                    and a bill that says nothing about it reads as merchandise
                    to anybody who has met only merchandise. */}
                <Pill tone={bill.kind === "EXPENSE" ? "info" : "neutral"}>
                  {bill.kind === "EXPENSE" ? "Expense" : "Merchandise"}
                </Pill>
                {isLate(bill) && (
                  <Pill tone="bad">
                    {count(bill.days_overdue)} days overdue
                  </Pill>
                )}
              </div>

              {/* Above the facts, because on an expense bill this IS the
                  document: the accounts these name are exactly what the
                  posting will debit, and the header below is the paperwork
                  around them. */}
              {bill.kind === "EXPENSE" && (
                <div>
                  <SubHead
                    aside={
                      lines === null
                        ? undefined
                        : `${count(lines.length)} ${lines.length === 1 ? "line" : "lines"}`
                    }
                  >
                    What it was for
                  </SubHead>
                  {lines === null ? (
                    <p className="text-[0.71875rem] text-mute">
                      {detail.isPending
                        ? "Reading the lines…"
                        : isMissingRead(detail.error)
                          ? "This node does not answer the per-bill read yet, so what the bill was for cannot be shown here. The posting on the journal entry says the same thing, account by account."
                          : "The lines could not be read."}
                    </p>
                  ) : (
                    <MiniTable head={["Account", "Location", "Amount"]}>
                      {lines.map((line) => (
                        <MiniRow key={line.line_id}>
                          <MiniCell>
                            <span className="flex min-w-0 items-center gap-1.5">
                              {/* The code opens the ledger — what has
                                  happened in this account — and the client's
                                  own name for it is never translated. */}
                              <AppLink
                                to="/finance/ledger"
                                sheet={{
                                  key: "account",
                                  value: line.account_code,
                                }}
                                className="shrink-0 font-mono text-[0.65625rem] text-mute hover:text-accent hover:underline"
                              >
                                {line.account_code}
                              </AppLink>
                              <span className="truncate text-ink">
                                {line.account_name}
                              </span>
                            </span>
                            {line.memo && (
                              <span className="block text-[0.65625rem] text-mute">
                                {line.memo}
                              </span>
                            )}
                          </MiniCell>
                          <MiniCell>
                            <SiteName id={line.site_id} />
                          </MiniCell>
                          <MiniCell align="right">
                            {money(line.amount_minor)}
                          </MiniCell>
                        </MiniRow>
                      ))}
                    </MiniTable>
                  )}
                </div>
              )}

              <Facts>
                {/* The client's own name for them, with the id in `title`.
                    A uuid was here, which is the id the URL and a support
                    call are about and not a thing anybody reads. */}
                <Fact term="Supplier">
                  <SupplierName
                    id={bill.supplier_id}
                    name={bill.supplier_name}
                  />
                </Fact>
                <Fact term="Location">
                  <SiteName id={bill.site_id} />
                </Fact>
                <Fact term="Invoice date">{day(bill.invoice_date)}</Fact>
                <Fact term="Due">{day(bill.due_date)}</Fact>
                <Fact term="Currency">{bill.currency}</Fact>
                <Fact term="Recorded by">{bill.recorded_by}</Fact>
                {bill.posted_by && (
                  <Fact term="Posted by">{bill.posted_by}</Fact>
                )}
                {bill.entry_number && bill.journal_entry_id && (
                  <Fact term="Journal">
                    <AppLink
                      to="/finance/journal"
                      sheet={{ key: "entry", value: bill.journal_entry_id }}
                      className="font-mono text-id text-accent hover:underline"
                    >
                      {bill.entry_number}
                    </AppLink>
                  </Fact>
                )}
              </Facts>

              {bill.note && (
                <p className="text-[0.78125rem] text-body">{bill.note}</p>
              )}

              <TotalsLadder
                rows={[
                  { label: "Subtotal", value: money(bill.subtotal_minor) },
                  { label: "Tax", value: money(bill.tax_minor) },
                  // `-0` is a real JavaScript value and `Intl` renders it as
                  // "-Rp 0", so a bill with no discount and nothing paid drew
                  // two negative zeroes. Negated only when there is something
                  // to negate.
                  // An expense bill cannot carry one — the client's only
                  // discount account is Potongan Pembelian, which is for
                  // purchases — so the row is not drawn rather than drawn as a
                  // permanent zero.
                  ...(bill.kind === "EXPENSE"
                    ? []
                    : [
                        {
                          label: "Discount",
                          value: money(
                            bill.discount_minor === 0 ? 0 : -bill.discount_minor
                          ),
                        },
                      ]),
                  { label: "Total", value: money(bill.total_minor) },
                  {
                    label: "Paid",
                    value: money(bill.paid_minor === 0 ? 0 : -bill.paid_minor),
                  },
                ]}
                total={{
                  label: "Outstanding",
                  value: money(bill.outstanding_minor),
                }}
              />

              {/* No dead ends: what has been paid against this bill is one
                  click away. Drawn only when there is something — a heading
                  over an empty table says "no payments" twice. */}
              {against.length > 0 && (
                <div>
                  <SubHead
                    aside={
                      bill.allocated_minor > bill.paid_minor
                        ? `${money(bill.allocated_minor - bill.paid_minor)} of it still in draft`
                        : undefined
                    }
                  >
                    Paid by
                  </SubHead>
                  <MiniTable head={["Payment", "Status", "Amount"]}>
                    {against.map(({ payment, allocation }) => (
                      <MiniRow key={payment.payment_id}>
                        <MiniCell>
                          {/* The payment itself, not the register it is on.
                              `payment` is a key in `lib/sheets.ts` now, so
                              this opens the record rather than landing
                              somebody on a list with a number to find. */}
                          <AppLink
                            to="/finance/payments"
                            sheet={{
                              key: "payment",
                              value: payment.payment_id,
                            }}
                            className="block font-mono text-[0.75rem] text-accent hover:underline"
                          >
                            {payment.payment_number}
                          </AppLink>
                          <span className="text-[0.65625rem] text-mute">
                            {day(payment.payment_date)}
                          </span>
                        </MiniCell>
                        <MiniCell>
                          <Pill tone={toneFor(payment.status)}>
                            {label(payment.status)}
                          </Pill>
                        </MiniCell>
                        <MiniCell align="right">
                          {money(allocation.amount_minor)}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                </div>
              )}
            </div>
          ),
      })}
    </Sheet>
  )
}

/// One thing an expense bill was for, as somebody keys it.
///
/// The account is held as a code *and* a name even though only the code is
/// sent: the picker answers with both, and splitting the pair would let a row
/// show one account's name over another's code. The same reason the bank
/// statement composer keeps both.
///
/// There is no `site` here, and that is the point. 0098 forces an expense line
/// to sit at its bill's own location — every 6* and 7* leaf in this client's
/// chart is already a per-location account, so a DC bill carrying a store-01
/// line would debit store 01 with no credit anywhere in store 01's books. A
/// control offering the choice would be a control whose every other answer is
/// refused.
interface ExpenseLineDraft {
  accountCode: string
  accountName: string
  amount: string
  memo: string
}

/// The bill as it is typed — every amount is text until it is submitted,
/// because a half-typed number is not a number.
interface BillDraft {
  /// `MERCHANDISE` or `EXPENSE`. What decides which payable the posting
  /// credits, which accounts it debits, and therefore whether `lines` means
  /// anything at all.
  kind: string
  invoiceNumber: string
  supplierId: string
  supplierName: string
  siteId: string
  invoiceDate: string
  dueDate: string
  subtotal: string
  tax: string
  discount: string
  note: string
  lines: ExpenseLineDraft[]
}

/// What the amounts add up to, from whatever is typed so far — and, on an
/// expense bill, whether the lines agree with the figure on the paper.
///
/// A blank tax or discount is zero rather than a refusal — most invoices carry
/// neither — but a *misread* one stays `null`, which is what stops the form.
///
/// The lines are checked against `subtotal` and never used to compute it. The
/// subtotal is what the supplier printed; the lines are somebody's account
/// coding of it, and a form that quietly made the two agree by deriving one
/// from the other would hide the keying error this comparison exists to catch.
/// The database makes the same comparison at COMMIT and names the difference.
function billTotals(draft: BillDraft) {
  const expense = draft.kind === "EXPENSE"
  const subtotalMinor = parseMinor(draft.subtotal)
  const taxMinor = draft.tax.trim() === "" ? 0 : parseMinor(draft.tax)
  // Refused outright on an expense bill: the client's only discount account is
  // Potongan Pembelian, which is for purchases. So it is zero here rather than
  // whatever is left in a box the form has stopped drawing.
  const discountMinor = expense
    ? 0
    : draft.discount.trim() === ""
      ? 0
      : parseMinor(draft.discount)
  // Integer minor units throughout — a float rupiah is a rounding error waiting
  // for a total to disagree with the ledger.
  const total = (subtotalMinor ?? 0) + (taxMinor ?? 0) - (discountMinor ?? 0)

  let linesMinor: number | null = 0
  for (const line of draft.lines) {
    const amount = parseMinor(line.amount)
    // A line with no account, no amount or a negative one is not a line. The
    // server says the same of each, one at a time and by number.
    if (
      linesMinor === null ||
      amount === null ||
      amount <= 0 ||
      line.accountCode === ""
    ) {
      linesMinor = null
      break
    }
    linesMinor += amount
  }

  const agree =
    !expense ||
    (draft.lines.length > 0 &&
      linesMinor !== null &&
      subtotalMinor !== null &&
      linesMinor === subtotalMinor)

  const ready =
    draft.invoiceNumber.trim() !== "" &&
    draft.supplierId.trim() !== "" &&
    draft.siteId.trim() !== "" &&
    draft.invoiceDate !== "" &&
    subtotalMinor !== null &&
    taxMinor !== null &&
    discountMinor !== null &&
    agree

  return {
    expense,
    subtotalMinor,
    taxMinor,
    discountMinor,
    linesMinor,
    total,
    agree,
    ready,
  }
}

/// Writing a supplier's invoice down. It does not post: recording and posting
/// are two acts, and this is only the first.
///
/// # Why one composer and not two
///
/// A merchandise bill and an expense bill share nine of their eleven fields —
/// the supplier, the location, the dates, the invoice number, the amounts. Two
/// sheets would be nine fields written twice and two "Record bill" buttons in a
/// toolbar, and the reader would have to know which kind of thing they were
/// holding before they could start typing it. The kind is a switch at the top,
/// where it belongs: it is the first decision, and everything below it follows.
function RecordSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  // What the request answered, not what was typed into it.
  const [receipt, setReceipt] = useState<string | null>(null)

  const record = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: BillDraft) => {
      const totals = billTotals(draft)
      const site = draft.siteId.trim()
      return recordBill({
        invoice_number: draft.invoiceNumber.trim(),
        supplier_id: draft.supplierId.trim(),
        supplier_name:
          draft.supplierName.trim() === "" ? null : draft.supplierName.trim(),
        site_id: site,
        invoice_date: draft.invoiceDate,
        due_date: draft.dueDate === "" ? null : draft.dueDate,
        subtotal_minor: totals.subtotalMinor ?? 0,
        tax_minor: totals.taxMinor ?? 0,
        discount_minor: totals.discountMinor ?? 0,
        note: draft.note.trim() === "" ? null : draft.note.trim(),
        kind: draft.kind,
        // Absent and not `[]` on a merchandise bill: the server refuses a
        // merchandise bill that carries any, and an empty array is a claim
        // about lines rather than the absence of one.
        lines: totals.expense
          ? draft.lines.map((line): RecordBillLine => ({
              account_code: line.accountCode,
              // The bill's own location, always. See `ExpenseLineDraft`.
              site_id: site,
              amount_minor: parseMinor(line.amount) ?? 0,
              memo: line.memo.trim() === "" ? null : line.memo.trim(),
            }))
          : undefined,
      })
    },
    onSuccess: (saved) => {
      setReceipt(saved.invoice_number)
      // The answer carries its lines, so the sheet somebody opens next reads
      // them out of the cache instead of asking for a bill this browser just
      // wrote.
      client.setQueryData(financeKeys.bill(saved.invoice_id), saved)
      // Only the fields that differ from invoice to invoice are cleared: the
      // supplier, the site and the dates are almost always the next bill's too.
      // The lines go with the amount — they are this invoice's coding of this
      // invoice, and carrying them forward is how the electricity gets booked
      // twice.
      form.setFieldValue("invoiceNumber", "")
      form.setFieldValue("subtotal", "")
      form.setFieldValue("tax", "")
      form.setFieldValue("discount", "")
      form.setFieldValue("note", "")
      form.setFieldValue("lines", [])
      // Recording writes no journal entry, so only the bill list moved.
      client.invalidateQueries({ queryKey: financeKeys.bills(null) })
    },
  })

  const form = useForm({
    defaultValues: {
      kind: "MERCHANDISE",
      invoiceNumber: "",
      supplierId: "",
      supplierName: "",
      siteId: "",
      invoiceDate: todayIso(),
      dueDate: "",
      subtotal: "",
      tax: "",
      discount: "",
      note: "",
      lines: [],
    } as BillDraft,
    onSubmit: ({ value }) => record.mutate(value),
  })

  /// Append, edit and drop one line, without the form having to know it is a
  /// list. TanStack Form's array helpers would do this too; a plain setter is
  /// three lines and does not put a second way of writing to the same field
  /// beside the nine `<form.Field>`s above it.
  const setLines = (next: (lines: ExpenseLineDraft[]) => ExpenseLineDraft[]) =>
    form.setFieldValue("lines", next(form.state.values.lines))

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Record a supplier bill"
      className="w-[34rem]"
      footer={
        /* The screen's black CTA opens this sheet and is behind the veil while
           it is up, so the two are never on screen together. */
        <form.Subscribe selector={(state) => billTotals(state.values)}>
          {(totals) => (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[0.71875rem] text-mute tabular-nums">
                {totals.ready
                  ? money(totals.total)
                  : totals.expense && totals.subtotalMinor !== null
                    ? "The lines have to add up to the subtotal"
                    : "Fill in the invoice and the amount"}
              </span>
              <Button
                variant="primary"
                disabled={!totals.ready || record.isPending}
                onClick={() => form.handleSubmit()}
              >
                {record.isPending ? "Recording…" : "Record"}
              </Button>
            </div>
          )}
        </form.Subscribe>
      }
    >
      <form
        // The button is in the sheet's footer, outside this element, so its
        // disabled state cannot block an Enter keypress. The gate is repeated
        // here rather than trusted to the layout.
        onSubmit={(event) => {
          event.preventDefault()
          if (billTotals(form.state.values).ready && !record.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-3.5"
      >
        {receipt && (
          <Banner tone="ok" onDismiss={() => setReceipt(null)}>
            {receipt} recorded. It is not in the books until somebody posts it.
          </Banner>
        )}
        {/* The server's own sentence, verbatim. Every refusal this endpoint
            has is written to be read by the person who typed the bill — which
            line is in the wrong class, which location the cost was put at,
            what the difference between the lines and the subtotal comes to —
            and paraphrasing any of them would lose the number they name. */}
        <Problem error={record.error} />

        {/* The first decision, at the top, because everything below follows
            from it. A segmented control and not sub-tabs: this is one form
            with two shapes, not two documents. */}
        <form.Field name="kind">
          {(field) => (
            <Field
              label="Kind"
              hint={
                field.state.value === "EXPENSE"
                  ? "A cost: rent, electricity, a repair, a capital purchase. It says what it was for, account by account."
                  : "Goods for resale. What the posting debits is decided by the rule, not by the person keying it."
              }
            >
              <Segmented
                value={field.state.value}
                onChange={(next) => field.handleChange(next)}
                options={[
                  { value: "MERCHANDISE", label: "Merchandise" },
                  { value: "EXPENSE", label: "Expense" },
                ]}
              />
            </Field>
          )}
        </form.Field>

        <div className="grid grid-cols-2 gap-3">
          <form.Field name="invoiceNumber">
            {(field) => (
              <Field label="Invoice number">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="siteId">
            {(field) => (
              <Field label="Location">
                {/* Was a text box placeheld "e.g. DC01", which no site id in
                    the data resembles. The server refuses an unknown one; this
                    is how nobody has to meet that refusal. */}
                <LocationSelect
                  value={field.state.value}
                  onChange={(next) => field.handleChange(next)}
                  emptyLabel="Choose a location"
                />
              </Field>
            )}
          </form.Field>
          {/* One field, across the row, where two stood: a uuid box headed
              "Supplier id" and a free-text one for the name beside it. See
              `<SupplierPicker>` for why that pair could file an invoice under
              the right name and the wrong debt. The name still goes on the
              wire — it is what the bill is recorded under — but it is now the
              master list's rather than somebody's typing. */}
          <form.Field name="supplierId">
            {(field) => (
              <Field label="Supplier" className="col-span-2">
                <SupplierPicker
                  value={field.state.value}
                  onPick={(supplier) => {
                    field.handleChange(supplier?.supplier_id ?? "")
                    form.setFieldValue("supplierName", supplier?.name ?? "")
                  }}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="invoiceDate">
            {(field) => (
              <Field label="Invoice date">
                <Day
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="dueDate">
            {(field) => (
              <Field label="Due date" hint="Optional.">
                <Day
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="subtotal">
            {(field) => (
              <Field
                label="Subtotal"
                problem={
                  field.state.value.trim() !== "" &&
                  parseMinor(field.state.value) === null
                    ? "Not a number."
                    : undefined
                }
              >
                <Money
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                  placeholder="0"
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="tax">
            {(field) => (
              <Field label="Tax">
                <Money
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                  placeholder="0"
                />
              </Field>
            )}
          </form.Field>
          {/* Not drawn at all on an expense bill, rather than drawn and
              disabled: the client's only discount account is Potongan
              Pembelian and it is for purchases, so there is no answer this box
              could take. The server refuses one in the same words. */}
          <form.Subscribe selector={(state) => state.values.kind}>
            {(kind) =>
              kind === "EXPENSE" ? null : (
                <form.Field name="discount">
                  {(field) => (
                    <Field label="Discount">
                      <Money
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={field.handleChange}
                        placeholder="0"
                      />
                    </Field>
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>
        </div>

        <form.Subscribe
          selector={(state) => ({
            expense: state.values.kind === "EXPENSE",
            lines: state.values.lines,
            site: state.values.siteId,
            totals: billTotals(state.values),
          })}
        >
          {(state) =>
            state.expense && (
              <ExpenseLines
                lines={state.lines}
                site={state.site}
                linesMinor={state.totals.linesMinor}
                subtotalMinor={state.totals.subtotalMinor}
                agree={state.totals.agree}
                onChange={setLines}
              />
            )
          }
        </form.Subscribe>

        <form.Field name="note">
          {(field) => (
            <Field label="Note" hint="Why it is being held, if it is.">
              <Textarea
                rows={2}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => billTotals(state.values)}>
          {(totals) => (
            <TotalsLadder
              rows={[
                { label: "Subtotal", value: money(totals.subtotalMinor ?? 0) },
                { label: "Tax", value: money(totals.taxMinor ?? 0) },
                ...(totals.expense
                  ? []
                  : [
                      {
                        label: "Discount",
                        // Same negative zero as the sheet's ladder: an
                        // untouched discount box drew "-Rp 0" under every
                        // invoice.
                        value: money(
                          totals.discountMinor ? -totals.discountMinor : 0
                        ),
                      },
                    ]),
              ]}
              total={{ label: "Total", value: money(totals.total) }}
            />
          )}
        </form.Subscribe>
      </form>
    </Sheet>
  )
}

/// What an expense bill was for, being keyed.
///
/// # Why the ladder is two figures and not one
///
/// "Lines Rp X · Before tax Rp Y" says both halves of the comparison the server
/// is about to make, so a mismatch is read as *which one is wrong* rather than
/// as a form refusing to submit. The database makes the same comparison at
/// COMMIT and names the difference; this is what stops anybody meeting it.
function ExpenseLines({
  lines,
  site,
  linesMinor,
  subtotalMinor,
  agree,
  onChange,
}: {
  lines: readonly ExpenseLineDraft[]
  site: string
  linesMinor: number | null
  subtotalMinor: number | null
  agree: boolean
  onChange: (next: (lines: ExpenseLineDraft[]) => ExpenseLineDraft[]) => void
}) {
  const edit = (index: number, patch: Partial<ExpenseLineDraft>) =>
    onChange((current) =>
      current.map((line, at) => (at === index ? { ...line, ...patch } : line))
    )

  return (
    <div className="flex flex-col gap-2.5">
      <SubHead
        aside={
          lines.length === 0
            ? undefined
            : `${count(lines.length)} ${lines.length === 1 ? "line" : "lines"}`
        }
      >
        What it was for
      </SubHead>

      <p className="text-[0.71875rem] text-mute">
        A cost — class 6 or 7 — or something that becomes one: prepaid expense,
        an advance, or a capital purchase under <code>10215</code>. Every line
        sits at the bill's own location:{" "}
        {site === "" ? (
          <span className="text-warn-fg">choose a location above first.</span>
        ) : (
          <>
            <SiteName id={site} className="text-ink" />. A cost at another
            location needs an inter-unit credit and no rule writes one yet, so
            it is refused — record one bill per location instead.
          </>
        )}
      </p>

      {lines.map((line, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-inner border border-hairline p-3"
        >
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1">
              {line.accountCode === "" ? (
                <AccountPicker
                  placeholder="Which account does this cost belong to"
                  // The chart is theirs and the refusals are the server's:
                  // an inactive account has been retired and cannot take new
                  // costs, and a class outside 1, 6 and 7 is not a cost at
                  // all. Both are shown and disabled rather than hidden — an
                  // accountant who cannot find the account they are holding
                  // an invoice for assumes the search is broken.
                  accept={(account) =>
                    !account.is_active
                      ? "retired"
                      : !EXPENSE_LINE_CLASSES.includes(account.root_class)
                        ? `class ${account.root_class}`
                        : null
                  }
                  onPick={(account) =>
                    edit(index, {
                      accountCode: account.account_code,
                      accountName: account.name,
                    })
                  }
                />
              ) : (
                <span className="flex min-w-0 items-center gap-2">
                  <Tag>{line.accountCode}</Tag>
                  <span className="min-w-0 flex-1 truncate text-[0.78125rem] text-ink">
                    {line.accountName}
                  </span>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() =>
                      edit(index, { accountCode: "", accountName: "" })
                    }
                  >
                    Change
                  </Button>
                </span>
              )}
            </span>
            <Button
              size="sm"
              variant="quiet"
              onClick={() =>
                onChange((current) => current.filter((_, at) => at !== index))
              }
            >
              Remove
            </Button>
          </div>

          <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-2">
            <Field
              label="Amount"
              problem={
                line.amount.trim() !== "" && parseMinor(line.amount) === null
                  ? "Not a number."
                  : undefined
              }
            >
              <Money
                value={line.amount}
                onChange={(next) => edit(index, { amount: next })}
                placeholder="0"
              />
            </Field>
            <Field label="Memo" hint="Optional; what this line was.">
              <Input
                value={line.memo}
                onChange={(event) => edit(index, { memo: event.target.value })}
              />
            </Field>
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between gap-3">
        <Button
          size="sm"
          variant="soft"
          onClick={() =>
            onChange((current) => [
              ...current,
              { accountCode: "", accountName: "", amount: "", memo: "" },
            ])
          }
        >
          Add a line
        </Button>
        {/* Both halves of the comparison, always — a single "out by" figure
            would say something is wrong without saying which number to fix. */}
        <span className="text-[0.71875rem] text-mute tabular-nums">
          Lines{" "}
          <span className={agree ? "text-ink" : "font-medium text-bad-fg"}>
            {linesMinor === null ? "—" : money(linesMinor)}
          </span>{" "}
          · Before tax{" "}
          <span className="text-ink">
            {subtotalMinor === null ? "—" : money(subtotalMinor)}
          </span>
        </span>
      </div>
    </div>
  )
}

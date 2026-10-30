import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, RowData, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { Fab } from "@/components/ui/fab"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { FilterChips } from "@/components/ui/filter-chips"
import { Switch } from "@/components/ui/form"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
  TotalsLadder,
} from "@/components/ui/rows"
import { PageHeader } from "@/components/ui/page-header"
import { CellMoney } from "@/components/ui/rows-switch"
import { Pill, Status } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  LoadingState,
  NoAccessState,
  NoMatch,
  Problem,
} from "@/components/ui/states"
import { useFilters, type Filter } from "@/lib/filters"
import { count, day, label, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  applySupplierAdvance,
  billDetail,
  billItemLines,
  billSettlements,
  billWarnings,
  financeKeys,
  holdBill,
  listBills,
  listPayments,
  postBill,
  projectionBillsQuery,
  recordBill,
  releaseBill,
  returnBill,
  supplierAdvance,
  unbilledReceipts,
} from "@/lib/queries/finance"
import { openAdvances } from "@/lib/queries/cash-documents"
import { useSiteLabel, useUnits } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { useSheet, type SheetKey } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useCompactRows } from "@/lib/table-rows"
import { useDebounced } from "@/lib/use-debounced"
import {
  EXPENSE_LINE_CLASSES,
  parseMinor,
  todayIso,
} from "@/screens/finance/chart"
import { useSupplierName } from "@/screens/finance/hooks"
import { addDays } from "@/screens/finance/stores-grid"
import {
  billStatus,
  LUNAS,
  NEW,
  PART_PAID,
  ppnCode,
  SERVER_STATUS_OF_WORD,
  termOf,
} from "@/screens/finance/purchasing"
import {
  AccountAndCategory,
  accountChoiceReady,
  type AccountChoice,
  SiteName,
  SiteSelect,
  SupplierName,
  SupplierPicker,
  UnitSelect,
} from "@/screens/finance/parts"
import { ApiError } from "@itulah/contract/client"
import type {
  RecordBillLine,
  SupplierBill,
  SupplierBillLine,
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
///
/// Late is "still owed and past its date", which is 7Soft's reading too: a
/// bill already paid has no reason to be red, whatever day its paper fell on.
function isLate(bill: SupplierBill): boolean {
  return bill.outstanding_minor > 0 && bill.days_overdue > 0
}

/// The site: its name in comfortable rows, its code in compact ones ("HO",
/// the name on hover) — compact rows give the width to the figures (owner,
/// 17 Oct, `lib/table-rows.ts`).
function BillSite({ id }: { id: string | null | undefined }) {
  const compact = useCompactRows()
  const name = useSiteLabel()
  if (!compact || id === null || id === undefined || id === "")
    return <SiteName id={id} />
  const full = name(id)
  return <span title={full}>{full.split(" · ")[0]}</span>
}

/// When it falls due. A late bill's date is drawn red, as 7Soft draws it,
/// with its days late on hover.
function BillDue({ bill }: { bill: SupplierBill }) {
  if (isLate(bill))
    return (
      <span
        className="text-bad-fg"
        title={`${count(bill.days_overdue)} days late`}
      >
        {day(bill.due_date)}
      </span>
    )
  return <>{day(bill.due_date)}</>
}

const deskBillColumns: ColumnDef<TableSetup, SupplierBill>[] = [
  {
    accessorKey: "invoice_number",
    // 7Soft's column words (Faktur Pembelian, Info Pembelian): No Faktur,
    // Gudang, Tanggal, JTempo, Jangka, PPN, Bayar, Sisa.
    header: "No faktur",
    size: 150,
    // The server orders by date, due, supplier, total and outstanding; see
    // `BILL_SORTS`. The number is searched, not sorted.
    enableSorting: false,
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-mono text-id text-body">
          {row.original.invoice_number}
        </span>
        {/* The marks a bill wears in any list: it was filed by Operations, and
            it is held. Drawn here rather than as columns because both are
            facts about the row and neither is a figure anybody sorts by. */}
        <BillMarks bill={row.original} />
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
    accessorKey: "due_date",
    header: "JTempo",
    size: 120,
    // "Due before the end of the month" is how a payment run is planned, and
    // the as-of box above answers a different question — it dates the ageing
    // report, not the list.
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => <BillDue bill={row.original} />,
  },
  {
    // 7Soft's Amount: what the paper came to, before anything was paid.
    accessorKey: "total_minor",
    header: "Total",
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="text-body tabular-nums">
        <CellMoney minor={row.original.total_minor} />
      </span>
    ),
  },
  {
    accessorKey: "outstanding_minor",
    header: "Sisa",
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
            <CellMoney minor={bill.outstanding_minor} />
          </span>
          {reserved > 0 && (
            <span className="text-[0.9375rem] text-warn-fg tabular-nums">
              <CellMoney minor={reserved} /> in draft
            </span>
          )}
        </span>
      )
    },
  },
  {
    // 7Soft's own words once a bill is in the books — New, Part paid, Lunas —
    // and the hub's for the two states the paper never had (Draft, Matched).
    // See `billStatus`.
    id: "status",
    accessorFn: (row) => billStatus(row).word,
    header: "Status",
    size: 130,
    enableSorting: false,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => {
      const state = billStatus(row.original)
      return <Status tone={state.tone}>{state.word}</Status>
    },
  },
  {
    accessorKey: "site_id",
    // The site the goods came in at is 7Soft's Gudang.
    header: "Gudang",
    size: 130,
    // The client's own name for it. The id stays in `title`, because that is
    // what the account codes carry and what a support call will be about.
    enableSorting: false,
    // The first to step out of compact rows short of room (`onGiveUp`).
    meta: { priority: 3 },
    cell: ({ row }) => <BillSite id={row.original.site_id} />,
  },
  {
    accessorKey: "invoice_date",
    header: "Tanggal",
    size: 120,
    meta: { filter: { kind: "date" }, priority: 2 },
    cell: ({ row }) => day(row.original.invoice_date),
  },
  {
    // The payment term, as 7Soft names it: T21 is twenty-one days. Read off
    // the invoice and due dates — the bill carries no term of its own.
    id: "term",
    accessorFn: (row) => termOf(row),
    header: "Jangka",
    size: 90,
    enableSorting: false,
    meta: { priority: 3 },
    cell: ({ row }) => {
      const term = termOf(row.original)
      return term === null ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="text-body tabular-nums">{term}</span>
      )
    },
  },
  {
    // PPN as 7Soft's list prints it: the tax code the rate implies.
    id: "ppn",
    accessorFn: (row) => ppnCode(row),
    header: "PPN",
    size: 90,
    enableSorting: false,
    meta: { priority: 3 },
    cell: ({ row }) => (
      <span className="text-body tabular-nums">{ppnCode(row.original)}</span>
    ),
  },
  {
    accessorKey: "paid_minor",
    header: "Bayar",
    size: 140,
    enableSorting: false,
    meta: { align: "right" },
    // What has actually left the bank against this bill — POSTED payments
    // only, summed on read. A bill nobody has paid draws a dash rather than
    // "Rp 0" fourteen rows in a row.
    cell: ({ row }) =>
      row.original.paid_minor === 0 ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="text-body tabular-nums">
          <CellMoney minor={row.original.paid_minor} />
        </span>
      ),
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

/// The two marks a bill can wear in a list, and nothing when it wears neither.
///
/// **GA** is the handover: the draft was filed by Operations and is Finance's
/// to inspect, not yet to pay. **On hold** is the hold — the bill is real but
/// nothing may pay it. Both are facts about the row, so they sit under the
/// invoice number rather than in a column a reader has to sort to find.
function BillMarks({ bill }: { bill: SupplierBill }) {
  const fromGa = bill.submitted_by_domain === "GA"
  if (!fromGa && !bill.on_hold) return null
  return (
    <span className="flex flex-wrap gap-1">
      {fromGa && <Pill tone="info">GA</Pill>}
      {bill.on_hold && <Pill tone="warn">On hold</Pill>}
    </span>
  )
}

/// A reference a bill line carries back to the GA record it was bought or
/// worked for, and the door to that record.
///
/// The GA mark is on every one of them on purpose: a line that says "perbaikan
/// AC-114" and does not say who filed it reads as Finance's own note. Each link
/// lands on the record itself — the asset register's sheet, the repair book,
/// the contract, the supply request — so a bill can be checked against what it
/// was for without hunting through a list.
function GaRef({
  to,
  sheetKey,
  value,
  label,
}: {
  to: string
  sheetKey: SheetKey
  value: string
  label: string
}) {
  return (
    <AppLink
      to={to}
      sheet={{ key: sheetKey, value }}
      className="inline-flex items-center gap-1 text-accent hover:underline"
    >
      <Pill tone="info">GA</Pill>
      <span className="truncate">{label}</span>
    </AppLink>
  )
}

/// The GA record a line points at, when it points at one.
///
/// Read from the LINE and never from the header: one bill may carry several
/// lines for different objects, and the header only summarises them (brief
/// §8.1). An asset, a repair, a contract and a supply request are each their
/// own door; `replacement` is carried on the wire but has no screen yet, so it
/// is not drawn rather than drawn as a dead link.
function LineRefs({ line }: { line: SupplierBillLine }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {line.asset_id !== null && (
        <GaRef
          to="/assets"
          sheetKey="asset"
          value={line.asset_id}
          label="Asset"
        />
      )}
      {line.repair_id !== null && (
        <GaRef
          to="/maintenance"
          sheetKey="repair"
          value={line.repair_id}
          label="Repair"
        />
      )}
      {line.contract_id !== null && (
        <GaRef
          to="/contracts"
          sheetKey="contract"
          value={line.contract_id}
          label="Contract"
        />
      )}
      {line.supply_request_id !== null && (
        <GaRef
          to="/supplies"
          sheetKey="supply"
          value={line.supply_request_id}
          label="Supply request"
        />
      )}
    </span>
  )
}

/// Where the account on a line came from, and whether Finance changed it.
///
/// The server suggests an account from the object the line names (§8.2), and
/// `source` is its own words for which level of that order answered — "kelas
/// aset · Air Conditioner", "objek perbaikan · AC & refrigerator". A line whose
/// account was keyed by Finance says so beside it, because an overridden
/// suggestion and a suggested one are different facts about the same code.
function LineSource({ line }: { line: SupplierBillLine }) {
  if (line.source === null && !line.account_overridden) return null
  return (
    <span className="shrink-0 truncate rounded-inner bg-soft-2 px-[0.375rem] text-[0.9375rem] text-body">
      {line.source ?? "GA suggestion"}
      {line.account_overridden && (
        <span className="text-mute"> · changed by Finance</span>
      )}
    </span>
  )
}

/// The expense list: the same columns as merchandise, plus what the bill was
/// for. Spliced in before Status rather than appended, so the two figures a
/// reader compares — what it was for, and what it came to — are not at opposite
/// ends of a wide row.
const deskExpenseColumns: ColumnDef<TableSetup, SupplierBill>[] = [
  ...deskBillColumns.slice(0, 5),
  {
    id: "lines",
    header: "Lines",
    size: 80,
    enableSorting: false,
    meta: { align: "right" },
    cell: ({ row }) => <LineCount id={row.original.invoice_id} />,
  },
  ...deskBillColumns.slice(5),
]

/// A phone draws each row as a card (`cardLead`), made of the columns below
/// and none of the desk's: the desk's are left out of the card (`card:
/// "hide"`) and these are left out of the desk table (`columnVisibility`, set
/// where the table is built).
function onTheDesk<TRow extends RowData>(
  columns: ColumnDef<TableSetup, TRow>[]
): ColumnDef<TableSetup, TRow>[] {
  return columns.map((column) => ({
    ...column,
    meta: { ...column.meta, card: "hide" as const },
  })) as ColumnDef<TableSetup, TRow>[]
}

/// A bill as a card: who it is owed to over the invoice number, what is still
/// owed as the figure, then when it falls due and where it stands.
const billCardColumns: ColumnDef<TableSetup, SupplierBill>[] = [
  {
    id: "head",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-0.5">
        <SupplierName
          id={row.original.supplier_id}
          name={row.original.supplier_name}
          className="block break-words"
        />
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[0.9375rem] font-normal text-mute">
            {row.original.invoice_number}
          </span>
          <BillMarks bill={row.original} />
        </span>
      </span>
    ),
  },
  {
    id: "lead",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => {
      const bill = row.original
      const reserved = bill.allocated_minor - bill.paid_minor
      return (
        <span className="flex flex-col items-end tabular-nums">
          <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
            {money(bill.outstanding_minor)}
          </span>
          <span className="text-[0.9375rem] text-mute">
            {reserved > 0 ? (
              <span className="text-warn-fg">{money(reserved)} in draft</span>
            ) : (
              "owed"
            )}
          </span>
        </span>
      )
    },
  },
  {
    id: "foot",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => {
      const bill = row.original
      return (
        <span className="tabular-nums">
          Due {day(bill.due_date)}
          {isLate(bill) ? (
            <span className="text-bad-fg">
              {" · "}
              {count(bill.days_overdue)}d late
            </span>
          ) : bill.days_overdue < 0 &&
            bill.status.toUpperCase() !== "POSTED" ? (
            ` · in ${-bill.days_overdue}d`
          ) : (
            ""
          )}
        </span>
      )
    },
  },
  {
    id: "state",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "status" },
    cell: ({ row }) => {
      const state = billStatus(row.original)
      return <Status tone={state.tone}>{state.word}</Status>
    },
  },
]

/// The card's own columns are drawn on a phone and never on a desk.
const CARD_COLUMNS = (phone: boolean) => ({
  head: phone,
  lead: phone,
  foot: phone,
  state: phone,
})

/// The bill tables' columns in compact rows (`lib/table-rows.ts`): no Paid
/// (Outstanding is what is left of it), no Overdue (a late due date turns red,
/// `BillDue`), and whatever the card had no room for (`givenUp`, Site then
/// Posting Date) — never a table that scrolls sideways.
const billVisibility = (
  phone: boolean,
  compact: boolean,
  givenUp: readonly string[]
) => ({
  ...CARD_COLUMNS(phone),
  ...(compact
    ? {
        paid_minor: false,
        days_overdue: false,
        term: false,
        ppn: false,
        ...Object.fromEntries(givenUp.map((id) => [id, false])),
      }
    : {}),
})

const billColumns = [...onTheDesk(deskBillColumns), ...billCardColumns]
const expenseColumns = [...onTheDesk(deskExpenseColumns), ...billCardColumns]

const deskUnbilledColumns: ColumnDef<TableSetup, UnbilledReceipt>[] = [
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
    header: "Site",
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
    header: "At Order Price",
    size: 170,
    meta: {
      align: "right",
      filter: { kind: "number", unit: "Rp" },
    },
    // Accepted quantity times the agreed price. What the delivery is worth if
    // the supplier bills what was agreed — deliberately not a bookable figure.
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        <CellMoney minor={row.original.value_at_order_price_minor} />
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

/// A delivery nobody has billed, as a card: the supplier over the receipt, what
/// it is worth at the order price, and how long it has been waiting.
const unbilledCardColumns: ColumnDef<TableSetup, UnbilledReceipt>[] = [
  {
    id: "head",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-0.5">
        <SupplierName
          id={row.original.supplier_id}
          className="block break-words"
        />
        <span className="font-mono text-[0.9375rem] font-normal text-mute">
          {row.original.receipt_number}
        </span>
      </span>
    ),
  },
  {
    id: "lead",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <span className="flex flex-col items-end tabular-nums">
        <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
          {money(row.original.value_at_order_price_minor)}
        </span>
        <span className="text-[0.9375rem] text-mute">at order price</span>
      </span>
    ),
  },
  {
    id: "foot",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span>
          Arrived {day(row.original.arrived_at)} ·{" "}
          {count(row.original.line_count)}{" "}
          {row.original.line_count === 1 ? "line" : "lines"}
        </span>
        <SiteName id={row.original.site_id} />
      </span>
    ),
  },
  {
    id: "state",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "status" },
    cell: ({ row }) => (
      <Status tone={row.original.days_waiting > 30 ? "warn" : "neutral"}>
        {count(row.original.days_waiting)}d waiting
      </Status>
    ),
  },
]

const unbilledColumns = [
  ...onTheDesk(deskUnbilledColumns),
  ...unbilledCardColumns,
]

/// Which of the four lists is on screen.
///
/// Merchandise and Expenses are two *datasets* and not two filters on one, which
/// is why they are sub-tabs: they are settled out of different payables, they
/// are posted by different rules, and only one of them says what it was for. A
/// segmented control here would have claimed they were one list narrowed.
///
/// **Dari GA** is the handover inbox: the same DRAFT expense bills, but the
/// ones Operations filed, asked for on the server (`draft_from=GA`) because
/// "what has GA sent us" is a population rather than a narrowing of the page in
/// hand. It is a fourth tab and not a filter on Expenses for that reason.
type BillTab = "merchandise" | "expenses" | "ga" | "unbilled"

/// 7Soft's bill chips, in its order: every bill, the two payment words the
/// paper carries, the late ones, and the settled ones.
///
/// 7Soft's sixth chip, **Giro bounced**, is not drawn: a bill read carries no
/// bounced-giro state, so a chip that could never match would be a dead
/// control (the gap is on the backend list in the report). The counts 7Soft
/// prints after each word are not drawn either — the register pages on the
/// server and there is no per-word count on the wire.
type BillChip = "all" | "new" | "part" | "overdue" | "lunas"

const BILL_CHIPS: readonly {
  readonly value: BillChip
  readonly label: string
}[] = [
  { value: "all", label: "All" },
  { value: "new", label: NEW },
  { value: "part", label: PART_PAID },
  { value: "overdue", label: "Overdue" },
  { value: "lunas", label: LUNAS },
]

/// Does this bill answer the chip? "Overdue" is 7Soft's own test — still owed
/// and past its date — and not one of the payment words.
function matchesChip(bill: SupplierBill, chip: BillChip): boolean {
  if (chip === "all") return true
  if (chip === "overdue") return isLate(bill)
  const word = billStatus(bill).word
  return chip === "new"
    ? word === NEW
    : chip === "part"
      ? word === PART_PAID
      : word === LUNAS
}

/// How many bills one page of a register tab asks for. A step, not a
/// ceiling: the table asks for the next page as its last rows scroll into
/// view. The unbilled tab does not page — `GET /finance/unbilled` takes no
/// limit and answers whole.
const PAGE = 100

/// The columns the server can order a bill list by, the word it knows each
/// one as, and whether the direction flips on the way.
///
/// `days_overdue` is the one that flips: the server has no "overdue" sort,
/// but it has `due`, which orders by the date the balance next falls due —
/// and the most overdue bill is the one whose due date is earliest. Every
/// other column carries `enableSorting: false`.
const BILL_SORTS: Record<string, { sort: string; flip?: boolean }> = {
  supplier: { sort: "supplier" },
  invoice_date: { sort: "date" },
  due_date: { sort: "due" },
  total_minor: { sort: "total" },
  outstanding_minor: { sort: "outstanding" },
  days_overdue: { sort: "due", flip: true },
}

/// The sort, the search and the status clause as the request that answers
/// them. Status is the one column clause `GET /bills` can take; the same
/// clause still runs in the browser, where it can only agree.
function billScope(
  sorting: SortingState,
  filters: readonly Filter[],
  needle: string
): { sort?: string; dir?: string; status?: string; q?: string } {
  const by = sorting[0]
  const known = by === undefined ? undefined : BILL_SORTS[by.id]
  const desc = known?.flip === true ? by?.desc !== true : by?.desc === true
  const status = filters.find(
    (filter) =>
      filter.column === "status" &&
      filter.operator === "isAnyOf" &&
      filter.values.length > 0
  )
  // The column says 7Soft's words (New, Part paid, Lunas); the server knows
  // three of them as one status, POSTED, and the table narrows the rest.
  const asked = status
    ? [
        ...new Set(
          status.values.map(
            (value) => SERVER_STATUS_OF_WORD[value] ?? value.toUpperCase()
          )
        ),
      ].join(",")
    : undefined
  return {
    sort: known?.sort,
    dir: known !== undefined && desc ? "desc" : undefined,
    status: asked,
    q: needle === "" ? undefined : needle,
  }
}

export function SupplierBills() {
  const supplierName = useSupplierName()
  const phone = useLayout() === "phone"
  const compact = useCompactRows()
  /// The bill columns the merchandise table gave up for room in compact rows.
  const [givenUp, setGivenUp] = useState<readonly string[]>([])
  const giveUp = useCallback(
    (ids: readonly string[]) =>
      setGivenUp((was) => (was.join() === ids.join() ? was : ids)),
    []
  )
  const [tab, setTab] = useState<BillTab>("merchandise")
  /// 7Soft's bill chips — one question, every answer on view. They narrow the
  /// pages in hand; the server keeps ordering by due date, so the late bills
  /// are the first ones read either way.
  const [chip, setChip] = useState<BillChip>("all")
  const [query, setQuery] = useState("")
  const [unit, setUnit] = useState("")
  const [recording, setRecording] = useState(false)
  const bill = useSheet("bill")
  /// A unit's bills are the bills at its sites — a bill stays at the site it
  /// was received at — so the unit goes on the wire as its sites, one `site`,
  /// comma-separated, which the server reads as a list (Accounts Payable asks
  /// the same way). The picker says "unit", like every other Finance screen.
  const units = useUnits()
  const site =
    unit === ""
      ? ""
      : (units.data?.find((one) => one.id === unit)?.sites ?? [])
          .map((one) => one.id)
          .join(",")
  /// A unit whose sites are not known yet must not read as every site.
  const unitReady = unit === "" || site !== ""
  const [billSort, setBillSort] = useState<SortingState>([
    { id: "days_overdue", desc: true },
  ])
  const [expenseSort, setExpenseSort] = useState<SortingState>([
    { id: "days_overdue", desc: true },
  ])
  const [waitSort, setWaitSort] = useState<SortingState>([
    { id: "days_waiting", desc: true },
  ])

  /// Three lists, one panel, two keys.
  ///
  /// One panel because there is only ever one — it is the shell's right column
  /// and a single URL flag, so the tab decides which model it is driving
  /// rather than each tab drawing its own.
  ///
  /// Two keys because two of the three are the same shape. Merchandise and
  /// Expenses share every column id, so a clause set on one is meaningful on
  /// the other and rides across in `?f=`. Unbilled deliveries are a different
  /// shape entirely — no status, no supplier name, a different date — and
  /// share `?f=` with nobody: on one key its clauses and the bills' would take
  /// turns overwriting each other, since each model writes back only the
  /// clauses it recognises.
  const billFilters = useFilters(billColumns)
  const expenseFilters = useFilters(expenseColumns)
  const waitFilters = useFilters(unbilledColumns, "f2")

  /// Debounced, because every keystroke is a round trip over the bills.
  const needle = useDebounced(query.trim(), 400)

  // Each tab pages on its own, narrowed on the SERVER by kind, location,
  // search, status and order. They used to be one read of the newest two
  // hundred bills split by kind and location in the browser, which left the
  // expense tab holding whatever expense bills happened to fall in that page.
  const billAsk = {
    ...billScope(billSort, billFilters.filters, needle),
    kind: "MERCHANDISE",
    site: site || undefined,
    limit: PAGE,
  }
  const bills = useInfiniteQuery({
    queryKey: [...financeKeys.bills(null, site || null), "pages", billAsk],
    queryFn: ({ pageParam, signal }) =>
      listBills({ ...billAsk, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // The previous answer stays on screen while the next is fetched. Without
    // it every keystroke empties the table to a loading line.
    placeholderData: (previous) => previous,
    enabled: unitReady,
  })
  const expenseAsk = {
    ...billScope(expenseSort, expenseFilters.filters, needle),
    kind: "EXPENSE",
    site: site || undefined,
    limit: PAGE,
  }
  const expenses = useInfiniteQuery({
    queryKey: [...financeKeys.bills(null, site || null), "pages", expenseAsk],
    queryFn: ({ pageParam, signal }) =>
      listBills({ ...expenseAsk, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
    enabled: unitReady,
  })
  /// The inbox, narrowed on the SERVER: `draft_from=GA` asks the node for the
  /// drafts Operations filed. Its status is fixed at DRAFT, so a status clause
  /// on the shared expense model narrows it in the browser only.
  const gaAsk = {
    ...billScope(expenseSort, [], needle),
    status: "DRAFT",
    draftFrom: "GA",
    site: site || undefined,
    limit: PAGE,
  }
  const gaBills = useInfiniteQuery({
    queryKey: [
      ...financeKeys.bills("DRAFT", site || null, "GA"),
      "pages",
      gaAsk,
    ],
    queryFn: ({ pageParam, signal }) =>
      listBills({ ...gaAsk, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
    // Fetched when the inbox is opened, not on every visit to this screen:
    // most mornings nobody is looking at what GA filed, and a fourth list is
    // a fourth request.
    enabled: tab === "ga" && unitReady,
  })
  const unbilled = useQuery({
    queryKey: financeKeys.unbilled(),
    queryFn: ({ signal }) => unbilledReceipts(signal),
  })

  /// 7Soft's four bill figures, over the posted book the register draws from.
  ///
  /// The list pages, so a sum of the pages in hand would be a figure that
  /// grows as somebody scrolls — the four cards read the open invoices whole,
  /// once, the way the Payment Projection already does.
  const book = useQuery(
    projectionBillsQuery("POSTED", site === "" ? undefined : site)
  )
  const openBills = useMemo(
    () => (book.data ?? []).filter((one) => one.outstanding_minor > 0),
    [book.data]
  )
  const today = todayIso()
  const dueBy = addDays(today, 7)
  const owed = openBills.reduce((sum, one) => sum + one.outstanding_minor, 0)
  const dueWeek = openBills.filter((one) => {
    const due = one.next_due_date ?? one.due_date
    return due !== null && due >= today && due <= dueBy
  })
  const lateBills = openBills.filter(isLate)

  /// Each bill's supplier written in full, "Maju Jaya, UD" — the cell, the
  /// search and the supplier facet all read the row's name.
  const written = (row: SupplierBill): SupplierBill => ({
    ...row,
    supplier_name: supplierName(row.supplier_id, row.supplier_name),
  })
  const billRows = useMemo(
    () => bills.data?.pages.flatMap((page) => page.rows.map(written)) ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bills.data, supplierName]
  )
  /// The chip narrows the pages in hand. "Nothing recorded" and "nothing
  /// matches the chip" are different answers, so the empty states below ask
  /// both questions.
  const visibleBills = useMemo(
    () =>
      chip === "all"
        ? billRows
        : billRows.filter((one) => matchesChip(one, chip)),
    [billRows, chip]
  )
  const expenseRows = useMemo(
    () => expenses.data?.pages.flatMap((page) => page.rows.map(written)) ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses.data, supplierName]
  )
  const gaRows = useMemo(
    () => gaBills.data?.pages.flatMap((page) => page.rows.map(written)) ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gaBills.data, supplierName]
  )
  /// The server's own counts — every bill each tab's request matches, never
  /// the length of the pages loaded so far.
  const expenseHeld = expenses.data?.pages[0]?.total ?? 0
  const gaHeld = gaBills.data?.pages[0]?.total ?? 0
  /// Unbilled deliveries answer whole, so the unit's sites are applied here.
  const waitRows = useMemo(() => {
    const sites = site === "" ? null : new Set(site.split(","))
    return (unbilled.data ?? []).filter(
      (row) => sites === null || sites.has(row.site_id)
    )
  }, [unbilled.data, site])

  /// Whether the search or a column clause is narrowing a bill tab —
  /// "nothing recorded" and "nothing matches" have different fixes.
  const billNarrowed =
    needle !== "" || billFilters.filters.length > 0 || chip !== "all"
  const expenseNarrowed = needle !== "" || expenseFilters.filters.length > 0
  const clearBills = () => {
    setQuery("")
    setChip("all")
    billFilters.clear()
  }
  const clearExpenses = () => {
    setQuery("")
    expenseFilters.clear()
  }

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

  // The bill tables take their order and their search from the request, so
  // neither is done again here: sorting or searching the pages in hand and
  // calling it the register is the mistake infinite scroll invites.
  const billTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: visibleBills,
        columns: billFilters.columns,
        getRowId: (row: SupplierBill) => row.invoice_id,
        state: {
          columnFilters: billFilters.columnFilters,
          columnVisibility: billVisibility(phone, compact, givenUp),
          sorting: billSort,
        },
        manualSorting: true,
        onSortingChange: setBillSort,
      }),
      [
        visibleBills,
        billFilters.columns,
        billFilters.columnFilters,
        billSort,
        phone,
        compact,
        givenUp,
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
          columnVisibility: billVisibility(phone, compact, []),
          sorting: expenseSort,
        },
        manualSorting: true,
        onSortingChange: setExpenseSort,
      }),
      [
        expenseRows,
        expenseFilters.columns,
        expenseFilters.columnFilters,
        expenseSort,
        phone,
        compact,
      ]
    )
  )

  /// The GA inbox's table, and deliberately the SAME filter model and sort as
  /// Expenses: a GA draft is an expense bill, so every column and clause a
  /// reader set on Expenses means the same here, and a second model would let
  /// the two tabs' clauses overwrite each other in `?f=`. Only the rows differ,
  /// and they came from the server already narrowed.
  const gaTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: gaRows,
        columns: expenseFilters.columns,
        getRowId: (row: SupplierBill) => row.invoice_id,
        state: {
          columnFilters: expenseFilters.columnFilters,
          columnVisibility: billVisibility(phone, compact, []),
          sorting: expenseSort,
        },
        manualSorting: true,
        onSortingChange: setExpenseSort,
      }),
      [
        gaRows,
        expenseFilters.columns,
        expenseFilters.columnFilters,
        expenseSort,
        phone,
        compact,
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
          columnVisibility: CARD_COLUMNS(phone),
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
        phone,
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

  return (
    <PageContent>
      {/* The one action stands in the head; on a phone "Record bill" is the
          round + over the bottom bar. */}
      <PageHeader
        crumb="Finance · Payables"
        title="Bills"
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setRecording(true)}>
              Record bill
            </Button>
          )
        }
      />
      <Fab label="Record bill" onClick={() => setRecording(true)} />

      {/* Four datasets, not four slices of one. Goods for resale and the
          electricity bill are settled out of different payables and posted by
          different rules; an unbilled receipt is a document the supplier has
          not sent at all; the GA inbox is a handover, asked for on the server
          because it is a population rather than a page. */}

      <Toolbar
        className="group/bar"
        lead={
          <SubTabs
            value={tab}
            onChange={(next) => setTab(next as BillTab)}
            tabs={[
              { value: "merchandise", label: "Merchandise" },
              {
                value: "expenses",
                label: `Expenses${expenseHeld > 0 ? ` · ${count(expenseHeld)}` : ""}`,
              },
              {
                value: "ga",
                label: `From GA${gaHeld > 0 ? ` · ${count(gaHeld)}` : ""}`,
              },
              {
                value: "unbilled",
                label: `Unbilled deliveries${waitRows.length > 0 ? ` · ${waitRows.length}` : ""}`,
              },
            ]}
          />
        }
      >
        {tab === "merchandise" && (
          <FilterChips
            label="Status"
            value={chip === "all" ? null : chip}
            options={BILL_CHIPS.map((one) => ({
              value: one.value === "all" ? null : one.value,
              label: one.label,
            }))}
            onChange={(next) => setChip((next ?? "all") as BillChip)}
          />
        )}
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
        {/* Whichever list is on screen. The unit is not among the questions
            inside it: the select beside this already narrows all of them, and
            a second copy in the panel would move the table and leave the
            select describing somewhere else. */}
        <FilterPanel
          model={
            tab === "unbilled"
              ? waitFilters
              : tab === "expenses" || tab === "ga"
                ? expenseFilters
                : billFilters
          }
          table={
            tab === "unbilled"
              ? waitTable
              : tab === "expenses"
                ? expenseTable
                : tab === "ga"
                  ? gaTable
                  : billTable
          }
          search={{ value: query, onChange: setQuery, label: "Search bills" }}
        />
      </Toolbar>

      {/* 7Soft's four bill figures, in its order, over every open bill. The
          first three press through to the list they count; "To check" reads
          "—" because nothing on the wire says which bills Finance flagged
          (see the backend list in the report) — it is drawn rather than left
          out so the gap is visible. */}
      {tab === "merchandise" && (
        <KpiStrip className="xl:grid-cols-4">
          <Kpi
            label="Owed"
            value={money(owed)}
            onClick={() => setChip("all")}
          />
          <Kpi
            label="Due this week"
            value={`${count(dueWeek.length)} · ${money(
              dueWeek.reduce((sum, one) => sum + one.outstanding_minor, 0)
            )}`}
          />
          <Kpi
            label="Overdue"
            value={
              <span
                className={lateBills.length > 0 ? "text-bad-fg" : undefined}
              >
                {`${count(lateBills.length)} · ${money(
                  lateBills.reduce((sum, one) => sum + one.outstanding_minor, 0)
                )}`}
              </span>
            }
            onClick={() => setChip("overdue")}
          />
          <Kpi label="To check" value="—" />
        </KpiStrip>
      )}

      {tab === "merchandise" ? (
        <>
          <Card
            aria-busy={bills.isPlaceholderData || undefined}
            className="list-swap overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
          >
            {queryState(bills, {
              loading: "Loading the bills…",
              refused,
              render: () =>
                visibleBills.length === 0 && billNarrowed ? (
                  <NoMatch what="bills" onClear={clearBills} />
                ) : visibleBills.length === 0 ? (
                  <EmptyState
                    action={
                      // Those deliveries are owed already (Total payables
                      // counts them); what they lack is their bill, so say
                      // where they are rather than leave the list at nothing.
                      waitRows.length > 0 ? (
                        <Button
                          variant="ghost"
                          onClick={() => setTab("unbilled")}
                        >
                          {count(waitRows.length)} unbilled{" "}
                          {waitRows.length === 1 ? "delivery" : "deliveries"}
                        </Button>
                      ) : undefined
                    }
                  >
                    {unit === ""
                      ? "No supplier invoice has been recorded yet."
                      : "No supplier invoice has been recorded for this unit."}
                  </EmptyState>
                ) : (
                  <DataTable<SupplierBill>
                    refresh={[bills]}
                    table={billTable}
                    pageScroll={phone}
                    cardsApart
                    cardLead
                    cardSort={false}
                    onRowClick={(row) => bill.open(row.invoice_id)}
                    isSelected={(row) => row.invoice_id === bill.value}
                    // What the column clauses leave of the pages in hand. The
                    // table keeps asking for pages while this shows, so it is
                    // only final once the list has been read to its end.
                    empty={<NoMatch what="bills" onClear={clearBills} />}
                    more={bills}
                    onGiveUp={compact ? giveUp : undefined}
                    // Compact rows run the card nearer the page's foot.
                    className={
                      phone
                        ? undefined
                        : compact
                          ? "max-h-[calc(100dvh-19rem)]"
                          : "max-h-[calc(100dvh-21rem)]"
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
          <Banner tone="info" className="mb-3 max-md:hidden">
            Costs rather than goods for resale — rent, electricity, a repair,
            and the capital purchases an asset is bought by. Each one names the
            accounts its cost belongs to, and those lines are what the posting
            debits. They settle out of{" "}
            <AppLink
              to="/finance/setup/account-links"
              sheet={{ key: "mapping", value: "non_merchandise_payable" }}
              className="text-accent hover:underline"
            >
              non-merchandise payable
            </AppLink>
            , not trade payable.
          </Banner>
          <Card
            aria-busy={expenses.isPlaceholderData || undefined}
            className="list-swap overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
          >
            {queryState(expenses, {
              loading: "Loading the bills…",
              refused,
              render: () =>
                expenseRows.length === 0 && expenseNarrowed ? (
                  <NoMatch what="expense bills" onClear={clearExpenses} />
                ) : expenseRows.length === 0 ? (
                  <EmptyState>
                    {unit === ""
                      ? "No expense bill has been recorded yet. Record one with “Record bill” and switch its kind to Expense."
                      : "No expense bill has been recorded for this unit."}
                  </EmptyState>
                ) : (
                  <DataTable<SupplierBill>
                    refresh={[expenses]}
                    table={expenseTable}
                    pageScroll={phone}
                    cardsApart
                    cardLead
                    cardSort={false}
                    onRowClick={(row) => bill.open(row.invoice_id)}
                    isSelected={(row) => row.invoice_id === bill.value}
                    empty={
                      <NoMatch what="expense bills" onClear={clearExpenses} />
                    }
                    more={expenses}
                    className={phone ? undefined : "max-h-[calc(100dvh-25rem)]"}
                  />
                ),
            })}
          </Card>
        </>
      ) : tab === "ga" ? (
        <>
          <Card
            aria-busy={gaBills.isPlaceholderData || undefined}
            className="list-swap overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
          >
            {queryState(gaBills, {
              loading: "Reading the drafts from GA…",
              refused,
              render: () => {
                /// The server's own count for what was asked — the difference
                /// between "GA has sent nothing" and "there are drafts and none
                /// of them match".
                if (gaHeld === 0 && needle !== "") {
                  return (
                    <NoMatch what="draft from GA" onClear={clearExpenses} />
                  )
                }
                if (gaHeld === 0) {
                  return <EmptyState>No drafts from GA.</EmptyState>
                }
                return (
                  <DataTable<SupplierBill>
                    refresh={[gaBills]}
                    table={gaTable}
                    pageScroll={phone}
                    cardsApart
                    cardLead
                    cardSort={false}
                    onRowClick={(row) => bill.open(row.invoice_id)}
                    isSelected={(row) => row.invoice_id === bill.value}
                    // "GA has sent nothing" is the sentence above; this is
                    // "there are some, and none of them match what you typed".
                    empty={
                      <NoMatch what="draft from GA" onClear={clearExpenses} />
                    }
                    more={gaBills}
                    className={phone ? undefined : "max-h-[calc(100dvh-25rem)]"}
                  />
                )
              },
            })}
          </Card>
        </>
      ) : (
        <>
          <Banner tone="info" className="mb-3">
            <span className="font-semibold tabular-nums">
              {money(exposure)}
            </span>{" "}
            at the order price, accepted quantity. These deliveries are already
            owed — they are in Total payables — and the bill, when it comes,
            replaces them.
          </Banner>
          {/* The one tab that does not page, and that is the finding rather
              than an omission: `unbilledReceipts()` sends no `limit`, so the
              list is whole and the exposure in the banner above is a total. */}
          <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            {queryState(unbilled, {
              loading: "Looking for unbilled deliveries…",
              refused,
              render: () =>
                waitRows.length === 0 ? (
                  <EmptyState>
                    {unit === ""
                      ? "Every delivery has a bill against it."
                      : "Every delivery to this unit has a bill against it."}
                  </EmptyState>
                ) : (
                  <DataTable<UnbilledReceipt>
                    refresh={[unbilled]}
                    table={waitTable}
                    pageScroll={phone}
                    cardsApart
                    cardLead
                    cardSort={false}
                    empty={
                      <NoMatch
                        what="deliveries"
                        held={waitRows.length}
                        onClear={() => setQuery("")}
                      />
                    }
                    className={phone ? undefined : "max-h-[calc(100dvh-25rem)]"}
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
    queryFn: ({ signal }) => listBills({}, signal).then((page) => page.rows),
    enabled: id !== null,
  })

  // What has been paid against it. The whole register under the key the
  // Payments screen owns, filtered here — there is no per-bill payments
  // endpoint, and asking for one supplier's payments would still not answer
  // "this invoice" because a payment can settle several bills at once.
  const payments = useQuery({
    queryKey: financeKeys.payments(null, null, null),
    queryFn: ({ signal }) =>
      listPayments({ limit: 200 }, signal).then((page) => page.rows),
    enabled: id !== null,
  })

  /// The register this screen already holds, if it carries this bill.
  const listed = bills.data?.find((row) => row.invoice_id === id)

  /// The GA inbox, asked only when the register cannot answer.
  ///
  /// A GA draft is a DRAFT expense bill, and the register is one page of two
  /// hundred — so the one row the inbox sent somebody to open may simply not be
  /// on it. This is the fallback, under the inbox's own key, so opening a row
  /// from the Dari GA tab costs nothing (the screen already holds the answer)
  /// and opening it from anywhere else costs one list read rather than a sheet
  /// that says "no bill is recorded under that id". `isSuccess` keeps it from
  /// firing while the register is still loading and the answer may already be
  /// on its way.
  const inbox = useQuery({
    queryKey: financeKeys.bills("DRAFT", null, "GA"),
    queryFn: ({ signal }) =>
      listBills({ status: "DRAFT", draftFrom: "GA" }, signal).then(
        (page) => page.rows
      ),
    enabled: id !== null && bills.isSuccess && listed === undefined,
  })
  const fromLists = listed ?? inbox.data?.find((row) => row.invoice_id === id)

  // What the bill was for, read one bill at a time. For an expense bill:
  // a merchandise bill has no lines by construction — what it debits is decided
  // by the posting rule, not by the person keying it — so asking would be a
  // request whose only possible answer is an empty array.
  //
  // And for any bill neither list carries. Both are pages of two hundred, and
  // the register pages now, so a bill opened from a cross-link or a pasted URL
  // can be older than either; the per-bill read answers it whatever its age.
  const detail = useBill(
    id,
    fromLists?.kind === "EXPENSE" ||
      (inbox.isSuccess && fromLists === undefined)
  )
  const bill = fromLists ?? detail.data
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

  const status = bill?.status?.toUpperCase() ?? ""
  const posted = status === "POSTED"
  const fromGa = bill?.submitted_by_domain === "GA"
  const held = bill?.on_hold === true

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "bill", id }}
      onOpenChange={(next) => !next && onClose()}
      id={bill?.invoice_number}
      title={
        bill === undefined
          ? "Bill"
          : supplierName(bill.supplier_id, bill.supplier_name)
      }
      footer={
        bill && !posted ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.9375rem] text-mute">
              {held
                ? "A held bill cannot be posted until it is released."
                : "Posts on the invoice date unless the month is closed."}
            </span>
            <Button
              variant="primary"
              // Held is a refusal the server makes, and paying the reader the
              // sentence before they press is better than a red banner after.
              // No warning ever reaches this button: warnings are not blocks.
              pending={post.isPending}
              disabled={held}
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
            // The register does not carry it and the inbox is still answering:
            // saying "no bill is recorded" now would be a lie in progress.
            inbox.isPending || inbox.isFetching || detail.isFetching ? (
              <LoadingState>Loading the bill…</LoadingState>
            ) : (
              <EmptyState>No bill is recorded under that id.</EmptyState>
            )
          ) : (
            <div className="flex flex-col gap-5">
              {post.isError && (
                <Banner tone="bad">
                  {post.error instanceof Error
                    ? post.error.message
                    : "The bill could not be posted."}
                </Banner>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                <Status tone={billStatus(bill).tone}>
                  {billStatus(bill).word}
                </Status>
                {/* Which kind, always — it decides what the posting debits,
                    and a bill that says nothing about it reads as merchandise
                    to anybody who has met only merchandise. */}
                <Pill tone={bill.kind === "EXPENSE" ? "info" : "neutral"}>
                  {bill.kind === "EXPENSE" ? "Expense" : "Merchandise"}
                </Pill>
                {/* Where it came from and whether it may be paid. Both are
                    properties of the document, so they sit with its state. */}
                {fromGa && <Pill tone="info">GA</Pill>}
                {held && <Pill tone="warn">On hold</Pill>}
                {isLate(bill) && (
                  <Pill tone="bad">
                    {count(bill.days_overdue)} days overdue
                  </Pill>
                )}
              </div>

              {/* A returned draft is not gone. Said on the record, because the
                  one reader who needs it is the one deciding whether to post it
                  or send it back again. */}
              {bill.returned_reason !== null && (
                <Banner tone="warn">
                  Returned to GA: {bill.returned_reason}. The bill keeps its id
                  and its GA mark and stays a draft — a return asks Operations
                  to fix it, it does not delete it.
                </Banner>
              )}

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
                    <p className="text-[0.9375rem] text-mute">
                      {detail.isPending
                        ? "Reading the lines…"
                        : isMissingRead(detail.error)
                          ? "This node does not answer the per-bill read yet, so what the bill was for cannot be shown here. The posting on the journal entry says the same thing, account by account."
                          : "The lines could not be read."}
                    </p>
                  ) : (
                    <MiniTable head={["Account", "Site", "Amount"]}>
                      {lines.map((line) => (
                        <MiniRow key={line.line_id}>
                          <MiniCell>
                            <span className="flex min-w-0 flex-col gap-1">
                              <span className="flex min-w-0 items-center gap-1.5">
                                {/* The code opens the ledger — what has
                                    happened in this account — and the client's
                                    own name for it is never translated. */}
                                <AppLink
                                  to="/finance/accounting/general-ledger"
                                  sheet={{
                                    key: "account",
                                    value: line.account_code,
                                  }}
                                  className="shrink-0 font-mono text-[0.9375rem] text-mute hover:text-accent hover:underline"
                                >
                                  {line.account_code}
                                </AppLink>
                                <span className="min-w-0 flex-1 truncate text-ink">
                                  {line.account_name}
                                  {/* What the line was for. Three expense
                                      accounts now carry every cost this client
                                      has, so a bill whose four lines all read
                                      "Beban umum & administrasi" is unreadable
                                      without this. */}
                                  {line.category_name !== null && (
                                    <span
                                      className="text-mute"
                                      title={line.category_code ?? undefined}
                                    >
                                      {" · "}
                                      {line.category_name}
                                    </span>
                                  )}
                                </span>
                                {/* Where the account came from, in the
                                    server's own words, and whether Finance
                                    keyed it instead. */}
                                <LineSource line={line} />
                              </span>
                              {line.memo && (
                                <span className="block text-[0.9375rem] text-mute">
                                  {line.memo}
                                </span>
                              )}
                              {/* What the line was for on GA's side — the
                                  record it was bought or worked for. One bill
                                  may carry several, one per line. */}
                              <LineRefs line={line} />
                            </span>
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

              {/* The header 7Soft's Faktur Pembelian opens with, in its order and
                  its words: No Faktur is the sheet's own title, then Tanggal,
                  Supplier, Jangka waktu, Jatuh tempo, Tipe invoice, Gudang,
                  Total diskon (in the totals below), PPN and Keterangan. The
                  client's own name for the supplier, with its code beside it —
                  the code is what 7Soft shows and what the ledgers are keyed
                  by. */}
              <Facts>
                <Fact term="Tanggal">{day(bill.invoice_date)}</Fact>
                <Fact term="Supplier">
                  <SupplierName
                    id={bill.supplier_id}
                    name={bill.supplier_name}
                  />
                  <span className="text-mute"> · {bill.supplier_id}</span>
                </Fact>
                <Fact term="Jangka waktu">{termOf(bill) ?? "—"}</Fact>
                <Fact term="Jatuh tempo">{day(bill.due_date)}</Fact>
                {/* Matching when the bill was tied to the deliveries it
                    answers (three-way), Standard when it was not. 7Soft's third
                    type, Uang Muka, is an advance here — its own document,
                    set against a bill below. */}
                <Fact term="Tipe invoice">
                  {bill.matched_at !== null ? "Matching" : "Standard"}
                </Fact>
                <Fact term="Gudang">
                  <SiteName id={bill.site_id} />
                </Fact>
                <Fact term="PPN">{ppnCode(bill)}</Fact>
                {bill.note && <Fact term="Keterangan">{bill.note}</Fact>}
                <Fact term="Currency">{bill.currency}</Fact>
                <Fact term="Recorded by">{bill.recorded_by}</Fact>
                {bill.posted_by && (
                  <Fact term="Posted by">{bill.posted_by}</Fact>
                )}
                {bill.entry_number && bill.journal_entry_id && (
                  <Fact term="Journal">
                    <AppLink
                      to="/finance/accounting/journal-entries"
                      sheet={{ key: "entry", value: bill.journal_entry_id }}
                      className="font-mono text-id text-accent hover:underline"
                    >
                      {bill.entry_number}
                    </AppLink>
                  </Fact>
                )}
              </Facts>

              {/* Detail: what the paper lists, read from the bill. Typing the
                  lines is receiving's job in Procurement, not Finance's. */}
              <BillItems bill={bill} />

              <TotalsLadder
                rows={[
                  { label: "Total", value: money(bill.subtotal_minor) },
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
                          label: "Total diskon",
                          value: money(
                            bill.discount_minor === 0 ? 0 : -bill.discount_minor
                          ),
                        },
                      ]),
                  { label: "PPN", value: money(bill.tax_minor) },
                  { label: "Grand total", value: money(bill.total_minor) },
                  {
                    label: "Total bayar",
                    value: money(bill.paid_minor === 0 ? 0 : -bill.paid_minor),
                  },
                ]}
                total={{
                  label: "Sisa",
                  value: money(bill.outstanding_minor),
                }}
              />

              {/* Uang Muka: the advances paid to this supplier before the bill
                  came, those already set against it, and the act of setting
                  one. */}
              <BillAdvances bill={bill} />

              {/* Pelunasan: what has been paid against this bill, one click
                  from each payment. Drawn only when there is something — a
                  heading over an empty table says "no payments" twice. */}
              {against.length > 0 && (
                <div>
                  <SubHead
                    aside={
                      bill.allocated_minor > bill.paid_minor
                        ? `${money(bill.allocated_minor - bill.paid_minor)} of it still in draft`
                        : undefined
                    }
                  >
                    Pelunasan
                  </SubHead>
                  <MiniTable
                    head={["Voucher", "Kas/Bank", "Bayar", "Potongan"]}
                  >
                    {against.map(({ payment, allocation }) => (
                      <MiniRow key={payment.payment_id}>
                        <MiniCell>
                          {/* The payment itself, not the register it is on.
                              `payment` is a key in `lib/sheets.ts` now, so
                              this opens the record rather than landing
                              somebody on a list with a number to find. */}
                          <AppLink
                            to="/finance/payables/payments"
                            sheet={{
                              key: "payment",
                              value: payment.payment_id,
                            }}
                            className="block font-mono text-[0.9375rem] text-accent hover:underline"
                          >
                            {payment.payment_number}
                          </AppLink>
                          <span className="text-[0.9375rem] text-mute">
                            {day(payment.payment_date)}
                          </span>
                        </MiniCell>
                        <MiniCell>
                          <span className="block text-ink">
                            {payment.account_name ?? label(payment.method)}
                          </span>
                          {payment.reference && (
                            <span className="text-[0.9375rem] text-mute">
                              No reff {payment.reference}
                            </span>
                          )}
                        </MiniCell>
                        <MiniCell align="right">
                          <span className="block text-ink">
                            {money(
                              allocation.amount_minor -
                                allocation.discount_minor
                            )}
                          </span>
                          {payment.status.toUpperCase() !== "POSTED" && (
                            <span className="text-[0.9375rem] text-warn-fg">
                              {label(payment.status)}
                            </span>
                          )}
                        </MiniCell>
                        <MiniCell align="right">
                          {allocation.discount_minor === 0 ? (
                            <span className="text-faint">—</span>
                          ) : (
                            money(allocation.discount_minor)
                          )}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                </div>
              )}

              {/* Holding, returning and the checks that precede a posting are
                  their own component, keyed by the bill: three drafts and a
                  warning check belong to the record on screen, and the remount
                  is what stops a reason typed for one being sent against the
                  next. See `<BillHandover>`. */}
              <BillHandover key={id!} id={id!} bill={bill} />
            </div>
          ),
      })}
    </Sheet>
  )
}

/// 7Soft's Detail tab: the item lines the paper lists — name, quantity, price,
/// total. Read from `GET /finance/bills/{id}/lines`; they were written by
/// receiving and matching, so nothing here edits them. An expense bill's own
/// lines are "What it was for" above.
function BillItems({ bill }: { bill: SupplierBill }) {
  const expense = bill.kind === "EXPENSE"
  const lines = useQuery({
    queryKey: financeKeys.billLines(bill.invoice_id),
    queryFn: ({ signal }) => billItemLines(bill.invoice_id, signal),
    enabled: !expense,
    retry: false,
    staleTime: 60_000,
  })
  const rows = lines.data ?? []
  if (expense || rows.length === 0) return null
  return (
    <div>
      <SubHead
        aside={`${count(rows.length)} ${rows.length === 1 ? "line" : "lines"}`}
      >
        Detail
      </SubHead>
      <MiniTable head={["Nama item", "Jml", "Harga", "Total"]}>
        {rows.map((line) => (
          <MiniRow key={line.line_number}>
            <MiniCell>
              <span className="block break-words text-ink">
                {line.description}
              </span>
            </MiniCell>
            <MiniCell align="right">{count(line.quantity)}</MiniCell>
            <MiniCell align="right">{money(line.unit_price_minor)}</MiniCell>
            <MiniCell align="right">{money(line.line_amount_minor)}</MiniCell>
          </MiniRow>
        ))}
      </MiniTable>
    </div>
  )
}

/// 7Soft's Uang Muka tab and its Apply Uang Muka button, and the "Sisa uang
/// muka" line under the bill.
///
/// An advance is money paid to the supplier against an order before there was
/// a bill (`supplier-advances`); applying one sets it against this bill, on its
/// own date, and the server refuses another supplier's, another unit's or one
/// of another currency. Which advances have already been set against THIS bill
/// is read from the payment ledger — the bill's settlements — and each one is
/// then asked for by id; the list of advances that can still be applied is the
/// supplier's open ones. Nothing is drawn for a bill with neither.
function BillAdvances({ bill }: { bill: SupplierBill }) {
  const client = useQueryClient()
  const posted = bill.status.toUpperCase() === "POSTED"
  const settled = useQuery({
    queryKey: financeKeys.billSettlements(bill.invoice_id),
    queryFn: ({ signal }) => billSettlements(bill.invoice_id, signal),
    enabled: posted,
    retry: false,
    staleTime: 30_000,
  })
  /// One row per advance, however many times it was set against the bill.
  const applied = [
    ...(settled.data?.settlements ?? [])
      .filter(
        (row) =>
          !row.delinked &&
          row.against_voucher_kind.toUpperCase().includes("ADVANCE")
      )
      .reduce(
        (by, row) =>
          by.set(
            row.against_voucher_id,
            (by.get(row.against_voucher_id) ?? 0) + row.amount_minor
          ),
        new Map<string, number>()
      ),
  ]
  const details = useQueries({
    queries: applied.map(([advanceId]) => ({
      queryKey: financeKeys.advance(advanceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        supplierAdvance(advanceId, signal),
      staleTime: 60_000,
      retry: false,
    })),
  })
  /// The supplier's advances with money still in them — the same read and key
  /// as a BKK's Offset tab.
  const open = useQuery({
    queryKey: [...financeKeys.all, "supplier-advances", bill.supplier_id],
    queryFn: ({ signal }) =>
      openAdvances(bill.supplier_id, signal).then((rows) =>
        rows.filter(
          (row) => row.status === "POSTED" && row.outstanding_minor > 0
        )
      ),
    enabled: posted,
    staleTime: 60_000,
  })
  const advances = open.data ?? []
  const left = advances.reduce((sum, row) => sum + row.outstanding_minor, 0)
  if (applied.length === 0 && advances.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      <div>
        <SubHead aside={`Sisa uang muka ${money(left)}`}>Uang muka</SubHead>
        {applied.length > 0 && (
          <MiniTable head={["No faktur", "Total", "Uang muka diapply", "Sisa"]}>
            {applied.map(([advanceId, amount], index) => {
              const advance = details[index]?.data
              return (
                <MiniRow key={advanceId}>
                  <MiniCell>
                    <span className="block font-mono text-[0.9375rem] text-ink">
                      {advance?.advance_number ?? "—"}
                    </span>
                    {advance && (
                      <span className="text-[0.9375rem] text-mute">
                        {day(advance.advance_date)}
                        {advance.reference ? ` · ${advance.reference}` : ""}
                      </span>
                    )}
                  </MiniCell>
                  <MiniCell align="right">
                    {advance ? money(advance.amount_minor) : "—"}
                  </MiniCell>
                  <MiniCell align="right">{money(amount)}</MiniCell>
                  <MiniCell align="right">
                    {advance ? money(advance.outstanding_minor) : "—"}
                  </MiniCell>
                </MiniRow>
              )
            })}
          </MiniTable>
        )}
      </div>
      {posted && bill.outstanding_minor > 0 && advances.length > 0 && (
        <ApplyAdvance
          bill={bill}
          advances={advances}
          onDone={() => client.invalidateQueries({ queryKey: financeKeys.all })}
        />
      )}
    </div>
  )
}

/// Apply Uang Muka: pick one of the supplier's open advances and how much of
/// it goes against this bill. The amount starts at the most that can: the
/// advance's balance or what is still owed, whichever is smaller.
function ApplyAdvance({
  bill,
  advances,
  onDone,
}: {
  bill: SupplierBill
  advances: Awaited<ReturnType<typeof openAdvances>>
  onDone: () => void
}) {
  const [asking, setAsking] = useState(false)
  const [advanceId, setAdvanceId] = useState("")
  const [amount, setAmount] = useState("")
  const minor = parseMinor(amount)
  const advance = advances.find((row) => row.advance_id === advanceId)
  const most =
    advance === undefined
      ? 0
      : Math.min(advance.outstanding_minor, bill.outstanding_minor)

  const apply = useMutation({
    mutationFn: () =>
      applySupplierAdvance(advanceId, {
        invoice_id: bill.invoice_id,
        amount_minor: minor ?? 0,
      }),
    onSuccess: () => {
      setAsking(false)
      setAdvanceId("")
      setAmount("")
      onDone()
    },
  })

  if (!asking) {
    return (
      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => setAsking(true)}>
          Apply Uang Muka
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3 rounded-inner border border-hairline p-3.5">
      <Problem error={apply.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Uang muka" required>
          <Select
            value={advanceId}
            onChange={(next) => {
              setAdvanceId(next)
              const picked = advances.find((row) => row.advance_id === next)
              setAmount(
                picked === undefined
                  ? ""
                  : String(
                      Math.min(picked.outstanding_minor, bill.outstanding_minor)
                    )
              )
            }}
          >
            <option value="">Choose an advance</option>
            {advances.map((row) => (
              <option key={row.advance_id} value={row.advance_id}>
                {row.advance_number} · {row.po_number} ·{" "}
                {money(row.outstanding_minor)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Uang muka diapply"
          required
          problem={
            minor !== null && minor > most && advance !== undefined
              ? `At most ${money(most)}.`
              : undefined
          }
        >
          <Money value={amount} onChange={setAmount} prefix="Rp" />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-3">
        <Button data-cancel variant="quiet" onClick={() => setAsking(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          pending={apply.isPending}
          disabled={
            advance === undefined ||
            minor === null ||
            minor <= 0 ||
            minor > most
          }
          onClick={() => apply.mutate()}
        >
          {apply.isPending ? "Applying…" : "Apply"}
        </Button>
      </div>
    </div>
  )
}

/// The three acts that change a bill's standing, and the check that goes before
/// the fourth: hold it, release it, send a GA draft back, and read what the
/// server warns about before it is posted.
///
/// # Why its own component, with its own state
///
/// The sheet is reused as one bill is swapped for another, and every one of
/// these holds something typed: a hold reason, a planned release, a return
/// reason. In the sheet they would survive the swap, and a reason typed for one
/// invoice would be one keystroke from being sent against the next. Keyed by
/// the bill id, React throws the whole thing away and starts the next one
/// empty — which is the reset, rather than an effect that runs after the wrong
/// value has already been drawn.
///
/// # Why nothing here blocks a posting
///
/// The six warnings are warnings (brief §8.4). `post_bill` refuses a HELD bill
/// and nothing else, so the one thing that reaches the post button is the hold,
/// and the warnings are read and left alone. A screen that disabled Post on a
/// warning would turn a question into a refusal.
function BillHandover({ id, bill }: { id: string; bill: SupplierBill }) {
  const client = useQueryClient()
  const [holdDraft, setHoldDraft] = useState(false)
  const [holdReason, setHoldReason] = useState("")
  const [releaseDate, setReleaseDate] = useState("")
  const [returnReason, setReturnReason] = useState("")
  const [warningsWanted, setWarningsWanted] = useState(false)

  /// Hold, release and return all answer with the whole bill, so every list
  /// holding it is invalidated rather than patched: whether it still appears in
  /// an inbox, a payment run or an ageing is for the server to say, and this
  /// screen does not own those answers.
  const hold = useMutation({
    mutationFn: () =>
      holdBill(id, {
        reason: holdReason.trim(),
        release_date: releaseDate === "" ? null : releaseDate,
      }),
    onSuccess: () => {
      setHoldDraft(false)
      setHoldReason("")
      setReleaseDate("")
      client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const release = useMutation({
    mutationFn: () => releaseBill(id),
    onSuccess: () => client.invalidateQueries({ queryKey: financeKeys.all }),
  })

  const sendBack = useMutation({
    mutationFn: () => returnBill(id, { reason: returnReason.trim() }),
    onSuccess: () => {
      setReturnReason("")
      client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  /// The warning check, and only when somebody has asked for it. `retry: false`
  /// because a node that does not answer the warnings read is a capability this
  /// deployment has not got, and asking three times changes nothing.
  const warnings = useQuery({
    queryKey: financeKeys.billWarnings(id),
    queryFn: ({ signal }) => billWarnings(id, signal),
    enabled: warningsWanted,
    retry: false,
    staleTime: 0,
  })

  const status = bill.status.toUpperCase()
  const posted = status === "POSTED"
  /// Whether the six checks apply: a draft or a matched bill is the one being
  /// read before it goes into the books. A posted bill has no "before".
  const checkable = status === "DRAFT" || status === "MATCHED"
  const fromGa = bill.submitted_by_domain === "GA"
  const held = bill.on_hold === true

  return (
    <>
      {/* ── Holding, and the way back ─────────────────────────────────────
          A hold is not a status of the document — it is a reason nothing may
          pay it, which is why the reason is required and the planned release
          is not. The switch is the state, exactly as `Switch` means everywhere
          else: what it changes takes effect when it is released. */}
      <div className="rounded-inner border border-hairline p-3.5">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[0.9375rem] font-medium text-ink">
              Hold
            </span>
            <span className="mt-0.5 block text-[0.9375rem] leading-relaxed text-body">
              {held
                ? "On hold; no payment can take it until it is released."
                : "Holding stops any payment against this bill until it is released."}
            </span>
          </span>
          <Switch
            on={held || holdDraft}
            busy={hold.isPending || release.isPending}
            label="Hold this bill"
            onToggle={() => {
              if (held) release.mutate()
              else setHoldDraft((open) => !open)
            }}
          />
        </div>

        {held ? (
          <div className="mt-3 flex flex-col gap-1">
            <p className="text-[0.9375rem] text-body">{bill.hold_reason}</p>
            <p className="text-[0.9375rem] text-mute">
              Planned release:{" "}
              {bill.release_date === null
                ? "not decided yet"
                : day(bill.release_date)}
            </p>
            <Problem error={release.error} />
          </div>
        ) : holdDraft ? (
          <div className="mt-3 flex flex-col gap-3">
            <Field label="Reason for the hold" required>
              <Input
                value={holdReason}
                onChange={(event) => setHoldReason(event.target.value)}
              />
            </Field>
            {/* Optional, and it means what it says: an empty date is "held
                until somebody decides", not "held forever". */}
            <Field label="Planned release">
              <Day value={releaseDate} onChange={setReleaseDate} />
            </Field>
            <div className="flex justify-end">
              <Button
                variant="soft"
                pending={hold.isPending}
                disabled={holdReason.trim() === ""}
                onClick={() => hold.mutate()}
              >
                {hold.isPending ? "Holding…" : "Hold this bill"}
              </Button>
            </div>
            <Problem error={hold.error} />
          </div>
        ) : null}
      </div>

      {/* ── Returning a GA draft ──────────────────────────────────────────
          Only a draft that came from GA can go back to it. The reason is
          required: a returned draft with no reason is one Operations cannot
          act on. */}
      {fromGa && !posted && (
        <div className="rounded-inner border border-hairline p-3.5">
          <span className="block text-[0.9375rem] font-medium text-ink">
            Return to GA
          </span>
          <span className="mt-0.5 block text-[0.9375rem] leading-relaxed text-body">
            The draft goes back to GA to be fixed. Its id and GA mark stay, and
            it stays DRAFT — this is a return, not a deletion.
          </span>
          <div className="mt-3 flex flex-col gap-3">
            <Field label="Reason for the return" required>
              <Textarea
                rows={2}
                value={returnReason}
                onChange={(event) => setReturnReason(event.target.value)}
              />
            </Field>
            <div className="flex justify-end">
              <Button
                variant="soft"
                pending={sendBack.isPending}
                disabled={returnReason.trim() === ""}
                onClick={() => sendBack.mutate()}
              >
                {sendBack.isPending ? "Returning…" : "Return to GA"}
              </Button>
            </div>
            <Problem error={sendBack.error} />
          </div>
        </div>
      )}

      {/* ── The six checks before posting ─────────────────────────────────
          Read on demand and never on open: the checks cost a query each, and
          most bills visit this sheet for a fact rather than to post. A warning
          is NOT a block — the server refuses only a held bill — so nothing
          here disables anything. */}
      {checkable && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <SubHead>Before posting</SubHead>
            <Button
              size="sm"
              variant="soft"
              disabled={warnings.isFetching}
              onClick={() => {
                setWarningsWanted(true)
                if (warningsWanted) warnings.refetch()
              }}
            >
              {warnings.isFetching ? "Checking…" : "Check before posting"}
            </Button>
          </div>
          {warnings.isError ? (
            <Problem error={warnings.error} />
          ) : warningsWanted && warnings.data !== undefined ? (
            warnings.data.length === 0 ? (
              // A check that ran and found nothing has to say so: the reader
              // needs to know the check happened, not that it was skipped.
              <p className="text-[0.9375rem] text-body">No warnings.</p>
            ) : (
              warnings.data.map((warning) => (
                <Banner key={`${warning.code}:${warning.message}`} tone="warn">
                  {/* The server's sentence, verbatim. It names the number or
                      the object, and paraphrasing it would lose the figure
                      somebody has to go and check. */}
                  {warning.message}
                  {warning.detail !== null && warning.detail !== undefined && (
                    <span className="mt-1 block opacity-80">
                      {warning.detail}
                    </span>
                  )}
                </Banner>
              ))
            )
          ) : (
            <p className="text-[0.9375rem] text-mute">
              A warning is not a block: posting can still go ahead.
            </p>
          )}
        </div>
      )}
    </>
  )
}

/// One thing an expense bill was for, as somebody keys it.
///
/// The account is held as a code *and* a name even though only the code is
/// sent: the picker answers with all of it, and splitting the parts would let
/// a row show one account's name over another's code. The same reason the bank
/// statement composer keeps them together.
///
/// There is no `site` here, and that is the point. 0098 forces an expense line
/// to sit at its bill's own location — every 6* and 7* leaf in this client's
/// chart is already a per-location account, so a DC bill carrying a store-01
/// line would debit store 01 with no credit anywhere in store 01's books. A
/// control offering the choice would be a control whose every other answer is
/// refused.
/// `account` is the account AND the category its family asks for, held as one
/// value. With forty accounts in the chart, 6301 is a line of the profit and
/// loss and has not yet said whether the invoice was for electricity or for
/// water; the category is what the account code used to carry, and the
/// database refuses a line that has only one half of it.
interface ExpenseLineDraft {
  account: AccountChoice | null
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
      // An account with no category, where its family asks for one, is half a
      // line — the trigger refuses it and names the five codes it would have
      // taken. Counted with the other three reasons a line is not a line.
      !accountChoiceReady(line.account)
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
export function RecordSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  // What the request answered, not what was typed into it.

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
              account_code: line.account!.account_code,
              // Omit the category when this account has no category family;
              // the API models that as an absent optional field.
              category_code: line.account!.category_code ?? undefined,
              // The bill's own location, always. See `ExpenseLineDraft`.
              site_id: site,
              amount_minor: parseMinor(line.amount) ?? 0,
              // This form cannot say a line replaces something reserved for —
              // that needs an asset class beside it, which it does not ask for.
              draws_reserve: false,
              // The account on this line is chosen by the person keying the
              // bill, so it is an override of whatever the line's object would
              // have proposed; the server reads this to show Finance what was
              // changed (brief §8.2).
              account_overridden: true,
              memo: line.memo.trim() === "" ? null : line.memo.trim(),
            }))
          : undefined,
      })
    },
    onSuccess: (saved) => {
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
      // Recording writes no journal entry, so only the bill lists moved —
      // every one of them, at every location: the register's tabs are keyed
      // by location and kind, so the unfiltered key alone would miss them.
      client.invalidateQueries({ queryKey: ["finance", "bills"] })
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
              <span className="text-[0.9375rem] text-mute tabular-nums">
                {totals.ready
                  ? money(totals.total)
                  : totals.expense && totals.subtotalMinor !== null
                    ? "The lines have to add up to the subtotal"
                    : "Fill in the invoice and the amount"}
              </span>
              <Button
                variant="primary"
                pending={record.isPending}
                disabled={!totals.ready}
                onClick={() => form.handleSubmit()}
              >
                {record.isPending ? "Submitting…" : "Submit"}
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
              <Field label="Invoice number" required>
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
              <Field label="Site" required>
                {/* Was a text box placeheld "e.g. DC01", which no site id in
                    the data resembles. The server refuses an unknown one; this
                    is how nobody has to meet that refusal. A bill stays at the
                    site it was received at. */}
                <SiteSelect
                  value={field.state.value}
                  onChange={(next) => field.handleChange(next)}
                  emptyLabel="Choose a site"
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
              <Field label="Supplier" required className="col-span-2">
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
              <Field label="Invoice date" required>
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
              <Field label="Due date">
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
                required
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

      <p className="text-[0.9375rem] text-mute">
        A cost — class 6 or 7 — or something that becomes one: prepaid expense,
        an advance, or a capital purchase under <code>10215</code>. Every line
        sits at the bill's own site:{" "}
        {site === "" ? (
          <span className="text-warn-fg">choose a site above first.</span>
        ) : (
          <>
            <SiteName id={site} className="text-ink" />. A cost at another site
            needs an inter-unit credit and no rule writes one yet, so it is
            refused — record one bill per site instead.
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
              <AccountAndCategory
                // The chart is theirs and the refusals are the server's: an
                // inactive account has been retired and cannot take new costs,
                // and a class outside 1, 6 and 7 is not a cost at all. Both
                // are shown and disabled rather than hidden — an accountant
                // who cannot find the account they are holding an invoice for
                // assumes the search is broken.
                accept={(account) =>
                  !account.is_active
                    ? "cancelled"
                    : !EXPENSE_LINE_CLASSES.includes(account.root_class)
                      ? `class ${account.root_class}`
                      : null
                }
                value={line.account}
                onChange={(next) => edit(index, { account: next })}
                categoryLabel={`What line ${index + 1} was for`}
                explain
              />
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
              required
              problem={
                line.amount.trim() !== "" && parseMinor(line.amount) === null
                  ? "Not a number."
                  : undefined
              }
            >
              <Money
                value={line.amount}
                onChange={(next) => edit(index, { amount: next })}
              />
            </Field>
            <Field label="Memo" hint="What this line was.">
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
              { account: null, amount: "", memo: "" },
            ])
          }
        >
          Add a line
        </Button>
        {/* Both halves of the comparison, always — a single "out by" figure
            would say something is wrong without saying which number to fix. */}
        <span className="text-[0.9375rem] text-mute tabular-nums">
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

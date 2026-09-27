import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnDef, Row, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Pencil, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { DataTable } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Switch } from "@/components/ui/form"
import {
  ColumnsMenu,
  DockedFilters,
  SortMenu,
  ViewPicker,
  ListOptionsSheet,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Section, TotalsLadder } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Thumbnail } from "@/components/ui/thumbnail"
import { useFilterState, type FilterField } from "@/lib/filters"
import { count, day, label, money } from "@/lib/format"
import {
  cancelPurchaseOrder,
  listSuppliers,
  orderScopeFromFilters,
  procurementKeys,
  purchaseOrderDetail,
  purchaseOrderPage,
  // Both hand-written beside their fetchers rather than generated, and
  // `PurchaseOrderPage` deliberately the local one: `@itulah/contract` exports
  // a type of the same name that this endpoint does not answer with.
  type PurchaseOrderDetail,
  type PurchaseOrderPage,
  type PurchaseOrderRow,
  type PurchaseOrderScope,
} from "@/lib/queries/procurement"
import { OrderComposer } from "@/screens/procurement/composer"
import { PoImportSheet } from "@/screens/procurement/import"
import {
  GRID_CELL,
  GRID_HEAD,
  PO_STATUS,
  poStatus,
  useIdempotencyKey,
} from "@/screens/procurement/shared"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { toast } from "@/lib/toast"
import { useDebounced } from "@/lib/use-debounced"
import { usePanelDock } from "@/lib/layout"

/// Purchase orders — the reference screen for this app.
///
/// Every other list is written the same way, so it is worth naming the parts:
///
///  1. One `useQuery` per read, keyed from `lib/queries/<domain>.ts`.
///  2. Columns declared outside the component (they never close over props),
///     built with `createColumnHelper` so the accessor and the cell agree.
///  3. `useTable` with the shared `tableSetup` — never a bespoke feature set.
///  4. `<DataTable>` for the grammar, and it virtualises itself past 150 rows.
///  5. Selection opens the floating `<Sheet>`; the list keeps its scroll.
///  6. `queryState` renders pending / error / data, so no screen invents its
///     own spinner or its own error sentence.
///  7. `useFilterState(fields)` reads the clauses out of the URL. The panel at
///     the right sets them and a plain box searches; the clauses are turned
///     into request parameters — see `orderScopeFromFilters` — and the
///     endpoint answers a narrowed list. The Receiving and Invoicing switches
///     are intentionally local slices of that loaded page: those operational
///     tallies are not query parameters yet. That is why the fields are
///     declared here rather than as `meta.filter` on the columns: what may be
///     asked is decided by what the SQL can answer, not by what a column
///     happens to hold, and an operator the request cannot carry is a chip
///     that silently narrows nothing. A short list a browser can hold —
///     `destinations.tsx` next door — still uses `useFilters(columns)` and
///     `<FilterBar>`; the order book is a year of the company's purchasing and
///     cannot.
///  8. `meta.card` and `meta.priority` on the same columns, which is the whole
///     of what this screen does to work on an iPad and a phone: what each
///     column becomes when the rows are relaid as cards, and what to drop
///     first when the table is wider than the glass. There is no second screen
///     and no second component — see `<DataTable>` for the three shapes those
///     two declarations buy.
///
/// The columns are the point, not the decoration. DESIGN.md is explicit that a
/// list exists to decide and to compare rows, so what is here is the document
/// a buyer compares — what it is worth, how much of it there is, when it was
/// promised and how much of it has landed — and not the supplier's address,
/// the internal id, or the DC a command was routed to. Those are one click
/// away in the sheet, which is where Destination went: nearly every order goes
/// to the one DC, and a column that says the same word on every row is not a
/// column, it is a caption.

/// What a status may be, before the server has said how many of each there
/// are. Once its counts arrive they decide the list — counted over the whole
/// book, not over the page, so a status is offered when the company has ever
/// used it and not merely when it survived the current filters.
/// Where an order STANDS, which is what the server now counts the status facet
/// by. Not the stored `order_status`: that column only ever reads ISSUED or
/// CLOSED, so an order that had arrived in full still showed as issued, and it
/// offered DRAFT and CANCELLED — two states nothing in the system can produce.
const STATUSES = Object.keys(PO_STATUS)

function safeUnits(value: unknown): number {
  if (typeof value === "number")
    return Number.isFinite(value) ? Math.max(0, value) : 0
  if (typeof value !== "string" || value.trim() === "") return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

type ReceiptView = "all" | "received"
type InvoiceView = "all" | "invoiced"

/// Nothing chosen: the rows stay in the order the server sends them, which is
/// the house order — late orders first, the longest-late at the top, then the
/// newest issued.
function defaultOrderSorting(): SortingState {
  return []
}

/// Late orders stand above everything else whatever the list is sorted by —
/// the owner's rule (2026-09-26). A hidden first key in front of whatever the
/// header asked for.
const OVERDUE_FIRST = { id: "overdue", desc: false } as const

function dateRank(value: string | null): number {
  if (value === null) return Number.NaN
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function compareOldest(a: string | null, b: string | null): number {
  const left = dateRank(a)
  const right = dateRank(b)
  if (Number.isNaN(left)) return Number.isNaN(right) ? 0 : 1
  if (Number.isNaN(right)) return -1
  return left - right
}

function compareNewest(a: string | null, b: string | null): number {
  const left = dateRank(a)
  const right = dateRank(b)
  if (Number.isNaN(left)) return Number.isNaN(right) ? 0 : 1
  if (Number.isNaN(right)) return -1
  return right - left
}

function supplierOf(row: PurchaseOrderRow): string {
  return row.supplier_name ?? row.supplier_id
}

/// The default inbox order: unfinished work first, oldest promise first;
/// completed work after it, newest issued order first.
function compareReceivingPriority(
  left: PurchaseOrderRow,
  right: PurchaseOrderRow
): number {
  const leftPending =
    left.lifecycle === "ACTIVE" || left.lifecycle === "PARTIALLY_RECEIVED"
  const rightPending =
    right.lifecycle === "ACTIVE" || right.lifecycle === "PARTIALLY_RECEIVED"
  if (leftPending !== rightPending) return leftPending ? -1 : 1

  const dateOrder = leftPending
    ? compareOldest(left.expected_arrival, right.expected_arrival)
    : compareNewest(left.issued_at, right.issued_at)
  if (dateOrder !== 0) return dateOrder
  return left.po_number.localeCompare(right.po_number, undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

function compareSupplier(
  left: PurchaseOrderRow,
  right: PurchaseOrderRow
): number {
  const supplierOrder = supplierOf(left).localeCompare(
    supplierOf(right),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    }
  )
  return supplierOrder === 0
    ? compareReceivingPriority(left, right)
    : supplierOrder
}

/// A share, 0-100, of one figure against another.
function share(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0
}

const columns: ColumnDef<TableSetup, PurchaseOrderRow>[] = [
  {
    // The sort key that keeps late orders on top. Never shown.
    id: "overdue",
    accessorFn: (row) => (row.overdue ? 0 : 1),
    header: "",
    enableHiding: false,
    meta: { card: "hide" },
  },
  {
    id: "order",
    accessorFn: (row) => row.po_number,
    header: "Order",
    size: 220,
    // Who the order is with names the row: the PO number identifies it, the
    // supplier is what somebody is looking for.
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-0.5 leading-snug">
        <span className="font-mono text-[0.875rem] text-body">
          {row.original.po_number}
        </span>
        <span className="truncate text-[0.875rem] text-ink">
          {row.original.supplier_name ?? "—"}
        </span>
      </span>
    ),
  },
  {
    id: "created",
    accessorFn: (row) => row.issued_at,
    header: "Date created",
    size: 130,
    sortFn: "datetime",
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) => (
      <span className="tabular-nums">{day(row.original.issued_at)}</span>
    ),
  },
  {
    accessorKey: "expected_arrival",
    header: "Delivery date",
    size: 150,
    // Red when it has passed and pieces are still owed — and those rows stand
    // at the top of the list.
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span
        className={
          row.original.overdue
            ? "flex items-center gap-1.5 font-medium text-bad-fg tabular-nums"
            : "tabular-nums"
        }
        title={row.original.overdue ? "Past its delivery date" : undefined}
      >
        {row.original.overdue && (
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-bad" />
        )}
        {day(row.original.expected_arrival)}
      </span>
    ),
  },
  {
    accessorKey: "expected_stock_units",
    header: "Qty order",
    size: 110,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span
        className="flex flex-col items-end leading-tight tabular-nums"
        title={`${count(row.original.expected_stock_units)} pieces across ${count(row.original.line_count)} items`}
      >
        {count(row.original.expected_stock_units)}
        <span className="text-[0.875rem] text-mute">
          {count(row.original.line_count)}
          {row.original.line_count === 1 ? " item" : " items"}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "net_minor",
    header: "Order value",
    size: 150,
    // Net of the order's discount, PPN included — the company does not
    // claim it back, so this is what is paid.
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        {money(row.original.net_minor)}
      </span>
    ),
  },
  {
    accessorKey: "received_stock_units",
    header: "Receiving qty",
    size: 120,
    meta: { align: "right", card: "hide", priority: 2 },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {count(row.original.received_stock_units)}
      </span>
    ),
  },
  {
    accessorKey: "received_value_minor",
    header: "Receiving value",
    size: 150,
    meta: { align: "right", card: "hide", priority: 2 },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {money(row.original.received_value_minor)}
      </span>
    ),
  },
  {
    id: "received",
    // By VALUE: what has arrived, as a share of what the order is worth.
    accessorFn: (row) => share(row.received_value_minor, row.net_minor),
    header: "Receiving",
    size: 130,
    meta: { card: "metric" },
    cell: ({ row }) => {
      const pct = share(
        row.original.received_value_minor,
        row.original.net_minor
      )
      return (
        <span
          className="flex items-center gap-2"
          title={`${money(row.original.received_value_minor)} of ${money(row.original.net_minor)} received`}
        >
          <span className="h-2 min-w-14 flex-1 overflow-hidden rounded-full bg-soft-2">
            <span
              className="block h-full rounded-full bg-[color-mix(in_srgb,var(--accent)_62%,white)]"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="w-10 shrink-0 text-right text-[0.875rem] text-mute tabular-nums">
            {Math.round(pct)}%
          </span>
        </span>
      )
    },
  },
  {
    id: "invoicing",
    accessorFn: (row) => safeUnits(row.invoiced_stock_units),
    header: "Invoicing",
    size: 130,
    // Off by default; Columns brings it back.
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => {
      const pct = share(
        safeUnits(row.original.invoiced_stock_units),
        safeUnits(row.original.expected_stock_units)
      )
      return (
        <span className="flex items-center gap-2">
          <span className="h-2 min-w-14 flex-1 overflow-hidden rounded-full bg-soft-2">
            <span
              className="block h-full rounded-full bg-[color-mix(in_srgb,var(--info)_62%,white)]"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="w-10 shrink-0 text-right text-[0.875rem] text-mute tabular-nums">
            {Math.round(pct)}%
          </span>
        </span>
      )
    },
  },
  {
    accessorKey: "lifecycle",
    header: "Status",
    size: 150,
    meta: { card: "status" },
    cell: ({ row }) => {
      const status = poStatus(row.original.lifecycle)
      return <Pill tone={status.tone}>{status.label}</Pill>
    },
  },
]

export function PurchaseOrders() {
  // Which order is open lives in the URL (`?order=…`), not in state beside the
  // table. A sheet in `useState` cannot be linked to, does not survive the
  // reload a browser gets every morning, and cannot be opened by the command
  // palette or a notification — all three of which want to.
  const order = useSheet("order")
  /// A blank order being written. In the URL like every other sheet, so a
  /// half-typed order survives a reload.
  const composer = useSheet("new-order")
  /// The import, over this book rather than on a screen of its own. In the
  /// URL like the composer beside it: a buyer halfway through twenty
  /// documents should survive the reload their browser gets every morning.
  const importing = useSheet("import")
  /// An issued order being rewritten, by id — the composer again, seeded.
  const editing = useSheet("edit-order")
  /// What was typed into the omnibox, also in the URL: a narrowed list is a
  /// thing people send each other.
  const search = useSheet("q")
  const navigate = useNavigate()
  // The first screenful is the work that has waited longest. The Receiving
  // column's comparator puts open orders first, then oldest promises, and
  // keeps completed orders newest-first below them.
  const [sorting, setSorting] = useState<SortingState>(defaultOrderSorting)
  const [visibility, setVisibility] = useState<Record<string, boolean>>({
    overdue: false,
    invoicing: false,
  })
  const [groupBySupplier, setGroupBySupplier] = useState(false)
  const [receiptView, setReceiptView] = useState<ReceiptView>("all")
  const [invoiceView, setInvoiceView] = useState<InvoiceView>("all")

  /// The suppliers, for the filter's own picker. Small, cached by every other
  /// procurement screen, and the reason the chip can offer a NAME where the
  /// request carries a code.
  const suppliers = useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
    staleTime: 5 * 60 * 1000,
  })

  /// The columns this list can be narrowed by, and the only ones: each maps to
  /// a parameter the endpoint answers, and the operators are cut to what it
  /// can honour. An operator the request cannot carry is a chip that silently
  /// narrows nothing.
  ///
  /// `counted` is the server's own tally over the whole book. Without it the
  /// picker asks the TABLE how many rows hold each value, and this table holds
  /// only what the same filters already let through — so every option nobody
  /// had ticked printed a 0 beside it, which reads as a book with nothing in
  /// it.
  const fields = useMemo<FilterField[]>(
    () => [
      {
        column: "supplier",
        label: "Supplier",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
          // `supplier_code`, NOT `supplier_id`. A supplier row's
          // `supplier_id` is a uuid; the column a purchase order carries
          // under that same name is the CODE — `SUP12` — and it is what the
          // request compares against. An option list built from the uuid
          // would have filtered to nothing, quietly, on every supplier.
          options: (suppliers.data ?? []).map((one) => ({
            value: one.supplier_code,
            label: one.name,
          })),
          // The picker offers a NAME where the request carries a code — for
          // the counted list as well, which arrives as bare codes.
          format: (code) =>
            (suppliers.data ?? []).find((one) => one.supplier_code === code)
              ?.name ?? code,
        },
      },
      {
        column: "lifecycle",
        label: "Status",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
          // The picker shows the sentence, not the code: a buyer excluding
          // cancelled orders is looking for "Cancelled", not `CANCELLED`.
          options: STATUSES.map((code) => ({
            value: code,
            label: poStatus(code).label,
          })),
          format: (code) => poStatus(code).label,
        },
      },
      {
        column: "issued_at",
        label: "Issued",
        // Two clauses rather than one "is between": they land on two different
        // request parameters and AND on the server exactly as the chips
        // promise.
        spec: { kind: "date", operators: ["gte", "lte"] },
      },
    ],
    [suppliers.data]
  )

  const filters = useFilterState(fields)

  /// What was typed, plus the chips, as the one request that answers both.
  ///
  /// Debounced, because every keystroke is a round trip to a SQL query over
  /// the whole company's purchasing. Four hundred milliseconds is long enough
  /// that typing a PO number asks once instead of fourteen times, and short
  /// enough that the box still feels like it is listening.
  const typed = (search.value ?? "").trim()
  const needle = useDebounced(typed, 400)
  const scope = useMemo<PurchaseOrderScope>(
    () => ({
      ...orderScopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
    }),
    [filters.filters, needle]
  )
  /// Whether anything is narrowing the list, which is a different question
  /// from whether the list is empty: "there are none" and "none match what you
  /// asked for" have different fixes.
  const narrowed =
    needle !== "" ||
    filters.filters.length > 0 ||
    receiptView !== "all" ||
    invoiceView !== "all"

  const orders = useQuery({
    queryKey: procurementKeys.orders(scope),
    queryFn: ({ signal }) => purchaseOrderPage(scope, signal),
    // The previous answer stays on screen while the next is fetched. Without
    // it every keystroke empties the table to a loading line and the screen
    // flashes its way through a word.
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(() => orders.data?.rows ?? [], [orders.data])

  const viewRows = useMemo(
    () =>
      rows.filter((row) => {
        const received =
          row.lifecycle === "FULLY_RECEIVED" ||
          row.lifecycle === "SHORT_RECEIVED"
        const invoiced = safeUnits(row.invoiced_stock_units) > 0
        return (
          (receiptView === "all" || (receiptView === "received" && received)) &&
          (invoiceView === "all" || (invoiceView === "invoiced" && invoiced))
        )
      }),
    [invoiceView, receiptView, rows]
  )

  const tableColumns = useMemo(
    () =>
      groupBySupplier
        ? columns.map((column) =>
            column.id === "order"
              ? {
                  ...column,
                  sortFn: (
                    left: Row<TableSetup, PurchaseOrderRow>,
                    right: Row<TableSetup, PurchaseOrderRow>
                  ) =>
                    compareSupplier(
                      left.original as PurchaseOrderRow,
                      right.original as PurchaseOrderRow
                    ),
                }
              : column
          )
        : columns,
    [groupBySupplier]
  )

  /// The same fields, carrying the server's tally.
  ///
  /// Built here and not above because the counts come from the answer and the
  /// question is built from the fields — declaring them together would be a
  /// circle. The bar is the only thing that needs them, so the bar is the only
  /// thing that gets them; `useFilterState` reads clauses out of the URL and
  /// does not care how many rows an option holds.
  ///
  /// Without this the picker asks the TABLE how many rows hold each value, and
  /// this table holds only what the same filters already let through — so
  /// every option nobody had ticked printed a 0 beside it, which reads as a
  /// book with nothing in it.
  const counted = useMemo<FilterField[]>(() => {
    const facets = orders.data?.facets
    if (facets === undefined) return fields
    return fields.map((field) =>
      field.column === "lifecycle"
        ? { ...field, spec: { ...field.spec, counted: facets.order_status } }
        : field.column === "supplier"
          ? { ...field, spec: { ...field.spec, counted: facets.supplier } }
          : field
    )
  }, [fields, orders.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: viewRows,
        columns: tableColumns,
        getRowId: (row: PurchaseOrderRow) => row.purchase_order_id,
        // The hidden late-first key leads whatever was chosen, and is taken
        // back out of anything the table hands back.
        state: {
          sorting: [OVERDUE_FIRST, ...sorting],
          columnVisibility: visibility,
        },
        onColumnVisibilityChange: setVisibility,
        onSortingChange: (
          next: SortingState | ((prev: SortingState) => SortingState)
        ) => {
          setGroupBySupplier(false)
          setSorting((was) =>
            (typeof next === "function"
              ? next([OVERDUE_FIRST, ...was])
              : next
            ).filter((one) => one.id !== OVERDUE_FIRST.id)
          )
        },
      }),
      [sorting, tableColumns, viewRows, visibility]
    )
  )

  const chooseSort = (id: string, desc: boolean) => {
    setGroupBySupplier(false)
    setSorting([{ id, desc }])
  }

  const chooseGrouping = (on: boolean) => {
    setGroupBySupplier(on)
    setSorting(on ? [{ id: "order", desc: false }] : defaultOrderSorting())
  }

  const docked = usePanelDock()

  return (
    <PageContent>
      <PageHeader
        title="Purchase orders"
        sub="What has been ordered, what has arrived, and what is still owed."
      />

      <PoImportSheet
        open={importing.value === true}
        onClose={importing.close}
      />

      <OrderComposer
        open={composer.value === true}
        onClose={composer.close}
        onRaised={(raised) => {
          // The receipt is a receipt: said once, in the corner, and gone. It
          // used to be a banner pinned over the table — furniture nobody
          // dismissed — and it announced the DC the command reached, which is
          // plumbing. What a buyer wants to know is that the order exists.
          toast.success(`${raised.po_number} issued`, {
            description: money(raised.net_minor),
          })
          // One navigation, not two. Closing the composer and opening the
          // order as separate calls both read the search that is on screen
          // NOW, so whichever landed second would put the other's parameter
          // back — and the sheet would open with the composer still over it.
          void navigate({
            to: ".",
            search: (prev: Record<string, unknown>) => ({
              ...prev,
              "new-order": undefined,
              order: raised.purchase_order_id,
            }),
            viewTransition: false,
          })
        }}
      />

      {/* One box for both questions, sitting on top of what it narrows.

          Search used to be a 12rem input in the page header's top-right
          corner — as far from the table as the layout allowed, and small
          enough to read as a minor control, when it is the fastest way to one
          order out of a year of them. Filtering and searching are also one
          thought: "berkah, issued, since August" is a sentence somebody says
          in one breath, and splitting it across two controls in two corners
          makes them say it twice.

          Both go to the SERVER. The book is the whole company's purchasing;
          narrowing it after it arrives has already paid for all of it. */}
      <div className="grid min-w-0 items-start gap-5 dock:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          {/* The count, and which columns the table is carrying. The prototype puts
          both on the line above the rows, where what they act on is visible. */}

          {/* One line, the width of the table, carrying everything that acts on
          it: what narrows it at the left, what orders and shapes it in the
          middle, and what creates a new one at the right. The page header
          above keeps the title and nothing else — its actions used to stand
          over the filter panel, which is not what they act on. */}
          {/* On a phone the line is two: the search and the one thing
          somebody at a supplier's counter came to do, then the tools that
          reshape the list, small. Columns is not offered there at all — below
          48rem the rows are cards, and a card has no columns to hide. On a
          wider screen the inner row dissolves (`md:contents`) and it is one
          line again, in the order it always had. */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="relative min-w-0 flex-1 md:mr-auto md:flex-none">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
              <input
                value={search.value ?? ""}
                onChange={(event) =>
                  event.target.value
                    ? search.open(event.target.value)
                    : search.close()
                }
                placeholder="Search orders"
                aria-label="Search orders"
                className="h-[2.125rem] w-full rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.875rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent md:w-56 pointer-coarse:h-11"
              />
            </span>
            {/* The phone: one button for filter, sort and views, opening one
                sheet — see `ListOptionsSheet` — and New order as a floating
                button below. From 48rem up this line is what it always was. */}
            <ListOptionsSheet
              model={filters}
              filterModel={{ ...filters, fields: counted }}
              table={table}
              sorting={sorting}
              onSort={chooseSort}
              className="md:hidden"
            />
            <Button
              variant="primary"
              onClick={() => composer.open(true)}
              className="max-md:hidden md:order-last"
            >
              New order
            </Button>
            <div className="hidden md:contents">
              {/* Below the width where the panel docks, this is where the
                  filters are — the panel returns nothing there, and until
                  this button stood here a phone or a laptop had no way to
                  narrow the book at all. */}
              {!docked && (
                <FilterPanel
                  model={{ ...filters, fields: counted }}
                  className="shrink-0 flex-nowrap max-md:order-first"
                />
              )}
              <SortMenu
                table={table}
                sorting={sorting}
                onSort={chooseSort}
                compact
                className="shrink-0 pointer-coarse:h-11"
              />
              <ColumnsMenu table={table} className="max-md:hidden" />
              <span
                aria-hidden
                className="mx-1 h-5 w-px bg-hairline max-md:hidden"
              />
              <ViewPicker
                model={filters}
                className="shrink-0 pointer-coarse:h-11"
              />
              {/* Import is hidden on the owner's instruction (2026-09-25)
                  until the import flow is ready for buyers; the sheet and its
                  `?import=` link still work. */}
            </div>
          </div>

          {/* The panel docks where there is room for it — the table measures
          1034px with its eight columns, the panel 256, and 1440 is the width
          that holds both without the list giving up a column. Narrower than
          that it is the Filter button in the omnibox above, which is the same
          model drawn as a sheet. */}
          {/* New order on a phone: a floating button at the thumb's corner,
              above the home bar, clear of every row. Raising an order is the
              one thing somebody at a supplier's counter opens this screen to
              do; on the toolbar it cost a third of the line the search needs. */}
          <Fab label="New order" onClick={() => composer.open(true)} />
          <Card className="overflow-hidden">
            {queryState(orders, {
              loading: "Loading the orders…",
              render: () =>
                viewRows.length === 0 ? (
                  narrowed ? (
                    <EmptyState>No order matches these filters.</EmptyState>
                  ) : (
                    <EmptyState>
                      No purchase order has been raised yet.
                    </EmptyState>
                  )
                ) : (
                  <DataTable<PurchaseOrderRow>
                    table={table}
                    cardSort={false}
                    onRowClick={(row) => order.open(row.purchase_order_id)}
                    isSelected={(row) => row.purchase_order_id === order.value}
                    // The owner's floating totals: how many orders, and what
                    // they add up to, under the columns they sum.
                    summary={{
                      order: (
                        <span>
                          {count(viewRows.length)}{" "}
                          <span className="font-normal text-body">
                            {viewRows.length === 1 ? "order" : "orders"}
                          </span>
                        </span>
                      ),
                      expected_stock_units: count(
                        viewRows.reduce(
                          (sum, row) => sum + row.expected_stock_units,
                          0
                        )
                      ),
                      net_minor: money(
                        viewRows.reduce((sum, row) => sum + row.net_minor, 0)
                      ),
                      received_stock_units: count(
                        viewRows.reduce(
                          (sum, row) => sum + row.received_stock_units,
                          0
                        )
                      ),
                      received_value_minor: money(
                        viewRows.reduce(
                          (sum, row) => sum + row.received_value_minor,
                          0
                        )
                      ),
                    }}
                    className="max-h-[calc(100vh-14rem)]"
                  />
                ),
            })}
          </Card>
        </div>

        <DockedFilters
          model={{ ...filters, fields: counted }}
          kpis={bookKpis(orders.data)}
          className="hidden dock:flex"
        >
          <OrderViewControls
            groupBySupplier={groupBySupplier}
            onGroupBySupplier={chooseGrouping}
            receiptView={receiptView}
            onReceiptView={setReceiptView}
            invoiceView={invoiceView}
            onInvoiceView={setInvoiceView}
          />
        </DockedFilters>
      </div>

      <OrderSheet
        id={order.value ?? null}
        onClose={order.close}
        onEdit={(id) => editing.open(id)}
      />
      <OrderEditor id={editing.value ?? null} onClose={editing.close} />
      {/* Mounted here rather than behind the trigger, because two of its three
          sheets are opened by URL from elsewhere: `?setup=<id>` is the link an
          article's detail follows back to the delivery that minted it. A sheet
          that only exists while its button has been pressed is a link that
          works for the person who clicked it and nobody else. */}
    </PageContent>
  )
}

function OrderViewControls({
  groupBySupplier,
  onGroupBySupplier,
  receiptView,
  onReceiptView,
  invoiceView,
  onInvoiceView,
}: {
  groupBySupplier: boolean
  onGroupBySupplier: (on: boolean) => void
  receiptView: ReceiptView
  onReceiptView: (view: ReceiptView) => void
  invoiceView: InvoiceView
  onInvoiceView: (view: InvoiceView) => void
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.875rem] font-medium text-body">
          Group by supplier
        </span>
        <Switch
          on={groupBySupplier}
          label="Group by supplier"
          onToggle={() => onGroupBySupplier(!groupBySupplier)}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.875rem] font-medium text-body">
          Received only
        </span>
        <Switch
          on={receiptView === "received"}
          label="Show received orders only"
          onToggle={() =>
            onReceiptView(receiptView === "received" ? "all" : "received")
          }
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.875rem] font-medium text-body">
          Invoiced only
        </span>
        <Switch
          on={invoiceView === "invoiced"}
          label="Show invoiced orders only"
          onToggle={() =>
            onInvoiceView(invoiceView === "invoiced" ? "all" : "invoiced")
          }
        />
      </div>
    </div>
  )
}

/// Four figures about the book as it currently stands.
///
/// `total` is the server's own count over everything the search and the chips
/// match, so it is true whatever the page holds. The three sums are not: they
/// are added up over the rows in hand, and a book that runs past one page has
/// more of them. Rather than print a confident wrong total, a partial page
/// says `of {n} shown` under the figure — the number is still useful, and the
/// reader is told what it covers.
/// `49.923.900.000` → `Rp 49,9 M`. Indonesian scale: ribu, juta, miliar.
function brief(minor: number): string {
  const abs = Math.abs(minor)
  const [scale, suffix] =
    abs >= 1_000_000_000
      ? [1_000_000_000, " M"]
      : abs >= 1_000_000
        ? [1_000_000, " jt"]
        : abs >= 1_000
          ? [1_000, " rb"]
          : [1, ""]
  const scaled = minor / scale
  const shown =
    scale === 1 ? String(minor) : scaled.toFixed(scaled < 10 ? 1 : 0)
  return `Rp ${shown.replace(".", ",")}${suffix}`
}

function bookKpis(page: PurchaseOrderPage | undefined) {
  if (page === undefined) return undefined
  const rows = page.rows
  const whole = page.next_cursor === null
  const note = whole
    ? undefined
    : `Over the ${count(rows.length)} orders loaded, of ${count(page.total)}`
  const open = rows.filter(
    (row) =>
      row.lifecycle === "ACTIVE" || row.lifecycle === "PARTIALLY_RECEIVED"
  )
  const value = open.reduce((sum, row) => sum + row.net_minor, 0)
  const late = rows.filter((row) => row.overdue).length
  // An order with no promised date cannot be late, and saying "0 overdue"
  // while most carry no date at all is a true number that reads as an
  // all-clear. The tile says how many it could not judge.
  const undated = rows.filter(
    (row) => row.expected_arrival === null && row.outstanding_stock_units > 0
  ).length
  return [
    { label: "Orders", value: count(page.total) },
    { label: "Still open", value: count(open.length), note },
    {
      label: "Overdue",
      value: count(late),
      note:
        undated === 0
          ? note
          : `${count(undated)} open orders carry no promised date, so they cannot be judged late${note === undefined ? "" : ` · ${note}`}`,
    },
    // Short, because a tile two columns wide cannot hold "Rp 49.923.900.000"
    // and a truncated figure is worse than a rounded one. The exact number is
    // on the title, where a hover finds it.
    {
      label: "On order",
      value: brief(value),
      note: `${money(value)}${note === undefined ? "" : ` · ${note}`}`,
    },
  ]
}

/// The record detail. It fetches its own read rather than being handed the row:
/// the list carries a summary, and the lines are only wanted once somebody
/// asks for one order.
function OrderSheet({
  id,
  onClose,
  onEdit,
}: {
  id: string | null
  onClose: () => void
  onEdit: (id: string) => void
}) {
  const detail = useQuery({
    queryKey: procurementKeys.order(id ?? ""),
    queryFn: ({ signal }) => purchaseOrderDetail(id!, signal),
    enabled: id !== null,
  })
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const cancel = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      cancelPurchaseOrder(
        orderId,
        reason === "" ? null : reason,
        idempotency.key
      ),
    onSuccess: (done) => {
      idempotency.rotate()
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
      void client.invalidateQueries({ queryKey: procurementKeys.suppliers() })
      toast.success(`${done.po_number} cancelled`)
    },
    // A refusal is said inside the confirmation that asked for it — see
    // `ConfirmButton` — not in a toast over a screen that has moved on.
  })

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "purchase_order", id }}
      onOpenChange={(open) => !open && onClose()}
      // The PO number IS the title. The supplier was, and it is already the
      // first fact in the body — so the head named the order after something
      // the document repeats two lines later, and the one string that
      // identifies it to everybody (the warehouse, the supplier, Finance) was
      // set in 12px mono above it.
      title={detail.data?.po_number ?? "Order"}
      caption={
        detail.data &&
        `Raised by ${detail.data.created_by} \u00b7 ${day(detail.data.issued_at)}`
      }
      badge={
        detail.data && (
          <Pill tone={poStatus(detail.data.lifecycle).tone}>
            {poStatus(detail.data.lifecycle).label}
          </Pill>
        )
      }
      actions={
        detail.data ? (
          <>
            {/* Offered only while the server would take the save: once goods,
                a bill or a price query stand against a line, the order is
                evidence and the button says why it is gone. */}
            <Button
              variant="ghost"
              size="sm"
              disabled={!detail.data.editable}
              title={detail.data.edit_blocked_reason ?? undefined}
              onClick={() => onEdit(detail.data.purchase_order_id)}
            >
              <Pencil />
              Edit
            </Button>
            {/* Only while nothing has been received, billed or advanced;
                after that an order is closed short instead. */}
            {detail.data.cancellable && (
              <ConfirmButton
                label="Cancel order"
                title={`Cancel ${detail.data.po_number}?`}
                description="The warehouse will stop receiving against this order. It stays on record as cancelled."
                confirmLabel="Cancel the order"
                tone="danger"
                variant="ghost"
                pending={cancel.isPending}
                className="h-8 px-2.5 text-[0.875rem]"
                reason={{
                  label: "Why",
                  optional: true,
                  placeholder: "Supplier cannot deliver this season",
                  hint: "Kept on the cancelled order.",
                }}
                onConfirm={(reason) =>
                  cancel.mutateAsync({
                    orderId: detail.data.purchase_order_id,
                    reason,
                  })
                }
              />
            )}
            <AppLink
              to="/operations/intake"
              sheet={{ key: "delivery", value: detail.data.po_number }}
              variant="ghost"
              size="sm"
            >
              Receiving
            </AppLink>
            <AppLink to="/finance/payables/bills" variant="ghost" size="sm">
              Invoicing
            </AppLink>
          </>
        ) : undefined
      }
      // Wider than a rail, because an order is a DOCUMENT rather than a
      // record: six columns of lines — what, when it is due, at what price,
      // how many ordered, how many arrived, what that came to — do not fit in
      // 27.5rem, and the two that were dropped to make them fit are the two a
      // buyer opens this to check.
      //
      // `md:` for the reason the composer's note gives: a bare `w-*` loses to
      // the rail's own `md:w-[27.5rem]` everywhere but a phone.
      width="wide"
      className="md:w-[58rem]"
    >
      {queryState(detail, {
        loading: "Loading the order…",
        render: (order) => <OrderDocument order={order} />,
      })}
    </Sheet>
  )
}

/// The composer over an issued order, seeded from what the server holds.
///
/// Fetches the same detail the order sheet reads — cached, so opening Edit
/// from the sheet costs nothing — and mounts the composer only once it has it:
/// a composer seeded from nothing and then from the order would flash an
/// empty form first.
function OrderEditor({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const navigate = useNavigate()
  const detail = useQuery({
    queryKey: procurementKeys.order(id ?? ""),
    queryFn: ({ signal }) => purchaseOrderDetail(id!, signal),
    enabled: id !== null,
  })
  const order = id !== null && detail.data?.editable ? detail.data : undefined
  return (
    <OrderComposer
      open={order !== undefined}
      editing={order}
      onClose={onClose}
      onRaised={(saved) => {
        toast.success(`${saved.po_number} updated`, {
          description: money(saved.net_minor),
        })
        // Back to the order, in one navigation — see the composer's own
        // `onRaised` above for why two would fight.
        void navigate({
          to: ".",
          search: (prev: Record<string, unknown>) => ({
            ...prev,
            "edit-order": undefined,
            order: saved.purchase_order_id,
          }),
          viewTransition: false,
        })
      }}
    />
  )
}

/// The order as the review draws it, because it is the same document.
///
/// The composer shows this shape before the order exists; this shows it
/// afterwards. They were two different screens about one piece of paper —
/// different tables, different facts, a status chip floating in the body of
/// one and not the other — so what somebody approved did not look like what
/// they came back to. This one now follows the review: the same two facts, the
/// same ruled grid, the same three-row ladder.
///
/// What the review has and this cannot: payment terms. `purchase_order` does
/// not store them, so there is no section to draw — an empty "Not agreed / no
/// schedule" block would be this screen inventing a fact.
function OrderDocument({ order }: { order: PurchaseOrderDetail }) {
  const pieces = order.lines.reduce(
    (sum, line) => sum + line.ordered_quantity,
    0
  )
  const received = order.lines.reduce(
    (sum, line) => sum + line.received_quantity,
    0
  )
  const pct =
    order.net_minor > 0
      ? Math.min(100, (order.expected_value_minor / order.net_minor) * 100)
      : 0
  const open =
    order.lifecycle === "ACTIVE" || order.lifecycle === "PARTIALLY_RECEIVED"
  const late =
    open &&
    order.expected_arrival !== null &&
    order.expected_arrival < new Date().toISOString().slice(0, 10)
  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="Supplier">{order.supplier_name ?? "—"}</Fact>
        <Fact term="Date created">
          {day(order.issued_at ?? order.created_at)}
        </Fact>
        <Fact term="Delivery date">
          <span className={late ? "font-medium text-bad-fg" : undefined}>
            {order.expected_arrival === null
              ? "—"
              : day(order.expected_arrival)}
            {late && " · late"}
          </span>
        </Fact>
        <Fact term="Receiving">
          {`${Math.round(pct)}% · ${money(order.expected_value_minor)}`}
        </Fact>
      </Facts>

      <Section title={`Lines (${order.lines.length})`} rule={false}>
        <div className="overflow-hidden rounded-inner border border-hairline">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] table-fixed border-collapse text-[0.875rem]">
              <colgroup>
                <col />
                <col className="w-[5.5rem]" />
                <col className="w-[6.5rem]" />
                <col className="w-[9rem]" />
                <col className="w-[9.5rem]" />
              </colgroup>
              <thead>
                <tr>
                  <th className={GRID_HEAD}>Item</th>
                  <th className={`${GRID_HEAD} text-right`}>Qty</th>
                  <th className={`${GRID_HEAD} text-right`}>Received</th>
                  <th className={`${GRID_HEAD} text-right`}>Price</th>
                  <th className={`${GRID_HEAD} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.po_line_id}>
                    <td className={GRID_CELL}>
                      <div className="flex items-center gap-2.5">
                        <Thumbnail
                          url={line.image_url}
                          fallback="—"
                          className="size-9 shrink-0 rounded-inner"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-ink">
                            {line.article_name}
                          </div>
                          <div className="truncate text-[0.875rem] text-body">
                            {[
                              line.division_code === null
                                ? "Unclassified"
                                : label(line.division_code),
                              ...line.tags.map((tag) => label(tag)),
                            ].join(" \u00b7 ")}
                          </div>
                          {/* What it sells for, and the SKUs it was ordered
                              in, when the buyer said. */}
                          {(line.base_price_minor != null ||
                            (line.variants ?? []).length > 0) && (
                            <div className="truncate text-[0.875rem] text-body">
                              {[
                                line.base_price_minor == null
                                  ? null
                                  : `Base ${money(line.base_price_minor)}${line.markup_bps == null ? "" : ` (+${line.markup_bps / 100}%)`}`,
                                ...(line.variants ?? []).map(
                                  (one) =>
                                    `${[one.colour_code, one.size_code].filter(Boolean).join("/")} \u00d7${one.quantity}${one.base_price_minor == null ? "" : ` @ ${money(one.base_price_minor)}`}`
                                ),
                              ]
                                .filter(Boolean)
                                .join(" \u00b7 ")}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td
                      className={`${GRID_CELL} text-right whitespace-nowrap tabular-nums`}
                    >
                      {line.order_unit_code && line.order_unit_quantity ? (
                        <span className="flex flex-col items-end leading-tight">
                          {`${line.order_unit_quantity.replace(".", ",")} ${line.order_unit_code}`}
                          <span className="text-mute">
                            {count(line.ordered_quantity)} pcs
                          </span>
                        </span>
                      ) : (
                        count(line.ordered_quantity)
                      )}
                    </td>
                    <td
                      className={`${GRID_CELL} text-right whitespace-nowrap tabular-nums`}
                    >
                      {count(line.received_quantity)}
                    </td>
                    <td
                      className={`${GRID_CELL} text-right whitespace-nowrap tabular-nums`}
                    >
                      {money(line.unit_price_minor)}
                    </td>
                    <td
                      className={`${GRID_CELL} text-right font-medium whitespace-nowrap text-ink tabular-nums`}
                    >
                      {money(line.ordered_value_minor)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-hairline bg-soft">
                  <td className="px-3 py-2.5 font-medium text-body">Total</td>
                  <td className="px-3 py-2.5 text-right font-medium text-ink tabular-nums">
                    {count(pieces)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium text-ink tabular-nums">
                    {count(received)}
                  </td>
                  <td />
                  <td className="px-3 py-2.5 text-right font-medium text-ink tabular-nums">
                    {money(order.gross_minor)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <TotalsLadder
          className="ml-auto w-full max-w-[26rem]"
          rows={[
            { label: "Lines", value: money(order.gross_minor) },
            {
              label: "Discount",
              value:
                order.discount_minor === 0
                  ? "—"
                  : `\u2212 ${money(order.discount_minor)}`,
            },
          ]}
          total={{
            label: "Net value",
            value: money(order.net_minor),
          }}
        />
      </Section>

      {/* No payment terms: payment is Finance's to arrange (the owner,
          2026-09-26). */}

      {order.notes !== null &&
        order.notes !== undefined &&
        order.notes.trim() !== "" && (
          <Section title="Notes">
            <p className="text-[0.875rem] leading-[1.375rem] whitespace-pre-wrap text-ink">
              {order.notes.trim()}
            </p>
          </Section>
        )}

      <OrderHistory order={order} />
    </div>
  )
}

/// Every saved edit of the order, newest first — the log the owner asked for
/// when edits were allowed until an order is finished.
function OrderHistory({ order }: { order: PurchaseOrderDetail }) {
  const revisions = order.revisions ?? []
  return (
    <Section title="History">
      <ol className="flex flex-col gap-3">
        {revisions.map((revision) => (
          <li
            key={revision.revision_id}
            className="rounded-inner border border-hairline px-3.5 py-3"
          >
            <div className="text-[0.875rem] text-body">
              Edited by <span className="text-ink">{revision.revised_by}</span>{" "}
              · {day(revision.revised_at)}{" "}
              {new Date(revision.revised_at).toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            <ul className="mt-1.5 flex flex-col gap-1">
              {revision.changes.length === 0 ? (
                <li className="text-[0.875rem] text-mute">
                  Saved without changes.
                </li>
              ) : (
                revision.changes.map((change, index) => (
                  <li key={index} className="text-[0.875rem] text-ink">
                    {describeChange(change)}
                  </li>
                ))
              )}
            </ul>
          </li>
        ))}
        <li className="px-3.5 text-[0.875rem] text-body">
          Created by <span className="text-ink">{order.created_by}</span> ·{" "}
          {day(order.issued_at ?? order.created_at)}
        </li>
      </ol>
    </Section>
  )
}

/// One logged change as a sentence.
function describeChange(change: Record<string, unknown>): string {
  const item = typeof change.item === "string" ? change.item : ""
  const field = String(change.field ?? "")
  const said = (value: unknown): string => {
    if (value === null || value === undefined || value === "") return "—"
    if (field === "unit_price" || field === "discount")
      return money(Number(value))
    if (field === "delivery_date") return day(String(value))
    if (typeof value === "number") return count(value)
    return String(value)
  }
  const names: Record<string, string> = {
    quantity: "qty",
    unit_price: "price",
    delivery_date: "delivery date",
    name: "name",
    notes: "notes",
    discount: "discount",
  }
  switch (change.kind) {
    case "added": {
      const to = (change.to ?? {}) as Record<string, unknown>
      return `Added ${item} — ${count(Number(to.quantity ?? 0))} × ${money(Number(to.unit_price_minor ?? 0))}`
    }
    case "removed":
      return `Removed ${item}`
    case "cancelled":
      return typeof change.to === "string" && change.to !== ""
        ? `Cancelled the order: ${change.to}`
        : "Cancelled the order"
    case "header":
      return `Changed ${names[field] ?? field}: ${said(change.from)} → ${said(change.to)}`
    default:
      return `${item}: ${names[field] ?? field} ${said(change.from)} → ${said(change.to)}`
  }
}

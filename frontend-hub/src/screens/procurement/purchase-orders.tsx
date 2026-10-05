import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { Menu } from "@base-ui/react/menu"
import { AppLink } from "@/components/ui/app-link"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnDef, Row, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardCheck,
  Pencil,
  RotateCcw,
  Search,
  X,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmButton, SavedDialog } from "@/components/ui/dialog"
import { DataTable } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Switch } from "@/components/ui/form"
import { DayRange, type DayWindow } from "@/components/ui/day-range"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ColumnsMenu, ListOptionsSheet } from "@/components/ui/list-chrome"
import { Pill } from "@/components/ui/pill"
import { Section } from "@/components/ui/rows"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import {
  useFilterState,
  type Filter,
  type FilterField,
  type FilterState,
  type Operator,
} from "@/lib/filters"
import { count, day, dayMonth, label, moment, money } from "@/lib/format"
import {
  cancelPurchaseOrder,
  catalogueVocabulary,
  closeLineShort,
  listSuppliers,
  orderScopeFromFilters,
  procurementKeys,
  purchaseOrderDetail,
  purchaseOrderPage,
  raisePurchaseReturn,
  supplierDetail,
  // Both hand-written beside their fetchers rather than generated, and
  // `PurchaseOrderPage` deliberately the local one: `@itulah/contract` exports
  // a type of the same name that this endpoint does not answer with.
  type PurchaseOrderDetail,
  type PurchaseOrderPage,
  type PurchaseOrderRow,
  type PurchaseOrderScope,
} from "@/lib/queries/procurement"
import { OrderComposer } from "@/screens/procurement/composer"
import {
  percentFromDiscount,
  percentText,
} from "@/screens/procurement/line-pricing-model"
import {
  CountReview,
  ReviewCountButton,
} from "@/screens/procurement/count-review"
import {
  useCountsAwaiting,
  useRecountingPos,
  useRecountReasons,
  useSilentDcSignIn,
} from "@/screens/procurement/count-review-state"
import { PoImportSheet } from "@/screens/procurement/import"
import {
  purchaseOrdersHtml,
  type PrintableOrder,
} from "@/screens/procurement/po-print"
import { openPrintWindow, printInto } from "@/screens/procurement/print"
import { downloadOrdersPdf } from "@/screens/procurement/po-pdf"
import { PrintMenu, type PrintChoice } from "@/screens/procurement/print-menu"
import {
  formatPhones,
  supplierDisplayName,
} from "@/screens/procurement/supplier-format"
import {
  SupplierName,
  useSupplierName,
} from "@/screens/procurement/supplier-name"
import {
  lineValue,
  pcs,
  poStatus,
  receivedGap,
  receivedTone,
  sentence,
  flattenSingles,
  useFittedVisibility,
  useActor,
  useIdempotencyKey,
} from "@/screens/procurement/shared"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { useDebounced } from "@/lib/use-debounced"

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

function safeUnits(value: unknown): number {
  if (typeof value === "number")
    return Number.isFinite(value) ? Math.max(0, value) : 0
  if (typeof value !== "string" || value.trim() === "") return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

/// The book in three, as the owner reads it (2026-09-28): what is still
/// coming, what is finished, what was called off. Each tab is the statuses
/// it stands for, and the request carries them.
const TABS = [
  {
    value: "active",
    label: "Active PO",
    statuses: ["ACTIVE", "PARTIALLY_RECEIVED"],
  },
  {
    value: "completed",
    label: "Completed PO",
    statuses: ["FULLY_RECEIVED", "SHORT_RECEIVED"],
  },
  { value: "cancelled", label: "Cancelled PO", statuses: ["CANCELLED"] },
] as const

type OrderTab = (typeof TABS)[number]["value"]

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

/// One figure added up over the rows in hand.
function sumOf(
  rows: readonly PurchaseOrderRow[],
  of: (row: PurchaseOrderRow) => number
): number {
  return rows.reduce((sum, row) => sum + of(row), 0)
}

/// The colour of a status word, by its tone.
const STATUS_TEXT: Record<ReturnType<typeof poStatus>["tone"], string> = {
  ok: "text-ok-fg",
  info: "text-info-fg",
  warn: "text-warn-fg",
  done: "text-body",
  neutral: "text-mute",
}

/// The list's columns (2026-09-29, the owner's order): PO · Delivery date ·
/// Qty ordered · Order value · Received qty · Received value · Status. One
/// figure a column, one line a cell; what has arrived is a bar against what
/// was ordered. Date created stays behind Columns. Widths are what each
/// heading and figure needs; the order's own column takes the rest.
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
    header: "PO",
    // Who the order is with names the row, and its number sits under it
    // (the owner, 2026-10-01): the supplier is what somebody is looking for.
    size: 200,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-0.5 leading-5">
        <span
          className="truncate text-[0.875rem] font-medium text-ink"
          title={row.original.supplier_name ?? undefined}
        >
          <SupplierName
            code={row.original.supplier_id}
            name={row.original.supplier_name}
          />
        </span>
        <span className="font-mono text-[0.875rem] text-mute">
          {row.original.po_number}
        </span>
      </span>
    ),
  },
  {
    id: "created",
    accessorFn: (row) => row.issued_at,
    header: "Date Created",
    size: 132,
    sortFn: "datetime",
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) => (
      <span className="tabular-nums">{day(row.original.issued_at)}</span>
    ),
  },
  {
    accessorKey: "expected_arrival",
    header: "Delivery Date",
    size: 132,
    // Red when it has passed and pieces are still owed — and those rows stand
    // at the top of the list.
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span
        className={
          row.original.overdue
            ? "font-medium text-bad-fg tabular-nums"
            : "tabular-nums"
        }
        title={row.original.overdue ? "Past its delivery date" : undefined}
      >
        {day(row.original.expected_arrival)}
      </span>
    ),
  },
  // Two heading rows (owner, 2026-10-02): what was ordered and what has
  // arrived, each as a quantity and a value under one heading.
  {
    id: "ordered",
    header: "Ordered",
    columns: [
      {
        // The pieces ordered, over however many lines.
        id: "qty_ordered",
        accessorFn: (row) => row.expected_stock_units,
        header: "Quantity",
        size: 176,
        meta: { align: "right", card: "hide", priority: 2 },
        cell: ({ row }) => (
          // Pieces, whatever unit the order was typed in; how many lines it
          // is made of stands under it.
          <span className="flex flex-col items-end leading-6 tabular-nums">
            <span className="whitespace-nowrap">
              {pcs(row.original.expected_stock_units)}
            </span>
            <span className="whitespace-nowrap text-mute">
              {`${count(row.original.line_count)} ${row.original.line_count === 1 ? "item" : "items"}`}
            </span>
          </span>
        ),
      },
      {
        // Net of the order's discount, PPN included — what is paid.
        accessorKey: "net_minor",
        header: "Value",
        size: 152,
        meta: { align: "right", card: "metric", priority: 2 },
        cell: ({ row }) => (
          <span className="font-medium whitespace-nowrap text-ink tabular-nums">
            {money(row.original.net_minor)}
          </span>
        ),
      },
    ],
  },
  {
    id: "received",
    header: "Received",
    columns: [
      {
        // The pieces that have arrived, as a share of the pieces ordered.
        id: "received_qty",
        accessorFn: (row) => row.received_stock_units,
        header: "Quantity",
        size: 176,
        meta: { align: "right", card: "hide" },
        cell: ({ row }) => {
          const gap = receivedGap(
            row.original.expected_stock_units,
            row.original.received_stock_units
          )
          return (
            <span className="flex flex-col items-end leading-6 tabular-nums">
              <span
                className={cn(
                  "whitespace-nowrap",
                  gap && "text-bad-fg",
                  row.original.received_stock_units === 0 && "text-mute"
                )}
              >
                {pcs(row.original.received_stock_units)}
              </span>
              {gap && (
                <span className="whitespace-nowrap text-bad-fg">
                  {gap.text}
                </span>
              )}
            </span>
          )
        },
      },
      {
        // What has arrived by value, as a share of the order's value (the owner:
        // "receiving hitung dari net value").
        accessorKey: "received_value_minor",
        header: "Value",
        size: 152,
        meta: { align: "right", card: "hide", priority: 2 },
        cell: ({ row }) => (
          <span
            className={cn(
              "whitespace-nowrap tabular-nums",
              row.original.received_value_minor === 0 && "text-mute"
            )}
          >
            {money(row.original.received_value_minor)}
          </span>
        ),
      },
    ],
  },
  {
    id: "invoicing",
    accessorFn: (row) => safeUnits(row.invoiced_stock_units),
    header: "Invoicing",
    size: 120,
    // Off by default; Columns brings it back.
    meta: { align: "right", card: "hide", priority: 3 },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {pcs(safeUnits(row.original.invoiced_stock_units))}
      </span>
    ),
  },
  {
    accessorKey: "lifecycle",
    header: "Status",
    // "Partially received" at 15px is 137px: the column needs that, the
    // cell's padding either side, and some air before the card's edge.
    size: 176,
    meta: { card: "status", swap: true },
    cell: ({ row }) => {
      const status = poStatus(row.original.lifecycle)
      const pendingExcess = row.original.excess_pending_stock_units
      // A word, no dot and no box (the owner, 2026-09-29): the colour says
      // whether it still wants somebody, and a finished order recedes.
      return (
        <span className="flex flex-col leading-5">
          <StatusWord
            po={row.original.po_number}
            className={cn("whitespace-nowrap", STATUS_TEXT[status.tone])}
            label={status.label}
            cancelled={noCountToReview(row.original.lifecycle)}
          />
          {/* Excess sits beside the status rather than in its own column: it
              is not where the order stands, it is a fact about it — and the
              owner does not want a chip for it (2026-09-29). */}
          {pendingExcess > 0 && (
            <span className="text-[0.875rem] whitespace-nowrap text-warn-fg">
              {`+${pcs(pendingExcess)} over`}
            </span>
          )}
        </span>
      )
    },
  },
]

/// The three questions a buyer narrows the book by, always on show: who, when
/// it was issued, when it is promised. Each is one or two clauses in the URL
/// (`?f=`), so a narrowed list can be linked and survives a reload. A phone
/// does not draw this row; its Filter button in `ListOptionsSheet` edits the
/// same clauses.
function FilterRow({
  filters,
  suppliers,
}: {
  filters: FilterState
  suppliers: readonly {
    supplier_code: string
    name: string
    legal_form?: string | null
  }[]
}) {
  const valueOf = (column: string, operator: Operator): string =>
    filters.filters.find(
      (one) => one.column === column && one.operator === operator
    )?.values[0] ?? ""
  /// Replace this column's clauses with the given ones, in ONE write — a
  /// range is two clauses, and two writes would each start from the same
  /// render's clauses and undo each other.
  const setColumn = (column: string, next: Filter[]) =>
    filters.set([
      ...filters.filters.filter((one) => one.column !== column),
      ...next,
    ])
  const range = (column: string): DayWindow => ({
    from: valueOf(column, "gte"),
    to: valueOf(column, "lte"),
  })
  const setRange = (column: string, next: DayWindow) =>
    setColumn(column, [
      ...(next.from === ""
        ? []
        : [{ column, operator: "gte" as const, values: [next.from] }]),
      ...(next.to === ""
        ? []
        : [{ column, operator: "lte" as const, values: [next.to] }]),
    ])
  const choices = useMemo(
    () =>
      suppliers.map((one) => ({
        value: one.supplier_code,
        label: supplierDisplayName(one),
      })),
    [suppliers]
  )
  const supplier = valueOf("supplier", "isAnyOf")
  const box = "h-[2.125rem] min-h-0 py-0"
  const anySet = filters.filters.length > 0

  return (
    <>
      <PickOne
        label="Supplier"
        placeholder="Supplier"
        choices={choices}
        value={supplier === "" ? null : supplier}
        onChange={(next) =>
          setColumn(
            "supplier",
            next === null
              ? []
              : [{ column: "supplier", operator: "isAnyOf", values: [next] }]
          )
        }
        className={cn(
          box,
          "w-52 shrink-0",
          choices.some((one) => one.value === supplier) &&
            "border-accent/40 bg-accent-bg [&_input]:text-accent"
        )}
      />
      <DayRange
        quiet
        label="Issued"
        placeholder="Issued"
        value={range("issued_at")}
        onChange={(next) => setRange("issued_at", next)}
        className={cn(box, "w-44 shrink-0")}
      />
      <DayRange
        quiet
        label="Delivery Date"
        placeholder="Delivery date"
        value={range("expected_arrival")}
        onChange={(next) => setRange("expected_arrival", next)}
        className={cn(box, "w-44 shrink-0")}
      />
      {anySet && (
        <Button
          size="sm"
          variant="ghost"
          aria-label="Clear filters"
          onClick={() => filters.clear()}
        >
          <X />
        </Button>
      )}
    </>
  )
}

/// The status word — or, when the Gudang's count waits for the buyer, the
/// action in the same place (an order with a count waiting is always active),
/// or "Recounting" while a count is being taken again.
function StatusWord({
  po,
  label,
  className,
  cancelled,
}: {
  po: string
  label: string
  className: string
  cancelled: boolean
}) {
  const waiting = useCountsAwaiting().get(po)
  const recounting = useRecountingPos().has(po)
  if (cancelled) return <span className={className}>{label}</span>
  if (waiting !== undefined && waiting.length > 0)
    return <ReviewCountButton po={po} inline />
  if (recounting)
    return <span className="whitespace-nowrap text-info-fg">Recounting</span>
  return <span className={className}>{label}</span>
}
/// An order that is cancelled or already complete takes no more goods, so a
/// count left waiting on it is stale: there is nothing to review.
function noCountToReview(lifecycle: string): boolean {
  return (
    lifecycle === "CANCELLED" ||
    lifecycle === "FULLY_RECEIVED" ||
    lifecycle === "SHORT_RECEIVED"
  )
}

export function PurchaseOrders() {
  const supplierNameOf = useSupplierName()
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
  /// The count the Gudang took, being reviewed by whoever raised the order.
  const review = useSheet("verify")
  // Counts are read from the DC, so the buyer's Central session opens one.
  useSilentDcSignIn()
  const navigate = useNavigate()
  // The first screenful is the work that has waited longest. The Receiving
  // column's comparator puts open orders first, then oldest promises, and
  // keeps completed orders newest-first below them.
  const [sorting, setSorting] = useState<SortingState>(defaultOrderSorting)
  const [groupBySupplier, setGroupBySupplier] = useState(false)
  const fit = useFittedVisibility(columns, {
    overdue: false,
    created: false,
    invoicing: false,
  })
  const visibility = fit.visibility
  /// The order raised a moment ago, while its line is still glowing. Cleared
  /// well after the glow ends, because the line only exists once the list has
  /// been read again.
  const [fresh, setFresh] = useState<string | null>(null)
  useEffect(() => {
    if (fresh === null) return
    const timer = window.setTimeout(() => setFresh(null), 8000)
    return () => window.clearTimeout(timer)
  }, [fresh])
  /// The suppliers whose group is folded shut, while the list is grouped.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [tab, setTab] = useState<OrderTab>("active")

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
            label: supplierDisplayName(one),
          })),
          // The picker offers a NAME where the request carries a code — for
          // the counted list as well, which arrives as bare codes.
          format: (code) => {
            const found = (suppliers.data ?? []).find(
              (one) => one.supplier_code === code
            )
            return found === undefined ? code : supplierDisplayName(found)
          },
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
      {
        // The day the supplier promised to deliver, from and to (the
        // owner, 2026-09-28). The same two clauses as Issued.
        column: "expected_arrival",
        label: "Delivery date",
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
      statuses: TABS.find((one) => one.value === tab)!.statuses,
      ...(needle === "" ? {} : { q: needle }),
    }),
    [filters.filters, needle, tab]
  )
  /// Whether anything is narrowing the list, which is a different question
  /// from whether the list is empty: "there are none" and "none match what you
  /// asked for" have different fixes.
  const narrowed = needle !== "" || filters.filters.length > 0

  const orders = useQuery({
    queryKey: procurementKeys.ordersPage(scope),
    queryFn: ({ signal }) => purchaseOrderPage(scope, signal),
    // The previous answer stays on screen while the next is fetched. Without
    // it every keystroke empties the table to a loading line and the screen
    // flashes its way through a word.
    placeholderData: (previous) => previous,
    // Counts and receipts land while the page is open: look again every half
    // minute while it is seen, and when the window comes back. Ten seconds
    // asked the whole order book 91 times in one test session; a count that
    // lands is also pushed here by the invalidation its own screen makes.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  const rows = useMemo(() => orders.data?.rows ?? [], [orders.data])

  const viewRows = rows

  /// How many orders each supplier has in the list, and what they add up to —
  /// the group headings' figures.
  const groups = useMemo(() => {
    const byName = new Map<string, { orders: number; total: number }>()
    for (const row of viewRows) {
      const group = byName.get(supplierOf(row)) ?? { orders: 0, total: 0 }
      group.orders += 1
      group.total += row.net_minor
      byName.set(supplierOf(row), group)
    }
    return byName
  }, [viewRows])

  const everyGroupShut =
    groups.size > 0 && [...groups.keys()].every((name) => collapsed.has(name))
  const tableColumns = useMemo(
    () =>
      groupBySupplier
        ? flattenSingles(columns, { ...visibility, ...fit.hidden }).map(
            (column) =>
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
        : flattenSingles(columns, { ...visibility, ...fit.hidden }),
    [fit.hidden, groupBySupplier, visibility]
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
      field.column === "supplier"
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
        // back out of anything the table hands back. Not while grouped: a
        // late order from another supplier would break the group, so the
        // groups are by supplier name and nothing else leads.
        state: {
          sorting: groupBySupplier ? sorting : [OVERDUE_FIRST, ...sorting],
          // A cancelled order took nothing in: its Receiving column is a
          // row of zeros, so that tab leaves it out.
          columnVisibility:
            tab === "cancelled"
              ? { ...fit.shown, received_qty: false }
              : fit.shown,
        },
        onColumnVisibilityChange: fit.change,
        onSortingChange: (
          next: SortingState | ((prev: SortingState) => SortingState)
        ) => {
          setGroupBySupplier(false)
          setCollapsed(new Set())
          setSorting((was) =>
            (typeof next === "function"
              ? next([OVERDUE_FIRST, ...was])
              : next
            ).filter((one) => one.id !== OVERDUE_FIRST.id)
          )
        },
      }),
      [groupBySupplier, sorting, tableColumns, fit.hidden, viewRows, visibility]
    )
  )

  const chooseSort = (id: string, desc: boolean) => {
    setGroupBySupplier(false)
    setCollapsed(new Set())
    setSorting([{ id, desc }])
  }

  const chooseGrouping = (on: boolean) => {
    setGroupBySupplier(on)
    setCollapsed(new Set())
    setSorting(on ? [{ id: "order", desc: false }] : defaultOrderSorting())
  }

  return (
    <PageContent>
      {/* The four figures of the tab showing, as cards over the list. */}
      <PageHeader title="Purchase Orders" small />
      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        {(
          bookKpis(orders.data) ??
          ["Orders", "Still open", "Overdue", "On order"].map((label) => ({
            label,
            value: "—",
            note: undefined,
          }))
        ).map((kpi) => (
          <div key={kpi.label} title={kpi.note}>
            <Kpi label={kpi.label} value={kpi.value} />
          </div>
        ))}
      </KpiStrip>

      <SubTabs
        tabs={TABS.map((one) => ({
          value: one.value,
          label: (
            <span>
              {one.label}
              <span className="ml-1.5 text-body tabular-nums">
                {count(
                  (orders.data?.facets.order_status ?? [])
                    .filter((facet) =>
                      (one.statuses as readonly string[]).includes(facet.value)
                    )
                    .reduce((sum, facet) => sum + facet.count, 0)
                )}
              </span>
            </span>
          ),
        }))}
        value={tab}
        onChange={(next) => {
          setTab(next as OrderTab)
          setCollapsed(new Set())
        }}
      />

      <PoImportSheet
        open={importing.value === true}
        onClose={importing.close}
      />

      <OrderComposer
        open={composer.value === true}
        onClose={composer.close}
        onReopen={() => composer.open(true)}
        onRaised={(saved) => {
          // The new line glows in the list for a few seconds (the owner,
          // 2026-10-04) — it is the one thing on screen that moved.
          setFresh(saved.purchase_order_id)
          // The composer has already said the new number, in the receipt
          // dialog that stays up over this list (the owner, 2026-10-04);
          // this runs the moment the save lands and closes back to the list.
          // Saving is not asking to read: the order is not
          // opened for them (owner, 2026-10-04) — it is on the list, one
          // click away, and the composer must still close and drop its own
          // parameter in one navigation, because two calls each read the
          // search that is on screen NOW and whichever landed second would
          // put the other's parameter back.
          void navigate({
            to: ".",
            search: (prev: Record<string, unknown>) => ({
              ...prev,
              "new-order": undefined,
            }),
            viewTransition: false,
          })
        }}
      />

      {/* One line from a tablet up, the width of the table, carrying
          everything that acts on it: the search and what narrows the book at
          the left, what shapes the table and what creates a new order at the
          right. The side panel that used to stand beside the list is gone
          (2026-09-28): it took 256px from a table that needs every one, and
          its figures are the cards above. On a phone: the search, and one
          button for filter and sort — see `ListOptionsSheet`. */}
      <div className="mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2">
        <span className="relative min-w-0 flex-1 lg:w-44 lg:flex-none">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
          <input
            value={search.value ?? ""}
            onChange={(event) =>
              event.target.value
                ? search.open(event.target.value)
                : search.close()
            }
            aria-label="Search orders"
            placeholder="Search orders"
            className="h-[2.125rem] w-full rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.875rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent pointer-coarse:h-11"
          />
        </span>
        <ListOptionsSheet
          model={filters}
          filterModel={{ ...filters, fields: counted }}
          table={table}
          sorting={sorting}
          onSort={chooseSort}
          className="lg:hidden"
        />
        <div className="hidden lg:contents">
          <FilterRow filters={filters} suppliers={suppliers.data ?? []} />
        </div>
        <div className="hidden md:contents">
          <span className="flex-1 max-lg:hidden" />
          {groupBySupplier && groups.size > 0 && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={everyGroupShut ? "Expand all" : "Collapse all"}
              title={everyGroupShut ? "Expand all" : "Collapse all"}
              onClick={() =>
                setCollapsed(
                  everyGroupShut ? new Set() : new Set(groups.keys())
                )
              }
            >
              {everyGroupShut ? <ChevronsUpDown /> : <ChevronsDownUp />}
            </Button>
          )}
          <ColumnsMenu
            table={table}
            label="View"
            extra={
              <Menu.Item
                closeOnClick={false}
                onClick={() => chooseGrouping(!groupBySupplier)}
                className="mb-1 flex min-h-8 cursor-default items-center justify-between gap-4 rounded-inner px-2 text-[0.875rem] text-ink outline-none select-none data-[highlighted]:bg-soft-2"
              >
                Group by supplier
                <span className="pointer-events-none">
                  <Switch
                    on={groupBySupplier}
                    label="Group by Supplier"
                    onToggle={() => {}}
                  />
                </span>
              </Menu.Item>
            }
          />
          {/* Import is hidden on the owner's instruction (2026-09-25)
              until the import flow is ready for buyers; the sheet and its
              `?import=` link still work. */}
          <Button variant="primary" onClick={() => composer.open(true)}>
            New order
          </Button>
        </div>
      </div>

      {/* New order on a phone: a floating button at the thumb's corner. */}
      <Fab label="New Order" onClick={() => composer.open(true)} />
      {/* `overflow-clip`, not `overflow-hidden`: hidden makes the card a
          scroll box, and the table's heading would stick to the card instead
          of the window. */}
      <div ref={fit.ref}>
        <Card className="overflow-clip">
          {queryState(orders, {
            loading: "Loading the orders…",
            render: () =>
              viewRows.length === 0 ? (
                narrowed ? (
                  <EmptyState>No order matches these filters.</EmptyState>
                ) : (
                  <EmptyState>Nothing here yet.</EmptyState>
                )
              ) : (
                <DataTable<PurchaseOrderRow>
                  table={table}
                  roomy
                  cardSort={false}
                  onRowClick={(row) => order.open(row.purchase_order_id)}
                  isSelected={(row) => row.purchase_order_id === order.value}
                  isFresh={(row) => row.purchase_order_id === fresh}
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
                    qty_ordered: pcs(
                      sumOf(viewRows, (row) => row.expected_stock_units)
                    ),
                    net_minor: money(sumOf(viewRows, (row) => row.net_minor)),
                    received_qty: pcs(
                      sumOf(viewRows, (row) => row.received_stock_units)
                    ),
                    received_value_minor: money(
                      sumOf(viewRows, (row) => row.received_value_minor)
                    ),
                  }}
                  // A heading before the first order of each supplier, while
                  // the list is grouped.
                  renderBefore={
                    groupBySupplier
                      ? (row, index, all) =>
                          index > 0 &&
                          supplierOf(all[index - 1]) ===
                            supplierOf(row) ? null : (
                            <GroupHeading
                              name={supplierNameOf(
                                row.supplier_id,
                                row.supplier_name
                              )}
                              group={groups.get(supplierOf(row))}
                              open={!collapsed.has(supplierOf(row))}
                              onToggle={() =>
                                setCollapsed((was) => {
                                  const next = new Set(was)
                                  if (!next.delete(supplierOf(row)))
                                    next.add(supplierOf(row))
                                  return next
                                })
                              }
                            />
                          )
                      : undefined
                  }
                  isHidden={
                    groupBySupplier
                      ? (row) => collapsed.has(supplierOf(row))
                      : undefined
                  }
                  pageScroll
                />
              ),
          })}
        </Card>
      </div>

      <OrderSheet
        id={order.value ?? null}
        onClose={order.close}
        onEdit={(id) => editing.open(id)}
      />
      <OrderEditor id={editing.value ?? null} onClose={editing.close} />
      <CountReview po={review.value ?? null} onClose={review.close} />
      {/* Mounted here rather than behind the trigger, because two of its three
          sheets are opened by URL from elsewhere: `?setup=<id>` is the link an
          article's detail follows back to the delivery that minted it. A sheet
          that only exists while its button has been pressed is a link that
          works for the person who clicked it and nobody else. */}
    </PageContent>
  )
}

/// The line above a supplier's orders while the list is grouped by supplier:
/// who, then how many and what they add up to, in muted text. Air above it
/// rather than a rule — the gap is what separates one supplier from the next.
function GroupHeading({
  name,
  group,
  open,
  onToggle,
}: {
  name: string
  group: { orders: number; total: number } | undefined
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex w-full items-center gap-2 px-3 pt-8 pb-2 text-left text-[0.875rem] outline-none focus-visible:text-ink"
    >
      <ChevronRight
        className={cn(
          "size-3.5 shrink-0 text-line-ico transition-transform duration-150",
          open && "rotate-90"
        )}
      />
      <span className="font-medium text-ink">{name}</span>
      {group && (
        <span className="text-body tabular-nums">
          {count(group.orders)} {group.orders === 1 ? "order" : "orders"} ·{" "}
          {money(group.total)}
        </span>
      )}
    </button>
  )
}

/// Orders on A5 for their suppliers, one sheet each, in a window of its own —
/// the way a supplier prints (`printSuppliers`). The window opens inside the
/// click — see `openPrintWindow` — and is filled once `load` has the orders
/// and their suppliers' addresses and the division names are read; the
/// suppliers are usually cached already. Resolves true once printed, false
/// when blocked or when an order could not be read.
async function printOrders(
  client: QueryClient,
  load: () => Promise<PurchaseOrderDetail[]>,
  choice: PrintChoice = { paper: "A5", pdf: false }
): Promise<boolean> {
  // The print window is opened now, inside the click — opened after the
  // reads it would come back a blocked pop-up. A PDF opens nothing: the
  // file lands in the browser's downloads (owner, 2026-10-04).
  const view = choice.pdf ? null : openPrintWindow()
  if (view !== null) {
    view.document.write(
      '<p style="font-family:sans-serif;color:#5b6158">Preparing the orders…</p>'
    )
  }
  try {
    const details = await load()
    const supplierIds = [
      ...new Set(
        details.flatMap((one) =>
          one.supplier_ref_id === null ? [] : [one.supplier_ref_id]
        )
      ),
    ]
    const [suppliers, vocabulary] = await Promise.all([
      Promise.all(
        supplierIds.map((supplierId) =>
          client
            .fetchQuery({
              queryKey: procurementKeys.supplier(supplierId),
              queryFn: ({ signal }) => supplierDetail(supplierId, signal),
            })
            .catch(() => null)
        )
      ),
      client
        .fetchQuery({
          queryKey: procurementKeys.vocabulary(),
          queryFn: ({ signal }) => catalogueVocabulary(signal),
          staleTime: 30 * 60 * 1000,
        })
        .catch(() => null),
    ])
    const orders: PrintableOrder[] = details.map((order) => ({
      order,
      supplier:
        suppliers[supplierIds.indexOf(order.supplier_ref_id ?? "")] ?? null,
    }))
    if (choice.pdf) {
      downloadOrdersPdf({
        orders,
        phone: (value) => (value ? formatPhones(value) : null),
        paper: choice.paper,
      })
      return true
    }
    if (view !== null) {
      printInto(
        view,
        purchaseOrdersHtml({
          orders,
          divisionLabel: (code) =>
            code === null
              ? "—"
              : (vocabulary?.divisions.find((term) => term.code === code)
                  ?.label ?? code),
          phone: (value) => (value ? formatPhones(value) : null),
          paper: choice.paper,
        })
      )
      return true
    }
    return false
  } catch {
    // A PDF that failed opened no window; a print's window closes with it.
    view?.close()
    toast.error("The orders could not be read. Try again.")
    return false
  }
}

/// Four figures about the book as it currently stands.
///
/// `total` is the server's own count over everything the search and the chips
/// match, so it is true whatever the page holds. The three sums are not: they
/// are added up over the rows in hand, and a book that runs past one page has
/// more of them. Rather than print a confident wrong total, a partial page
/// says `of {n} shown` under the figure — the number is still useful, and the
/// reader is told what it covers.
/// `49.923.900.000` → `Rp 49,9 billion`. Words, not the Indonesian jt/rb.
function brief(minor: number): string {
  const abs = Math.abs(minor)
  const [scale, suffix] =
    abs >= 1_000_000_000
      ? [1_000_000_000, " billion"]
      : abs >= 1_000_000
        ? [1_000_000, " million"]
        : abs >= 1_000
          ? [1_000, " thousand"]
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
/// The items table of an order, calm: horizontal rules only, one padding.
const HEAD_T =
  "border-b border-hairline bg-soft-2 px-4 py-3 text-left text-[0.875rem] font-medium whitespace-nowrap text-body"
const CELL_T = "border-t border-hairline px-4 py-4 align-middle"

export function OrderSheet({
  id,
  onClose,
  onEdit,
}: {
  id: string | null
  onClose: () => void
  onEdit: (id: string) => void
}) {
  const nameOfLogin = useNameOfLogin()
  const detail = useQuery({
    queryKey: procurementKeys.order(id ?? ""),
    queryFn: ({ signal }) => purchaseOrderDetail(id!, signal),
    enabled: id !== null,
  })
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  // A count the Gudang took, or is taking again, has to be settled first.
  const waitingCounts = useCountsAwaiting()
  const recountingPos = useRecountingPos()
  const countOpen =
    detail.data !== undefined &&
    ((waitingCounts.get(detail.data.po_number)?.length ?? 0) > 0 ||
      recountingPos.has(detail.data.po_number))

  /// The order on A5 for the supplier, the same document a ticked batch
  /// prints — see `printOrders`.
  const print = (data: PurchaseOrderDetail, choice: PrintChoice) =>
    printOrders(client, async () => [data], choice)

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
      setCancelledOrder(`PO ${done.po_number} is cancelled.`)
    },
    // A refusal is said inside the confirmation that asked for it — see
    // `ConfirmButton` — not in a toast over a screen that has moved on.
  })

  const actor = useActor()
  // What is still owed on a partly received order, and the call that gives it
  // up: every line with something outstanding is closed short, one by one.
  const stillOwed = (detail.data?.lines ?? []).filter(
    (line) =>
      line.closed_short_units == null &&
      line.received_quantity < line.ordered_quantity
  )
  const owedPieces = stillOwed.reduce(
    (sum, line) => sum + line.ordered_quantity - line.received_quantity,
    0
  )
  const closeShort = useMutation({
    mutationFn: async (reason: string) => {
      for (const line of stillOwed) {
        await closeLineShort(
          line.po_line_id,
          actor,
          reason.trim() === "" ? "Closed short from the order" : reason.trim()
        )
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
      if (id !== null)
        void client.invalidateQueries({ queryKey: procurementKeys.order(id) })
    },
  })

  /// The order the confirm cancelled, held in the receipt dialog until it is
  /// read — over the order sheet, which stays open on the cancelled record.
  /// This component outlives the sheet's openings.
  const [cancelledOrder, setCancelledOrder] = useState<string | null>(null)

  return (
    <>
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
          `Created by ${nameOfLogin(detail.data.created_by)} \u00b7 ${day(detail.data.issued_at)}`
        }
        // A finished or cancelled order says so with the stamp over its
        // document; the pill beside the number would say it twice.
        badge={
          detail.data &&
          !noCountToReview(detail.data.lifecycle) && (
            <Pill tone={poStatus(detail.data.lifecycle).tone}>
              {poStatus(detail.data.lifecycle).label}
            </Pill>
          )
        }
        actions={
          detail.data ? (
            <>
              {/* Edit opens the order's lines — quantities, prices, adding and
                taking off — and is offered only while the server would take
                the save: once the order is received in full, closed or
                cancelled it is evidence, and the button is not there. */}
              {detail.data.editable && (
                <Button
                  variant="primary"
                  size="sm"
                  title="Edit the items on this order"
                  onClick={() => onEdit(detail.data.purchase_order_id)}
                >
                  <Pencil />
                  Edit
                </Button>
              )}
              <PrintMenu
                onChoose={(choice) => void print(detail.data, choice)}
              />
              {/* Partly received and the rest is not coming: give it up here.
                It cannot be undone, so it asks. */}
              {detail.data.lifecycle === "PARTIALLY_RECEIVED" &&
                owedPieces > 0 && (
                  <ConfirmButton
                    label="Close Short"
                    title="Close This Short?"
                    description={`${pcs(owedPieces)} will be removed from the order, and the PO completes as received. This can't be undone.`}
                    confirmLabel="Close Short"
                    tone="danger"
                    variant="ghost"
                    size="sm"
                    pending={closeShort.isPending}
                    reason={{ label: "Reason for Closing" }}
                    onConfirm={(reason) => closeShort.mutateAsync(reason)}
                  />
                )}
              {/* Only while nothing has been received, billed or advanced;
                after that an order is closed short instead. */}
              {detail.data.cancellable && countOpen && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled
                  title="A count is waiting. Review it first."
                >
                  Cancel order
                </Button>
              )}
              {detail.data.cancellable && !countOpen && (
                <ConfirmButton
                  label="Cancel Order"
                  title={`Cancel ${detail.data.po_number}?`}
                  description="The warehouse will stop receiving against this order. It stays on record as cancelled."
                  cancelLabel="Keep Order"
                  confirmLabel="Cancel Order"
                  tone="danger"
                  variant="ghost"
                  size="sm"
                  pending={cancel.isPending}
                  reason={{
                    label: "Reason for Cancelling",
                    optional: true,
                  }}
                  onConfirm={(reason) =>
                    cancel.mutateAsync({
                      orderId: detail.data.purchase_order_id,
                      reason,
                    })
                  }
                />
              )}
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
      <SavedDialog
        open={cancelledOrder !== null}
        onOpenChange={(next) => {
          if (!next) setCancelledOrder(null)
        }}
        title={cancelledOrder ?? ""}
      />
    </>
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
  // Asked for an order the server will not take an edit of: say why, rather
  // than opening nothing.
  const blocked =
    id !== null && detail.data !== undefined && !detail.data.editable
  const blockedReason = detail.data?.edit_blocked_reason
  useEffect(() => {
    if (!blocked) return
    toast.error(
      sentence(blockedReason) ?? "This order can no longer be edited."
    )
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked])
  return (
    <OrderComposer
      open={order !== undefined}
      editing={order}
      onClose={onClose}
      onRaised={(saved) => {
        // The composer says the number itself, in the receipt dialog — this
        // only walks back to the order, in one navigation, because two
        // navigation calls would each read the search that is on screen NOW
        // and whichever landed second would put the other's parameter back.
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

/// What one of the line's own unit costs: the price agreed per unit when the
/// order kept one, else the per-piece price times the pieces in the unit — a
/// line ordered in kodi reads "Rp 20.000 / kodi", not "Rp 1.000 / pc".
function unitPriceText(line: PurchaseOrderDetail["lines"][number]): string {
  const unit = line.order_unit_code?.toLowerCase()
  if (unit === undefined || unit === "")
    return `${money(line.unit_price_minor)} / pc`
  const factor = Number(line.unit_factor ?? "1")
  const perUnit =
    line.order_unit_price_minor ??
    Math.round(line.unit_price_minor * (Number.isFinite(factor) ? factor : 1))
  return `${money(perUnit)} / ${unit}`
}

/// The count that waits for the buyer, at the head of the order's sheet — who
/// counted and when, with the way in to review it — or, when the buyer sent it
/// back, why. Nothing when no count is in play.
function CountBanner({ po, cancelled }: { po: string; cancelled: boolean }) {
  const waiting = useCountsAwaiting().get(po)
  const reason = useRecountReasons().get(po)
  const nameOfLogin = useNameOfLogin()
  if (cancelled) return null
  if (waiting !== undefined && waiting.length > 0) {
    const first = waiting[0]
    return (
      <div className="flex items-center gap-3 rounded-card bg-info-bg px-4 py-3.5 text-info-fg">
        <ClipboardCheck className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Counted at the Gudang</span>
          <span className="block text-[0.875rem]">
            {nameOfLogin(first.counted_by)}, {moment(first.counted_at)}
          </span>
        </span>
        <ReviewCountButton po={po} />
      </div>
    )
  }
  if (reason !== undefined) {
    return (
      <div className="flex items-center gap-3 rounded-card bg-warn-bg px-4 py-3.5 text-warn-fg">
        <RotateCcw className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Sent back to count</span>
          <span className="block text-[0.875rem]">{reason}</span>
        </span>
      </div>
    )
  }
  return null
}

/// The colour of a received figure (see `receivedTone`): green once the line
/// is whole, red while part of it is still owed, muted while nothing has come
/// in at all — not short, just not here.
function toneText(tone: "ok" | "bad" | null): string {
  return tone === "bad"
    ? "text-bad-fg"
    : tone === "ok"
      ? "text-ok-fg"
      : "text-mute"
}

/// One line's identity: the thumbnail, the article, and what it is. Shared by
/// the table row and the phone's card; how much has arrived stands beside it
/// in the Received column (see `OrderDocument`).
function LineItem({ line }: { line: PurchaseOrderDetail["lines"][number] }) {
  return (
    <div className="flex items-center gap-2.5">
      <Thumbnail
        url={line.image_url}
        name={line.article_name}
        division={line.division_code}
        fallback="—"
        className="size-9 shrink-0 rounded-inner"
      />
      <div className="min-w-0">
        <div className="truncate text-ink">{line.article_name}</div>
        <div className="truncate text-[0.875rem] text-body">
          {[
            line.division_code === null
              ? "Unclassified"
              : label(line.division_code),
            ...line.tags.map((tag) => label(tag)),
          ].join(" \u00b7 ")}
        </div>
        {/* Every receiving against the line, numbered when
          there was more than one; the total and its colour
          stand in the Received column. */}
        {receiptLines(line).length > 0 && (
          <div className="text-[0.875rem] text-body tabular-nums">
            <div>Received</div>
            <ul>
              {receiptLines(line).map((one) => (
                <li key={one.head + one.body} className="flex gap-2">
                  {/* A bullet only when there is more than one receiving to
                    tell apart. */}
                  {receiptLines(line).length > 1 && (
                    <span aria-hidden className="text-mute">
                      {"\u2022"}
                    </span>
                  )}
                  <span className="truncate">
                    {one.head === ""
                      ? one.body
                      : `${one.head} \u00b7 ${one.body}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
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
/// Payment terms are an optional choice on the order (a template from master
/// data); the fact is drawn only when one was chosen, never as "None".
function OrderDocument({ order }: { order: PurchaseOrderDetail }) {
  const pieces = order.lines.reduce(
    (sum, line) => sum + line.ordered_quantity,
    0
  )
  const received = order.lines.reduce(
    (sum, line) => sum + line.received_quantity,
    0
  )
  const open =
    order.lifecycle === "ACTIVE" || order.lifecycle === "PARTIALLY_RECEIVED"
  const late =
    open &&
    order.expected_arrival !== null &&
    order.expected_arrival < new Date().toISOString().slice(0, 10)
  // Why it was called off, as the cancel wrote it into the order's history.
  const cancelReason =
    order.lifecycle !== "CANCELLED"
      ? null
      : ((order.revisions ?? [])
          .flatMap((revision) => revision.changes)
          .map((change) =>
            change.kind === "cancelled" && typeof change.to === "string"
              ? change.to.trim()
              : ""
          )
          .find((reason) => reason !== "") ?? null)
  const nameOf = useSupplierName()
  /// What each line comes to, by the one rounding rule (see `lineValue`), and
  /// the order's lines added up.
  const amounts = order.lines.map((line) =>
    lineValue(line, line.ordered_quantity)
  )
  const gross = amounts.reduce((sum, one) => sum + one, 0)
  const totalTone = receivedTone(pieces, received)
  /// Pieces the order was closed short on, and what they were worth after
  /// their share of the discount: the invoice is the order less both. An order
  /// that was not closed short owes its whole total.
  const closedShortPieces = order.lines.reduce(
    (sum, line) => sum + (line.closed_short_units ?? 0),
    0
  )
  const closedShortValue =
    closedShortPieces > 0
      ? Math.max(0, gross - order.discount_minor - order.expected_value_minor)
      : 0
  const grandTotal = gross - order.discount_minor - closedShortValue
  /// The green stamp once the order is done, the red one once it is called
  /// off. Laid over the document's corner, not given a row of its own: it takes
  /// no room, and what is under it still reads through it.
  const stamp =
    order.lifecycle === "CANCELLED"
      ? { word: "CANCELLED", tone: "bad" as const }
      : order.lifecycle === "FULLY_RECEIVED"
        ? { word: "FULLY RECEIVED", tone: "ok" as const }
        : order.lifecycle === "SHORT_RECEIVED"
          ? { word: "CLOSED SHORT", tone: "ok" as const }
          : null
  return (
    <div className="relative flex flex-col gap-5">
      {stamp !== null && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1 right-2 z-10 inline-block -rotate-6 rounded-inner border-2 px-3 py-0.5 text-[1.125rem] font-bold tracking-[0.14em] opacity-40 select-none",
            stamp.tone === "ok"
              ? "border-ok-fg text-ok-fg"
              : "border-bad-fg text-bad-fg"
          )}
        >
          {stamp.word}
        </span>
      )}
      <CountBanner
        po={order.po_number}
        cancelled={noCountToReview(order.lifecycle)}
      />
      {/* The same air as the supplier's record: wide gaps between the facts. */}
      <Facts className="gap-x-10 gap-y-4 [&_dd]:mt-1">
        <Fact term="Supplier">
          {nameOf(
            order.supplier_id,
            order.supplier_name,
            order.supplier_ref_id
          )}
        </Fact>
        <Fact term="Delivery Date">
          <span className={late ? "font-medium text-bad-fg" : undefined}>
            {order.expected_arrival === null
              ? "—"
              : day(order.expected_arrival)}
          </span>
        </Fact>
        {order.payment_terms_code && (
          <Fact term="Payment Terms">
            {order.payment_terms_name ?? order.payment_terms_code}
          </Fact>
        )}
        <Fact term="Payment Method">{methodName(order.payment_method)}</Fact>
        {received > 0 && (
          // In pieces and in value, no percentage (the owner, 2026-10-05): the
          // list says "N pcs short", and a percentage by value said another
          // number for the same thing.
          <Fact term="Received">
            {/* Red only once it is short for good: the order is late or was
                closed short. A part-delivered open order is simply in
                progress. */}
            <span
              className={
                received < pieces &&
                (late || order.lifecycle === "SHORT_RECEIVED")
                  ? "text-bad-fg"
                  : undefined
              }
            >
              {`${count(received)} of ${count(pieces)} pcs \u00b7 ${money(order.expected_value_minor)} of ${money(gross - order.discount_minor)}`}
            </span>
          </Fact>
        )}
      </Facts>

      <Section title={`Items (${order.lines.length})`} rule={false} quiet>
        <div className="flex flex-col md:hidden">
          <ul className="flex flex-col overflow-hidden rounded-inner border border-hairline">
            {order.lines.map((line, index) => {
              const tone = receivedTone(
                line.ordered_quantity,
                line.received_quantity
              )
              return (
                <li
                  key={line.po_line_id}
                  className="flex flex-col gap-3 border-t border-hairline p-4 first:border-t-0"
                >
                  <LineItem line={line} />
                  <dl className="grid grid-cols-2 gap-3 text-[0.9375rem]">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-mute">Order Qty</dt>
                      <dd className="text-ink tabular-nums">
                        {pcs(line.ordered_quantity)}
                        {line.order_unit_code && line.order_unit_quantity && (
                          <span className="block text-mute">
                            {`${line.order_unit_quantity.replace(".", ",")} ${line.order_unit_code.toLowerCase()}`}
                          </span>
                        )}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-mute">Received</dt>
                      <dd className={`${toneText(tone)} tabular-nums`}>
                        {line.received_quantity === 0
                          ? "—"
                          : pcs(line.received_quantity)}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-mute">Unit Price</dt>
                      <dd className="text-ink tabular-nums">
                        {unitPriceText(line)}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-mute">Amount</dt>
                      <dd className="font-medium text-ink tabular-nums">
                        {money(amounts[index])}
                      </dd>
                    </div>
                  </dl>
                </li>
              )
            })}
            <li className="flex flex-col gap-2 border-t border-hairline bg-soft p-4 text-[0.9375rem]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-body">Total</span>
                <span className="font-medium text-ink tabular-nums">
                  {`${pcs(pieces)} \u00b7 ${money(gross)}`}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-body">Received</span>
                <span className={`${toneText(totalTone)} tabular-nums`}>
                  {`${received === 0 ? "\u2014" : pcs(received)}`}
                </span>
              </div>
              {order.discount_minor !== 0 && (
                <div className="flex items-baseline justify-between gap-3 text-body">
                  <span>
                    {`Discount \u00b7 ${percentText(order.discount_bps ?? percentFromDiscount(order.discount_minor, gross))} %`}
                    {pieces > 0 && (
                      <span className="block text-mute">
                        {`${money(Math.round(order.discount_minor / pieces))} / pc`}
                      </span>
                    )}
                  </span>
                  <span className="text-ink tabular-nums">
                    {`\u2212 ${money(order.discount_minor)}`}
                  </span>
                </div>
              )}

              {closedShortPieces > 0 && (
                <div className="flex items-baseline justify-between gap-3 text-body">
                  <span>{`Closed Short \u00b7 ${pcs(closedShortPieces)}`}</span>
                  <span className="text-ink tabular-nums">
                    {`\u2212 ${money(closedShortValue)}`}
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3 border-t border-hairline pt-2">
                <span className="font-medium text-body">Grand Total</span>
                <span className="font-medium text-ink tabular-nums">
                  {money(grandTotal)}
                </span>
              </div>
            </li>
          </ul>
        </div>
        <div className="hidden overflow-hidden rounded-inner border border-hairline md:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] table-fixed border-collapse text-[0.875rem]">
              <colgroup>
                <col />
                <col className="w-[9.5rem]" />
                <col className="w-[10rem]" />
                <col className="w-[9rem]" />
                <col className="w-[10rem]" />
              </colgroup>
              <thead>
                <tr>
                  <th className={HEAD_T}>Item</th>
                  <th className={`${HEAD_T} text-right`}>Ordered Quantity</th>
                  <th className={`${HEAD_T} text-right`}>Received Quantity</th>
                  <th className={`${HEAD_T} text-right`}>Unit Price</th>
                  <th className={`${HEAD_T} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line, index) => {
                  const tone = receivedTone(
                    line.ordered_quantity,
                    line.received_quantity
                  )
                  return (
                    <tr key={line.po_line_id}>
                      <td className={`${CELL_T}`}>
                        <LineItem line={line} />
                      </td>
                      <td
                        className={`${CELL_T} text-right whitespace-nowrap tabular-nums`}
                      >
                        {/* Pieces first; what was said in dozens or kodi under it. */}
                        {line.order_unit_code && line.order_unit_quantity ? (
                          <span className="flex flex-col items-end gap-0.5">
                            {pcs(line.ordered_quantity)}
                            <span className="text-mute">
                              {`${line.order_unit_quantity.replace(".", ",")} ${line.order_unit_code.toLowerCase()}`}
                            </span>
                          </span>
                        ) : (
                          pcs(line.ordered_quantity)
                        )}
                      </td>
                      <td
                        className={`${CELL_T} text-right whitespace-nowrap tabular-nums`}
                      >
                        {/* What has arrived, in the colour of how it stands
                          against the order: red short, green whole, muted
                          while nothing has come in. */}
                        <span className="flex flex-col items-end gap-0.5">
                          <span className={toneText(tone)}>
                            {line.received_quantity === 0
                              ? "—"
                              : pcs(line.received_quantity)}
                          </span>
                        </span>
                      </td>
                      <td
                        className={`${CELL_T} text-right whitespace-nowrap tabular-nums`}
                      >
                        {unitPriceText(line)}
                      </td>
                      <td
                        className={`${CELL_T} text-right font-medium whitespace-nowrap text-ink tabular-nums`}
                      >
                        <span className="flex flex-col items-end gap-0.5">
                          {money(amounts[index])}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-hairline bg-soft">
                  <td className="px-4 py-3 font-medium text-body">Total</td>
                  <td className="px-4 py-3 text-right font-medium whitespace-nowrap text-ink tabular-nums">
                    {pcs(pieces)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                    <span className="flex flex-col items-end gap-0.5">
                      <span className={toneText(totalTone)}>
                        {received === 0 ? "—" : pcs(received)}
                      </span>
                    </span>
                  </td>
                  <td />
                  <td className="px-4 py-3 text-right font-medium text-ink tabular-nums">
                    {money(gross)}
                  </td>
                </tr>
                {order.discount_minor !== 0 && (
                  <tr className="border-t border-hairline">
                    <td colSpan={4} className="px-4 py-3 text-body">
                      {`Discount \u00b7 ${percentText(order.discount_bps ?? percentFromDiscount(order.discount_minor, gross))} %`}
                      {pieces > 0 && (
                        <span className="block text-mute">
                          {`${money(Math.round(order.discount_minor / pieces))} / pc`}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-ink tabular-nums">
                      {`\u2212 ${money(order.discount_minor)}`}
                    </td>
                  </tr>
                )}

                {closedShortPieces > 0 && (
                  <tr className="border-t border-hairline">
                    <td colSpan={4} className="px-4 py-3 text-body">
                      {`Closed Short \u00b7 ${pcs(closedShortPieces)}`}
                    </td>
                    <td className="px-4 py-3 text-right text-ink tabular-nums">
                      {`\u2212 ${money(closedShortValue)}`}
                    </td>
                  </tr>
                )}
                <tr className="border-t border-hairline bg-soft">
                  <td colSpan={4} className="px-4 py-3 font-medium text-body">
                    Grand Total
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-ink tabular-nums">
                    {money(grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </Section>

      <BeyondTheOrder order={order} />

      {/* Payment terms sit in the facts above, only when chosen. */}

      {order.terms_and_conditions != null &&
        order.terms_and_conditions.trim() !== "" && (
          <Section title="Terms and Conditions" rule={false} quiet>
            <p className="text-[0.875rem] leading-[1.375rem] whitespace-pre-wrap text-ink">
              {order.terms_and_conditions.trim()}
            </p>
          </Section>
        )}

      {cancelReason !== null && (
        <Section title="Cancel Reason" rule={false} quiet>
          <p className="text-[0.875rem] leading-[1.375rem] whitespace-pre-wrap text-ink">
            {cancelReason}
          </p>
        </Section>
      )}

      {order.notes !== null &&
        order.notes !== undefined &&
        order.notes.trim() !== "" && (
          <Section title="Notes" rule={false} quiet>
            <p className="text-[0.875rem] leading-[1.375rem] whitespace-pre-wrap text-ink">
              {order.notes.trim()}
            </p>
          </Section>
        )}
    </div>
  )
}

/// One muted line per receiving against a line: "Received: 13 Sep · 230 pcs",
/// numbered ("Received 1: ...") when there was more than one. An older server
/// that sends no receipts still gets the total, without a date. A count that
/// named pieces as not the ordered article says so beside its receiving.
function receiptLines(
  line: PurchaseOrderDetail["lines"][number]
): { head: string; body: string }[] {
  const receipts = line.receipts ?? []
  if (receipts.length === 0)
    return line.received_quantity > 0
      ? [{ head: "", body: pcs(line.received_quantity) }]
      : []
  // One bullet per receiving: an order can arrive in two or three goes. What
  // counts as received is what matched the order — the excess goes back and is
  // said in Return to Supplier, not here.
  return receipts.map((one) => ({
    head: dayMonth(one.received_at),
    body: `${pcs(one.matched_quantity)}${
      one.wrong_quantity > 0
        ? ` · ${pcs(one.wrong_quantity)} not as ordered`
        : ""
    }`,
  }))
}

/// What arrived beyond what was ordered, and where it is going.
///
/// Shown only once there is something to say: a line still carrying pending
/// excess, or a return already raised against one that no longer does. One
/// action for the whole order — a buyer sending 3 pieces back on Monday and 2
/// more on Tuesday is not a decision anybody here is asking for.
function BeyondTheOrder({ order }: { order: PurchaseOrderDetail }) {
  const nameOf = useSupplierName()
  const supplier =
    order.supplier_name === null
      ? "the supplier"
      : nameOf(order.supplier_id, order.supplier_name, order.supplier_ref_id)
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const returns = order.returns ?? []
  const excessLines = order.lines.filter(
    (line) => line.excess_pending_quantity > 0
  )
  const pendingTotal = excessLines.reduce(
    (sum, line) => sum + line.excess_pending_quantity,
    0
  )
  const hasExcess = order.lines.some((line) => line.excess_quantity > 0)

  const raise = useMutation({
    mutationFn: () =>
      raisePurchaseReturn(order.purchase_order_id, {}, idempotency.key),
    onSuccess: (created) => {
      idempotency.rotate()
      void client.invalidateQueries({
        queryKey: procurementKeys.order(order.purchase_order_id),
      })
      void client.invalidateQueries({ queryKey: procurementKeys.orders() })
      void client.invalidateQueries({ queryKey: procurementKeys.returns() })
      setRaised({
        number: created.return_number,
        quantity: created.quantity,
        to: supplier,
      })
    },
  })
  /// The return the raise minted, held in the receipt dialog until it is
  /// read. This component survives the write — the order it stands on now
  /// carries the return — so the state lives here.
  const [raised, setRaised] = useState<{
    readonly number: string
    readonly quantity: number
    readonly to: string
  } | null>(null)

  if (!hasExcess && returns.length === 0) return null

  return (
    <Section title="Return to Supplier" rule={false} quiet>
      <div className="flex flex-col gap-3">
        {excessLines.length > 0 && (
          <>
            <ul className="flex flex-col gap-1.5">
              {excessLines.map((line) => (
                <li
                  key={line.po_line_id}
                  className="flex items-center justify-between gap-3 text-[0.875rem]"
                >
                  <span className="min-w-0 truncate text-ink">
                    {line.article_name}
                    <span className="ml-1.5 font-mono text-mute">
                      {line.article_code}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium text-warn-fg tabular-nums">
                    {`+${pcs(line.excess_pending_quantity)}`}
                  </span>
                </li>
              ))}
            </ul>
            <ConfirmButton
              label={`Return ${pcs(pendingTotal)} to supplier`}
              title="Send the Excess Back"
              description={`These ${count(pendingTotal)} pieces came beyond the order and go back to ${supplier}. The Gudang hands them over.`}
              confirmLabel="Raise the Return"
              className="self-start"
              pending={raise.isPending}
              onConfirm={() => raise.mutateAsync()}
            />
          </>
        )}
        {returns.length > 0 && (
          <ul className="flex flex-col gap-3">
            {/* Each return with what went back and what it was worth, and a way
              into the return itself. */}
            {returns.map((ret) => (
              <li
                key={ret.return_id}
                className="flex flex-col gap-1.5 rounded-inner border border-hairline p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <AppLink
                    to="/procurement/returns"
                    sheet={{ key: "allotment", value: ret.return_id }}
                    className="font-medium text-accent hover:underline"
                  >
                    {ret.return_number}
                  </AppLink>
                  <span className="text-[0.875rem] text-mute">
                    {ret.status !== "OPEN"
                      ? "Confirmed"
                      : ret.note_generated_at != null
                        ? "Generated"
                        : "Not Generated"}
                  </span>
                </div>
                {ret.lines.map((one) => {
                  const line = order.lines.find(
                    (l) => l.po_line_id === one.po_line_id
                  )
                  return (
                    <div
                      key={`${one.receipt_line_id}-${one.po_line_id}`}
                      className="flex items-baseline justify-between gap-3 text-[0.875rem]"
                    >
                      <span className="min-w-0 truncate text-ink">
                        {one.article_name}
                      </span>
                      <span className="shrink-0 text-body tabular-nums">
                        {line === undefined
                          ? pcs(one.quantity)
                          : `${pcs(one.quantity)} \u00b7 ${money(lineValue(line, one.quantity))}`}
                      </span>
                    </div>
                  )
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
      <SavedDialog
        open={raised !== null}
        onOpenChange={(next) => {
          if (!next) setRaised(null)
        }}
        title={<>{raised?.number} raised</>}
      >
        {raised === null
          ? undefined
          : `${pcs(raised.quantity)} to ${raised.to}`}
      </SavedDialog>
    </Section>
  )
}

/// An order's way of paying, as a person reads it. Giro unless the server
/// says otherwise: an older server sends none, and giro is the default.
function methodName(method: string | null | undefined): string {
  switch (method) {
    case "TRANSFER":
      return "Transfer"
    case "CASH":
      return "Cash"
    default:
      return "Giro"
  }
}

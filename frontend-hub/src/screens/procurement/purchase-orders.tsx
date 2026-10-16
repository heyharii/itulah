import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { AppLink } from "@/components/ui/app-link"
import { DocStamp } from "@/components/ui/doc-stamp"
import {
  keepPreviousData,
  useInfiniteQuery,
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
  Plus,
  RotateCcw,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { useIdentity } from "@/lib/session"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { DockTools } from "@/components/shell/dock-tools"
import { Fab } from "@/components/ui/fab"
import { SwitchPill } from "@/components/ui/form"
import { DayRange, type DayWindow } from "@/components/ui/day-range"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import {
  BarSpacer,
  ColumnsMenu,
  SearchSuggest,
} from "@/components/ui/list-chrome"
import { Pill } from "@/components/ui/pill"
import { Section } from "@/components/ui/rows"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import {
  useFilterState,
  type Filter,
  type FilterField,
  type FilterState,
  type Operator,
} from "@/lib/filters"
import {
  count,
  day,
  dayMonth,
  label,
  moment,
  money,
  moneyCompact,
  percentBps,
  quantity,
  recentMoment,
} from "@/lib/format"
import { prefetchOrder } from "@/screens/procurement/prefetch"
import {
  createPurchaseOrderLink,
  cancelPurchaseOrder,
  catalogueVocabulary,
  closeLineShort,
  orderBookQuery,
  orderDetailQuery,
  orderScopeFromFilters,
  procurementKeys,
  raisePurchaseReturn,
  supplierDetail,
  supplierItemDetail,
  supplierNamesQuery,
  // Both hand-written beside their fetchers rather than generated, and
  // `PurchaseOrderPage` deliberately the local one: `@itulah/contract` exports
  // a type of the same name that this endpoint does not answer with.
  type PurchaseOrderDetail,
  type PurchaseOrderPage,
  type PurchaseOrderRow,
  type PurchaseOrderScope,
} from "@/lib/queries/procurement"
import type { PurchaseCountAwaitingVerification } from "@itulah/contract"
import { useOutbox, type OutboxJob } from "@/lib/offline/po-outbox"
import { refreshReference, useOnline } from "@/lib/offline/reference"
import { OrderComposer } from "@/screens/procurement/composer"
import { ItemsTable } from "@/screens/procurement/items-table"
import { useVariantRows } from "@/screens/procurement/variant-words"
import {
  HeldOrderSheet,
  HELD_PREFIX,
  heldRow,
  isHeld,
} from "@/screens/procurement/held-orders"
import { percentFromDiscount } from "@/screens/procurement/line-pricing-model"
import {
  CountReview,
  ReviewCountButton,
} from "@/screens/procurement/count-review"
import {
  useCountsAwaiting,
  useRecountingPos,
  useRecalls,
  useSilentDcSignIn,
} from "@/screens/procurement/count-review-state"
import { PoImportSheet } from "@/screens/procurement/import"
import { colourKeys, listColours } from "@/lib/queries/colours"
import {
  cancellationOf,
  purchaseOrdersHtml,
  titled,
  type PrintableOrder,
} from "@/screens/procurement/po-print"
import { orderLink } from "@/screens/procurement/qr"
import { openPrintWindow, printInto } from "@/screens/procurement/print"
import { downloadOrdersPdf } from "@/screens/procurement/po-pdf"
import { PrintMenu, type PrintChoice } from "@/screens/procurement/print-menu"
import { LineSheet } from "@/screens/procurement/line-sheet"
import { SupplierSheet } from "@/screens/procurement/suppliers"
import {
  formatPhones,
  supplierDisplayName,
} from "@/screens/procurement/supplier-format"
import {
  SupplierName,
  useSupplierName,
  useSupplierRecordId,
} from "@/screens/procurement/supplier-name"
import {
  NOT_AS_ORDERED,
  returnLineParts,
} from "@/screens/procurement/return-lines"
import {
  isOpenOrder,
  lineValue,
  pcs,
  poStatus,
  receivedTone,
  sentence,
  flattenSingles,
  useFittedVisibility,
  useActor,
  useIdempotencyKey,
  STAMP,
  unitPriceText,
} from "@/screens/procurement/shared"
import { useLayout } from "@/lib/layout"
import { queryState } from "@/lib/query-state"
import { pullIn } from "@/lib/pull-in"
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

/// Nothing chosen: the rows stay in the order the server sends them — the
/// newest change first (`sort=updated`).
function defaultOrderSorting(): SortingState {
  return []
}

/// Orders with a count to review stand above everything else, then late ones,
/// whatever the list is sorted by — the owner's rule (2026-09-26, and the
/// review count first on 2026-10-05). A hidden first key in front of whatever
/// the header asked for.
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
  const leftPending = isOpenOrder(left)
  const rightPending = isOpenOrder(right)
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

/// What the counts waiting for review would add to an order if they were
/// taken as counted: the pieces that match the order (as many as the line
/// can still take), and beyond it the pieces that are not the article plus
/// any the line cannot take — the same split the review dialog makes. The
/// value is the matching pieces at the agreed price, less the order's
/// discount as the order's own value is (`net / gross`), or null when a line
/// has no price to go by.
interface Counted {
  readonly matched: number
  readonly beyond: number
  readonly value: number | null
}

function countedOf(
  counts: readonly PurchaseCountAwaitingVerification[] | undefined,
  order: PurchaseOrderRow
): Counted | undefined {
  if (counts === undefined || counts.length === 0) return undefined
  const kept = order.gross_minor > 0 ? order.net_minor / order.gross_minor : 1
  const lines = new Map<
    string,
    {
      correct: number
      wrong: number
      outstanding: number
      price: number | null
    }
  >()
  for (const one of counts) {
    const line = lines.get(one.po_line_id) ?? {
      correct: 0,
      wrong: 0,
      outstanding: one.outstanding_stock_units,
      price: one.unit_price_minor,
    }
    const wrong = one.wrong_quantity ?? 0
    line.correct += one.counted_quantity - wrong
    line.wrong += wrong
    lines.set(one.po_line_id, line)
  }
  let matched = 0
  let beyond = 0
  let value: number | null = 0
  for (const line of lines.values()) {
    const taken = Math.max(0, Math.min(line.correct, line.outstanding))
    matched += taken
    beyond += line.wrong + (line.correct - taken)
    value =
      value === null || line.price === null ? null : value + taken * line.price
  }
  return {
    matched,
    beyond,
    value: value === null ? null : Math.round(value * kept),
  }
}

/// A row of the list: the order, and whether and what the warehouse has counted
/// on it that waits for the buyer.
type ListRow = PurchaseOrderRow & {
  readonly review?: boolean
  readonly counted?: Counted
}

/// What an order has received as the list says it: what came in and was
/// accepted, plus what the warehouse has counted and nobody has yet reviewed —
/// so an order with "Review Count" next to it already says how many (the
/// owner, 2026-10-05). Beyond is the pieces that are not what was ordered.
function receivedOf(row: ListRow): {
  readonly matched: number
  readonly beyond: number
  readonly value: number
} {
  const counted = row.counted
  return {
    matched: row.received_stock_units + (counted?.matched ?? 0),
    beyond: row.excess_stock_units + (counted?.beyond ?? 0),
    value: row.received_value_minor + (counted?.value ?? 0),
  }
}

/// The list's columns (the owner, 2026-10-05): PO · Delivery date · Ordered ·
/// Received · Status. Ordered and Received each hold the pieces over what they
/// are worth, one heading over both, and the heading's menu sorts by either
/// (`meta.sortBy`, through the four hidden columns below). Date created and
/// Invoicing stay behind Columns. Widths are what each heading and figure
/// needs; the order's own column takes the rest.
const columns: ColumnDef<TableSetup, PurchaseOrderRow>[] = [
  {
    // The sort key that keeps the orders somebody has to act on on top: first
    // those with a count waiting for the buyer's review, then the orders made
    // offline and not yet sent (owner, 2026-10-05). The rest keep the server's
    // order, newest change first (owner, 2026-10-10 — late ones no longer
    // lead; they stay red). Never shown.
    id: "overdue",
    accessorFn: (row) =>
      (row as PurchaseOrderRow & { readonly review?: boolean }).review
        ? 0
        : isHeld(row)
          ? 1
          : 2,
    header: "",
    enableHiding: false,
    meta: { card: "hide" },
  },
  // Each figure of Ordered and Received as a column of its own, never drawn:
  // what the two headings' menus and the phone's sort sheet sort by.
  {
    id: "qty_ordered",
    accessorFn: (row) => row.expected_stock_units,
    header: "Ordered Quantity",
    enableHiding: false,
    meta: { card: "hide" },
  },
  {
    accessorKey: "net_minor",
    header: "Ordered Value",
    enableHiding: false,
    meta: { card: "hide" },
  },
  {
    id: "received_qty",
    accessorFn: (row) => receivedOf(row as ListRow).matched,
    header: "Received Quantity",
    enableHiding: false,
    meta: { card: "hide" },
  },
  {
    id: "received_value_minor",
    accessorFn: (row) => receivedOf(row as ListRow).value,
    header: "Received Value",
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
          // The name is what somebody is looking for, so where the row is a
          // card (a phone or a tablet) it is the largest and heaviest thing in
          // it: 16px semibold, over the number in regular weight. It may take
          // two lines there rather than lose the end of a long name.
          className="truncate text-[0.9375rem] font-medium text-ink max-lg:line-clamp-2 max-lg:text-[1rem] max-lg:font-semibold max-lg:whitespace-normal"
          title={row.original.supplier_name ?? undefined}
        >
          <SupplierName
            code={row.original.supplier_id}
            name={row.original.supplier_name}
          />
        </span>
        {/* How many lines the order is made of stands beside its number: it
            says something about the order, not about the pieces. */}
        <span className="truncate text-[0.9375rem] font-normal text-mute">
          <span className="font-mono">{row.original.po_number}</span>
          {` · ${count(row.original.line_count)} ${row.original.line_count === 1 ? "item" : "items"}`}
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
    // at the top of the list. On a card it stands under the status instead
    // (the status cell draws it there), so the card has two straight edges.
    meta: { card: "hide" },
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
  // A finished order is read by when it came in, not when it was due (owner,
  // 2026-10-16): Completed shows this in place of Delivery Date.
  {
    id: "received_date",
    accessorFn: (row) => row.fulfilled_at,
    header: "Received Date",
    size: 132,
    sortFn: "datetime",
    meta: { card: "hide" },
    // "+3 days" under it, in red, when it came in after its delivery date
    // (owner, 2026-10-16).
    cell: ({ row }) => {
      const { fulfilled_at, expected_arrival } = row.original
      if (fulfilled_at === null) return <span className="tabular-nums">—</span>
      const late =
        expected_arrival === null
          ? 0
          : Math.round(
              (Date.parse(fulfilled_at.slice(0, 10)) -
                Date.parse(expected_arrival.slice(0, 10))) /
                86_400_000
            )
      return (
        <span className="flex flex-col tabular-nums">
          <span>{day(fulfilled_at)}</span>
          {late > 0 && (
            <span className="text-[0.9375rem] text-bad-fg">
              {`+${late} ${late === 1 ? "day" : "days"}`}
            </span>
          )}
        </span>
      )
    },
  },
  // A cancelled order never came in: it is read by when it was cancelled —
  // the last thing that happened to it (owner, 2026-10-16).
  {
    id: "cancelled_date",
    accessorFn: (row) => row.updated_at,
    header: "Cancelled Date",
    size: 132,
    sortFn: "datetime",
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="tabular-nums">{day(row.original.updated_at)}</span>
    ),
  },
  // What was ordered and what has arrived, one column each (the owner,
  // 2026-10-05): the pieces on top, what they are worth under them in the
  // quiet colour. The heading's menu sorts by either figure.
  {
    id: "ordered",
    accessorFn: (row) => row.expected_stock_units,
    header: "Ordered",
    enableSorting: false,
    // "Rp 11.976.240.000" at 15px and the cell's padding, and no more: at
    // 1024px the five columns fit with room for a Windows scrollbar.
    size: 172,
    meta: {
      align: "right",
      // A card says it in its lead figure and foot instead.
      card: "hide",
      // Never given up for room (the owner, 2026-10-16): a 12-inch laptop
      // keeps what was ordered beside what has come in.
      sortBy: [
        { id: "qty_ordered", label: "Quantity" },
        { id: "net_minor", label: "Value" },
      ],
    },
    cell: ({ row }) => (
      // Pieces, whatever unit the order was typed in, over the value net of
      // the order's discount, PPN included — what is paid.
      <span className="flex flex-col items-end leading-6 tabular-nums">
        <span className="font-medium whitespace-nowrap text-ink">
          {pcs(row.original.expected_stock_units)}
        </span>
        <span className="whitespace-nowrap text-mute">
          {money(row.original.net_minor)}
        </span>
      </span>
    ),
  },
  {
    id: "received",
    accessorFn: (row) => receivedOf(row as ListRow).matched,
    header: "Received",
    enableSorting: false,
    size: 172,
    meta: {
      align: "right",
      // A card says it in its foot instead.
      card: "hide",
      sortBy: [
        { id: "received_qty", label: "Quantity" },
        { id: "received_value_minor", label: "Value" },
      ],
    },
    cell: ({ row }) => {
      const ordered = row.original.expected_stock_units
      const { matched, beyond, value } = receivedOf(row.original as ListRow)
      if (matched === 0 && beyond === 0)
        return (
          <span className="whitespace-nowrap text-mute tabular-nums">
            {pcs(0)}
          </span>
        )
      // The pieces that match the order, red while they are not all of it,
      // and in brackets whatever came beyond it — over the order or not the
      // article it names — always red: "580 pcs (+20)" on an order of 600 is
      // 580 right, 20 to go back, 20 still owed (the owner, 2026-10-05).
      // Under them, what the matching pieces are worth: what is paid
      // ("receiving hitung dari net value").
      return (
        <span className="flex flex-col items-end leading-6 tabular-nums">
          {/* The bracket drops under the pieces when the two do not fit on
              one line ("120.000 pcs (+12.000)"), never cut off. */}
          <span>
            <span
              className={cn(
                "font-medium whitespace-nowrap text-ink",
                matched !== ordered && "text-bad-fg"
              )}
            >
              {pcs(matched)}
            </span>
            {beyond > 0 && (
              <>
                {" "}
                <span className="whitespace-nowrap text-bad-fg">{`(+${count(beyond)})`}</span>
              </>
            )}
          </span>
          <span className="whitespace-nowrap text-mute">{money(value)}</span>
        </span>
      )
    },
  },
  // Three columns that exist only on a card (under 1024px; `cardLead`): the
  // promised day under the number, the figure the card leads with, and the
  // foot's left side — what has come in. The table says the same in its own
  // columns (the owner, 2026-10-06).
  {
    id: "delivery",
    accessorFn: (row) => row.expected_arrival,
    header: "Delivery",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => (
      <span>
        {"Delivery "}
        <span
          className={
            row.original.overdue
              ? "font-medium text-bad-fg tabular-nums"
              : "text-ink tabular-nums"
          }
        >
          {day(row.original.expected_arrival)}
        </span>
      </span>
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.expected_stock_units,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      // What was ordered, big, over what it is worth.
      <span className="flex flex-col items-end tabular-nums">
        <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
          {count(row.original.expected_stock_units)}
          <span className="text-[0.9375rem] font-normal tracking-normal text-mute">
            {row.original.expected_stock_units === 1 ? " pc" : " pcs"}
          </span>
        </span>
        <span className="mt-0.5 text-[0.9375rem] text-mute">
          {money(row.original.net_minor)}
        </span>
      </span>
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => receivedOf(row as ListRow).matched,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => <CardFoot row={row.original as ListRow} />,
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
    // "Partially received" at 15px is 137px, and the stamp "FULLY RECEIVED"
    // in bold capitals with its double rule is 152: the column needs the
    // wider, the cell's padding either side, and some air.
    size: 200,
    meta: { card: "status", swap: true },
    cell: ({ row }) => {
      const status = poStatus(row.original.lifecycle)
      const pendingExcess = row.original.excess_pending_stock_units
      // On the desk a word, no dot and no box (the owner, 2026-09-29): the
      // colour says whether it still wants somebody, and a finished order
      // recedes. On a card an open order keeps its status at the top right,
      // and a finished one has it pressed on like a rubber stamp, floating
      // over the card's right side (the owner, 2026-10-05).
      const finished = noCountToReview(row.original.lifecycle)
      return (
        <span className="flex flex-col leading-5 max-lg:items-end">
          {!finished && (
            <span className="max-lg:hidden">
              <StatusWord
                po={row.original.po_number}
                className={cn("whitespace-nowrap", STATUS_TEXT[status.tone])}
                label={status.label}
                cancelled={false}
              />
            </span>
          )}
          {finished ? (
            <span
              className={cn(
                STAMP,
                row.original.lifecycle === "FULLY_RECEIVED"
                  ? "text-ok-fg"
                  : row.original.lifecycle === "SHORT_RECEIVED"
                    ? "text-bad-fg"
                    : "text-mute"
              )}
            >
              {status.label}
              {/* The day it was finished, inside the stamp as on a date
                  stamp, without the year (the owner, 2026-10-05). */}
              {row.original.fulfilled_at !== null && (
                <span className="block tabular-nums">
                  {dayMonth(row.original.fulfilled_at)}
                </span>
              )}
            </span>
          ) : (
            // On a card the pill (or the Review Count button) stands in the
            // foot, on the right, where the stamp stands for a finished order
            // (the owner, 2026-10-06).
            <span className="flex lg:hidden">
              <StatusWord
                po={row.original.po_number}
                className=""
                label={status.label}
                cancelled={false}
                stamp={status.tone}
              />
            </span>
          )}
          {/* Excess sits beside the status rather than in its own column: it
              is not where the order stands, it is a fact about it — and the
              owner does not want a chip for it (2026-09-29). Not on a card,
              where the red bracket on its figures already says it. */}
          {pendingExcess > 0 && (
            <span className="text-[0.9375rem] whitespace-nowrap text-warn-fg max-lg:hidden">
              {`+${pcs(pendingExcess)} over`}
            </span>
          )}
        </span>
      )
    },
  },
]

/// A card's foot, on the left: what has come in. "Received 6 pcs" over what
/// the pieces are worth, the figure heavier than its word, red while the pieces
/// are not the whole order and whatever came beyond it in red brackets — the
/// table's rules, and `cardTone` washes the foot for the same reason. An order
/// made offline has nothing to receive: it says when it was made (the owner,
/// 2026-10-06).
function CardFoot({ row }: { readonly row: ListRow }) {
  if (isHeld(row)) return <span>{`Made ${moment(row.issued_at)}`}</span>
  const ordered = row.expected_stock_units
  const { matched, beyond, value } = receivedOf(row)
  if (matched === 0 && beyond === 0)
    return (
      <span className="tabular-nums">
        {"Received "}
        <span>{pcs(0)}</span>
      </span>
    )
  return (
    <span className="flex flex-col leading-6 tabular-nums">
      <span>
        {"Received "}
        <span
          className={cn(
            "text-cell font-semibold whitespace-nowrap text-ink",
            matched !== ordered && "text-bad-fg"
          )}
        >
          {pcs(matched)}
        </span>
        {beyond > 0 && (
          <>
            {" "}
            <span className="text-cell font-semibold whitespace-nowrap text-bad-fg">{`(+${count(beyond)})`}</span>
          </>
        )}
      </span>
      <span>{money(value)}</span>
    </span>
  )
}

/// Whether a card wants a look: the pieces in hand are not the order, or came
/// beyond it. An order made offline has nothing to look at yet.
function cardToneOf(row: PurchaseOrderRow): "alert" | undefined {
  if (isHeld(row)) return undefined
  const { matched, beyond } = receivedOf(row as ListRow)
  const started = matched > 0 || beyond > 0
  return started && (matched !== row.expected_stock_units || beyond > 0)
    ? "alert"
    : undefined
}

/// The three questions a buyer narrows the book by, always on show: who, when
/// it was issued, when it is promised. Each is one or two clauses in the URL
/// (`?f=`), so a narrowed list can be linked and survives a reload. A phone
/// does not draw this row; its Filter button in `ListOptionsSheet` edits the
/// same clauses.
function FilterRow({ filters }: { filters: FilterState }) {
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
  const box = "h-control min-h-0 py-0"
  const anySet = filters.filters.length > 0

  return (
    <>
      <DayRange
        label="Created at"
        placeholder="Created at"
        value={range("issued_at")}
        onChange={(next) => setRange("issued_at", next)}
        className={cn(box, "w-44 shrink-0")}
      />
      <DayRange
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

/// The status word — or, when the warehouse's count waits for the buyer, the
/// action in the same place (an order with a count waiting is always active).
/// A count being taken again changes nothing here: the order stays Active
/// (owner, 2026-10-10).
function StatusWord({
  po,
  label,
  className,
  cancelled,
  stamp,
}: {
  po: string
  label: string
  className: string
  cancelled: boolean
  /// On a card the status is a stamp — the order's state pressed onto it, as
  /// on paper — rather than a coloured word (the owner, 2026-10-05).
  stamp?: ReturnType<typeof poStatus>["tone"]
}) {
  const waiting = useCountsAwaiting().get(po)
  const word = (text: string, tone: ReturnType<typeof poStatus>["tone"]) =>
    stamp === undefined ? (
      <span className={className}>{text}</span>
    ) : (
      <Pill tone={tone}>{text}</Pill>
    )
  if (cancelled) return word(label, stamp ?? "neutral")
  if (waiting !== undefined && waiting.length > 0)
    return <ReviewCountButton po={po} inline />
  return word(label, stamp ?? "neutral")
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
  const client = useQueryClient()
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
  /// The count the warehouse took, being reviewed by whoever raised the order.
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
    delivery: false,
    lead: false,
    foot: false,
    qty_ordered: false,
    net_minor: false,
    received_qty: false,
    received_value_minor: false,
    created: false,
    invoicing: false,
  })
  const visibility = fit.visibility
  /// Whether the rows are cards: a phone, or a tablet (`cardsOnTablet`).
  const layout = useLayout()
  const cards = layout === "phone" || layout === "tablet"
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
  /// Orders made with no connection and not yet sent, and the one being read
  /// or taken back to the form (`held-orders.tsx`).
  const actor = useActor()
  const online = useOnline()
  const held = useOutbox()
  const outbox = useMemo(
    () => held.filter((job) => job.owner === actor),
    [held, actor]
  )
  const [heldOpen, setHeldOpen] = useState<string | null>(null)
  const [resume, setResume] = useState<OutboxJob | null>(null)
  // Keep the device's copy of the masters a purchase order is written
  // against current while there is a connection, so there is one to write
  // it from when there is not.
  useEffect(() => {
    void refreshReference()
  }, [])

  /// The suppliers, for the filter's own picker. Small, cached by every other
  /// procurement screen, and the reason the chip can offer a NAME where the
  /// request carries a code.
  const suppliers = useQuery(supplierNamesQuery())

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
          searchable: true,
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
        label: "Created at",
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
  /// The suppliers the search offers by name, and the one already taken. The
  /// clause is the same `supplier` one the filter row drew a picker for, so a
  /// link that carries it still narrows the book.
  const supplierChoices = useMemo(
    () =>
      (suppliers.data ?? []).map((one) => ({
        value: one.supplier_code,
        label: supplierDisplayName(one),
      })),
    [suppliers.data]
  )
  const pickedSupplier = filters.filters.find(
    (one) => one.column === "supplier" && one.operator === "isAnyOf"
  )?.values[0]

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
      // Newest change first (owner, 2026-10-10); the orders waiting for a
      // review still stand above it — the hidden first key.
      sort: "updated",
    }),
    [filters.filters, needle, tab]
  )
  /// Whether anything is narrowing the list, which is a different question
  /// from whether the list is empty: "there are none" and "none match what you
  /// asked for" have different fixes.
  const narrowed = needle !== "" || filters.filters.length > 0

  // The book runs past one page — 22,914 completed orders is 115 pages of 200 —
  // so the list asks for the next page as the table is scrolled to its end
  // (`more`), instead of stopping at the first. The totals and the facets are
  // the first page's: the server counts them over the whole book.
  const book = useInfiniteQuery({
    ...orderBookQuery(scope),
    // Counts and receipts land while the page is open: look again every half
    // minute while it is seen, and when the window comes back. Ten seconds
    // asked the whole order book 91 times in one test session; a count that
    // lands is also pushed here by the invalidation its own screen makes. Once
    // more than the first page is in hand a refresh would ask for all of them
    // again, so the list then waits for a window focus instead.
    refetchInterval: (query) =>
      (query.state.data?.pages.length ?? 1) > 1 ? false : 30_000,
    refetchOnWindowFocus: true,
    // Another tab: the rows in hand stay, dimmed (`list-swap`), until the
    // next tab's land — no blink to the loading state between.
    placeholderData: keepPreviousData,
  })
  const orders = useMemo(() => {
    const pages = book.data?.pages
    const merged: PurchaseOrderPage | undefined =
      pages === undefined
        ? undefined
        : {
            ...pages[0],
            rows: pages.flatMap((one) => one.rows),
            next_cursor: pages[pages.length - 1].next_cursor,
          }
    return { ...book, data: merged }
  }, [book])

  const rows = useMemo(() => orders.data?.rows ?? [], [orders.data])

  /// The orders the warehouse has counted something on, waiting for the buyer.
  /// Carried on each row so the hidden first sort key can put them on top.
  const awaiting = useCountsAwaiting()
  const viewRows = useMemo(
    () => [
      // Orders not yet sent stand first, among the open ones. The search
      // narrows them by supplier; the other filters are the server's and do
      // not reach what the server has not seen.
      ...(tab === "active"
        ? outbox
            .filter(
              (job) =>
                needle === "" ||
                job.supplier_name.toLowerCase().includes(needle.toLowerCase())
            )
            .map(heldRow)
        : []
      ).map((row) => ({ ...row, review: false, counted: undefined })),
      ...rows.map((row) => ({
        ...row,
        review: (awaiting.get(row.po_number)?.length ?? 0) > 0,
        counted: countedOf(awaiting.get(row.po_number), row),
      })),
    ],
    [rows, awaiting, outbox, tab, needle]
  )

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
          // Cards (under 1024px) are laid out down the page, so nothing is
          // given up for width there: a card shows Ordered and Received
          // whatever the fitted table would have dropped. A cancelled order
          // took nothing in: its Received column is a row of zeros, so that
          // tab leaves it out.
          columnVisibility: {
            ...(cards ? fit.visibility : fit.shown),
            delivery: cards,
            lead: cards,
            foot: cards,
            ...(tab === "cancelled" ? { received: false } : {}),
            ...(tab === "active"
              ? { received_date: false, cancelled_date: false }
              : tab === "completed"
                ? {
                    expected_arrival: false,
                    received_date: !cards,
                    cancelled_date: false,
                  }
                : {
                    expected_arrival: false,
                    received_date: false,
                    cancelled_date: !cards,
                  }),
          },
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
      [
        groupBySupplier,
        sorting,
        tableColumns,
        fit.hidden,
        viewRows,
        visibility,
        cards,
      ]
    )
  )

  /// How many orders each tab holds, from the server's own tally of the whole
  /// search (so it does not move as the list is narrowed to a tab).
  const facetCount = (statuses: readonly string[]) =>
    (orders.data?.facets.order_status ?? [])
      .filter((facet) => statuses.includes(facet.value))
      .reduce((sum, facet) => sum + facet.count, 0)
  const chooseGrouping = (on: boolean) => {
    setGroupBySupplier(on)
    setCollapsed(new Set())
    setSorting(on ? [{ id: "order", desc: false }] : defaultOrderSorting())
  }

  return (
    <PageContent>
      {/* The screen's one action stands in its head, at the right
          (hub-ui-patterns, 14 Oct); a phone has the + at the thumb instead. */}
      <PageHeader
        title="Purchase Orders"
        small
        actions={
          layout === "phone" ? undefined : (
            <Button variant="primary" onClick={() => composer.open(true)}>
              <Plus />
              New order
            </Button>
          )
        }
      />
      {/* Cards on a desk and a tablet, the model Articles uses (owner,
          2026-10-12: back to the four KPI cards); the sentence is the phone's. */}
      <KpiStrip className="grid-cols-2 max-md:hidden md:grid-cols-4 xl:grid-cols-4">
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
      <SummaryBand
        page={orders.data}
        review={awaiting}
        tab={tab}
        className="md:hidden"
      />

      <SubTabs
        // Hidden on a phone: the status is the button in the drawer over the
        // bottom bar (`DockTools`), which says the same and has the room for
        // the counts (owner, 2026-10-05).
        className="max-md:hidden"
        tabs={TABS.map((one) => ({
          value: one.value,
          label: (
            <span>
              {one.label}
              <span className="ml-1.5 text-body tabular-nums">
                {count(facetCount(one.statuses))}
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

      <HeldOrderSheet
        job={outbox.find((job) => job.id === heldOpen) ?? null}
        onClose={() => setHeldOpen(null)}
        onEdit={setResume}
      />

      <OrderComposer
        open={composer.value === true || resume !== null}
        resume={resume ?? undefined}
        onClose={() => {
          composer.close()
          setResume(null)
        }}
        onReopen={() => composer.open(true)}
        onRaised={(saved) => {
          // A held order taken back to the form and sent from it is on the
          // server now: the form closes, whatever opened it.
          setResume(null)
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
      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden lg:flex-nowrap">
        <SearchSuggest
          value={search.value ?? ""}
          onChange={(next) => (next ? search.open(next) : search.close())}
          label="Search orders"
          suggestions={supplierChoices.map((one) => ({
            value: one.value,
            label: one.label,
          }))}
          picked={
            pickedSupplier === undefined
              ? null
              : {
                  value: pickedSupplier,
                  label:
                    supplierChoices.find((one) => one.value === pickedSupplier)
                      ?.label ?? pickedSupplier,
                }
          }
          onPick={(code) =>
            filters.set([
              ...filters.filters.filter((one) => one.column !== "supplier"),
              {
                column: "supplier",
                operator: "isAnyOf" as const,
                values: [code],
              },
            ])
          }
          onClear={() =>
            filters.set(
              filters.filters.filter((one) => one.column !== "supplier")
            )
          }
        />
        {/* No Filter button over the list (owner, 2026-10-14: "filter di
            procurement buttonnya hapus"): search and the two date ranges
            stand here; on a phone filter and sort are in the dock. */}
        <div className="hidden lg:contents">
          <FilterRow filters={filters} />
        </div>
        <div className="hidden md:contents">
          {/* Out of the Columns menu, beside the search like Suppliers'
              "Active order" (owner, 2026-10-15): the same bordered switch. */}
          <SwitchPill
            on={groupBySupplier}
            label="Group by supplier"
            onToggle={() => chooseGrouping(!groupBySupplier)}
          />
          <BarSpacer />
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
          <ColumnsMenu table={table} />
          {/* Import is hidden on the owner's instruction (2026-09-25)
              until the import flow is ready for buyers; the sheet and its
              `?import=` link still work. New order is in the page head. */}
        </div>
      </div>

      {/* New order on a phone: a floating button at the thumb's corner. */}
      <Fab label="New Order" onClick={() => composer.open(true)} />
      {/* On a phone the search and the filter live in the drawer over the
          bottom bar, not at the top of the list (owner, 2026-10-05). */}
      <DockTools
        search={{
          value: search.value ?? "",
          onChange: (next) => (next ? search.open(next) : search.close()),
          label: "Search Orders",
        }}
        // Filter and sort are pages of the drawer, as status is: one family.
        filter={{
          count: filters.filters.length,
          panel: {
            model: filters,
            filterModel: { ...filters, fields: counted },
            table,
          },
        }}
        sort={dockSortOf(table)}
        status={{
          value: tab,
          options: TABS.map((one) => ({
            value: one.value,
            label: one.label.replace(/ PO$/, ""),
            count: facetCount(one.statuses),
          })),
          onChange: (next) => {
            setTab(next as OrderTab)
            setCollapsed(new Set())
          },
        }}
      />
      {/* `overflow-clip`, not `overflow-hidden`: hidden makes the card a
          scroll box, and the table's heading would stick to the card instead
          of the window. */}
      <div
        ref={fit.ref}
        aria-busy={book.isPlaceholderData || undefined}
        className="list-swap"
      >
        <Card className="overflow-clip max-lg:overflow-visible max-lg:border-0 max-lg:bg-transparent max-lg:shadow-none">
          {queryState(
            // With no connection and nothing read yet, the list is the orders
            // on this device: they are what there is to show, and "loading"
            // would be a wait for something that is not coming.
            orders.data === undefined && !online && outbox.length > 0
              ? {
                  isPending: false,
                  isError: false,
                  error: null,
                  data: { rows: [] } as unknown as PurchaseOrderPage,
                  refetch: () => void orders.refetch(),
                }
              : orders,
            {
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
                    cardsApart
                    // Under 1024px the five columns do not fit (a 768px tablet
                    // has 702px of card): every row is a card there, and a card
                    // has room for Ordered and Received side by side.
                    cardsOnTablet
                    cardLead
                    cardTone={cardToneOf}
                    cardsTwoUp
                    // An order with a count waiting opens the count's review,
                    // not its detail — the same sheet its Review Count button
                    // opens (owner, 2026-10-11).
                    onRowClick={(row) =>
                      isHeld(row)
                        ? setHeldOpen(
                            row.purchase_order_id.slice(HELD_PREFIX.length)
                          )
                        : row.review === true
                          ? review.open(row.po_number)
                          : order.open(row.purchase_order_id)
                    }
                    onRowIntent={(row) => {
                      // A held (offline) order has no sheet to warm.
                      if (!isHeld(row))
                        void prefetchOrder(client, row.purchase_order_id)
                    }}
                    isSelected={(row) => row.purchase_order_id === order.value}
                    isFresh={(row) => row.purchase_order_id === fresh}
                    // The owner's floating totals: how many orders, and what
                    // they add up to, under the columns they sum.
                    more={book}
                    refresh={[book]}
                    summary={{
                      order: (
                        <span>
                          {count(viewRows.length)}{" "}
                          <span className="font-normal text-body">
                            {viewRows.length === 1 ? "order" : "orders"}
                          </span>
                          {orders.data !== undefined &&
                            orders.data.next_cursor !== null && (
                              <span className="font-normal text-body">
                                {" "}
                                of {count(orders.data.total)}
                              </span>
                            )}
                        </span>
                      ),
                      // Each sum as its column shows it: the pieces over the
                      // value, and what came beyond the orders in brackets.
                      ordered: (
                        <span className="flex flex-col items-end py-2 leading-5">
                          <span>
                            {pcs(
                              sumOf(viewRows, (row) => row.expected_stock_units)
                            )}
                          </span>
                          <span className="font-normal text-body">
                            {money(sumOf(viewRows, (row) => row.net_minor))}
                          </span>
                        </span>
                      ),
                      received: (() => {
                        const beyond = sumOf(
                          viewRows,
                          (row) => receivedOf(row).beyond
                        )
                        return (
                          <span className="flex flex-col items-end py-2 leading-5">
                            <span>
                              {pcs(
                                sumOf(
                                  viewRows,
                                  (row) => receivedOf(row).matched
                                )
                              )}
                              {beyond > 0 && (
                                <span className="text-bad-fg">{` (+${count(beyond)})`}</span>
                              )}
                            </span>
                            <span className="font-normal text-body">
                              {money(
                                sumOf(viewRows, (row) => receivedOf(row).value)
                              )}
                            </span>
                          </span>
                        )
                      })(),
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
            }
          )}
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
      className="flex w-full items-center gap-2 px-3 pt-8 pb-2 text-left text-[0.9375rem] outline-none focus-visible:text-ink"
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
    const [suppliers, vocabulary, colourMaster] = await Promise.all([
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
      client
        .fetchQuery({
          queryKey: colourKeys.list(),
          queryFn: ({ signal }) => listColours(signal),
          staleTime: 30 * 60 * 1000,
        })
        .catch(() => null),
    ])
    /// "Black M" on paper, from the masters the screens use.
    const variantName = (colour: string | null, size: string | null) =>
      [
        colour === null
          ? null
          : (colourMaster?.colours.find((one) => one.code === colour)?.label ??
            colour),
        size === null
          ? null
          : (vocabulary?.sizes.find((one) => one.code === size)?.label ?? size),
      ]
        .filter(Boolean)
        .join(" ")
    // Each item's description, read from the catalogue once per item.
    const itemIds = [
      ...new Set(
        details.flatMap((order) =>
          order.lines
            .map((line) => line.supplier_item_id)
            .filter((id): id is string => id !== null)
        )
      ),
    ]
    const descriptions = new Map<string, string>()
    await Promise.all(
      itemIds.map((id) =>
        client
          .fetchQuery({
            queryKey: procurementKeys.supplierItem(id),
            queryFn: ({ signal }) => supplierItemDetail(id, signal),
          })
          .then((item) => {
            const text = item.description?.trim()
            if (text) descriptions.set(id, text)
          })
          .catch(() => undefined)
      )
    )
    // Each open order's public page, for its QR (0971): made once, found
    // after. An order whose link could not be made prints without one.
    const open = (order: PurchaseOrderDetail) =>
      order.lifecycle !== "CANCELLED" &&
      order.lifecycle !== "FULLY_RECEIVED" &&
      order.lifecycle !== "SHORT_RECEIVED"
    const links = new Map<string, string>()
    await Promise.all(
      details.filter(open).map((order) =>
        client
          .fetchQuery({
            queryKey: ["purchase-order-link", order.purchase_order_id],
            queryFn: ({ signal }) =>
              createPurchaseOrderLink(order.purchase_order_id, signal),
            staleTime: Infinity,
          })
          .then((link) =>
            links.set(order.purchase_order_id, orderLink(link.token))
          )
          .catch(() => undefined)
      )
    )
    const orders: PrintableOrder[] = details.map((order) => ({
      order,
      supplier:
        suppliers[supplierIds.indexOf(order.supplier_ref_id ?? "")] ?? null,
      descriptions,
      qrUrl: links.get(order.purchase_order_id),
    }))
    if (choice.pdf) {
      downloadOrdersPdf({
        orders,
        phone: (value) => (value ? formatPhones(value) : null),
        paper: choice.paper,
        variantName,
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
          variantName,
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

/// Three figures about the book as it currently stands.
///
/// `total` is the server's own count over everything the search and the chips
/// match, so it is true whatever the page holds. The three sums are not: they
/// are added up over the rows in hand, and a book that runs past one page has
/// more of them. Rather than print a confident wrong total, a partial page
/// says `of {n} shown` under the figure — the number is still useful, and the
/// reader is told what it covers.
/// The four figures of the tab showing, as cards over the list — on a desk and
/// a tablet. A phone has the sentence under the title instead (`SummaryBand`).
function bookKpis(page: PurchaseOrderPage | undefined) {
  if (page === undefined) return undefined
  const rows = page.rows
  const whole = page.next_cursor === null
  const note = whole
    ? undefined
    : `Over the ${count(rows.length)} orders loaded, of ${count(page.total)}`
  const open = rows.filter(isOpenOrder)
  const value = open.reduce((sum, row) => sum + row.net_minor, 0)
  const late = rows.filter((row) => row.overdue).length
  // An order with no promised date cannot be late, and saying "0 overdue"
  // while most carry no date at all is a true number that reads as an
  // all-clear. The tile says how many it could not judge — among the open
  // orders only: a cancelled or closed-short one is not waited on at all.
  const undated = open.filter(
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
      value: moneyCompact(value),
      note: `${money(value)}${note === undefined ? "" : ` · ${note}`}`,
    },
  ]
}

/// What the tab comes to, said as a sentence under the title (owner,
/// 2026-10-06: the header band). One fact is bold — the one to act on — and
/// the rest is plain; a fact that is none is not said at all.
///
///  - Active: "Hi Rina, **4 orders in review**. 8 orders are active, Rp 4,0 B
///    in total." Anything late takes the bold, in red, and the review
///    count follows plain.
///  - Completed: "**2 orders were closed short**." (red, only when there are
///    any) then "12 orders are complete, with Rp 49 M received."
///  - Cancelled: "**1 order** for Rp 320 K was cancelled."
///
/// The sums are over the rows in hand; a list that runs past one page says so
/// on the title.
interface Said {
  readonly lead?: { readonly text: string; readonly late: boolean }
  readonly after: string
  readonly note?: string
}

/// A figure, its words and a sum of money never part across lines.
const nb = (text: string) => text.replace(/ /g, "\u00a0")

function summaryOf(
  page: PurchaseOrderPage,
  review: ReadonlyMap<string, unknown>,
  tab: OrderTab
): Said {
  const rows = page.rows
  const n = page.total
  const note =
    page.next_cursor === null
      ? undefined
      : `Over the ${count(rows.length)} orders loaded, of ${count(n)}`
  const orders = (k: number, one: string, many: string) =>
    nb(`${count(k)} ${k === 1 ? one : many}`)

  if (tab === "active") {
    if (n === 0) return { after: "No active orders." }
    const open = rows.filter(isOpenOrder)
    const late = rows.filter((row) => row.overdue).length
    // Only orders still on this list: the queue can hold a count for an order
    // that has since been completed, and that is not one the buyer can act on.
    const toReview = open.filter((row) => review.has(row.po_number)).length
    const value = nb(
      moneyCompact(open.reduce((sum, row) => sum + row.net_minor, 0))
    )
    const active = `${orders(n, "order is", "orders are")} active, ${value} in total.`
    if (late > 0)
      return {
        lead: {
          text: orders(late, "order is late", "orders are late"),
          late: true,
        },
        after: `. ${toReview > 0 ? `${nb(`${count(toReview)} in review`)}. ` : ""}${active}`,
        note,
      }
    if (toReview > 0)
      return {
        lead: {
          text: orders(toReview, "order in review", "orders in review"),
          late: false,
        },
        after: `. ${active}`,
        note,
      }
    return { after: active.replace(/^./, (c) => c.toUpperCase()), note }
  }

  if (tab === "completed") {
    if (n === 0) return { after: "No completed orders." }
    // The server's own tally over the whole search, so it is true however
    // much of the list has loaded.
    const short = page.facets.order_status
      .filter((facet) => facet.value === "SHORT_RECEIVED")
      .reduce((sum, facet) => sum + facet.count, 0)
    const got = nb(
      moneyCompact(rows.reduce((sum, row) => sum + row.received_value_minor, 0))
    )
    const complete = `${orders(n, "order is", "orders are")} complete, with ${got} received.`
    return short > 0
      ? {
          lead: {
            text: orders(
              short,
              "order was closed short",
              "orders were closed short"
            ),
            late: true,
          },
          after: `. ${complete}`,
          note,
        }
      : { after: complete, note }
  }

  if (n === 0) return { after: "Nothing has been cancelled." }
  const gone = nb(
    moneyCompact(rows.reduce((sum, row) => sum + row.net_minor, 0))
  )
  return {
    lead: { text: orders(n, "order", "orders"), late: false },
    after: ` for ${gone} ${n === 1 ? "was" : "were"} cancelled.`,
    note,
  }
}

/// The sentence, in the header band on a phone — the white of the bar
/// carried down under the title, the bar's own rule dropped so the two read
/// as one — and under the title on a desk. It scrolls with the list: the
/// title stays, the sentence does not hold two lines of the screen.
function SummaryBand({
  page,
  review,
  tab,
  className,
}: {
  page: PurchaseOrderPage | undefined
  review: ReadonlyMap<string, unknown>
  tab: OrderTab
  className?: string
}) {
  const identity = useIdentity()
  const first = (
    identity.data?.display_name ??
    identity.data?.username ??
    ""
  ).split(" ")[0]
  // The bar's hairline goes while the band is in view (`top-bar.tsx`), so
  // title and sentence read as one surface; once the band has scrolled up
  // under the title the rule comes back, the edge where the list meets it.
  const band = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const root = document.documentElement
    const node = band.current
    if (node === null) return
    const watch = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) root.dataset.headerBand = ""
      else delete root.dataset.headerBand
    })
    watch.observe(node)
    return () => {
      watch.disconnect()
      delete root.dataset.headerBand
    }
  }, [])
  const said = page === undefined ? null : summaryOf(page, review, tab)
  // After "Hi Rina," the sentence carries on: "nothing", not "Nothing".
  const carry = (text: string) =>
    first === ""
      ? text
      : text.replace(/^(No|Nothing)\b/, (w) => w.toLowerCase())
  return (
    <p
      ref={band}
      title={said?.note}
      className={cn(
        "mb-5 min-h-6 text-[0.9375rem] leading-normal text-pretty text-body max-md:-mx-4 max-md:-mt-4 max-md:mb-4 max-md:border-b max-md:border-hairline max-md:bg-canvas max-md:px-4 max-md:pt-0.5 max-md:pb-3.5",
        className
      )}
    >
      {said !== null && (
        // Arrives with the data: a short fade, no movement.
        <span className="transition-opacity duration-200 ease-(--ease-out) starting:opacity-0">
          {first !== "" && `Hi ${first}, `}
          {said.lead !== undefined && (
            <b
              className={cn(
                "font-semibold tabular-nums",
                said.lead.late ? "text-bad-fg" : "text-ink"
              )}
            >
              {said.lead.text}
            </b>
          )}
          {said.lead === undefined ? carry(said.after) : said.after}
        </span>
      )}
    </p>
  )
}

/// The record detail. It fetches its own read rather than being handed the row:
/// the list carries a summary, and the lines are only wanted once somebody
/// asks for one order.
export function OrderSheet({
  id,
  onClose,
  onEdit,
  onSupplier,
}: {
  id: string | null
  onClose: () => void
  onEdit: (id: string) => void
  /// The order was opened from its supplier's record: naming the supplier
  /// goes back there instead of stacking the same record again.
  onSupplier?: () => void
}) {
  const nameOf = useSupplierName()
  const recordOf = useSupplierRecordId()
  // What the order names, followed as layers over it (owner, 14 Oct: "semua
  // bisa di klik"): a line's item, the supplier in the head.
  const [lineShown, setLineShown] = useState<
    PurchaseOrderDetail["lines"][number] | null
  >(null)
  const [supplierShown, setSupplierShown] = useState<string | null>(null)
  useEffect(() => {
    setLineShown(null)
    setSupplierShown(null)
  }, [id])
  const detail = useQuery({
    ...orderDetailQuery(id ?? ""),
    enabled: id !== null,
  })
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  // A count the warehouse took, or is taking again, has to be settled first.
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

  const shown = detail.data

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
      // A confirm dialog has no plain button to say it from: toast only.
      void pullIn({
        from: null,
        rowId: done.purchase_order_id,
        pill: done.po_number,
        title: `${done.po_number} cancelled`,
      })
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

  const verify = useSheet("verify")
  const counts = useCountsAwaiting()
  /// What can be done to the order: along the foot of its sheet on every
  /// screen, the same buttons in the same places on a desk and on a phone, and
  /// where a thumb is (the owner, 2026-10-05: "jangan dibedakan"). Print is
  /// the icon at the left; the rest stand at the right with the main action
  /// last — the count's review when one is waiting, with Edit beside it, plain;
  /// else Edit.
  const actionsOf = (order: PurchaseOrderDetail) => {
    const reviewing = (counts.get(order.po_number)?.length ?? 0) > 0
    // A count waiting for review settles what the order is: nothing that ends
    // it is offered until it has been looked at (owner, 2026-10-12) — hidden,
    // not greyed with a reason in a tooltip.
    const settled = reviewing || countOpen
    // A supporting verb on a record (hub-ui-patterns: Print and Edit are
    // ghosts); the blue is for Review Count when a count waits.
    const edit = order.editable && (
      <Button
        key="edit"
        variant="ghost"
        size="sm"
        title="Edit the items on this order"
        onClick={() => onEdit(order.purchase_order_id)}
      >
        Edit
      </Button>
    )
    // Partly received and the rest is not coming: give it up here. It cannot
    // be undone, so it asks.
    const closeShortButton = order.lifecycle === "PARTIALLY_RECEIVED" &&
      owedPieces > 0 &&
      !settled && (
        <ConfirmButton
          key="short"
          label="Close Short"
          title="Close This Short?"
          description={`${pcs(owedPieces)} will be removed from the order, and the PO completes as received. This can't be undone.`}
          confirmLabel="Close Short"
          tone="danger"
          // Red, as Cancel is: it ends the order and cannot be undone
          // (owner, 2026-10-16: "close short selalu merah").
          variant="destructive"
          size="sm"
          pending={closeShort.isPending}
          reason={{ label: "Reason for Closing", optional: true }}
          onConfirm={(reason) => closeShort.mutateAsync(reason)}
        />
      )
    // Only while nothing has been received, billed or advanced; after that an
    // order is closed short instead. Solid red with white text.
    const cancelButton = order.cancellable && !settled && (
      <ConfirmButton
        key="cancel"
        label="Cancel order"
        title={`Cancel ${order.po_number}?`}
        description="The warehouse will stop receiving against this order. It stays on record as cancelled."
        cancelLabel="Keep Order"
        confirmLabel="Cancel Order"
        tone="danger"
        variant="destructive"
        size="sm"
        pending={cancel.isPending}
        reason={{ label: "Reason for Cancelling", optional: true }}
        onConfirm={(reason) =>
          cancel.mutateAsync({ orderId: order.purchase_order_id, reason })
        }
      />
    )
    return (
      <div className="flex items-center gap-2 [&_button]:h-9 [&_button]:px-4">
        {/* Print at the left of the foot, with its word and not the printer
            alone (owner, 2026-10-12). Every other button is solid blue, Cancel
            red; the pieces that came beyond the order go back from here too,
            at the right. */}
        <span className="ml-auto flex items-center gap-2">
          {/* Close Short first, at the left of the rest (owner,
              2026-10-16). */}
          {closeShortButton}
          <PrintMenu onChoose={(choice) => void print(order, choice)} />
          {cancelButton}
          {edit}
          {!settled && <ReturnToSupplierButton order={order} />}
          {reviewing && (
            <Button
              key="review"
              variant="primary"
              size="sm"
              onClick={() => verify.open(order.po_number)}
            >
              Review Count
            </Button>
          )}
        </span>
      </div>
    )
  }

  return (
    <>
      <Sheet
        open={id !== null}
        subject={id === null ? undefined : { kind: "purchase_order", id }}
        onOpenChange={(open) => !open && onClose()}
        // The supplier is the title; the PO number, the delivery note and the
        // delivery date stand on the line under it, and what was ordered and
        // received in a box at the right (owner, 2026-10-11,
        // `po-detail-form-options.html`, "Balanced"). A finished or cancelled
        // order says so with the stamp over its document.
        title={
          shown ? (
            // The supplier is a link to its record, like every name here.
            <button
              type="button"
              className="record-link text-left"
              onClick={() =>
                onSupplier !== undefined
                  ? onSupplier()
                  : setSupplierShown(
                      recordOf(
                        shown.supplier_id,
                        shown.supplier_name,
                        shown.supplier_ref_id
                      )
                    )
              }
            >
              {nameOf(
                shown.supplier_id,
                shown.supplier_name,
                shown.supplier_ref_id
              )}
            </button>
          ) : (
            "Order"
          )
        }
        id={shown?.po_number}
        // A finished order's state is its stamp; the chip would say it twice
        // (owner, 2026-10-14).
        badge={
          shown &&
          !noCountToReview(shown.lifecycle) && (
            <Pill tone={poStatus(shown.lifecycle).tone}>
              {poStatus(shown.lifecycle).label}
            </Pill>
          )
        }
        // No "n items" under the name: "Order items" already counts them
        // (owner, 2026-10-14).
        footer={shown ? actionsOf(shown) : undefined}
        // Wider than a rail, because an order is a DOCUMENT rather than a
        // record: six columns of lines — what, when it is due, at what price,
        // how many ordered, how many arrived, what that came to — do not fit in
        // 27.5rem, and the two that were dropped to make them fit are the two a
        // buyer opens this to check.
        //
        // `md:` for the reason the composer's note gives: a bare `w-*` loses to
        // the rail's own `md:w-[27.5rem]` everywhere but a phone.
        width="wide"
      >
        {queryState(detail, {
          loading: "Loading the order…",
          render: (order) => (
            <OrderDocument order={order} onItem={setLineShown} />
          ),
        })}
      </Sheet>
      <LineSheet
        line={lineShown}
        po={shown?.po_number}
        onClose={() => setLineShown(null)}
      />
      <SupplierSheet
        id={supplierShown}
        context={shown?.po_number}
        onClose={() => setSupplierShown(null)}
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
    ...orderDetailQuery(id ?? ""),
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
      // Edit is the order's sheet in its other mode: in its place, not over it.
      swap
      onClose={onClose}
      onRaised={() => {
        // The composer says the number itself, in the receipt dialog. Saving
        // an edit closes the form AND the order's sheet behind it, back to the
        // list (owner, 2026-10-06) — it used to walk back to the order and
        // leave its detail open. One navigation for both, because two calls
        // would each read the search that is on screen NOW and whichever
        // landed second would put the other's parameter back.
        void navigate({
          to: ".",
          search: (prev: Record<string, unknown>) => ({
            ...prev,
            "edit-order": undefined,
            order: undefined,
          }),
          viewTransition: false,
        })
      }}
    />
  )
}

/// What the warehouse did to the order, at the head of its sheet: a recall.
/// A count that waits for the buyer says nothing here — Review Count in the
/// foot is how it is reached — and neither does a recount.
function CountBanner({ po, cancelled }: { po: string; cancelled: boolean }) {
  const waiting = useCountsAwaiting().get(po)
  const recalled = useRecalls().get(po)
  const nameOfLogin = useNameOfLogin()
  if (cancelled) return null
  // No "Counted at the warehouse" banner (owner, 2026-10-10): the sheet's foot
  // carries Review Count, which already says a count is waiting.
  if (waiting !== undefined && waiting.length > 0) return null
  if (recalled !== undefined) {
    return (
      <div className="flex items-center gap-3 rounded-card bg-warn-bg px-4 py-3.5 text-warn-fg">
        <RotateCcw className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Recalled by the warehouse</span>
          <span className="block text-[0.9375rem]">
            {`${titled(nameOfLogin(recalled.by))}, ${recentMoment(recalled.at)} · was ${count(recalled.was)} pcs`}
          </span>
        </span>
      </div>
    )
  }
  // No "Sent back to count" banner (owner, 2026-10-10): a recount changes
  // nothing on the order's sheet.
  return null
}

/// Every receiving against one line, under its name in the items table (see
/// `ItemsTable`, which draws the name, the picture and what it is filed under).
function LineReceipts({
  line,
}: {
  line: PurchaseOrderDetail["lines"][number]
}) {
  const receipts = receiptLines(line)
  if (receipts.length === 0) return null
  return (
    // Every receiving against the line, numbered when there was more than
    // one; the total and its colour stand in the Received column.
    <div className="text-[0.9375rem] text-body tabular-nums">
      <div>Received</div>
      <ul>
        {receipts.map((one) => (
          <li key={one.head + one.body} className="flex gap-2">
            {/* A bullet only when there is more than one receiving to tell
                apart. */}
            {receipts.length > 1 && (
              <span aria-hidden className="text-mute">
                {"\u2022"}
              </span>
            )}
            <span className="truncate">
              {one.head === "" ? one.body : `${one.head} \u00b7 ${one.body}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/// Open, and the day it was promised for has gone by.
function isLateOrder(order: PurchaseOrderDetail): boolean {
  return (
    (order.lifecycle === "ACTIVE" ||
      order.lifecycle === "PARTIALLY_RECEIVED") &&
    order.expected_arrival !== null &&
    order.expected_arrival < new Date().toISOString().slice(0, 10)
  )
}

/// How the order is paid: the method, and the terms when one was chosen.
function paymentOf(order: PurchaseOrderDetail): string {
  return order.payment_terms_code
    ? `${methodName(order.payment_method)} \u00b7 ${order.payment_terms_name ?? order.payment_terms_code}`
    : methodName(order.payment_method)
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
function OrderDocument({
  order,
  onItem,
}: {
  order: PurchaseOrderDetail
  /// Opens a line's record — its catalogue item, or the line itself — over
  /// the order.
  onItem?: (line: PurchaseOrderDetail["lines"][number]) => void
}) {
  const variantRows = useVariantRows()
  const pieces = order.lines.reduce(
    (sum, line) => sum + line.ordered_quantity,
    0
  )
  const received = order.lines.reduce(
    (sum, line) => sum + line.received_quantity,
    0
  )
  /// What arrived beyond the order (over, or not the article) goes back. A
  /// line's received quantity is already only what matched the order, so all
  /// of it was accepted, and is worth what the server expects to be billed.
  const excessPieces = order.lines.reduce(
    (sum, line) => sum + line.excess_quantity,
    0
  )
  const acceptedValue = order.lines.reduce(
    (sum, line) => sum + line.expected_value_minor,
    0
  )
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
  /// What the closed-short pieces were worth at their price, and the discount
  /// left on what stays: the same grand total, said so each line can be checked
  /// by hand — 40 pcs × Rp 90.000 is Rp 3.600.000, not what is left of it after
  /// a share of the discount (owner, 2026-10-12).
  const closedShortGross = order.lines.reduce(
    (sum, line) => sum + lineValue(line, line.closed_short_units ?? 0),
    0
  )
  const discountLeft =
    closedShortPieces > 0
      ? gross - closedShortGross - grandTotal
      : order.discount_minor
  const discountLabel = `Discount \u00b7 ${percentBps(order.discount_bps ?? percentFromDiscount(order.discount_minor, gross))}`
  /// The stamp once the order is done, as the list presses it on the row,
  /// with the day: the last thing that happened to it — the last receipt, or
  /// the last change (a close short, a cancel).
  const stamp =
    order.lifecycle === "CANCELLED"
      ? { word: "Cancelled", tone: "mute" as const }
      : order.lifecycle === "FULLY_RECEIVED"
        ? { word: "Fully received", tone: "ok" as const }
        : order.lifecycle === "SHORT_RECEIVED"
          ? { word: "Closed short", tone: "bad" as const }
          : null
  const stampedAt =
    stamp === null
      ? null
      : ([
          ...order.lines.flatMap((line) =>
            (line.receipts ?? []).map((one) => one.received_at)
          ),
          ...(order.revisions ?? []).map((one) => one.revised_at),
        ]
          .sort()
          .at(-1) ?? null)
  return (
    <div className="relative flex flex-col gap-6">
      {stamp !== null && (
        <DocStamp
          word={stamp.word}
          at={stampedAt}
          // Why it was cancelled, in the stamp's ink (owner, 2026-10-16).
          note={cancellationOf(order)?.reason}
          tone={stamp.tone}
        />
      )}
      {/* The record's figures, first (hub-ui-patterns, one format): when it
          is due — red once late — how it is paid, the pieces, the total. */}
      {/* 32 to the table, as the list has 32 to its tabs (24 gap + 8). */}
      <KpiStrip className="mb-2!">
        <Kpi
          label="Delivery Date"
          value={
            <span className={cn(isLateOrder(order) && "text-bad-fg")}>
              {order.expected_arrival === null
                ? "—"
                : day(order.expected_arrival)}
            </span>
          }
        />
        <Kpi label="Payment" value={paymentOf(order)} />
        {received > 0 ? (
          <>
            <Kpi
              label="Received"
              value={`${count(received)} / ${pcs(pieces)}`}
            />
            {pieces - received - closedShortPieces > 0 && (
              <Kpi
                label="To come"
                value={pcs(pieces - received - closedShortPieces)}
              />
            )}
          </>
        ) : (
          <Kpi label="Ordered" value={pcs(pieces)} />
        )}
        <Kpi label="Grand Total" value={money(grandTotal)} />
      </KpiStrip>
      <CountBanner
        po={order.po_number}
        cancelled={noCountToReview(order.lifecycle)}
      />
      {/* No "Order items n" over the table (owner, 2026-10-15): the table's
          own head says Item, and the figures above already count it. */}
      <div>
        <ItemsTable
          totalsApart
          quantityLabel="Ordered"
          rows={order.lines.map((line, index) => ({
            key: line.po_line_id,
            image: line.image_url,
            name: line.article_name,
            division: line.division_code,
            colour: line.variants?.[0]?.colour_code ?? null,
            filed: [
              line.division_code === null
                ? "Unclassified"
                : label(line.division_code),
              ...line.tags.map((tag) => label(tag)),
            ].join(" \u00b7 "),
            said:
              line.order_unit_code && line.order_unit_quantity
                ? `${line.order_unit_quantity.replace(".", ",")} ${line.order_unit_code.toLowerCase()}`
                : null,
            pieces: line.ordered_quantity,
            price: unitPriceText(line),
            amount: amounts[index],
            received:
              received > 0
                ? {
                    pieces: line.received_quantity,
                    tone: receivedTone(
                      line.ordered_quantity,
                      line.received_quantity
                    ),
                  }
                : undefined,
            more: <LineReceipts line={line} />,
            onOpen: onItem === undefined ? undefined : () => onItem(line),
            variants: variantRows(
              (line.variants ?? []).map((one) => ({
                colour: one.colour_code,
                size: one.size_code,
                pieces: one.quantity,
                photo: one.image_urls?.[0],
              }))
            ),
          }))}
          totals={{
            pieces,
            // No Received column while nothing has come in (owner, 2026-10-11).
            received:
              received > 0 ? { pieces: received, tone: totalTone } : undefined,
            gross,
            discount:
              order.discount_minor === 0
                ? undefined
                : {
                    minor: order.discount_minor,
                    label: `Discount \u00b7 ${percentBps(order.discount_bps ?? percentFromDiscount(order.discount_minor, gross))}`,
                    perPiece:
                      pieces > 0
                        ? Math.round(order.discount_minor / pieces)
                        : null,
                  },
            closedShort:
              closedShortPieces > 0
                ? { pieces: closedShortPieces, value: closedShortValue }
                : undefined,
            grand: grandTotal,
          }}
        />
        {/* Under the table, at the right: what came in as bare figures — pieces
            only — and the money in the one box, so a column never mixes Rp and
            pcs and Grand Total stands under Amount (owner, 2026-10-12). Received
            is drawn once something has been received. */}
        {/* Lark (owner, 2026-10-12): the pieces as compact cards at the left —
            the first one the figure that matters, Received once anything has
            come — and the money at the right under Amount, no box around it. */}
        {/* The figures are at the top; under the table only the ladder that
            explains a discount or a short close down to the grand total. */}
        {/* Under the table, at the right (owner, 14 Oct: "total order pcsnya
            berapa, total order berapa, accepted berapa"): the pieces first —
            ordered, received, accepted, what goes back — then the money down to
            the grand total and, once goods were accepted, what they are worth. */}
        <div className="mt-4 flex justify-end">
          {/* As po-detail-branches.html draws it (owner, 2026-10-14): what
              the lines come to, pieces and rupiah on one row; the discount
              and a short close; the grand total; then, once goods came, what
              came, what was accepted and what goes back. */}
          <dl className="order-totals grid w-full grid-cols-[1fr_auto] items-center gap-x-10 gap-y-2.5 text-[0.9375rem] tabular-nums md:w-[19rem]">
            <dt className="text-body">
              Total
              <span className="text-mute"> · {pcs(pieces)}</span>
            </dt>
            <dd className="text-right text-ink">{money(gross)}</dd>
            {order.discount_minor !== 0 && (
              <>
                <dt className="text-body">
                  {discountLabel}
                  {/* Per piece, under it (po-detail-branches.html). */}
                  {pieces > 0 && (
                    <span className="block text-mute">
                      {money(Math.round(order.discount_minor / pieces))} / pc
                    </span>
                  )}
                </dt>
                <dd className="text-right text-ink">{money(-discountLeft)}</dd>
              </>
            )}
            {closedShortPieces > 0 && (
              <>
                <dt className="text-body">
                  Closed Short
                  <span className="text-mute"> · {pcs(closedShortPieces)}</span>
                </dt>
                <dd className="text-right text-ink">
                  {money(-closedShortGross)}
                </dd>
              </>
            )}
            <div aria-hidden className="col-span-2 border-t border-hairline" />
            {/* Once goods came there is no Grand Total (owner, 2026-10-16):
                the order's own sum is the Total Order, what goes back is
                pieces only, and the last, bold line is what was accepted and
                what it is worth. No "Total Received": received is only what
                matched the order, the same figure as Accepted. */}
            {received > 0 ? (
              <>
                <dt className="text-body">Total Order</dt>
                <dd className="text-right text-ink">{money(grandTotal)}</dd>
                <dt className="font-semibold text-ink">
                  Accepted · {pcs(received)}
                </dt>
                <dd className="text-right text-base leading-[1.375rem] font-semibold text-ink">
                  {money(acceptedValue)}
                </dd>
                {/* What goes back stands apart, under a space: pieces only,
                    no price — it is not billed (owner, 2026-10-16). */}
                {excessPieces > 0 && (
                  <>
                    <dt className="mt-3 text-body">To Be Returned</dt>
                    <dd className="mt-3 text-right text-bad-fg">
                      {pcs(excessPieces)}
                    </dd>
                  </>
                )}
              </>
            ) : (
              <>
                <dt className="font-semibold text-ink">Grand Total</dt>
                <dd className="text-right text-base leading-[1.375rem] font-semibold text-ink">
                  {money(grandTotal)}
                </dd>
              </>
            )}
          </dl>
        </div>
      </div>

      <BeyondTheOrder order={order} />

      {order.terms_and_conditions != null &&
        order.terms_and_conditions.trim() !== "" && (
          <Section title="Terms and Conditions" rule={false} quiet>
            <p className="text-[0.9375rem] leading-[1.375rem] whitespace-pre-wrap text-ink">
              {order.terms_and_conditions.trim()}
            </p>
          </Section>
        )}

      {cancelReason !== null && (
        <Section title="Cancel Reason" rule={false} quiet>
          <p className="text-[0.9375rem] leading-[1.375rem] whitespace-pre-wrap text-ink">
            {cancelReason}
          </p>
        </Section>
      )}

      {order.notes !== null &&
        order.notes !== undefined &&
        order.notes.trim() !== "" && (
          <Section title="Notes" rule={false} quiet>
            <p className="text-[0.9375rem] leading-[1.375rem] whitespace-pre-wrap text-ink">
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
  // said in Return PO, not here.
  return receipts.map((one) => ({
    head: dayMonth(one.received_at),
    body: `${pcs(one.matched_quantity)}${
      one.wrong_quantity > 0
        ? ` · ${pcs(one.wrong_quantity)} not as ordered`
        : ""
    }`,
  }))
}

/// Pieces that came beyond the order and wait for a return, by what they are:
/// those over a line stand under its article, and the ones that matched no
/// article at all are one row of their own — Not As Ordered, never hung on an
/// article.
function pendingReturnRows(order: PurchaseOrderDetail) {
  const rows: {
    key: string
    name: string
    pieces: number
    value: number | null
  }[] = []
  let notAsOrdered = 0
  for (const line of order.lines) {
    const pending = line.excess_pending_quantity
    if (pending <= 0) continue
    const wrong = Math.min(
      pending,
      (line.receipts ?? []).reduce((sum, one) => sum + one.wrong_quantity, 0)
    )
    notAsOrdered += wrong
    if (pending - wrong > 0)
      rows.push({
        key: line.po_line_id,
        name: line.article_name,
        pieces: pending - wrong,
        value: lineValue(line, pending - wrong),
      })
  }
  if (notAsOrdered > 0)
    rows.push({
      key: "not-as-ordered",
      name: NOT_AS_ORDERED,
      pieces: notAsOrdered,
      value: null,
    })
  return rows
}

/// The pieces going back, from the foot of the sheet — bottom right, solid blue
/// (owner, 2026-10-12): the one thing left to do on an order that is complete.
/// One action for the whole order — a buyer sending 3 pieces back on Monday and
/// 2 more on Tuesday is not a decision anybody here is asking for.
function ReturnToSupplierButton({ order }: { order: PurchaseOrderDetail }) {
  const nameOf = useSupplierName()
  const supplier =
    order.supplier_name === null
      ? "the supplier"
      : nameOf(order.supplier_id, order.supplier_name, order.supplier_ref_id)
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const pendingTotal = order.lines.reduce(
    (sum, line) => sum + line.excess_pending_quantity,
    0
  )
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
      void pullIn({
        from: null,
        rowId: order.purchase_order_id,
        pill: created.return_number,
        title: `${created.return_number} raised`,
        description: `${pcs(created.quantity)} to ${supplier}`,
      })
    },
  })
  if (pendingTotal <= 0) return null
  return (
    <ConfirmButton
      label={`Return ${pcs(pendingTotal)}`}
      title="Send the Excess Back"
      description={`These ${quantity(pendingTotal)} came beyond the order and go back to ${supplier}. The warehouse hands them over.`}
      confirmLabel="Raise the Return"
      variant="primary"
      size="sm"
      pending={raise.isPending}
      onConfirm={() => raise.mutateAsync()}
    />
  )
}

/// One return, in the dress of the items table: a head line (the RS number and
/// where it stands), Item | Pieces | Value, and a Total. A return that has gone
/// back is stamped RETURNED rather than worded (owner, 2026-10-12).
function ReturnCard({
  head,
  state,
  stamped = false,
  rows,
}: {
  head: React.ReactNode
  state: string
  stamped?: boolean
  rows: readonly {
    key: string
    name: string
    pieces: number
    value: number | null
  }[]
}) {
  const total = rows.reduce((sum, one) => sum + one.pieces, 0)
  const CELL_R = "px-4 py-2.5 text-right whitespace-nowrap tabular-nums"
  return (
    <div className="overflow-hidden rounded-inner border border-hairline">
      <div className="flex items-center justify-between gap-3 border-b border-hairline bg-soft px-4 py-3">
        <span className="font-medium text-ink">{head}</span>
        {stamped ? (
          <span
            aria-hidden
            className="inline-block -rotate-[4deg] rounded-inner border-2 border-ink px-2.5 text-[0.9375rem] leading-[1.375rem] font-bold tracking-[0.14em] text-ink opacity-55 select-none"
          >
            RETURNED
          </span>
        ) : (
          <span className="text-body">{state}</span>
        )}
      </div>
      <table className="w-full table-fixed border-collapse text-[0.9375rem]">
        <thead>
          <tr className="text-[0.9375rem] text-body">
            <th className="w-1/2 px-4 py-2 text-left font-medium">Item</th>
            <th className="px-4 py-2 text-right font-medium">Pieces</th>
            <th className="px-4 py-2 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((one) => (
            <tr key={one.key} className="border-t border-hairline text-ink">
              <td className="truncate px-4 py-2.5">{one.name}</td>
              <td className={CELL_R}>{pcs(one.pieces)}</td>
              <td className={CELL_R}>
                {one.value === null ? (
                  <span className="text-faint">—</span>
                ) : (
                  money(one.value)
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-hairline bg-soft font-semibold text-ink">
            <td className="px-4 py-2.5">Total</td>
            <td className={CELL_R}>{pcs(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/// What arrived beyond what was ordered, and where it is going.
///
/// Shown only once there is something to say: pieces still waiting for a
/// return, or a return already raised against them. Words by stage: "To Be
/// Returned" (raised, the note not made), "Hand Over" (the note is made and the
/// warehouse hands the goods over), then the RETURNED stamp. The button that
/// raises it is the foot's, not this card's.
function BeyondTheOrder({ order }: { order: PurchaseOrderDetail }) {
  const returns = order.returns ?? []
  const pending = pendingReturnRows(order)
  if (pending.length === 0 && returns.length === 0) return null
  return (
    <Section title="Return PO" rule={false} quiet>
      <div className="flex flex-col gap-3">
        {pending.length > 0 && (
          <ReturnCard
            head="Not raised yet"
            state="To Be Returned"
            rows={pending}
          />
        )}
        {returns.map((ret) => (
          <ReturnCard
            key={ret.return_id}
            head={
              <AppLink
                to="/procurement/returns"
                sheet={{ key: "allotment", value: ret.return_id }}
                className="text-accent hover:underline"
              >
                {ret.return_number}
              </AppLink>
            }
            stamped={ret.status !== "OPEN"}
            state={
              ret.note_generated_at != null ? "Hand Over" : "To Be Returned"
            }
            rows={ret.lines.flatMap((one) => {
              const line = order.lines.find(
                (l) => l.po_line_id === one.po_line_id
              )
              return returnLineParts(one).map((part) => ({
                key: `${one.receipt_line_id}-${part.sku}`,
                name: part.name,
                pieces: part.qty,
                value:
                  line === undefined || part.unknown
                    ? null
                    : lineValue(line, part.qty),
              }))
            })}
          />
        ))}
      </div>
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

import { ActivityFold } from "@/components/ui/activity-fold"
import { useShopName } from "@/components/operations/outbound-papers"
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useEffect, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { ConfirmButton } from "@/components/ui/dialog"
import { Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { Fab } from "@/components/ui/fab"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Banner, EmptyState } from "@/components/ui/states"
import { Timeline, type TimelineEvent } from "@/components/ui/timeline"
import { useFilters } from "@/lib/filters"
import { count, dayMonth, label, moment, quantity } from "@/lib/format"
import { STAMP } from "@/screens/procurement/shared"
import { useLayout } from "@/lib/layout"
import { useAppNavigate } from "@/lib/navigate"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"
import { amendAllotment } from "@/lib/operations/changes"
import {
  allotmentDetail,
  allotmentsByArticle,
  allotmentsByStore,
  cancelAllotment,
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  listAllotments,
  listFinishedAllotments,
  type AllotmentAmendment,
  type AllotmentDetail,
  type AllotmentRow,
  type ArticleAllotmentList,
  type ArticleRollup,
  type FulfillmentStatus,
  type StoreSkuSummary,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { DeliveryCards } from "@/screens/allotment/delivery-cards"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { Choice, Metric, MetricRow } from "@/screens/inventory/parts"
import { toast } from "@/lib/toast"
import {
  cancelOf,
  draftEditOf,
  draftNoteOf,
  floorOf,
  pendingOf,
  roomOf,
  stagesOf,
  storesOf,
  targetOf,
  undoLinesOf,
} from "@/screens/allotment/amend-data"
import { ArticleThumb } from "@/screens/allotment/article-thumb"
import { CancelDialog } from "@/screens/allotment/cancel-dialog"
import { allotFromValue, stageDraft } from "@/screens/allotment/draft"
import { AllotmentItems, ExpandToggle } from "@/screens/allotment/items"
import { ExpandContext, useExpanding } from "@/screens/allotment/expanding"
import { StoreLines } from "@/screens/allotment/store-lines"
import { ToAllot } from "@/screens/allotment/to-allot"
import { useToAllot } from "@/screens/allotment/to-allot-data"
import { sitesOf, useActor } from "@/screens/inventory/shared"
import { type DisplayUnit } from "@/screens/inventory/unit-display"

/// Allotments — what each store has been promised, and how much of it has
/// arrived. `docs/allotment-v1.md` §12 is the UI contract this screen follows
/// and §14 the list of what it must never do; both are worth reading before
/// touching this file.
///
/// The number the list leads with is **To receive**, read straight off the
/// server's canonical commitment view — never `quantity - received -
/// cancelled` in the browser (ALT-INV-16). MD's own pipeline is five stages —
/// To pack · Packed · Shipment · In transit · Received — with Shipment
/// standing for `at_shipment_qty + at_loaded_qty` (ALT-D06) and the receiving
/// difference sitting in the totals rather than as a sixth column (§14 #6).
/// There is no Pick action here any more: picking is the warehouse's act, not
/// MD's (§10; §13 step 3).

/// The page's tabs: what is still to allot, the allotments still in progress,
/// the ones that have finished (Completed — done, closed short or received
/// short) and the ones MD called off (Cancelled, owner 10 Oct 2026).
type View = "unallotted" | "allotted" | "completed" | "cancelled"

/// Called off by MD (or refused by the DC) rather than worked to the end.
/// `cancelled_at` is what tells MD's cancel from a close short: both end
/// CLOSED in the view and CANCELLED in the header.
function isCancelled(row: AllotmentRow): boolean {
  return (
    row.status === "REJECTED" ||
    (row.status === "CANCELLED" && (row.cancelled_at ?? null) !== null) ||
    (row.status === "CANCELLED" && row.activation_target_origin_id !== null)
  )
}

/// The three readings the Allotted tab's own picker offers.
type Reading = "allotments" | "store" | "article"

/// The switch over the "Allotments" reading went (owner, 2 Oct 2026): one list,
/// what is on its way and what has arrived. The value is kept because the
/// server calls are keyed by it.
type Tab = "active" | "completed"

/// What the tab asks the server for. Completed is its own key: it is two reads
/// merged.
function statusOf(tab: Tab): string {
  return tab === "active" ? "ACTIVE" : "FINISHED"
}

/// One figure added up over the rows in hand.
function sumOf<T>(rows: readonly T[], of: (row: T) => number): number {
  return rows.reduce((sum, row) => sum + of(row), 0)
}

/// A quantity, in the viewer's chosen unit — "960", never "960 Piece" when the
/// base unit is already pieces. Sorting and filtering stay in pieces
/// regardless; this only changes what is printed.
function qtyOf(display: DisplayUnit, n: number): string {
  return display.unit?.is_base !== false ? count(n) : display.format(n)
}

/// This book counts in pieces and nothing else.
const PIECES: DisplayUnit = {
  code: "PCS",
  unit: undefined,
  options: [],
  setCode: () => {},
  format: (n) => count(n),
  isLoading: false,
}

/// Prepared at the warehouse — picked or packed — and everything that has gone
/// further.
function workedOf(row: AllotmentRow): number {
  const packedOn =
    row.at_packed_qty +
    row.at_shipment_qty +
    row.at_loaded_qty +
    row.at_in_transit_qty +
    row.received_qty
  return Math.max(row.total_picked_quantity, packedOn)
}

/// Shipped from the warehouse: on the road, or already at the store.
function departedOf(row: AllotmentRow): number {
  return row.at_in_transit_qty + row.received_qty
}

/// A shop's own id, shortened the way the New Allotment matrix already
/// shortens it — `store-04` → `04` — for a column heading that has to share a
/// row with a dozen others. The full id is never shown as a caption or a
/// label (§14 #17); only this shortened, human word is.
function destinationShort(id: string): string {
  return id.replace(/^store-?/i, "") || id
}

/// What an allotment that is over is called: cancelled by MD, some of it was
/// closed, a store received less than was sent, or it was received in full.
///
/// A cancel MD made on a cloud-owned allotment is "Cancelled" whatever was
/// picked — what was picked is the warehouse's to move back, not a remainder.
/// A DC-owned one keeps the old reading: nothing picked is "Cancelled", the
/// rest "Closed short". A store receipt below what was sent (214 of 220) is
/// "Received short", never "Completed", and wins over a closed remainder: it is
/// what happened at the store, the other is what MD decided.
function endedWord(row: AllotmentRow): string {
  if (row.status === "CANCELLED" || row.status === "REJECTED") {
    return row.activation_target_origin_id === null ||
      (row.total_picked_quantity === 0 && row.received_qty === 0)
      ? "Cancelled"
      : "Closed short"
  }
  if (row.receiving_gap_qty > 0) return "Received short"
  return row.closed_short_qty > 0 ? "Closed short" : "Completed"
}

/// The status word every screen in this app now draws instead of a pill: a
/// 5px dot and a word, no border, no fill (house rule, 28 Sep 2026). Colour is
/// the only thing that carries meaning here — Active is the accent, Completed
/// is ok, Received short wants a look, and a closed one is simply quiet.
function StatusWord({
  status,
  text,
}: {
  status: FulfillmentStatus
  text: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.9375rem] text-ink">
      <span
        aria-hidden
        className={cn(
          "size-[5px] shrink-0 rounded-full",
          status === "ACTIVE" && "bg-accent",
          status === "COMPLETED" && "bg-ok",
          status === "CLOSED" && "bg-mute",
          // Over, but not as it was meant to be.
          text === "Received short" && "bg-warn",
          (text === "Closed short" || text === "Cancelled") && "bg-mute"
        )}
      />
      {text}
    </span>
  )
}

/// A finished allotment's status, pressed on like the rubber stamp a finished
/// order wears in Procurement: the word over the day it was reached. Completed
/// is ok, a closed remainder wants a look, received short is red and a
/// cancelled one is quiet.
function EndedStamp({ row }: { row: AllotmentRow }) {
  const word = endedWord(row)
  return (
    <span
      className={cn(
        STAMP,
        word === "Completed" && "text-ok-fg",
        word === "Closed short" && "text-warn-fg",
        word === "Received short" && "text-bad-fg",
        word === "Cancelled" && "text-mute"
      )}
    >
      {word}
      <span className="block tabular-nums">{dayMonth(row.updated_at)}</span>
    </span>
  )
}

/// The book's columns. Three in sight — the number, the store, and the
/// pieces over how many items (the owner, 2 Oct 2026: "items" and "articles"
/// are one word here, said once) — and the rest behind Columns: when it was
/// made, whose goods, its status and how far it has got. Searched, filtered
/// and ordered through them; oldest first, because the allotment that has
/// waited longest is the one somebody should be chasing.
///
/// Completed and Cancelled read two columns, the allotment's number and its
/// supplier (allotment-ops-prototype, 11 Oct 2026: "completed cukup allotment
/// number dan supplier"); a row still opens the sheet.
function columns(finished = false): ColumnDef<TableSetup, AllotmentRow>[] {
  const all: ColumnDef<TableSetup, AllotmentRow>[] = [
    {
      id: "expand",
      header: () => <span className="sr-only">Items</span>,
      size: 44,
      enableSorting: false,
      enableHiding: false,
      meta: { card: "hide" },
      cell: ({ row }) => (
        <ExpandToggle
          id={row.original.id}
          number={row.original.allotment_number}
        />
      ),
    },
    {
      accessorKey: "allotment_number",
      header: "Allotment",
      meta: { grow: 160, card: "id" },
      cell: ({ row }) => <AllotmentCell row={row.original} />,
    },
    {
      id: "stores",
      accessorFn: (row) => (row.destination_names ?? []).join(", "),
      header: "Store",
      meta: { grow: 220, card: "title" },
      cell: ({ row }) => {
        const names = row.original.destination_names ?? []
        const full = names.join(", ") || "—"
        // A card has one line: the first three, and how many more.
        const short =
          names.length > 3
            ? `${names.slice(0, 3).join(", ")} +${names.length - 3}`
            : full
        return (
          <>
            <span
              className="block truncate text-ink max-md:hidden"
              title={names.join(", ") || undefined}
            >
              {full}
            </span>
            <span className="block text-ink md:hidden">{short}</span>
          </>
        )
      },
    },
    {
      // Sorts by the pieces; the items ride underneath, the way the order
      // book's Qty does.
      id: "qty",
      accessorFn: (row) => row.total_quantity,
      header: "Quantity",
      size: 130,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => (
        <span className="block text-right tabular-nums">
          <span className="block whitespace-nowrap text-ink">
            {count(row.original.total_quantity)} pcs
          </span>
          <span className="block whitespace-nowrap text-mute">
            {count(row.original.article_count)}{" "}
            {row.original.article_count === 1 ? "article" : "articles"}
          </span>
        </span>
      ),
    },
    {
      accessorKey: "created_at",
      header: "Created At",
      sortFn: "datetime",
      size: 170,
      meta: { filter: { kind: "date" }, card: "hide" },
      // The day and the time (owner, 10 Oct 2026): two allotments made the same
      // day are told apart by when.
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {moment(row.original.created_at)}
        </span>
      ),
    },
    {
      id: "supplier",
      accessorFn: (row) => row.supplier_names ?? "",
      header: "Supplier",
      meta: { grow: 160, card: finished ? "title" : "hide" },
      // One supplier per line (owner, 16 Oct 2026: "kebawah, per supplier").
      cell: ({ row }) => {
        const names = (row.original.supplier_names ?? "")
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
        return names.length === 0 ? (
          <span className="text-mute">No supplier</span>
        ) : (
          <span className="flex flex-col">
            {names.map((name) => (
              <span key={name} className="block truncate">
                {name}
              </span>
            ))}
          </span>
        )
      },
    },
    {
      accessorKey: "fulfillment_status",
      header: "Status",
      size: 190,
      meta: { card: "status" },
      cell: ({ row }) =>
        row.original.fulfillment_status === "ACTIVE" ? (
          <StatusWord status="ACTIVE" text="Active" />
        ) : (
          <EndedStamp row={row.original} />
        ),
    },
    {
      id: "picked",
      accessorFn: (row) => workedOf(row),
      header: "Picked",
      size: 100,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => (
        <span className="tabular-nums">{count(workedOf(row.original))}</span>
      ),
    },
    {
      id: "packed",
      accessorFn: (row) => packedOf(row),
      header: "Packed",
      size: 100,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => (
        <span className="tabular-nums">{count(packedOf(row.original))}</span>
      ),
    },
    {
      id: "dispatch",
      accessorFn: (row) => departedOf(row),
      header: "Dispatch",
      size: 100,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => (
        <span className="tabular-nums">{count(departedOf(row.original))}</span>
      ),
    },
    // Two columns that exist only on a card (a phone; `cardLead`): the figure
    // the card leads with, and the foot's left side — how much has arrived.
    {
      id: "lead",
      accessorFn: (row) => row.total_quantity,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      cell: ({ row }) => (
        <span className="flex flex-col items-end tabular-nums">
          <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
            {count(row.original.total_quantity)}
            <span className="text-[0.9375rem] font-normal tracking-normal text-mute">
              {row.original.total_quantity === 1 ? " pc" : " pcs"}
            </span>
          </span>
          <span className="mt-0.5 text-[0.9375rem] text-mute">
            {count(row.original.article_count)}{" "}
            {row.original.article_count === 1 ? "item" : "items"}
          </span>
        </span>
      ),
    },
    {
      id: "foot",
      accessorFn: (row) => row.received_qty,
      header: "",
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {"Received "}
          <span className="text-cell font-semibold text-ink">
            {count(row.original.received_qty)}
          </span>
          {` of ${count(row.original.total_quantity)} pcs`}
        </span>
      ),
    },
  ]
  // Finished: the number, the supplier, how many stores, the pieces over the
  // articles, and the stamp (owner, 16 Oct 2026: "berapa pcs berapa
  // articles", "berapa store", "ada capnya seperti di po list").
  if (!finished) return all
  const keep = (id: string) =>
    all.find(
      (column) =>
        column.id === id ||
        ("accessorKey" in column && column.accessorKey === id)
    )!
  return [
    keep("allotment_number"),
    keep("supplier"),
    {
      id: "store_count",
      accessorFn: (row) => (row.destination_names ?? []).length,
      header: "Stores",
      size: 110,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => {
        const names = row.original.destination_names ?? []
        return (
          <span
            className="block text-right whitespace-nowrap tabular-nums"
            title={names.join(", ") || undefined}
          >
            {count(names.length)} {names.length === 1 ? "store" : "stores"}
          </span>
        )
      },
    },
    { ...keep("qty"), meta: { align: "right", card: "lead" } },
    keep("fulfillment_status"),
  ]
}

/// A card that wants a look: a DC that refused it, or pieces a store did not
/// find.
function cardToneOf(row: AllotmentRow): "alert" | undefined {
  return row.edge_application_status === "REJECTED" || row.receiving_gap_qty > 0
    ? "alert"
    : undefined
}

/// Packed at the warehouse or further on — the same cumulative reading the
/// allotment sheet's lines use, so the card and the sheet cannot disagree.
function packedOf(row: AllotmentRow): number {
  return (
    row.at_packed_qty +
    row.at_shipment_qty +
    row.at_loaded_qty +
    row.at_in_transit_qty +
    row.received_qty
  )
}

/// The allotment's number, and under it anything that needs saying: a DC
/// that has not taken it yet, or refused it, or pieces a store did not find.
function AllotmentCell({ row }: { row: AllotmentRow }) {
  const notes = [
    // MD cancelled it and the warehouse is still putting pieces back: it
    // stays in progress until they are, but says so (owner, 10 Oct 2026).
    row.fulfillment_status === "ACTIVE" &&
      (row.cancelled_at ?? null) !== null && {
        text: "Cancelled · warehouse putting back",
        tone: "text-bad-fg",
      },
    row.edge_application_status === "PENDING" && {
      text: "Waiting for DC",
      tone: "text-warn-fg",
    },
    row.edge_application_status === "REJECTED" && {
      text: "Refused by DC",
      tone: "text-bad-fg",
    },
    row.receiving_gap_qty > 0 && {
      text: `${count(row.receiving_gap_qty)} not found`,
      tone: "text-warn-fg",
    },
  ].filter((one) => one !== false)
  return (
    <span className="block min-w-0">
      <span className="block truncate font-mono font-medium text-ink">
        {row.allotment_number}
      </span>
      {notes.length > 0 && (
        <span className="flex flex-wrap gap-x-3">
          {notes.map((one) => (
            <span key={one.text} className={one.tone}>
              {one.text}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

/// The "By article" reading's own, much shorter, column set — no Journey, no
/// pipeline: just what a garment was promised and how much of it has arrived
/// (§12: "By article: ARTICLE · SKUs · STORES · ALLOTED · RECEIVED · TO
/// RECEIVE").
function articleColumns(
  display: DisplayUnit
): ColumnDef<TableSetup, ArticleRollup>[] {
  const qty = (n: number) => qtyOf(display, n)
  return [
    {
      accessorKey: "article_name",
      header: "Article",
      meta: { grow: 200 },
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <ArticleThumb
            url={row.original.image_url}
            name={row.original.article_name}
            division={row.original.division_code}
            articleCode={row.original.article_code}
          />
          <span className="min-w-0">
            <span className="block truncate text-ink">
              {row.original.article_name}
            </span>
            <span className="block truncate font-mono text-mute">
              {row.original.article_code}
            </span>
          </span>
        </span>
      ),
    },
    {
      accessorKey: "sku_count",
      header: "SKUs",
      size: 80,
      meta: { align: "right", card: "metric" },
      cell: ({ row }) => (
        <span className="tabular-nums">{count(row.original.sku_count)}</span>
      ),
    },
    {
      accessorKey: "destination_count",
      header: "Stores",
      size: 80,
      meta: { align: "right", card: "metric" },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {count(row.original.destination_count)}
        </span>
      ),
    },
    {
      accessorKey: "total_quantity",
      header: "Allotted",
      size: 110,
      meta: { align: "right", card: "metric" },
      cell: ({ row }) => (
        <span className="tabular-nums">{qty(row.original.total_quantity)}</span>
      ),
    },
    {
      accessorKey: "total_received_quantity",
      header: "Received",
      size: 110,
      meta: { align: "right", card: "metric" },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {qty(row.original.total_received_quantity)}
        </span>
      ),
    },
    {
      accessorKey: "to_receive_qty",
      header: "To Receive",
      size: 110,
      meta: { align: "right", card: "metric" },
      cell: ({ row }) => {
        const n = row.original.to_receive_qty
        return (
          <span
            className={cn(
              "tabular-nums",
              n > 0 ? "font-medium text-ink" : "text-faint"
            )}
          >
            {qty(n)}
          </span>
        )
      },
    },
  ]
}

export function Allotments({
  // Owner's menu of 2026-09-28: "Return to supplier" and "Return to HO" are
  // this same screen, pre-narrowed — see `screens/allotment/returns.tsx`.
  // `/allotment` passes neither, so it opens on TO_STORE exactly as the MD
  // book always has.
  title = "Allotments",
  type = "TO_STORE",
  sub,
  actions,
}: {
  actions?: React.ReactNode
  title?: string
  /// One of `AllotmentType`'s values, fixed by the caller rather than a
  /// picker on screen — the wrapper already knows which book it is.
  type?: string
  sub?: string
} = {}) {
  // Always pieces (the owner, 2026-09-29): the "Show in" picker is gone from
  // this book. Not the shared hook — it remembers a unit chosen on another
  // screen, and with no picker here there would be no way back from it.
  const display = PIECES
  const actor = useActor()
  const qty = (n: number) => qtyOf(display, n)

  /// The page's three tabs. Unallotted and Problems are the store book's
  /// own: the return books have nothing to allot.
  const storeBook = type === "TO_STORE"
  const [view, setView] = useState<View>(storeBook ? "unallotted" : "allotted")
  const [readingChoice, setReading] = useState<Reading>("allotments")
  // In progress is the Active book, Completed the finished one; the By store
  // and By article readings only exist for what is in progress.
  const finishedView = view === "completed" || view === "cancelled"
  const tab: Tab = finishedView ? "completed" : "active"
  const reading: Reading = finishedView ? "allotments" : readingChoice
  const [store, setStore] = useState("")
  const [query, setQuery] = useState("")
  // The note stays behind Columns: the three stage bars need its width, and
  // a list of allotments is read by number and progress, not by note.
  const [visibility, setVisibility] = useState<Record<string, boolean>>({
    supplier: false,
    fulfillment_status: false,
    picked: false,
    packed: false,
    dispatch: false,
    lead: false,
    foot: false,
  })
  /// Whether the rows are cards: a phone.
  const cards = useLayout() === "phone"
  // Oldest first (the owner, 29 Sep 2026).
  const [sorting, setSorting] = useState<SortingState>([
    { id: "created_at", desc: false },
  ])
  const [articleSorting, setArticleSorting] = useState<SortingState>([
    { id: "to_receive_qty", desc: true },
  ])
  const allotment = useSheet("allotment")
  /// What the card's foot asked the sheet to start with: Edit or Cancel.
  const [sheetStart, setSheetStart] = useState<"edit" | "cancel" | null>(null)
  const expanding = useExpanding()

  /// The KPI strip's own read — always ACTIVE, always this book's type — kept
  /// under the same query key `listAllotments(type, "ACTIVE")` would build, so
  /// when the Allotments reading's own Active tab is open the two share one
  /// fetch instead of asking the server twice for the same page.
  const activeQuery = useQuery({
    queryKey: inventoryKeys.allotmentList(type, "ACTIVE"),
    queryFn: ({ signal }) => listAllotments(type, "ACTIVE", signal),
  })
  /// For the Completed card: how many this book has finished, all time.
  const completedQuery = useQuery({
    queryKey: inventoryKeys.allotmentList(type, "FINISHED"),
    queryFn: ({ signal }) => listFinishedAllotments(type, signal),
  })

  const toAllot = useToAllot(storeBook)
  /// The finished book split in two: worked to the end, and called off.
  const finishedDone = completedQuery.data?.items.filter(
    (row) => !isCancelled(row)
  ).length
  const finishedCancelled =
    completedQuery.data?.items.filter(isCancelled).length

  const list = useQuery({
    queryKey: inventoryKeys.allotmentList(type, statusOf(tab)),
    queryFn: ({ signal }) =>
      tab === "active"
        ? listAllotments(type, "ACTIVE", signal)
        : listFinishedAllotments(type, signal),
    enabled: reading === "allotments",
    // Another tab or filter: the rows in hand stay, dimmed (`list-swap`),
    // until the next are read.
    placeholderData: keepPreviousData,
  })

  const byStore = useQuery({
    queryKey: inventoryKeys.allotmentsByStore(store),
    queryFn: ({ signal }) => allotmentsByStore(store, signal),
    enabled: reading === "store" && store !== "",
  })

  const byArticle = useQuery({
    queryKey: inventoryKeys.allotmentsByArticle(store),
    queryFn: ({ signal }) => allotmentsByArticle(store, signal),
    enabled: reading === "article",
  })

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const stores = useMemo(
    () =>
      sitesOf(fleet.data?.items ?? [], "STORE").map((site) => ({
        value: site.site_id,
        label: site.site_name,
      })),
    [fleet.data]
  )

  /// The main table's source: the plain book, or one shop's own slice of it.
  /// "By article" reads a wholly different shape and gets its own table
  /// below.
  const source = reading === "store" ? byStore : list
  const rows = useMemo(() => {
    const all = (source.data?.items ?? []) as AllotmentRow[]
    if (view === "completed") return all.filter((row) => !isCancelled(row))
    if (view === "cancelled") return all.filter(isCancelled)
    return all
  }, [source.data, view])

  const tableColumns = useMemo(() => columns(finishedView), [finishedView])
  const filters = useFilters(tableColumns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: AllotmentRow) => row.id,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
          columnVisibility: {
            ...visibility,
            lead: cards,
            foot: cards,
            ...(cards && !finishedView ? { fulfillment_status: true } : {}),
            // Finished books always show whose goods and the stamp.
            ...(finishedView
              ? { supplier: true, fulfillment_status: true }
              : {}),
          },
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
        onColumnVisibilityChange: setVisibility,
      }),
      [
        rows,
        filters.columns,
        filters.columnFilters,
        query,
        sorting,
        visibility,
        cards,
        finishedView,
      ]
    )
  )

  const articleTableColumns = useMemo(() => articleColumns(display), [display])
  const articleRows = useMemo(
    () => (byArticle.data?.items ?? []) as ArticleRollup[],
    [byArticle.data]
  )
  const articleTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: articleRows,
        columns: articleTableColumns,
        getRowId: (row: ArticleRollup) => row.article_id,
        state: { globalFilter: query, sorting: articleSorting },
        onSortingChange: setArticleSorting,
        onGlobalFilterChange: setQuery,
      }),
      [articleRows, articleTableColumns, query, articleSorting]
    )
  )

  const shown = table.getRowModel().rows.map((row) => row.original)

  const narrowed = query !== "" || filters.filters.length > 0

  /// The three tabs as the dock's status button, on a phone.
  const pageTabs = {
    value: view,
    options: [
      // A return book has nothing to allot: no Unallotted (owner, 16 Oct
      // 2026: Return HO gets the same tabs).
      ...(storeBook
        ? [
            {
              value: "unallotted",
              label: "Unallotted",
              count: toAllot.articles,
            },
          ]
        : []),
      {
        value: "allotted",
        label: "In progress",
        count: activeQuery.data?.items.length,
      },
      { value: "completed", label: "Completed", count: finishedDone },
      { value: "cancelled", label: "Cancelled", count: finishedCancelled },
    ],
    onChange: (next: string) => setView(next as View),
  }
  /// The strip's figures — said again in a line under the title on a phone.
  const active = activeQuery.data?.items
  const toPickPcs = active
    ? sumOf(active, (r) =>
        Math.max(0, r.total_quantity - r.total_cancelled_quantity - workedOf(r))
      )
    : undefined
  const inWarehouse = active
    ? sumOf(active, (r) => Math.max(0, workedOf(r) - departedOf(r)))
    : undefined
  const inTransit = active
    ? sumOf(active, (r) => r.at_in_transit_qty)
    : undefined

  return (
    <PageContent>
      <PageHeader
        title={title}
        sub={
          sub ??
          "What each store has been promised, and how much of it has arrived."
        }
        // The screen's one action stands in its head (hub-ui-patterns,
        // 14 Oct); a phone has the + at the thumb instead (`Fab` below).
        actions={
          view === "unallotted"
            ? undefined
            : (actions ??
              (type === "TO_STORE" && !cards ? (
                <Button variant="primary" onClick={() => setView("unallotted")}>
                  New allotment
                </Button>
              ) : undefined))
        }
      />

      {activeQuery.data && (
        <p className="mb-4 text-[0.9375rem] leading-normal text-pretty text-body md:hidden">
          <b className="font-semibold text-ink tabular-nums">
            {count(activeQuery.data.items.length)}{" "}
            {activeQuery.data.items.length === 1 ? "allotment" : "allotments"}
          </b>{" "}
          in progress. {qty(toPickPcs ?? 0)} pcs to pick,{" "}
          {qty(inWarehouse ?? 0)} in stock, {qty(inTransit ?? 0)} in transit.
        </p>
      )}
      {/* What MD reads first (allotment-ops-prototype): how many are in
          progress, and where their pieces are — still to pick, in the
          warehouse, or dispatched and not yet received. */}
      <KpiStrip className="grid-cols-2 max-md:hidden md:grid-cols-4 xl:grid-cols-4">
        <Kpi
          label="In stock"
          value={inWarehouse === undefined ? "—" : `${qty(inWarehouse)} pcs`}
        />
        <Kpi
          label="Picklist"
          value={toPickPcs === undefined ? "—" : `${qty(toPickPcs)} pcs`}
        />
        <Kpi
          label="In progress"
          value={activeQuery.data ? count(activeQuery.data.items.length) : "—"}
        />
        <Kpi
          label="In transit"
          value={inTransit === undefined ? "—" : `${qty(inTransit)} pcs`}
        />
      </KpiStrip>

      {
        <SubTabs
          className="max-md:hidden"
          value={view}
          onChange={(next) => setView(next as View)}
          tabs={(
            [
              ["unallotted", "Unallotted", toAllot.articles],
              ["allotted", "In progress", activeQuery.data?.items.length],
              ["completed", "Completed", finishedDone],
              ["cancelled", "Cancelled", finishedCancelled],
            ] as const
          )
            .filter(([value]) => storeBook || value !== "unallotted")
            .map(([value, text, total]) => ({
              value,
              label: (
                <>
                  {text}{" "}
                  <span className="text-mute tabular-nums">
                    {total === undefined ? "—" : count(total)}
                  </span>
                </>
              ),
            }))}
        />
      }

      {view === "unallotted" ? (
        <ToAllot
          suppliers={toAllot.suppliers}
          status={toAllot.status}
          dockStatus={storeBook ? pageTabs : undefined}
        />
      ) : (
        <>
          <div className="group/bar mb-5 flex min-h-[2.25rem] flex-wrap items-center gap-2.5 md:flex-nowrap">
            {view === "allotted" && (
              <Select
                aria-label="Reading"
                value={reading}
                onChange={(next) => setReading(next as Reading)}
                className="h-[2.125rem] w-auto shrink-0 max-md:hidden"
              >
                <option value="allotments">Allotments</option>
                <option value="store">By store</option>
                <option value="article">By article</option>
              </Select>
            )}
            <span className="contents max-md:hidden">
              <ExpandingSearch
                value={query}
                onChange={setQuery}
                label="Search allotments"
              />
            </span>
            <BarSpacer />
            {(reading === "store" || reading === "article") && (
              <Choice
                value={store}
                onChange={setStore}
                options={stores}
                className="max-w-56"
              />
            )}
            <div className="hidden md:contents">
              <span className="flex-1" />
              {reading === "article" && <ColumnsMenu table={articleTable} />}
            </div>
          </div>

          {type === "TO_STORE" && (
            <Fab label="New Allotment" onClick={() => setView("unallotted")} />
          )}
          {/* On a phone the status, search, filter and sort are the dock's
              (owner, 2026-10-06), as on the order book. */}
          <DockTools
            search={{
              value: query,
              onChange: setQuery,
              label: "Search Allotments",
            }}
            sort={reading === "article" ? undefined : dockSortOf(table)}
            status={pageTabs}
          />

          {reading === "article" ? (
            <ByArticle
              table={articleTable}
              query={byArticle}
              store={stores.find((one) => one.value === store)?.label ?? null}
            />
          ) : reading === "store" && store === "" ? (
            <Card>
              <EmptyState>
                Choose a store to see everything owed to it, and its lifetime
                per-SKU pipeline.
              </EmptyState>
            </Card>
          ) : (
            <>
              {reading === "store" && byStore.data && (
                <>
                  <Card className="mb-[1.125rem] px-4 py-3.5">
                    <MetricRow>
                      <Metric
                        label="Allotted"
                        value={qty(
                          sumOf(byStore.data.sku_summary, (sku) => sku.quantity)
                        )}
                      />
                      <Metric
                        label="Received"
                        value={qty(
                          sumOf(
                            byStore.data.sku_summary,
                            (sku) => sku.received_quantity
                          )
                        )}
                      />
                      <Metric
                        label="To receive"
                        value={qty(
                          sumOf(
                            byStore.data.sku_summary,
                            (sku) => sku.to_receive_qty
                          )
                        )}
                        tone="warn"
                      />
                      <Metric
                        label="SKUs"
                        value={count(byStore.data.sku_summary.length)}
                      />
                    </MetricRow>
                    <p className="mt-3 text-[0.9375rem] text-mute">
                      This summary spans every allotment ever addressed to{" "}
                      {byStore.data.destination_name} — not only the ones listed
                      below.
                    </p>
                  </Card>

                  <ByStoreSkus
                    rows={byStore.data.sku_summary}
                    store={byStore.data.destination_name}
                    needle={query}
                    display={display}
                  />
                </>
              )}

              <div
                aria-busy={source.isPlaceholderData || undefined}
                className="list-swap"
              >
                {queryState(source, {
                  loading: "Reading the allotment book…",
                  render: () =>
                    rows.length === 0 ? (
                      narrowed ? (
                        <EmptyState>
                          No allotment matches these filters.
                        </EmptyState>
                      ) : reading === "store" ? (
                        <EmptyState>
                          Nothing has ever been allotted to this store.
                        </EmptyState>
                      ) : (
                        <EmptyState>Nothing here yet.</EmptyState>
                      )
                    ) : view === "allotted" && reading === "allotments" ? (
                      <>
                        <DeliveryCards
                          rows={shown}
                          stores={stores}
                          onOpen={(id) => {
                            setSheetStart(null)
                            allotment.open(id)
                          }}
                          onEdit={(id) => {
                            setSheetStart("edit")
                            allotment.open(id)
                          }}
                          onCancel={(id) => {
                            setSheetStart("cancel")
                            allotment.open(id)
                          }}
                        />
                      </>
                    ) : (
                      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
                        <ExpandContext value={expanding}>
                          <DataTable<AllotmentRow>
                            refresh={[list]}
                            table={table}
                            roomy
                            pageScroll
                            cardSort={false}
                            cardsApart
                            cardLead={!finishedView}
                            cardTone={cardToneOf}
                            onRowClick={(row) => allotment.open(row.id)}
                            isSelected={(row) => row.id === allotment.value}
                            isExpanded={(row) => expanding.isOpen(row.id)}
                            renderSub={(row) => <AllotmentItems id={row.id} />}
                            summary={{
                              allotment_number: (
                                <span>
                                  {count(shown.length)}{" "}
                                  <span className="font-normal text-body">
                                    {shown.length === 1
                                      ? "allotment"
                                      : "allotments"}
                                  </span>
                                </span>
                              ),
                              qty: `${qty(sumOf(shown, (row) => row.total_quantity))} pcs`,
                            }}
                          />
                        </ExpandContext>
                      </Card>
                    ),
                })}
              </div>
            </>
          )}
        </>
      )}

      <AllotmentSheet
        id={allotment.value ?? null}
        onClose={() => {
          setSheetStart(null)
          allotment.close()
        }}
        start={sheetStart}
        display={display}
        actor={actor}
      />
    </PageContent>
  )
}

/// What one shop is owed, SKU by SKU — the lifetime pipeline the server has
/// already computed, so a picker can read the size run at a glance rather than
/// subtracting five numbers in their head (§12: "By store: … per SKU Alloted
/// · To Pack · Packed · Shipment · In Transit · Received · To Receive").
///
/// Sorted by what is still owed, and left to scroll with the page: this is
/// supplementary to the allotments below it, not a box of its own to scroll
/// inside (the house rule against inner `max-h` scroll boxes).
function ByStoreSkus({
  rows,
  store,
  needle,
  display,
}: {
  rows: readonly StoreSkuSummary[]
  store: string
  needle: string
  display: DisplayUnit
}) {
  const qty = (n: number) => qtyOf(display, n)
  const catalogue = useCatalogueIdentity()
  const wanted = needle.trim().toLowerCase()
  const shown = useMemo(
    () =>
      [...rows]
        .filter((row) => {
          if (wanted === "") return true
          const identity = catalogue.get(row.sku_code)
          return (
            row.sku_code.toLowerCase().includes(wanted) ||
            (identity?.article_name ?? "").toLowerCase().includes(wanted) ||
            (identity?.article_code ?? "").toLowerCase().includes(wanted)
          )
        })
        .sort(
          (left, right) =>
            right.to_receive_qty - left.to_receive_qty ||
            left.sku_code.localeCompare(right.sku_code)
        ),
    [rows, catalogue, wanted]
  )

  const cell = (n: number) => (
    <span className={n === 0 ? "text-faint" : undefined}>{qty(n)}</span>
  )

  return (
    <Card className="mb-[1.125rem] overflow-hidden">
      <CardHeader>
        <CardTitle>Owed to {store}, by SKU</CardTitle>
        <span className="text-[0.9375rem] text-mute tabular-nums">
          {count(shown.length)} SKUs
        </span>
      </CardHeader>
      <div className="overflow-x-auto border-t border-hairline px-4 py-3">
        {shown.length === 0 ? (
          <EmptyState>
            Nothing has ever been allotted to this store under that search.
          </EmptyState>
        ) : (
          <MiniTable
            head={[
              "SKU",
              { label: "In progress", align: "right" },
              { label: "To Pack", align: "right" },
              { label: "Packed", align: "right" },
              { label: "Shipment", align: "right" },
              { label: "In Transit", align: "right" },
              { label: "Received", align: "right" },
              { label: "To Receive", align: "right" },
            ]}
          >
            {shown.map((row) => {
              const identity = catalogue.get(row.sku_code)
              return (
                <tr key={row.sku_id} className="border-t border-hairline">
                  <td className="py-2 pr-2">
                    <span className="block text-[0.9375rem] text-ink">
                      {identity?.article_name ?? row.sku_code}
                    </span>
                    <span className="font-mono text-[0.9375rem] text-mute">
                      {row.sku_code}
                      {identity &&
                        ` · ${[identity.colour, identity.size].filter(Boolean).join(" · ")}`}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {cell(row.quantity)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {cell(row.to_pack_qty)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {cell(row.at_packed_qty)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {cell(row.at_shipment_qty + row.at_loaded_qty)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {cell(row.at_in_transit_qty)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {cell(row.received_quantity)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {cell(row.to_receive_qty)}
                  </td>
                </tr>
              )
            })}
          </MiniTable>
        )}
      </div>
    </Card>
  )
}

/// The book read by garment: where an article has been sent, and how much of
/// it has actually arrived. Its own `DataTable`, narrower than the main book's
/// — no Journey, no pipeline, just what §12 asks for.
function ByArticle({
  table,
  query,
  store,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any
  query: UseQueryResult<ArticleAllotmentList>
  store: string | null
}) {
  const rows = query.data?.items ?? []
  return (
    <Card className="overflow-clip">
      <CardHeader>
        <CardTitle>
          {store === null
            ? "Every article ever allotted"
            : `Dispatched to ${store}`}
        </CardTitle>
        <span className="text-[0.9375rem] text-mute tabular-nums">
          {count(rows.length)} articles
        </span>
      </CardHeader>
      <div className="border-t border-hairline">
        {queryState(query, {
          loading: "Reading the book by garment…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {store === null
                  ? "Nothing has been allotted out of any pool yet."
                  : "Nothing has ever been dispatched to this store."}
              </EmptyState>
            ) : (
              <DataTable<ArticleRollup> table={table} pageScroll />
            ),
        })}
      </div>
    </Card>
  )
}

/// The record detail. It fetches its own read rather than being handed the
/// row: the list carries a summary and the lines are only wanted once
/// somebody opens one allotment.
///
/// MD edits and cancels from here, in place (allotment-ops-prototype, "MD ·
/// Allotments", 15 Oct 2026; the foot, never the head). The body is the
/// allotment's STORES (`StoreLines`): articles when a store is opened, sizes
/// never.
///
///  - **Edit** turns each store's total, and each article's total for a store,
///    into a box. A typed total is spread over the sizes underneath, never
///    under what is already dispatched. **Save** sends the draft as one
///    `/amend` (per-line `to` targets).
///  - **Ticks** pick the stores a Cancel is for. Cancelling stores is an
///    `/amend` too: each of their lines down to what is dispatched (0 when
///    nothing is). With no tick, and nothing dispatched anywhere, it is the
///    whole allotment's `/cancel`; with part dispatched, "Cancel the rest" is
///    the same `/amend` over every store.
///  - Save and a store cancel answer in a toast with **Undo** for 10 s, which
///    sends the lines back to what they were — re-read first, never under what
///    has been dispatched since. The whole `/cancel` has no way back (there is
///    no un-cancel), so its toast has no Undo.
///
/// A DC-owned allotment keeps the old Edit (close short, then New allotment
/// filled in) and the old cancel: `/amend` answers only for the cloud's own.
function AllotmentSheet({
  id,
  onClose,
  start = null,
  display,
  actor,
}: {
  id: string | null
  onClose: () => void
  /// Open straight into Edit or the Cancel dialog (the In progress card's foot).
  start?: "edit" | "cancel" | null
  /// The viewer's chosen unit, shared with the list this sheet opens from —
  /// switching it there is reflected here without a picker of its own.
  display: DisplayUnit
  actor: string
}) {
  const client = useQueryClient()
  const qty = (n: number) => qtyOf(display, n)
  // The store as the board names it ("C001 · Cikupa").
  const shopName = useShopName()

  const detail = useQuery({
    queryKey: inventoryKeys.allotment(id ?? ""),
    queryFn: ({ signal }) => allotmentDetail(id!, signal),
    enabled: id !== null,
    // The DC answers on its own time: keep reading while it has not.
    refetchInterval: (query) =>
      query.state.data?.edge_application_status === "PENDING" ||
      query.state.data?.cancellation?.outcome === null
        ? 4000
        : false,
  })

  /// The cancel dialog.
  const [cancelling, setCancelling] = useState(false)
  /// Editing in place: each touched line's new target, by line id.
  const [draft, setDraft] = useState<Map<string, number> | null>(null)
  /// The stores ticked for a Cancel.
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  // Another allotment opens on a fresh sheet — "adjusting state during
  // render": nothing of the last one's dialog, draft or ticks is left over.
  const [shown, setShown] = useState<string | null>(null)
  if (id !== shown) {
    setShown(id)
    setCancelling(id !== null && start === "cancel")
    setDraft(null)
    setTicked(new Set())
  }

  const refresh = () => {
    client.invalidateQueries({ queryKey: inventoryKeys.allotments() })
    client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
  }

  const cancel = useMutation({
    mutationFn: (vars: { reason: string }) =>
      cancelAllotment(id!, {
        reason: vars.reason,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: refresh,
  })

  /// MD's change in place: lines to new targets, through `/amend`.
  const amend = useMutation({
    mutationFn: (vars: {
      id: string
      lines: { allotment_line_id: string; to: number }[]
      reason: string | null
    }) =>
      amendAllotment(vars.id, {
        idempotency_key: idempotencyKey(),
        reason: vars.reason,
        lines: vars.lines,
      }),
    onSuccess: refresh,
  })

  /// Undo for 10 s: the lines back to `before`, read against the allotment as
  /// it stands now. It holds the allotment's id, not the sheet's — the sheet
  /// may have closed or moved on by the time Undo is pressed.
  const undoOf = (allotmentId: string, before: Map<string, number>) => () => {
    void (async () => {
      try {
        const fresh = await client.fetchQuery({
          queryKey: inventoryKeys.allotment(allotmentId),
          queryFn: ({ signal }) => allotmentDetail(allotmentId, signal),
          staleTime: 0,
        })
        const back = undoLinesOf(fresh.lines, before)
        if (back.length > 0)
          await amendAllotment(allotmentId, {
            idempotency_key: idempotencyKey(),
            reason: "Undo",
            lines: back,
          })
        refresh()
        toast("Undone")
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not undo the change"
        )
      }
    })()
  }

  const goto = useAppNavigate()

  const record = detail.data
  const lines = record?.lines ?? []
  const packable = lines.filter((one) => one.to_pack_qty > 0)
  /// Close short, then New allotment opens with what was released — one
  /// number per item and store — to change a quantity or move it. The draft is
  /// written only once the close is accepted, so a refusal leaves nothing
  /// behind. For a DC-owned allotment only.
  const reallot = async (reason: string) => {
    if (!record) return
    const released = packable.map((one) => ({
      skuId: one.sku_id,
      destinationId: one.destination_id,
      quantity: one.to_pack_qty,
    }))
    await cancel.mutateAsync({ reason })
    stageDraft(released)
    goto("/allotment/new", {
      key: "allotFrom",
      value: allotFromValue("reallot", record.id),
    })
  }

  const edge =
    record !== undefined && record.activation_target_origin_id !== null
  const toStore =
    record !== undefined &&
    (record.type === "TO_STORE" || record.type === "TO_SITE")
  const gone = record === undefined ? null : cancelOf(record)
  /// MD can still do something to it: it is live and not cancelled.
  const live =
    record !== undefined &&
    record.fulfillment_status === "ACTIVE" &&
    !(gone?.cancelled ?? false)
  /// The cloud's own allotment to stores: edited and cancelled in place.
  const inPlace =
    live && toStore && !edge && record.cancellation === null && actor !== ""
  /// Nothing is left that is not dispatched: no edit down, no cancel.
  const allSent =
    record !== undefined &&
    (edge ? record.to_pack_qty === 0 : roomOf(lines) === 0)
  const editing = inPlace && draft !== null
  /// Edit is the New allotment grid (owner, 2026-10-16): same rows, Stock
  /// column, and a cell never goes over the free stock.
  const editInGrid = () => {
    if (!record) return
    goto("/allotment/new", {
      key: "allotFrom",
      value: allotFromValue("edit", record.id),
    })
  }
  // A card's Edit opens the grid once the allotment is known to be ours.
  const wantsGrid = start === "edit" && inPlace ? (record?.id ?? null) : null
  useEffect(() => {
    if (wantsGrid !== null)
      goto("/allotment/new", {
        key: "allotFrom",
        value: allotFromValue("edit", wantsGrid),
      })
  }, [wantsGrid, goto])

  // What a Cancel is for: the ticked stores, or every store — only those with
  // something left to cancel (a store dispatched in full has nothing to give).
  const storeIds = [...new Set(lines.map((line) => line.destination_id))]
  const scopeIds = (ticked.size > 0 ? [...ticked] : storeIds).filter(
    (store) => roomOf(lines.filter((line) => line.destination_id === store)) > 0
  )
  const scopeLines = lines.filter((line) =>
    scopeIds.includes(line.destination_id)
  )
  const whole = ticked.size === 0
  /// Part of what the Cancel is for is dispatched already: it cancels the rest.
  const rest = stagesOf(scopeLines).dispatched > 0
  /// Anything of the allotment dispatched at all: then even the whole of it is
  /// cancelled line by line, never by `/cancel`.
  const anyDispatched = stagesOf(lines).dispatched > 0
  const scopeNames = storesOf(scopeLines).map((store) => {
    const board = shopName(store.id)
    return board === store.id ? store.name : board
  })
  const scopeWho =
    scopeNames.length === 1
      ? scopeNames[0]
      : `${count(scopeNames.length)} stores`
  const cancelLabel = !whole
    ? `${rest ? "Cancel the rest for" : "Cancel"} ${scopeWho}`
    : rest
      ? "Cancel the rest"
      : "Cancel allotment"

  /// The cancel MD confirmed. The whole allotment with nothing dispatched is
  /// `/cancel`; anything else is every scoped line down to its floor.
  const confirmCancel = async (reason: string) => {
    if (!record) return
    if (!inPlace || (whole && !anyDispatched)) {
      const result = await cancel.mutateAsync({ reason })
      const owed = result.owed_total ?? 0
      toast.success(
        result.edge_cancellation_status === "PENDING"
          ? "Passed to the DC. Cancelling"
          : `${result.allotment_number} cancelled${
              owed > 0 ? ` · ${quantity(owed)} put back by the warehouse` : ""
            }`
      )
      setTicked(new Set())
      return
    }
    const down = scopeLines
      .filter((line) => targetOf(line) > floorOf(line))
      .map((line) => ({ allotment_line_id: line.id, to: floorOf(line) }))
    await amend.mutateAsync({ id: record.id, lines: down, reason })
    setTicked(new Set())
    // No Undo on a cancel: the server closes what was still to pick short,
    // and a closed-short line is not raised back by the same edit (tested on
    // the cloud Gudang, 16 Oct 2026).
    toast.success(
      `${rest ? "Rest cancelled" : "Cancelled"} · ${
        whole ? record.allotment_number : scopeWho
      }`
    )
  }

  const edit = draft === null ? null : draftEditOf(lines, draft)
  const save = () => {
    if (!record || edit === null || edit.lines.length === 0) return
    const before = edit.before
    const said = draftNoteOf(edit)
    amend.mutate(
      { id: record.id, lines: edit.lines, reason: null },
      {
        onSuccess: () => {
          setDraft(null)
          // Undo only takes an increase back (a lower target); a decrease
          // was closed short or owed to the warehouse and does not come back
          // by raising the target again.
          const raisedOnly = edit.lines.every(
            (line) => line.to > (before.get(line.allotment_line_id) ?? 0)
          )
          toast.success(
            `Saved · ${said}`,
            raisedOnly
              ? {
                  duration: 10_000,
                  action: { label: "Undo", onClick: undoOf(record.id, before) },
                }
              : undefined
          )
        },
      }
    )
  }

  /// Why Edit and Cancel are off on a DC-run allotment: the DC turned the
  /// last change down, because what it was for is already picked there.
  const refused =
    record?.cancellation?.outcome === "REJECTED"
      ? (record.cancellation.blocked_picked_quantity ?? 0) > 0
        ? `The DC already picked ${qty(record.cancellation.blocked_picked_quantity ?? 0)}, so it can no longer be edited or cancelled.`
        : "The DC turned down the last change."
      : null

  const footer =
    record === undefined || !live ? undefined : inPlace ? (
      editing ? (
        <SheetFooter
          onCancel={() => {
            setDraft(null)
            amend.reset()
          }}
          cancelLabel="Discard"
          primary={{
            label: "Save",
            onClick: save,
            pending: amend.isPending,
            disabled: edit === null || edit.lines.length === 0,
          }}
          note={edit === null ? undefined : draftNoteOf(edit)}
          error={amend.error}
        />
      ) : (
        <SheetFooter
          danger={
            <>
              <Button
                variant="danger"
                disabled={scopeLines.length === 0}
                onClick={() => setCancelling(true)}
              >
                {cancelLabel}
              </Button>
              <CancelDialog
                open={cancelling}
                onOpenChange={setCancelling}
                id={record.id}
                number={record.allotment_number}
                simple={false}
                toPack={record.to_pack_qty}
                scope={{ lines: scopeLines, whole }}
                onConfirm={confirmCancel}
              />
            </>
          }
          primary={{
            label: "Edit",
            onClick: editInGrid,
          }}
          note={allSent ? "Everything has already been dispatched." : undefined}
        />
      )
    ) : (
      <SheetFooter
        danger={
          <>
            <Button
              variant="danger"
              disabled={
                allSent ||
                // A return already on its way is not cancelled any more.
                (!edge && anyDispatched) ||
                record.cancellation !== null ||
                (edge && record.edge_application_status !== "ACCEPTED") ||
                actor === ""
              }
              onClick={() => setCancelling(true)}
            >
              Cancel allotment
            </Button>
            <CancelDialog
              open={cancelling}
              onOpenChange={setCancelling}
              id={record.id}
              number={record.allotment_number}
              simple
              toPack={record.to_pack_qty}
              onConfirm={confirmCancel}
            />
          </>
        }
        primary={
          !toStore || !edge ? undefined : (
            <ConfirmButton
              label="Edit"
              variant="primary"
              title="Edit this allotment?"
              description={`${qty(record.to_pack_qty)} still to pack opens in New allotment, filled in, to change and save. This allotment is replaced.`}
              confirmLabel="Edit"
              pending={cancel.isPending}
              disabled={
                allSent ||
                record.cancellation !== null ||
                record.edge_application_status !== "ACCEPTED" ||
                actor === ""
              }
              // No reason asked (owner, 2026-10-11): the close is recorded as
              // "Edited", which is all an edit is.
              onConfirm={() => reallot("Edited")}
            />
          )
        }
        note={
          allSent
            ? "Everything has already been dispatched."
            : refused !== null
              ? refused
              : undefined
        }
      />
    )

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "allotment", id }}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={record?.allotment_number ?? "Allotment"}
      closeAs="back"
      // MD sees it at once: Cancelled, whoever's work is still to do.
      badge={gone?.cancelled ? <Pill tone="bad">Cancelled</Pill> : undefined}
      // Who made it and when is the Activity's (owner, 2026-10-12): the
      // head is the number, its state and nothing else.
      footer={footer}
      width="wide"
      // A draft is typing: closing asks first.
      dirty={edit !== null && edit.lines.length > 0}
    >
      {queryState(detail, {
        loading: "Opening the allotment…",
        render: (data) => (
          <AllotmentDocument
            record={data}
            display={display}
            lines={
              <StoreLines
                key={data.id}
                lines={data.lines}
                draft={draft ?? undefined}
                onDraft={editing ? setDraft : undefined}
                selected={inPlace ? ticked : undefined}
                onSelect={inPlace ? setTicked : undefined}
              />
            }
          />
        ),
      })}
    </Sheet>
  )
}

const HIDDEN_EVENTS = new Set([
  "ALLOTMENT_EXECUTED",
  "ALLOTMENT_PICKED",
  "ALLOTMENT_PARTIALLY_PICKED",
])

const EVENT_TITLE: Record<string, string> = {
  ALLOTMENT_CREATED: "Created",
  ALLOTMENT_CANCELLATION_REQUESTED: "Close short requested",
  ALLOTMENT_CANCELLED: "Closed short",
  ALLOTMENT_SHORTAGE: "Short in the warehouse",
}

/// What MD's own changes are called in the history.
const AMENDMENT_TITLE: Record<AllotmentAmendment["kind"], string> = {
  REDUCE: "Quantity reduced",
  ADD: "Quantity added",
  CANCEL: "Cancelled",
}

/// The allotment as a document: the fulfillment pipeline, the lines matrix,
/// and its history — the shape §12's UI contract asks for, drawn as facts
/// rather than as disabled inputs.
function AllotmentDocument({
  record,
  display,
  lines,
}: {
  record: AllotmentDetail
  display: DisplayUnit
  /// The allotment's stores (`StoreLines`), drawn by the sheet: it holds the
  /// draft and the ticks.
  lines: React.ReactNode
}) {
  const qty = (n: number) => qtyOf(display, n)
  /// The SKU and store an event names, when it names them.
  const lineOf = (event: AllotmentDetail["events"][number]) =>
    record.lines.find(
      (line) =>
        line.sku_id === event.sku_id &&
        (event.destination_id === null ||
          line.destination_id === event.destination_id)
    )
  const happened: { at: string; event: TimelineEvent }[] = record.events
    .filter((event) => !HIDDEN_EVENTS.has(event.event_type))
    .map((event) => {
      const line = lineOf(event)
      const where = line
        ? [
            [line.colour, line.size].filter(Boolean).join(" · ") ||
              line.sku_code,
            line.destination_name ?? destinationShort(line.destination_id),
          ].join(" to ")
        : null
      const why =
        record.cancellation !== null &&
        record.cancellation.reason !== "" &&
        event.event_type === "ALLOTMENT_CANCELLATION_REQUESTED"
          ? record.cancellation.reason
          : null
      return {
        at: event.occurred_at,
        event: {
          id: event.id,
          title: EVENT_TITLE[event.event_type] ?? label(event.event_type),
          detail: [qty(event.quantity), where, why].filter(Boolean).join(" · "),
          at: moment(event.occurred_at),
          state: "done" as const,
        },
      }
    })
  // MD's edits and cancels, one entry per act: an edit that touched twenty
  // lines is one row in the history, not twenty.
  const acts = new Map<string, AllotmentAmendment[]>()
  for (const one of record.amendments ?? []) {
    const key = `${one.kind}|${one.actor_id}|${one.created_at}`
    acts.set(key, [...(acts.get(key) ?? []), one])
  }
  for (const [key, group] of acts) {
    const first = group[0]
    happened.push({
      at: first.created_at,
      event: {
        id: `amendment-${key}`,
        title: AMENDMENT_TITLE[first.kind],
        detail: [
          first.reason,
          first.actor_id,
          group.length > 1 ? `${count(group.length)} lines` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        at: moment(first.created_at),
        state: "done",
      },
    })
  }
  // The warehouse's side of MD's changes: seen per store (opening the work), and the pieces
  // it moved back.
  for (const one of record.acknowledgements ?? []) {
    const store = record.lines.find(
      (line) => line.destination_id === one.destination_id
    )
    happened.push({
      at: one.at,
      event: {
        id: `acknowledged-${one.destination_id}-${one.at}`,
        title: "Warehouse saw the change",
        detail: [
          store?.destination_name ?? destinationShort(one.destination_id),
          one.by,
        ].join(" · "),
        at: moment(one.at),
        state: "done",
      },
    })
  }
  for (const one of record.move_backs ?? []) {
    happened.push({
      at: one.at,
      event: {
        id: `move-back-${one.at}`,
        title: `Warehouse moved back ${quantity(one.pieces)}`,
        detail: one.by,
        at: moment(one.at),
        state: "done",
      },
    })
  }
  // The server's order stands until MD's changes join it.
  if (
    acts.size > 0 ||
    (record.acknowledgements?.length ?? 0) > 0 ||
    (record.move_backs?.length ?? 0) > 0
  )
    happened.sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
  const events = happened.map((one) => one.event)

  /// Cancelled, and by whom, why and when — the status alone when the detail
  /// does not say.
  const gone = cancelOf(record)
  /// Pieces MD took out that the warehouse has not moved back yet.
  const owed = pendingOf(record.lines)

  return (
    <div className="flex flex-col gap-5">
      {(record.edge_application_status === "PENDING" ||
        record.edge_application_status === "REJECTED" ||
        record.receiving_gap_qty > 0 ||
        !record.received_projection_consistent ||
        owed > 0) && (
        <div className="flex flex-col gap-2">
          {record.edge_application_status === "PENDING" && (
            <Banner tone="warn">
              Waiting for the DC to accept this allotment. It can't be closed
              short until then.
            </Banner>
          )}
          {record.edge_application_status === "REJECTED" && (
            <Banner tone="bad">The DC refused this allotment.</Banner>
          )}
          {owed > 0 && (
            <Banner tone="warn">
              {`The warehouse still has to put back ${quantity(owed)} ${
                gone.cancelled ? "of this cancelled allotment" : "you took out"
              }.`}
            </Banner>
          )}
          {record.receiving_gap_qty > 0 && (
            <Banner tone="warn">
              {qty(record.receiving_gap_qty)} were handed over but not found at
              the store. Inventory is looking into it.
            </Banner>
          )}
          {!record.received_projection_consistent && (
            <Banner tone="bad">
              The received count and the scanned tags disagree.
            </Banner>
          )}
        </div>
      )}

      {gone.cancelled &&
        (gone.by !== null || gone.at !== null || gone.reason !== null) && (
          <Facts>
            {gone.by !== null && <Fact term="Cancelled by">{gone.by}</Fact>}
            {gone.at !== null && <Fact term="On">{moment(gone.at)}</Fact>}
            {gone.reason !== null && (
              <Fact term="Reason" wide>
                {gone.reason}
              </Fact>
            )}
          </Facts>
        )}

      {/* No heading and no rule over it: the sheet is the allotment's items
          (owner, 10 Oct 2026). */}
      {lines}

      {events.length > 0 && (
        <ActivityFold count={events.length}>
          <Timeline events={events} />
        </ActivityFold>
      )}
    </div>
  )
}

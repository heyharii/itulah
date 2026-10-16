import {
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import type { ClosedShortLine } from "@itulah/contract"
import { useMemo, useState } from "react"

import { DockTools, type DockStatus } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ConfirmButton, SavedDialog } from "@/components/ui/dialog"
import { BarSpacer, ExpandingSearch } from "@/components/ui/list-chrome"
import { EmptyState } from "@/components/ui/states"
import { count, day, quantity } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { shortReasonLabel } from "@/lib/operations/changes"
import {
  closeShortAllotment,
  inventoryKeys,
  type StillNeededLine,
  type StillNeededList,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"

/// Still needed: what MD allotted that the warehouse has not been able to
/// finish (9 Oct 2026). Each line says what MD wants (Target), what has gone
/// (Sent) and what is still to pick (To pick) — with, under it, why the picker
/// could not finish when one said. MD may Close remaining; there is no Wait.
/// Closed short is the other half: what MD has already closed.
///
/// On a phone each line is a card (`cardLead`): the article and SKU, the store,
/// the short reason as one quiet line, To pick as the card's figure, Target and
/// Sent in its foot and Close remaining as the foot's one button. Search and the
/// tab choice are the dock's.

const number = (n: number) => <span className="tabular-nums">{count(n)}</span>

/// A figure the cloud may not answer yet: a dash rather than a wrong zero.
const figure = (n: number | undefined) =>
  n === undefined ? <span className="text-faint">—</span> : number(n)

/// The article over its SKU. On a card it is the title: the SKU line stays the
/// quiet mono one it is on a desk.
function articleCell(row: { article_name: string; sku_code: string }) {
  return (
    <span className="block min-w-0">
      <span className="block truncate text-ink">{row.article_name}</span>
      <span className="block truncate font-mono text-[0.9375rem] font-normal text-mute">
        {row.sku_code}
      </span>
    </span>
  )
}

function allotmentCell(row: { allotment_number: string }, when: string) {
  return (
    <span className="block min-w-0">
      <span className="block truncate font-mono text-ink">
        {row.allotment_number}
      </span>
      <span className="block truncate text-mute">{day(when)}</span>
    </span>
  )
}

function storeOf(row: {
  destination_name: string | null
  destination_id: string
}) {
  return row.destination_name ?? row.destination_id
}

/// What MD wants the store to get: the target, or what was allotted on a cloud
/// that does not answer the target yet.
const targetOf = (row: StillNeededLine) => row.target ?? row.allotted

/// Why the picker could not finish, in plain words — nothing when none said.
const reasonOf = (row: StillNeededLine) =>
  row.short_reason ? shortReasonLabel(row.short_reason) : ""

function CloseRemaining({
  row,
  onClosed,
}: {
  row: StillNeededLine
  /// The close went through; the receipt is the panel's to show — this cell
  /// unmounts when the refetch moves the row out of the open list.
  onClosed: (pcs: number) => void
}) {
  const client = useQueryClient()
  const phone = useLayout() === "phone"
  const close = useMutation({
    mutationFn: () =>
      closeShortAllotment(row.allotment_id, {
        idempotency_key: crypto.randomUUID(),
        lines: [
          { allotment_line_id: row.allotment_line_id, quantity: row.unfilled },
        ],
        reason: null,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: inventoryKeys.allotments() })
      client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      onClosed(row.unfilled)
    },
  })
  return (
    // The dialog is portalled, but React events still bubble through it to
    // the row that opens the sheet.
    <span onClick={(event) => event.stopPropagation()}>
      <ConfirmButton
        label="Close remaining"
        // A card's foot takes the tint word button (44px to land on); a table
        // row the small soft one.
        variant={phone ? "tint" : "soft"}
        size={phone ? "card" : "sm"}
        title="Close remaining?"
        description={`${storeOf(row)} gets ${count(targetOf(row) - row.unfilled)} of ${count(targetOf(row))}.`}
        confirmLabel="Close remaining"
        pending={close.isPending}
        onConfirm={() => close.mutateAsync()}
      />
    </span>
  )
}

function openColumns(
  onClosed: (pcs: number) => void
): ColumnDef<TableSetup, StillNeededLine>[] {
  return [
    {
      id: "no",
      header: "No.",
      size: 64,
      enableSorting: false,
      meta: { card: "hide" },
      cell: ({ row }) => (
        <span className="text-mute tabular-nums">{row.index + 1}</span>
      ),
    },
    {
      accessorKey: "allotment_number",
      header: "Allotment",
      size: 150,
      meta: { card: "id" },
      cell: ({ row }) => allotmentCell(row.original, row.original.allotted_at),
    },
    {
      id: "store",
      header: "Store",
      size: 160,
      accessorFn: (row) => storeOf(row),
      meta: { card: "meta" },
      cell: ({ row }) => storeOf(row.original),
    },
    {
      id: "sku",
      header: "SKU",
      accessorFn: (row) => row.article_name,
      meta: { grow: 200, card: "title" },
      cell: ({ row }) => articleCell(row.original),
    },
    {
      id: "target",
      header: "Target",
      size: 100,
      accessorFn: (row) => targetOf(row),
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => number(targetOf(row.original)),
    },
    {
      id: "sent",
      header: "Dispatched",
      size: 100,
      accessorFn: (row) => row.sent ?? 0,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => figure(row.original.sent),
    },
    {
      // The pieces still to pick, and under them why the picker could not
      // finish when one said.
      accessorKey: "unfilled",
      header: "To pick",
      size: 200,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => {
        const why = reasonOf(row.original)
        return (
          <span className="block text-right">
            <span className="block font-medium text-warn-fg tabular-nums">
              {count(row.original.unfilled)}
            </span>
            {why !== "" && (
              <span className="block text-[0.9375rem] text-mute">{why}</span>
            )}
          </span>
        )
      },
    },
    // Three columns that exist only on a card (a phone; `cardLead`): the short
    // reason as one quiet line under the store, the figure the card leads with,
    // and the foot's left side.
    {
      id: "reason",
      header: "",
      accessorFn: (row) => reasonOf(row),
      enableHiding: false,
      enableSorting: false,
      meta: { card: "meta" },
      cell: ({ row }) => reasonOf(row.original),
    },
    {
      id: "lead",
      header: "",
      accessorFn: (row) => row.unfilled,
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      cell: ({ row }) => (
        <span className="flex flex-col items-end tabular-nums">
          <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-warn-fg">
            {count(row.original.unfilled)}
          </span>
          <span className="mt-0.5 text-[0.9375rem] text-mute">to pick</span>
        </span>
      ),
    },
    {
      id: "foot",
      header: "",
      accessorFn: (row) => targetOf(row),
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {"Target "}
          <span className="font-semibold text-ink">
            {count(targetOf(row.original))}
          </span>
          {row.original.sent !== undefined && (
            <>
              {" · Dispatched "}
              <span className="font-semibold text-ink">
                {count(row.original.sent)}
              </span>
            </>
          )}
        </span>
      ),
    },
    {
      id: "action",
      header: "",
      size: 170,
      enableSorting: false,
      enableHiding: false,
      meta: { align: "right", card: "status" },
      cell: ({ row }) => (
        <CloseRemaining row={row.original} onClosed={onClosed} />
      ),
    },
  ]
}

function closedColumns(): ColumnDef<TableSetup, ClosedShortLine>[] {
  return [
    {
      id: "no",
      header: "No.",
      size: 64,
      enableSorting: false,
      meta: { card: "hide" },
      cell: ({ row }) => (
        <span className="text-mute tabular-nums">{row.index + 1}</span>
      ),
    },
    {
      accessorKey: "allotment_number",
      header: "Allotment",
      size: 150,
      meta: { card: "id" },
      cell: ({ row }) => (
        <span className="block truncate font-mono text-ink">
          {row.original.allotment_number}
        </span>
      ),
    },
    {
      id: "store",
      header: "Store",
      size: 160,
      accessorFn: (row) => storeOf(row),
      meta: { card: "meta" },
      cell: ({ row }) => storeOf(row.original),
    },
    {
      id: "sku",
      header: "SKU",
      accessorFn: (row) => row.article_name,
      meta: { grow: 200, card: "title" },
      cell: ({ row }) => articleCell(row.original),
    },
    {
      accessorKey: "allotted",
      header: "Allotted",
      size: 100,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => number(row.original.allotted),
    },
    {
      accessorKey: "packed",
      header: "Packed",
      size: 100,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => number(row.original.packed),
    },
    {
      accessorKey: "closed_short",
      header: "Closed Short",
      size: 120,
      meta: { align: "right", card: "hide" },
      cell: ({ row }) => number(row.original.closed_short),
    },
    {
      accessorKey: "closed_at",
      header: "By / Date",
      size: 160,
      meta: { card: "hide" },
      cell: ({ row }) => (
        <span className="block min-w-0">
          <span className="block truncate text-ink">
            {row.original.closed_by}
          </span>
          <span className="block truncate text-mute">
            {day(row.original.closed_at)}
          </span>
        </span>
      ),
    },
    {
      id: "lead",
      header: "",
      accessorFn: (row) => row.closed_short,
      enableHiding: false,
      enableSorting: false,
      meta: { card: "lead" },
      cell: ({ row }) => (
        <span className="flex flex-col items-end tabular-nums">
          <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
            {count(row.original.closed_short)}
          </span>
          <span className="mt-0.5 text-[0.9375rem] text-mute">
            closed short
          </span>
        </span>
      ),
    },
    {
      id: "foot",
      header: "",
      accessorFn: (row) => row.closed_at,
      enableHiding: false,
      enableSorting: false,
      meta: { card: "foot" },
      cell: ({ row }) => (
        <span>
          {row.original.closed_by} · {day(row.original.closed_at)}
        </span>
      ),
    },
  ]
}

/// Whether a line is what was searched for: its allotment, store, article or SKU.
function matches(
  row: {
    allotment_number: string
    article_name: string
    article_code: string
    sku_code: string
    destination_name: string | null
    destination_id: string
  },
  needle: string
): boolean {
  return `${row.allotment_number} ${storeOf(row)} ${row.article_name} ${row.article_code} ${row.sku_code}`
    .toLowerCase()
    .includes(needle)
}

/// The two tabs' body. Row click opens the allotment sheet.
export function UnfilledPanel({
  which,
  query,
  onOpen,
  dockStatus,
}: {
  which: "open" | "closed"
  query: UseQueryResult<StillNeededList>
  onOpen: (allotmentId: string) => void
  /// The page's tabs as the dock's status button, on a phone.
  dockStatus?: DockStatus
}) {
  const cards = useLayout() === "phone"
  const [search, setSearch] = useState("")
  const needle = search.trim().toLowerCase()
  const everyOpen = query.data?.open
  const everyClosed = query.data?.closed
  const open = useMemo(
    () =>
      (everyOpen ?? []).filter((row) => needle === "" || matches(row, needle)),
    [everyOpen, needle]
  )
  const closed = useMemo(
    () =>
      (everyClosed ?? []).filter(
        (row) => needle === "" || matches(row, needle)
      ),
    [everyClosed, needle]
  )
  /// The close a press made, held in the receipt dialog until it is read. The
  /// panel stays mounted through the refetch that moves the closed row out of
  /// the open list — the cell that started the write does not.
  const [closedPcs, setClosedPcs] = useState<number | null>(null)
  const openColumnDefs = useMemo(() => openColumns(setClosedPcs), [])
  const closedColumnDefs = useMemo(() => closedColumns(), [])
  const visibility = useMemo(
    () => ({ lead: cards, foot: cards, reason: cards }),
    [cards]
  )

  const openTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: open,
        columns: openColumnDefs,
        getRowId: (row: StillNeededLine) => row.allotment_line_id,
        state: { columnVisibility: visibility },
      }),
      [open, openColumnDefs, visibility]
    )
  )
  const closedTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: closed,
        columns: closedColumnDefs,
        getRowId: (row: ClosedShortLine) =>
          `${row.allotment_line_id}-${row.closed_at}`,
        state: { columnVisibility: { lead: cards, foot: cards } },
      }),
      [closed, closedColumnDefs, cards]
    )
  )

  const searching = needle !== ""

  return (
    <>
      <DockTools
        search={{
          value: search,
          onChange: setSearch,
          label: "Search Allotments",
        }}
        status={dockStatus}
      />
      <div className="group/bar mb-5 flex min-h-[2.25rem] items-center max-md:hidden">
        <ExpandingSearch
          value={search}
          onChange={setSearch}
          label="Search allotments"
        />
        <BarSpacer />
      </div>
      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(query, {
          loading: "Reading what is still needed…",
          render: (data) =>
            which === "open" ? (
              open.length === 0 ? (
                <EmptyState>
                  {searching && data.open.length > 0
                    ? "No line matches."
                    : "Nothing is still needed."}
                </EmptyState>
              ) : (
                <DataTable<StillNeededLine>
                  refresh={[query]}
                  table={openTable}
                  roomy
                  pageScroll
                  cardSort={false}
                  cardsApart
                  cardLead
                  onRowClick={(row) => onOpen(row.allotment_id)}
                />
              )
            ) : closed.length === 0 ? (
              <EmptyState>
                {searching && data.closed.length > 0
                  ? "No line matches."
                  : "Nothing completed."}
              </EmptyState>
            ) : (
              <DataTable<ClosedShortLine>
                refresh={[query]}
                table={closedTable}
                roomy
                pageScroll
                cardSort={false}
                cardsApart
                cardLead
                onRowClick={(row) => onOpen(row.allotment_id)}
              />
            ),
        })}
      </Card>
      <SavedDialog
        open={closedPcs !== null}
        onOpenChange={(next) => {
          if (!next) setClosedPcs(null)
        }}
        title={closedPcs !== null && <>{quantity(closedPcs)} closed</>}
      />
    </>
  )
}

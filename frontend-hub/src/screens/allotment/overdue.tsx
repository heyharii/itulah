import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { BarSpacer, ExpandingSearch } from "@/components/ui/list-chrome"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { DockTools, type DockStatus } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import type { OverdueRow } from "@/screens/allotment/overdue-data"
import { AllotmentItems, ExpandToggle } from "@/screens/allotment/items"
import { ExpandContext, useExpanding } from "@/screens/allotment/expanding"
import { tableSetup, type TableSetup } from "@/lib/table"

const columns: ColumnDef<TableSetup, OverdueRow>[] = [
  {
    id: "expand",
    header: () => <span className="sr-only">Items</span>,
    size: 44,
    enableSorting: false,
    enableHiding: false,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <ExpandToggle id={row.original.id} number={row.original.number} />
    ),
  },
  {
    accessorKey: "number",
    header: "Allotment",
    meta: { grow: 160, card: "id" },
    cell: ({ row }) => (
      <span className="block truncate font-mono font-medium text-ink">
        {row.original.number}
      </span>
    ),
  },
  {
    accessorKey: "store",
    header: "Store",
    meta: { grow: 220, card: "title" },
    cell: ({ row }) => (
      <span className="block truncate text-ink">{row.original.store}</span>
    ),
  },
  {
    accessorKey: "pieces",
    header: "Quantity",
    size: 130,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        <span className="block whitespace-nowrap text-ink">
          {count(row.original.pieces)} pcs
        </span>
        <span className="block whitespace-nowrap text-mute">
          {count(row.original.items)}{" "}
          {row.original.items === 1 ? "item" : "items"}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "days",
    header: "Age",
    size: 120,
    meta: { align: "right", card: "status" },
    cell: ({ row }) => (
      <span className="font-medium whitespace-nowrap text-bad-fg tabular-nums">
        {count(row.original.days)} days
      </span>
    ),
  },
  {
    accessorKey: "stage",
    header: "Stuck at",
    size: 150,
    meta: { card: "hide" },
    cell: ({ row }) => <span className="text-ink">{row.original.stage}</span>,
  },
  // Two columns that exist only on a card (a phone; `cardLead`): the figure
  // the card leads with, and where the goods are stuck.
  {
    id: "lead",
    accessorFn: (row) => row.pieces,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <span className="flex flex-col items-end tabular-nums">
        <span className="text-[1.5rem] leading-tight font-semibold tracking-tight text-ink">
          {count(row.original.pieces)}
          <span className="text-[0.875rem] font-normal tracking-normal text-mute">
            {row.original.pieces === 1 ? " pc" : " pcs"}
          </span>
        </span>
        <span className="mt-0.5 text-[0.875rem] text-mute">
          {count(row.original.items)}{" "}
          {row.original.items === 1 ? "item" : "items"}
        </span>
      </span>
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.stage,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <span>
        {"Stuck at "}
        <span className="text-cell font-semibold text-ink">
          {row.original.stage}
        </span>
      </span>
    ),
  },
]

/// The Overdue tab: a row per Active allotment past `OVERDUE_DAYS`, oldest
/// first. A row opens its allotment.
export function OverdueTable({
  rows,
  loading,
  selected,
  onOpen,
  dockStatus,
}: {
  rows: readonly OverdueRow[]
  /// The Active book is still on its way.
  loading: boolean
  selected: string | undefined
  onOpen: (allotmentId: string) => void
  /// The page's tabs as the dock's status button, on a phone.
  dockStatus?: DockStatus
}) {
  const [query, setQuery] = useState("")
  const cards = useLayout() === "phone"
  const expanding = useExpanding()
  const [sorting, setSorting] = useState<SortingState>([
    { id: "days", desc: true },
  ])
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === "") return rows
    return rows.filter((row) =>
      `${row.number} ${row.store} ${row.stage}`.toLowerCase().includes(needle)
    )
  }, [rows, query])
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: shown as OverdueRow[],
        columns,
        getRowId: (row: OverdueRow) => row.id,
        state: {
          sorting,
          columnVisibility: { lead: cards, foot: cards },
        },
        onSortingChange: setSorting,
      }),
      [shown, sorting, cards]
    )
  )
  return (
    <>
      <DockTools
        search={{
          value: query,
          onChange: setQuery,
          label: "Search Allotments",
        }}
        status={dockStatus}
      />
      <div className="group/bar mb-5 flex min-h-[2.25rem] items-center max-md:hidden">
        <ExpandingSearch
          value={query}
          onChange={setQuery}
          label="Search allotments"
        />
        <BarSpacer />
      </div>
      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {shown.length === 0 ? (
          <EmptyState>
            {loading
              ? "Reading the allotment book…"
              : rows.length === 0
                ? "Nothing overdue."
                : "No allotment matches."}
          </EmptyState>
        ) : (
          <ExpandContext value={expanding}>
            <DataTable<OverdueRow>
              table={table}
              roomy
              pageScroll
              cardSort={false}
              cardsApart
              cardLead
              cardTone={() => "alert"}
              onRowClick={(row) => onOpen(row.id)}
              isSelected={(row) => row.id === selected}
              isExpanded={(row) => expanding.isOpen(row.id)}
              renderSub={(row) => <AllotmentItems id={row.id} />}
            />
          </ExpandContext>
        )}
      </Card>
    </>
  )
}

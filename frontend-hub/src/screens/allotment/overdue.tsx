import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { BarSpacer, ExpandingSearch } from "@/components/ui/list-chrome"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
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
    meta: { grow: 160 },
    cell: ({ row }) => (
      <span className="block truncate font-mono font-medium text-ink">
        {row.original.number}
      </span>
    ),
  },
  {
    accessorKey: "store",
    header: "Store",
    meta: { grow: 220 },
    cell: ({ row }) => (
      <span className="block truncate text-ink">{row.original.store}</span>
    ),
  },
  {
    accessorKey: "pieces",
    header: "Quantity",
    size: 130,
    meta: { align: "right" },
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
    meta: { align: "right" },
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
    cell: ({ row }) => <span className="text-ink">{row.original.stage}</span>,
  },
]

/// The Overdue tab: a row per Active allotment past `OVERDUE_DAYS`, oldest
/// first. A row opens its allotment.
export function OverdueTable({
  rows,
  loading,
  selected,
  onOpen,
}: {
  rows: readonly OverdueRow[]
  /// The Active book is still on its way.
  loading: boolean
  selected: string | undefined
  onOpen: (allotmentId: string) => void
}) {
  const [query, setQuery] = useState("")
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
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [shown, sorting]
    )
  )
  return (
    <>
      <div className="group/bar mb-5 flex min-h-[2.25rem] items-center">
        <ExpandingSearch
          value={query}
          onChange={setQuery}
          label="Search allotments"
        />
        <BarSpacer />
      </div>
      <Card className="overflow-clip">
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

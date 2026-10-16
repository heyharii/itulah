import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import type { Refreshable } from "@/components/ui/refresh-stamp"
import { EmptyState } from "@/components/ui/states"
import { count, quantity } from "@/lib/format"
import { tableSetup, type TableSetup } from "@/lib/table"
import type { ProblemRow } from "./problems-data"

const columns: ColumnDef<TableSetup, ProblemRow>[] = [
  {
    accessorKey: "allotment",
    header: "Allotment",
    size: 170,
    cell: ({ row }) => (
      <span className="font-mono text-ink">{row.original.allotment}</span>
    ),
  },
  {
    accessorKey: "store",
    header: "Store",
    meta: { grow: 160 },
    cell: ({ row }) => (
      <span className="block truncate text-ink">{row.original.store}</span>
    ),
  },
  {
    accessorKey: "supplier",
    header: "Supplier",
    meta: { grow: 160 },
    cell: ({ row }) => (
      <span className="block truncate text-body">{row.original.supplier}</span>
    ),
  },
  {
    id: "problem",
    accessorFn: (row) => row.short,
    header: "Problem",
    meta: { grow: 200 },
    cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="block whitespace-nowrap text-ink">
          {row.original.kind}{" "}
          <span className="font-medium text-bad-fg tabular-nums">
            −{quantity(row.original.short)}
          </span>
        </span>
        {row.original.detail !== null && (
          <span className="block truncate text-mute">
            {row.original.detail}
          </span>
        )}
      </span>
    ),
  },
  {
    accessorKey: "pieces",
    header: "Pcs",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="text-ink tabular-nums">
        {count(row.original.pieces)}
      </span>
    ),
  },
]

/// The Problems tab: one table, a row per allotment and store with something
/// that will not arrive in full. A row opens its allotment.
export function ProblemsTable({
  rows,
  loading,
  selected,
  onOpen,
  refresh,
}: {
  rows: readonly ProblemRow[]
  /// The reads it is made of are still on their way.
  loading: boolean
  /// The queries `rows` were made from, for the stamp over the table.
  refresh?: readonly Refreshable[]
  selected: string | undefined
  onOpen: (allotmentId: string) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as ProblemRow[],
        columns,
        getRowId: (row: ProblemRow) => row.key,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )
  return (
    <Card className="overflow-clip">
      {rows.length === 0 ? (
        <EmptyState>
          {loading ? "Reading the allotment book…" : "No problems."}
        </EmptyState>
      ) : (
        <DataTable<ProblemRow>
          refresh={refresh}
          table={table}
          roomy
          pageScroll
          cardSort={false}
          onRowClick={(row) => row.allotmentId && onOpen(row.allotmentId)}
          isSelected={(row) =>
            row.allotmentId !== null && row.allotmentId === selected
          }
        />
      )}
    </Card>
  )
}

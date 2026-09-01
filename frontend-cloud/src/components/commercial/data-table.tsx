/* eslint-disable react-refresh/only-export-components -- the hook that builds a
   commercial table and the component that draws it are one unit; see the note
   inside on why they have to agree about pagination. */
import { DataGrid } from "@/components/custom/data-grid"
import { dataTableFeatures, type DataTableFeatures } from "@/lib/table/features"
import type { ColumnDef, Row, RowData, SortingState, Table as TanTable } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

/// A commercial table, on the same footing as the buying screens' one.
///
/// The markup is the shared table block's, unchanged — this exists only so
/// that four tables in this folder do not each carry their own copy of a
/// header loop, a body loop and a `useTable` call, which is how three of them
/// end up sorting and the fourth quietly does not.
///
/// One page the size of the data on purpose: `getRowModel()` routes through
/// the paginated row model whenever the pagination feature is registered, and
/// the shared registry registers it for every table, so a table that said
/// nothing about pagination would silently draw its first ten rows.
export function useCommercialTable<TData extends RowData>({
  data,
  columns,
  getRowId,
  sorting: initialSorting = [],
}: {
  data: TData[]
  columns: ColumnDef<DataTableFeatures, TData>[]
  getRowId: (row: TData) => string
  sorting?: SortingState
}): TanTable<DataTableFeatures, TData> {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)

  return useTable(
    useMemo(
      () => ({
        features: dataTableFeatures,
        data,
        columns,
        getRowId,
        state: {
          sorting,
          pagination: { pageIndex: 0, pageSize: Math.max(1, data.length) },
        },
        onSortingChange: setSorting,
      }),
      [data, columns, getRowId, sorting],
    ),
  )
}

export function CommercialTable<TData extends RowData>({
  table,
  onRowClick,
  rowClassName,
  footer,
}: {
  table: TanTable<DataTableFeatures, TData>
  onRowClick?: (row: Row<DataTableFeatures, TData>) => void
  rowClassName?: (row: Row<DataTableFeatures, TData>) => string | undefined
  footer?: React.ReactNode
}) {
  return (
    <DataGrid
      table={table}
      onRowClick={onRowClick}
      rowClassName={rowClassName}
      footer={footer}
    />
  )
}

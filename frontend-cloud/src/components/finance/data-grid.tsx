/* eslint-disable react-refresh/only-export-components -- the hook that builds a
   finance table and the component that draws it are one unit: a screen never
   wants one without the other, and splitting them would put the reason they
   agree about pagination in a file neither of them mentions. */
/// Aliased: `Table` is already the name of the TanStack table type this module
/// is written against, and the frame is the markup, not the model
import { Table as TableFrame } from "@/components/custom/table"
import { dataTableFeatures, type DataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import type {
  ColumnDef,
  ColumnFiltersState,
  Row,
  RowData,
  SortingState,
  Table,
} from "@tanstack/react-table"
import { flexRender, useTable } from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useMemo, useRef, useState } from "react"

/// A finance table, wired the way every finance screen wants one.
///
/// Sorting and filtering are held here rather than in each screen because they
/// are the same two pieces of state every time, and because a screen that owns
/// them ends up owning the whole `useTable` call — which is how five tables
/// come to disagree about whether the header sorts.
///
/// The whole answer is paginated into one page on purpose. `getRowModel()`
/// routes through the paginated row model whenever the pagination feature is
/// registered, and the registry registers it for every table (see
/// `lib/table/features.ts`), so a table that said nothing about pagination
/// would silently draw its first ten rows. One page the size of the data means
/// the row model is the sorted, filtered answer and nothing else.
export function useDataGrid<TData extends RowData>({
  data,
  columns,
  getRowId,
  sorting: initialSorting = [],
}: {
  data: TData[]
  columns: ColumnDef<DataTableFeatures, TData>[]
  getRowId: (row: TData) => string
  sorting?: SortingState
}): Table<DataTableFeatures, TData> {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  return useTable(
    useMemo(
      () => ({
        features: dataTableFeatures,
        data,
        columns,
        getRowId,
        state: {
          sorting,
          columnFilters,
          pagination: { pageIndex: 0, pageSize: Math.max(1, data.length) },
        },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        enableFilters: true,
        enableColumnFilters: true,
      }),
      [data, columns, getRowId, sorting, columnFilters],
    ),
  )
}

/// The dense finance table, drawn from a TanStack table rather than by hand.
///
/// # What finance changes about the shared frame, and what it does not
///
/// The frame is `components/custom/table`. It owns the scroll container, which
/// is the element the virtualiser has to be told about, so it takes a
/// `containerRef` — this used to be a hand-written `div` around a `table` for
/// want of that one prop.
///
/// What is overridden is the density. Finance rows are a third of the height of
/// the ones the frame is built for: an accountant reading a trial balance wants
/// as many accounts on the screen at once as the screen will hold, not
/// comfortable padding. So the rows below are plain `tr`/`td` with their own
/// padding rather than `TableRow`/`TableCell`, and the type scale is set on the
/// table itself.
///
/// # Why the rows are virtualised rather than capped
///
/// The client's chart is 7,528 accounts. Every previous version of these
/// screens dealt with that by asking the server for fewer rows, which is the
/// one answer an accountant cannot accept: a trial balance that quietly stops
/// at row 200 balances, and is not the trial balance. So the whole answer is
/// fetched and only the visible slice is laid out.
///
/// Spacer rows rather than absolutely positioned ones, because a `<tr>` taken
/// out of flow takes its cells' widths with it and the columns stop lining up
/// with the header. Two empty rows of the right height keep the table a table.
const ROW = 26

export function DataGrid<TData extends RowData>({
  table,
  /// Rendered ahead of the rows, inside the same `tbody` — an opening balance,
  /// a heading. It scrolls with the rows because it belongs to them.
  lead,
  foot,
  rowKey,
  onRowClick,
  rowClassName,
  empty,
}: {
  table: Table<DataTableFeatures, TData>
  lead?: React.ReactNode
  foot?: React.ReactNode
  rowKey?: (row: Row<DataTableFeatures, TData>) => string
  onRowClick?: (row: Row<DataTableFeatures, TData>) => void
  rowClassName?: (row: Row<DataTableFeatures, TData>) => string | undefined
  empty?: React.ReactNode
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const rows = table.getRowModel().rows

  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    // Exact rather than estimated: every row below is given this height, so the
    // total the virtualiser reserves is the height the table actually has and
    // the scrollbar does not creep as you read down it.
    estimateSize: () => ROW,
    overscan: 16,
  })

  const items = virtual.getVirtualItems()
  const before = items.length === 0 ? 0 : (items[0]?.start ?? 0)
  const after =
    items.length === 0 ? 0 : virtual.getTotalSize() - (items[items.length - 1]?.end ?? 0)

  return (
    <TableFrame
      containerRef={scroller}
      containerClassName="min-h-0 flex-1"
      className="text-[13px]"
    >
      <thead className="bg-card sticky top-0 z-10 border-b">
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id} className="text-muted-foreground text-[11px]">
            {group.headers.map((header) => (
              <th
                key={header.id}
                className={cn(
                  "px-3 py-1.5 text-left font-medium first:px-3.5",
                  header.column.columnDef.meta?.headerClassName,
                )}
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {lead}
        {before > 0 && <tr aria-hidden style={{ height: before }} />}
        {items.map((item) => {
          const row = rows[item.index]
          if (row === undefined) return null
          return (
            <tr
              key={rowKey === undefined ? row.id : rowKey(row)}
              style={{ height: ROW }}
              onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
              className={cn(
                "hover:bg-muted/40 border-b",
                onRowClick !== undefined && "cursor-pointer",
                rowClassName?.(row),
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={cn("px-3 py-1 first:px-3.5", cell.column.columnDef.meta?.cellClassName)}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          )
        })}
        {after > 0 && <tr aria-hidden style={{ height: after }} />}
        {rows.length === 0 && empty !== undefined && (
          <tr>
            <td
              colSpan={table.getVisibleFlatColumns().length}
              className="text-muted-foreground px-3.5 py-3 text-[12px]"
            >
              {empty}
            </td>
          </tr>
        )}
      </tbody>
      {foot}
    </TableFrame>
  )
}

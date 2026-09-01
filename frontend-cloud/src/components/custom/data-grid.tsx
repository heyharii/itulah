import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/custom/table"
import type { DataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import type { Cell, Header, Row, RowData, Table as TanTable } from "@tanstack/react-table"
import { flexRender } from "@tanstack/react-table"

/// The operational list: dense grid on `sm+`, stacked record cards below.
///
/// One grammar across purchasing, sourcing and commercial so a buyer who
/// learns the pin / sticky header / footer on orders finds the same thing on
/// price books. The card reflow is not a different product — it is the same
/// columns, identity first, middle columns dropped.
export function DataGrid<TData extends RowData>({
  table,
  onRowClick,
  rowClassName,
  footer,
}: {
  table: TanTable<DataTableFeatures, TData>
  onRowClick?: (row: Row<DataTableFeatures, TData>) => void
  rowClassName?: (row: Row<DataTableFeatures, TData>) => string | undefined
  /// Aggregate line under the grid. Defaults to a count of the visible rows.
  footer?: React.ReactNode
}) {
  const rows = table.getRowModel().rows
  const headerGroups = table.getHeaderGroups()
  const visibleCount = headerGroups[0]?.headers.length ?? 1
  const summary =
    footer !== undefined ? (
      footer
    ) : (
      <>
        <b>{rows.length}</b>
        {rows.length === 1 ? " row" : " rows"}
      </>
    )

  return (
    <>
      <div className="flex flex-col gap-[11px] p-3.5 sm:hidden">
        {rows.map((row) => (
          <RecordCard
            key={row.id}
            row={row}
            onOpen={onRowClick === undefined ? undefined : () => onRowClick(row)}
            className={rowClassName?.(row)}
          />
        ))}
      </div>
      <Table grammar="grid" containerClassName="hidden sm:block min-h-0 flex-1">
        <TableHeader>
          {headerGroups.map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={header.column.columnDef.meta?.headerClassName}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              tabIndex={onRowClick === undefined ? undefined : 0}
              role={onRowClick === undefined ? undefined : "button"}
              data-state={
                "getIsSelected" in row && row.getIsSelected() ? "selected" : undefined
              }
              onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
              onKeyDown={
                onRowClick === undefined
                  ? undefined
                  : (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onRowClick(row)
                      }
                    }
              }
              className={cn(onRowClick !== undefined && "cursor-pointer", rowClassName?.(row))}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className={cell.column.columnDef.meta?.cellClassName}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={visibleCount}>{summary}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </>
  )
}

function RecordCard<TData extends RowData>({
  row,
  onOpen,
  className,
}: {
  row: Row<DataTableFeatures, TData>
  onOpen?: () => void
  className?: string
}) {
  const cells = row.getVisibleCells().filter((cell) => {
    const kind = cell.column.columnDef.meta?.kind
    return kind !== "select" && kind !== "actions"
  })
  const title = cells[0]
  const rest = cells.slice(1)

  return (
    <article
      className={cn(
        "overflow-hidden rounded-[var(--os-r-card,16px)] border border-[var(--os-hairline-2,#e6e6ea)]",
        "bg-[var(--os-canvas,#fff)] shadow-[var(--os-shadow-soft,0_1px_2px_rgba(20,20,25,.03))]",
        onOpen !== undefined && "cursor-pointer",
        className,
      )}
      onClick={onOpen}
      onKeyDown={
        onOpen === undefined
          ? undefined
          : (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onOpen()
              }
            }
      }
      tabIndex={onOpen === undefined ? undefined : 0}
      role={onOpen === undefined ? undefined : "button"}
    >
      <div className="flex items-center gap-2.5 bg-[var(--os-soft,#fafafa)] px-3.5 py-2.5">
        <div className="min-w-0 flex-1 text-[14px] font-semibold tracking-[-0.015em]">
          {title !== undefined && flexRender(title.column.columnDef.cell, title.getContext())}
        </div>
      </div>
      {rest.length > 0 && (
        <dl className="flex flex-col gap-1 px-3.5 py-2.5">
          {rest.map((cell) => (
            <div key={cell.id} className="flex items-baseline justify-between gap-3">
              <dt className="font-[var(--os-mono,ui-monospace)] text-[10.5px] font-medium tracking-[0.05em] text-[var(--os-faint,#d3d3d8)] uppercase">
                {labelOf(cell)}
              </dt>
              <dd className="min-w-0 truncate text-right text-[13px] text-[var(--os-ink,#1d1d1f)]">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  )
}

function labelOf<TData extends RowData>(
  cell: Cell<DataTableFeatures, TData, unknown>,
): string {
  const meta = cell.column.columnDef.meta
  if (typeof meta?.label === "string" && meta.label !== "") return meta.label
  const header = cell.column.columnDef.header
  if (typeof header === "string") return header
  return cell.column.id
}

export function headerLabel<TData extends RowData>(
  header: Header<DataTableFeatures, TData, unknown>,
): string {
  const meta = header.column.columnDef.meta
  if (typeof meta?.label === "string" && meta.label !== "") return meta.label
  const def = header.column.columnDef.header
  if (typeof def === "string") return def
  return header.column.id
}

import { flexRender, type useTable } from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react"
import { useRef } from "react"

import { cn } from "@/lib/utils"
import type { TableSetup } from "@/lib/table"

/// The full-width list table — the shape most of this app is.
///
/// Header case: the workbench prototypes (`inventory-`, `finance-`,
/// `commercial-prototype.html`) all paint uppercase micro-caps in Inter, while
/// DESIGN.md's component table asks for sentence case. This app follows the
/// prototypes, because its whole shell is lifted from `inventory-prototype.html`
/// and a screen wearing that shell with different table headers matches neither
/// reference. The rule DESIGN.md is actually protecting — *mono* micro-caps are
/// reserved for in-card mini-tables — is honoured: these are Inter.
///
/// Rows are virtualised above `virtualizeAbove` and rendered plainly below it.
/// Never `slice()` to cap a list: that hides rows and calls it fast.

type AnyTable = ReturnType<typeof useTable<TableSetup, never>>

export interface DataTableProps<TRow> {
  /// A `useTable` instance built with `tableSetup`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table: any
  readonly onRowClick?: (row: TRow) => void
  /// Which row reads as selected. Selection is a tint — never a left bar.
  readonly isSelected?: (row: TRow) => boolean
  /// Row height in px, needed only when virtualising. 38 is what the
  /// prototype's 10px/14px cell padding measures to.
  readonly rowHeight?: number
  readonly virtualizeAbove?: number
  readonly empty?: React.ReactNode
  readonly className?: string
}

export function DataTable<TRow>({
  table,
  onRowClick,
  isSelected,
  rowHeight = 38,
  virtualizeAbove = 150,
  empty,
  className,
}: DataTableProps<TRow>) {
  const rows = (table as AnyTable).getRowModel().rows
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualise = rows.length > virtualizeAbove

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    enabled: virtualise,
  })

  const headers = (table as AnyTable).getHeaderGroups()

  const body =
    rows.length === 0 ? (
      <tbody>
        <tr>
          <td
            colSpan={(table as AnyTable).getAllLeafColumns().length}
            className="px-3.5 py-10 text-center text-meta text-body"
          >
            {empty ?? "Nothing to show."}
          </td>
        </tr>
      </tbody>
    ) : virtualise ? (
      <tbody
        className="relative block"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          return (
            <Row
              key={row.id}
              row={row}
              onRowClick={onRowClick}
              selected={isSelected?.(row.original as TRow) ?? false}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: item.size,
                transform: `translateY(${item.start}px)`,
                display: "flex",
              }}
              virtual
            />
          )
        })}
      </tbody>
    ) : (
      <tbody>
        {rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            onRowClick={onRowClick}
            selected={isSelected?.(row.original as TRow) ?? false}
          />
        ))}
      </tbody>
    )

  return (
    <div ref={scrollRef} className={cn("min-h-0 overflow-auto", className)}>
      <table
        className={cn(
          "w-full border-collapse text-cell",
          virtualise && "table-fixed"
        )}
      >
        <thead className={cn(virtualise && "block")}>
          {headers.map((group) => (
            <tr key={group.id} className={cn(virtualise && "flex w-full")}>
              {group.headers.map((header) => {
                const sortable = header.column.getCanSort()
                const sorted = header.column.getIsSorted()
                const align = header.column.columnDef.meta?.align
                return (
                  <th
                    key={header.id}
                    style={
                      virtualise
                        ? { flex: `0 0 ${header.getSize()}px` }
                        : undefined
                    }
                    className={cn(
                      // Sticky, because this component owns its own scroll
                      // container: without it the header scrolled away with
                      // the rows and a reader forty lines down had columns of
                      // figures with nothing naming them. On `<th>` rather
                      // than `<thead>` — a sticky thead does nothing in a
                      // table, the cells are what stick — and opaque, or the
                      // rows show through as they pass underneath.
                      "sticky top-0 z-10 bg-canvas",
                      "border-b border-hairline px-3.5 py-[0.5625rem] text-eyebrow font-semibold whitespace-nowrap text-mute uppercase",
                      align === "right" ? "text-right" : "text-left",
                      align === "center" && "text-center"
                    )}
                  >
                    {header.isPlaceholder ? null : sortable ? (
                      <button
                        type="button"
                        onClick={() => header.column.toggleSorting()}
                        className={cn(
                          "inline-flex items-center gap-1 uppercase transition-colors hover:text-ink",
                          align === "right" && "flex-row-reverse"
                        )}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {sorted === "asc" ? (
                          <ChevronUp className="size-3 text-ink" />
                        ) : sorted === "desc" ? (
                          <ChevronDown className="size-3 text-ink" />
                        ) : (
                          <ChevronsUpDown className="size-3 text-faint" />
                        )}
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        {body}
      </table>
    </div>
  )
}

function Row({
  row,
  onRowClick,
  selected,
  style,
  virtual,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onRowClick?: (original: any) => void
  selected: boolean
  style?: React.CSSProperties
  virtual?: boolean
}) {
  return (
    <tr
      style={style}
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      data-selected={selected || undefined}
      className={cn(
        "border-b border-hairline last:border-b-0",
        onRowClick && "cursor-pointer",
        // Selection is a tint. DESIGN.md is explicit that there is no left bar.
        selected ? "bg-accent-bg" : "hover:bg-soft"
      )}
    >
      {row.getVisibleCells().map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cell: any) => {
          const align = cell.column.columnDef.meta?.align
          return (
            <td
              key={cell.id}
              style={
                virtual ? { flex: `0 0 ${cell.column.getSize()}px` } : undefined
              }
              className={cn(
                "px-3.5 py-2.5 whitespace-nowrap text-text",
                virtual && "flex items-center",
                align === "right" && "justify-end text-right",
                align === "center" && "justify-center text-center"
              )}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          )
        }
      )}
    </tr>
  )
}

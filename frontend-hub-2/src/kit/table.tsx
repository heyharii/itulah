import { flexRender, useTable } from "@tanstack/react-table"
import type { ColumnDef, RowData } from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ArrowDown } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/cn"

/// The list table — the shape most of this app is.
///
/// Headless TanStack Table for the column model, our own markup for everything
/// drawn. The library holds which columns exist, which are visible, which way a
/// header points and which rows are picked; the `<table>`, the 48px row, the
/// ruled columns and the virtual window are this file's.
///
/// ## What is different about how it looks
///
/// **Headings are sentence case, at the same size as the cells.** Older shells
/// painted 11px uppercase micro-caps — the hardest text on the page, naming the
/// column somebody is trying to read, and small enough that the sort arrow
/// beside it was the larger mark. A heading one grey lighter than its data is
/// quieter in the way that matters: by rank, not by size.
///
/// **Columns are ruled**, which is what lets the heading be quiet: a column
/// that is drawn does not also have to be announced.
///
/// **`table-layout: fixed`, every column declaring a width.** Under `auto` the
/// browser redistributes declared widths to fit content, so anything drawn from
/// the declared numbers lands where the cells are not.
///
/// **A filler row absorbs leftover height**, so the rules reach the bottom of
/// the frame — real cell borders on a real row, not a background layer whose
/// position has to be guessed.
///
/// ## Infinite scrolling, and why it stays a real table
///
/// Rows are virtualised: whatever the list holds, the DOM holds about thirty
/// `<tr>`. The window is positioned by two SPACER ROWS rather than by absolute
/// positioning or a stack of flex divs — because the moment a table stops being
/// a table, `table-layout: fixed` stops applying and every column width has to
/// be re-implemented by hand, which is how a header ends up a few pixels out of
/// step with the body it names.
///
/// Row height is FIXED at 48 rather than measured. A measuring virtualiser
/// re-reads each row after it mounts and corrects the offsets, and the
/// correction is a visible shiver while scrolling fast.
///
/// The next page is asked for while there are still rows to scroll through, so
/// the fetch overlaps the scrolling instead of following it. A list that loads
/// at the bottom is a list that stops at the bottom.
///
/// ## Columns leave when the width runs out
///
/// Not the type size. Shrinking the scale to fit is how a list becomes
/// unreadable on the very device it was shrunk for. Each column declares
/// `meta.priority`; the lowest goes first, and a column without one never goes
/// — that is the identity column and the figure the screen exists for.

/// How many rows from the end the next page is asked for.
///
/// Twelve is about a screen and a half at this row height. Fewer and a fast
/// scroll reaches the end before the answer does; many more and a list nobody
/// scrolls still pulls a page it will not use.
const NEAR_THE_END = 12

const ROW_HEIGHT = 48

/// The narrowest a column may be drawn when it does not say for itself.
///
/// A column states its own floor in `meta.min`, because the columns are not
/// alike — see the note there. This is the fallback for one that forgot.
const MIN_COLUMN = 140

export interface Sort {
  readonly key: string
  readonly desc: boolean
}

export function Table<Row extends RowData>({
  columns,
  rows,
  rowId,
  onRowClick,
  isOpen,
  empty,
  foot,
  sort,
  onSort,
  caption,
  hasMore,
  loadingMore,
  onNeedMore,
}: {
  columns: ColumnDef<TableSetup, Row>[]
  rows: Row[]
  rowId: (row: Row) => string
  onRowClick?: (row: Row) => void
  /// Which row reads as open. A TINT, never a left bar: a bar competes with the
  /// column rules and turns two systems of line into one mess.
  isOpen?: (row: Row) => boolean
  sort?: Sort
  onSort?: (key: string) => void
  /// What this table is a list OF. Drawn for a screen reader only: sighted
  /// readers have the page heading above it, and a reader tabbing into a grid
  /// of figures has nothing at all unless the table says what it holds.
  caption: string
  empty?: React.ReactNode
  /// The summary line, keyed by COLUMN ID.
  ///
  /// A map rather than a row of cells, and that is not a style preference: a
  /// hand-written row has to contain exactly as many cells as there are
  /// visible columns, and the moment a column is hidden — by the tab, or by
  /// the width — an extra cell becomes an extra COLUMN. It has no heading, no
  /// body and no declared width, so it silently eats the leftover space and
  /// the table stops filling its frame.
  ///
  /// Keyed, the table draws one cell per visible column and a column with
  /// nothing to summarise gets an empty one. It cannot go out of step.
  foot?: Record<string, React.ReactNode>
  hasMore?: boolean
  loadingMore?: boolean
  onNeedMore?: () => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const width = useWidth(scroller)

  // How many columns this width can afford, and therefore which are hidden.
  // Measured from the CONTAINER, not the window: the shell's sidebar opens and
  // closes, and a table that only watched the window would keep six columns in
  // a frame that lost 248px of it.
  const visibility = useMemo(
    () =>
      whatFits(
        columns.map((column, index) => ({
          id: idOf<Row>(column, index),
          min: column.meta?.min ?? MIN_COLUMN,
          priority: column.meta?.priority,
        })),
        width,
      ),
    [columns, width],
  )

  const table = useTable({
    features: tableSetup,
    data: rows,
    columns,
    getRowId: (row: Row) => rowId(row),
    state: {
      columnVisibility: visibility,
      // The header reads this to say which way it points; the ORDERING is the
      // server's. See `lib/table.ts` for why no sorted row model is registered.
      sorting: sort ? [{ id: sort.key, desc: sort.desc }] : [],
    },
    manualSorting: true,
  })

  const shown = table.getVisibleLeafColumns()
  const body = table.getRowModel().rows

  // Declared sizes add up to 100 across ALL columns, so the moment one is
  // hidden the rest add up to less and the table stops filling its frame —
  // leaving a blank strip to the right of the last column that looks like a
  // seventh column nobody named. Rescaled to what is actually on screen, the
  // proportions between the remaining columns are kept and the table always
  // spans its width.
  const declared = shown.reduce(
    (sum, column) => sum + (column.columnDef.size ?? 0),
    0,
  )
  const share = (column: { columnDef: { size?: number } }) =>
    declared === 0 ? 0 : ((column.columnDef.size ?? 0) / declared) * 100

  const virtualiser = useVirtualizer({
    count: body.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    // Rows that exist just off-screen are rows already painted when they
    // arrive. Twelve either way is roughly one screen of headroom, which is
    // what a trackpad flick eats before the next frame.
    overscan: 12,
  })

  const window_ = virtualiser.getVirtualItems()
  const first = window_[0]
  const last = window_[window_.length - 1]
  // Everything scrolled past, and everything still to come, as height. The two
  // spacers put the window in the right place without moving a single row out
  // of the table's own layout.
  const above = first ? first.start : 0
  const below = last ? virtualiser.getTotalSize() - last.end : 0

  // Asking for the next page is an EFFECT of having scrolled near the end, not
  // something a scroll handler does: the virtualiser already knows which rows
  // are in view, and a second listener computing the same thing from
  // `scrollTop` would answer differently during momentum scrolling.
  useEffect(() => {
    if (!hasMore || loadingMore || !onNeedMore) return
    if (!last) return
    if (last.index >= body.length - NEAR_THE_END) onNeedMore()
  }, [last, body.length, hasMore, loadingMore, onNeedMore])

  return (
    // A tab stop, and an accessible name for it.
    //
    // A scrollable region with nothing focusable inside it can only be reached
    // with a mouse — which on a trial balance of seven thousand accounts means
    // the list is unreadable without one. Tables whose rows open something have
    // focusable rows and pass by accident; the ones that only READ do not, and
    // those are exactly the long ones. So the region is always a tab stop,
    // rather than one on the screens that happen to need it.
    //
    // `aria-label` from the caption because a tab stop announced as "group" is
    // one nobody can place. The caption is already written for the table.
    <div
      ref={scroller}
      tabIndex={0}
      role="group"
      aria-label={caption}
      className="min-h-0 flex-1 overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue"
    >
      {/* `h-full` so the column rules reach the bottom of the frame even when
          four rows are all there is. Without it the table is as tall as its
          content and the summary line floats mid-page, with the rules stopping
          in mid-air above it. */}
      <table className="h-full w-full table-fixed border-separate border-spacing-0">
        <caption className="sr-only">{caption}</caption>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta
                const sortKey = meta?.sortKey
                const on = sort !== undefined && sortKey === sort.key
                const inner = (
                  <>
                    {meta?.icon && (
                      <span className="text-ink-4 flex">{meta.icon}</span>
                    )}
                    <span className="truncate">
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                    </span>
                    {sortKey && (
                      <ArrowDown
                        aria-hidden
                        className={cn(
                          "size-[13px] shrink-0 stroke-2 transition-[opacity,transform]",
                          // On a right-aligned column the arrow goes in FRONT,
                          // so what stops at the column's edge is the heading —
                          // flush with the figures under it rather than pushed
                          // off them by an arrow's width.
                          meta?.align === "right" && "order-first",
                          on
                            ? "text-ink opacity-100"
                            : "opacity-0 group-hover/th:opacity-60",
                          on && !sort.desc && "rotate-180",
                        )}
                      />
                    )}
                  </>
                )
                return (
                  <th
                    key={header.id}
                    scope="col"
                    style={{ width: `${share(header.column)}%` }}
                    aria-sort={
                      on ? (sort.desc ? "descending" : "ascending") : undefined
                    }
                    className="group/th border-line bg-canvas text-cell text-ink-3 sticky top-0 z-[2] h-10 overflow-hidden border-r border-b p-0 text-left font-normal whitespace-nowrap last:border-r-0"
                  >
                    {sortKey && onSort ? (
                      // The whole heading is the control, not a small arrow
                      // beside it: a target the width of the column is one
                      // nobody has to aim at, and it is what a keyboard reaches
                      // with one Tab instead of one per glyph.
                      <button
                        type="button"
                        onClick={() => onSort(sortKey)}
                        className={cn(
                          "hover:bg-hover hover:text-ink flex h-full w-full items-center gap-[7px] px-3.5 text-left transition-colors",
                          meta?.align === "right" && "justify-end",
                        )}
                      >
                        {inner}
                      </button>
                    ) : (
                      <span
                        className={cn(
                          "flex h-full w-full items-center gap-[7px] px-3.5",
                          meta?.align === "right" && "justify-end",
                        )}
                      >
                        {inner}
                      </span>
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>

        <tbody>
          {above > 0 && (
            <tr aria-hidden style={{ height: above }}>
              <td colSpan={shown.length} className="p-0" />
            </tr>
          )}

          {window_.map((virtual) => {
            const row = body[virtual.index]
            const original = row.original as Row
            return (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(original) : undefined}
                // A clickable `<tr>` is invisible to a keyboard: it is not a
                // control, so Tab never lands on it and Enter never reaches it.
                // Given a role and a tab stop it behaves like the thing it
                // already looked like.
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? "button" : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key !== "Enter" && event.key !== " ") return
                        // Space scrolls a page by default, which on a list is
                        // the opposite of activating the row under the cursor.
                        event.preventDefault()
                        onRowClick(original)
                      }
                    : undefined
                }
                aria-current={isOpen?.(original) ? "true" : undefined}
                className={cn(
                  "group",
                  onRowClick &&
                    "focus-visible:outline-blue cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2",
                  isOpen?.(original) ? "bg-blue-soft" : "hover:bg-[#fbfbfa]",
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    style={{ height: ROW_HEIGHT }}
                    className={cn(
                      "border-line text-cell text-ink-2 overflow-hidden border-r border-b px-3.5 text-ellipsis whitespace-nowrap last:border-r-0",
                      cell.column.columnDef.meta?.align === "right" &&
                        "text-right",
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            )
          })}

          {below > 0 && (
            <tr aria-hidden style={{ height: below }}>
              <td colSpan={shown.length} className="p-0" />
            </tr>
          )}

          {/* The empty message spans the table and carries no column rule, so
              it does not read as a row with five blank columns beside it. The
              filler below still rules the frame, which is what keeps an empty
              table looking like a table rather than one that failed to draw. */}
          {body.length === 0 && empty && (
            <tr>
              <td
                colSpan={shown.length}
                className="px-4 py-11 text-center align-top whitespace-normal"
              >
                {empty}
              </td>
            </tr>
          )}

          {/* The filler. Real cells, so the rules cannot drift from them. It
              contributes nothing once the rows are taller than the frame. */}
          <tr className="h-full" aria-hidden>
            {shown.map((column) => (
              <td
                key={column.id}
                className="border-line border-r p-0 last:border-r-0"
              />
            ))}
          </tr>
        </tbody>

        {foot && (
          <tfoot>
            <tr>
              {shown.map((column) => (
                <FootCell key={column.id} align={column.columnDef.meta?.align}>
                  {foot[column.id]}
                </FootCell>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/// A cell in the summary line.
export function FootCell({
  align,
  children,
}: {
  align?: "right"
  children?: React.ReactNode
}) {
  return (
    <td
      className={cn(
        "border-line bg-canvas text-ctl text-ink-4 sticky bottom-0 h-11 border-t px-3.5",
        align === "right" && "text-right",
      )}
    >
      {children}
    </td>
  )
}

/// The container's width, tracked.
///
/// A `ResizeObserver` rather than a window listener, because the thing that
/// changes here is usually not the window: the shell's sidebar opens and
/// closes, and the table's frame loses 248px without the window moving at all.
function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0)
  // Layout effect, so the first paint already knows how many columns fit.
  // With a plain effect the table renders every column once and then drops
  // some, which is a visible flash of a layout nobody asked for.
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    setWidth(node.clientWidth)
    const watch = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    )
    watch.observe(node)
    return () => watch.disconnect()
  }, [ref])
  return width
}

/// Which columns to hide so the rest fit the width they have.
///
/// Exported and pure so it can be tested without a DOM: it is the one piece of
/// this file that is a decision rather than a drawing, and the failure it
/// prevents — a money column narrowed until `Rp 244.802.000` reads
/// `Rp 244.80…` — is invisible in a screenshot at the wrong width.
///
/// Drops the least important column, asks again, and stops the moment what is
/// left actually fits. Counting "how many columns of some average width" would
/// either truncate the money or throw away a column that would have fitted.
///
/// Returns the shape TanStack's `columnVisibility` state wants: an id mapped to
/// `false` is hidden, and an id absent is shown.
export function whatFits(
  columns: readonly {
    id: string
    min: number
    /// Absent means never drop this one.
    priority?: number
  }[],
  width: number,
): Record<string, boolean> {
  const hidden: Record<string, boolean> = {}
  // Before the container has been measured, show everything. Hiding on a
  // guess would flash a narrow layout on every first paint.
  if (width === 0) return hidden

  let needed = columns.reduce((sum, column) => sum + column.min, 0)
  const droppable = columns
    .filter((column) => column.priority !== undefined)
    .sort((a, b) => a.priority! - b.priority!)

  for (const column of droppable) {
    if (needed <= width) break
    hidden[column.id] = false
    needed -= column.min
  }
  return hidden
}

/// The id TanStack will give a column, worked out the same way it does.
///
/// `columnVisibility` is keyed by column id, and a `ColumnDef` may declare one,
/// derive it from `accessorKey`, or fall back to its index. Guessing wrong here
/// would hide nothing and look like the feature is off.
function idOf<Row extends RowData>(
  column: ColumnDef<TableSetup, Row>,
  index: number,
): string {
  if (column.id) return column.id
  if ("accessorKey" in column && typeof column.accessorKey === "string") {
    return column.accessorKey
  }
  return String(index)
}

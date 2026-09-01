/**
 * The scrolling body every long list in the suite shares.
 *
 * It owns four things that were previously re-solved, or silently skipped, in
 * every screen: the scroll container, the window of rows actually in the DOM,
 * the sticky header alignment, and the point at which the next page is asked
 * for.
 *
 * It deliberately does **not** own cell markup. The suite has ~32 hand-written
 * tables whose cells carry real design — avatars, price provenance chips,
 * truncation rules — and forcing them through generic column renderers would be
 * a rewrite of all of them for no user-visible gain. A screen keeps its own
 * `renderRow` and gains windowing by changing its container.
 *
 * Rows are CSS grid, not `<table>`. That is not a style preference: virtual
 * rows are absolutely positioned, and native table layout will not honour that
 * — a `<tr>` inside a `<tbody>` cannot be taken out of flow without the table
 * collapsing. `columns` is a grid-template-columns string, so a screen states
 * its widths once and the header and every row stay locked to it.
 *
 * Accessibility: the grid carries explicit `role` attributes so the structure a
 * `<table>` used to give for free is still announced.
 */

import { useVirtualizer } from "@tanstack/react-virtual"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

export interface InfiniteControls {
  /** Whether the server has more rows beyond the ones in `rows`. */
  hasNextPage: boolean
  /** True while a page is in flight, so the footer can say so and the trigger can hold. */
  isFetchingNextPage: boolean
  fetchNextPage: () => void
}

export interface VirtualRowsProps<T> {
  rows: T[]
  /** Stable identity per row. Index is a last resort and will fight reordering. */
  rowKey: (row: T, index: number) => string
  /** `grid-template-columns`, e.g. "minmax(0,1fr) 148px 168px". */
  columns: string
  /**
   * Row height in px, or a function of the row for a list whose rows genuinely
   * differ — a sectioned list interleaving day headers with entries, say.
   *
   * A constant is far cheaper: the virtualizer can compute any row's offset
   * arithmetically instead of summing. Reach for the function form only when
   * the heights really are different, and keep whatever it returns in step with
   * the row's own class, because the virtualizer positions on this number and
   * the browser paints on the class.
   */
  rowHeight: number | ((row: T, index: number) => number)
  header?: ReactNode
  renderRow: (row: T, index: number) => ReactNode
  onRowClick?: (row: T, index: number) => void
  /**
   * Extra classes for the row element itself — per-row state that has to paint
   * across the whole row, such as a selected tint.
   *
   * Put backgrounds here rather than on the cells. Rows are `items-center`
   * grids, so a grid item is only as tall as its own content: a background on a
   * cell paints a content-height box, and a row of cells with different content
   * heights paints as a set of ragged, disconnected blocks instead of one row.
   * The row element is the only box that spans the full row rect.
   */
  rowClassName?: string | ((row: T, index: number) => string | undefined)
  /**
   * Whether rows take the hover wash. Defaults to whether `onRowClick` is set,
   * since a clickable row should always look hoverable — set it explicitly for
   * a table that wants the wash without claiming a whole-row click target
   * (cells own their own clicks).
   */
  hoverable?: boolean
  empty?: ReactNode
  /** Omit for a fully-loaded list; supply to page in from the server. */
  infinite?: InfiniteControls
  /** How many rows from the end to start fetching. One screenful is the point:
   *  ask early enough that the rows arrive before the user reaches them. */
  loadMoreThreshold?: number
  className?: string
  /**
   * Extra rows rendered outside the viewport. More overscan trades DOM nodes
   * for fewer blank frames during a fast flick.
   *
   * It is also, accidentally, what hides a known alignment error. The
   * virtualizer maps `scrollTop` onto item offsets assuming row 0 begins at
   * scroll offset 0 — but this component borrows an ancestor's scroller, and
   * whatever the screen renders above the list occupies that scroller first.
   * Measured on the commercial catalogue: 177px in a wide pane, 1,086px in a
   * narrow one where the filter chips wrap.
   *
   * The default overscan of 10 is 560px of slack, so a 177px offset is absorbed
   * and the viewport stays covered at every scroll position — verified. A
   * 1,086px offset is not, and there the user would see a gap.
   *
   * `scrollMargin` is the documented option for this and was tried twice; both
   * attempts rendered **zero** rows at every scroll position, verified against a
   * real 832px viewport. Reverted rather than shipped. Raising overscan is the
   * blunt mitigation if a screen puts a lot above its list; the real fix needs
   * someone to work out why `scrollMargin` empties the range here.
   */
  overscan?: number
  /**
   * The element that scrolls. Leave unset and the nearest scrollable ancestor
   * is used.
   *
   * Every long list in this suite already sits inside a scroller its screen
   * owns — the tab pane in `inventory.tsx`, the sheet body, the app shell. A
   * virtualizer that insisted on scrolling itself would nest a second scrollbar
   * inside the first, so it borrows the one that is already there instead. That
   * is also what keeps the migration to ~32 tables a container swap rather than
   * a layout rewrite of every screen.
   */
  scrollElement?: HTMLElement | null
}

export function VirtualRows<T>({
  rows,
  rowKey,
  columns,
  rowHeight,
  header,
  renderRow,
  onRowClick,
  rowClassName,
  hoverable,
  empty,
  infinite,
  loadMoreThreshold = 12,
  className,
  overscan = 10,
  scrollElement,
}: VirtualRowsProps<T>) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)

  /* Resolved after mount because it is a DOM question, not a render one. The
   * layout effect runs before paint, so the first frame already virtualizes
   * rather than briefly laying out every row. */
  useLayoutEffect(() => {
    if (scrollElement !== undefined) {
      setScroller(scrollElement)
      return
    }
    setScroller(nearestScroller(anchorRef.current))
  }, [scrollElement])

  const sizeOf =
    typeof rowHeight === "function"
      ? (index: number) => {
          const row = rows[index]
          return row === undefined ? 0 : rowHeight(row, index)
        }
      : () => rowHeight



  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: sizeOf,
    overscan,
  })

  const showsHover = hoverable ?? onRowClick !== undefined

  const virtualRows = virtualizer.getVirtualItems()
  const lastIndex = virtualRows.at(-1)?.index ?? 0

  /* Asking for the next page is a side effect of having scrolled near the end,
   * not of rendering — doing it during render would fire again on every
   * re-render while the request is still in flight. */
  useEffect(() => {
    if (!infinite) return
    if (!infinite.hasNextPage || infinite.isFetchingNextPage) return
    if (lastIndex >= rows.length - loadMoreThreshold) infinite.fetchNextPage()
  }, [infinite, lastIndex, rows.length, loadMoreThreshold])

  if (rows.length === 0) {
    return (
      <div ref={anchorRef} className={className}>
        {header && <GridHeader columns={columns}>{header}</GridHeader>}
        {empty ?? (
          <p className="px-3.5 py-12 text-center text-xs text-ink-4">
            Nothing to show.
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      ref={anchorRef}
      className={className}
      role="grid"
      aria-rowcount={infinite?.hasNextPage ? -1 : rows.length}
    >
      {header && <GridHeader columns={columns}>{header}</GridHeader>}

      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualRows.map((item) => {
          const row = rows[item.index]
          if (row === undefined) return null
          return (
            <div
              key={rowKey(row, item.index)}
              role="row"
              aria-rowindex={item.index + 1}
              data-index={item.index}
              onClick={onRowClick ? () => onRowClick(row, item.index) : undefined}
              className={cn(
                "absolute top-0 left-0 grid w-full items-center border-b border-b-[color-mix(in_srgb,var(--line)_78%,transparent)]",
                onRowClick && "cursor-pointer",
                showsHover && "hover:bg-hover",
                typeof rowClassName === "function"
                  ? rowClassName(row, item.index)
                  : rowClassName
              )}
              style={{
                height: item.size,
                gridTemplateColumns: columns,
                transform: `translateY(${item.start}px)`,
              }}
            >
              {renderRow(row, item.index)}
            </div>
          )
        })}
      </div>

      {infinite?.isFetchingNextPage && (
        <p
          role="status"
          className="py-3 text-center text-[11.5px] text-ink-4"
        >
          Loading more…
        </p>
      )}
    </div>
  )
}

function GridHeader({
  columns,
  children,
}: {
  columns: string
  children: ReactNode
}) {
  return (
    <div
      role="row"
      className="sticky top-0 z-10 grid h-9 items-center border-b border-b-line-strong bg-surface text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase"
      style={{ gridTemplateColumns: columns }}
    >
      {children}
    </div>
  )
}

/**
 * The nearest ancestor a screen has designated as its scroller.
 *
 * Deliberately asks only whether the element *may* scroll, not whether it
 * currently does. An earlier version required `scrollHeight > clientHeight` and
 * broke every short list: with one row the pane does not overflow, no ancestor
 * qualified, the virtualizer had nothing to measure against and rendered zero
 * rows. Whether a pane is the scroller is a fact about the layout, not about
 * how much data happens to be in it right now.
 *
 * Falls back to the document scroller so the component still works on a screen
 * that scrolls the page itself.
 */
function nearestScroller(from: HTMLElement | null): HTMLElement | null {
  let node = from?.parentElement ?? null
  while (node) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === "auto" || overflowY === "scroll") return node
    node = node.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? null
}

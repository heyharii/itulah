import { flexRender, type useTable } from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
} from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { Select } from "@/components/ui/field"
import { LoadMore, type Pageable } from "@/components/ui/states"
import { useCoarsePointer, useLayout } from "@/lib/layout"
import { columnName } from "@/components/ui/column-name"
import { cn } from "@/lib/utils"
import type { TableSetup } from "@/lib/table"

/// The full-width list table — the shape most of this app is.
///
/// Header case: SENTENCE case, at the same size as the cells below it.
///
/// This reversed on 2026-09-10. The old rule followed
/// `inventory-prototype.html`, which paints uppercase micro-caps — and that
/// was right while the whole shell came from that prototype. The shell is now
/// the one Hari ruled on across the `directory-table` and `cash-bank`
/// prototypes, and there a heading is 15px Inter at weight 400 in `body` grey,
/// separated from its column by a hairline rather than by shouting.
///
/// The substantive reason, not just the lineage: 11px uppercase with letter
/// spacing is the hardest text on the page to read and it names the column
/// somebody is trying to read. It was small enough that the *sort arrow* beside
/// it was the larger mark. A heading the same size as its data, one grey
/// lighter, is quieter in the way that matters — by rank, not by size.
///
/// Uppercase micro-caps survive where they were always right: the `dt` of a
/// phone card and the section headings inside a sheet, where they label a block
/// rather than a column, and where there is no data at the same size to confuse
/// them with.
///
/// Rows are virtualised above `virtualizeAbove` and rendered plainly below it.
/// Never `slice()` to cap a list: that hides rows and calls it fast.
///
/// ## The same rows at three widths
///
/// This component is where the app stops being a desk app, and it is the only
/// place that had to change for it — which is the point. A screen writes its
/// columns once and gets all three shapes:
///
///  - **desk** (64rem up) — the table, every column.
///  - **narrow** — the table, minus the columns that do not fit, dropped one
///    at a time in the order the columns themselves declare in
///    `meta.priority` until the rest fits the card it is standing in. Fewer
///    columns, not smaller type: shrinking the scale to fit is how a list
///    becomes unreadable on the very device it was shrunk for.
///  - **phone** (under 48rem) — the same rows, relaid as cards from the role
///    each column declares in `meta.card`. NOT a table you scroll sideways: a
///    list exists to compare its rows, and a row you have to scroll to finish
///    reading cannot be compared with the one above it.
///
/// Row HEIGHT is decided separately, by the pointer rather than by the width —
/// see `touch` below and `lib/layout.ts`. An iPad in landscape is wider than
/// most laptops and is still worked with a thumb.

type AnyTable = ReturnType<typeof useTable<TableSetup, never>>

export interface DataTableProps<TRow> {
  /// A `useTable` instance built with `tableSetup`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table: any
  readonly onRowClick?: (row: TRow) => void
  /// Which row reads as selected. Selection is a tint — never a left bar.
  readonly isSelected?: (row: TRow) => boolean
  /// A row that has just landed — an order that was raised a moment ago. It
  /// glows for a few seconds and settles, so the eye finds the new line in a
  /// long list; nothing is kept once the glow is over.
  readonly isFresh?: (row: TRow) => boolean
  /// 44px rows instead of 38, the DESIGN.md touch floor.
  ///
  /// Left unset it follows the POINTER: a finger gets 44, a mouse gets 38. That
  /// is the honest signal — the question is what is pressing the row, not how
  /// wide the window is — and it means the tables in Operations no longer have
  /// to remember to ask, while an office screen read with a mouse keeps the six
  /// pixels a row that cost real information.
  ///
  /// Passed explicitly it wins, for the one case a device cannot report: a
  /// handheld run through a browser that claims a fine pointer.
  readonly touch?: boolean
  /// Row height in px, needed only when virtualising. Derived from `touch`
  /// unless a caller genuinely knows better; 38 is what the prototype's
  /// 10px/14px cell padding measures to, and 44 is the touch floor.
  readonly rowHeight?: number
  /// More air above and below each row's cells, for a list whose rows carry
  /// two lines (a name over its number) and read as a stack otherwise.
  readonly roomy?: boolean
  readonly virtualizeAbove?: number
  readonly empty?: React.ReactNode
  /// The one thing this row is waiting for, drawn IN the status cell.
  ///
  /// Status and the verb are the same question asked twice — what this row IS,
  /// and what it is therefore waiting for — so they share a cell rather than
  /// costing the table a column of twelve buttons. The pill stands while the
  /// list is being read down; the row under the pointer swaps it for the thing
  /// to press. Return `null` for a row with nothing to do, and its pill simply
  /// stays put.
  ///
  /// The cell it lands in is the one whose column declares `meta.swap`.
  readonly rowAction?: (row: TRow) => React.ReactNode
  /// Whether the phone's cards carry their own sort line. A screen that puts
  /// sort in its options sheet (`ListOptionsSheet`) turns this off — two
  /// sort controls on one small screen read as two different orders.
  readonly cardSort?: boolean
  /// On a phone, each row is a card of its own with a gap between, instead of
  /// rows divided by hairlines inside one shared card. The screen drops its
  /// own wrapper's border and fill on a phone (`max-md:`) so the cards stand
  /// on the page.
  readonly cardsApart?: boolean
  /// Lay the rows out as cards on a tablet too, not only on a phone. For a list
  /// whose key columns (status, what has arrived) would otherwise sit off the
  /// edge of a 768px screen: Apple's rule — show the common path first — beats
  /// showing every column.
  readonly cardsOnTablet?: boolean
  /// Called when the last rows scroll into view — infinite scroll. The list
  /// fetches its next page here; the table only says when it is due. Watched
  /// with an IntersectionObserver on a marker after the last row, against the
  /// table's own scroll box on a desk and against the page on a phone, where
  /// the cards scroll with the page.
  readonly onEndReached?: () => void
  /// The infinite query behind the rows. The table asks for the next page
  /// itself as the last rows come into view, and says so at its foot —
  /// "Loading more…", or why the page did not come, with Try again. Prefer it
  /// to `onEndReached`, which only says when a page is due and leaves the
  /// states to the screen.
  readonly more?: Pageable
  /// A summary row pinned under the rows — a count, a sum — keyed by column
  /// id. It floats at the foot of the table's own scroll box, so the totals
  /// stay in view however far down the list somebody has scrolled. Columns
  /// with no entry are left blank.
  readonly summary?: Readonly<Record<string, React.ReactNode>>
  /// The page scrolls, not the table (the owner, 2026-09-28): no scroll box
  /// of its own, so the list is read in the window like the page around it,
  /// its heading row sticking under the app bar and `summary` floating at
  /// the window's foot. Every row is drawn — no virtualiser, which needs a
  /// box of its own to measure — and the columns are held at their `size`
  /// with the `meta.grow` one taking the rest, so a page arriving never
  /// reflows them. Nothing above it may clip (`overflow-hidden` makes a
  /// scroll box and un-sticks the heading; use `overflow-clip`).
  readonly pageScroll?: boolean
  /// An optional extra block drawn directly under a row, full width — the
  /// row's contents opened out in place. Called for a row only when
  /// `isExpanded` says it is open; return `null` for nothing. In the desk
  /// table it is a `<tr><td colSpan>` after the row, on a phone a block
  /// under the card. The screen owns the toggle (usually a chevron cell
  /// that stops click propagation) and the expanded state. Not drawn while
  /// the rows are virtualised, which needs every row at one height.
  readonly renderSub?: (row: TRow) => React.ReactNode
  /// Whether a row's `renderSub` block is showing.
  readonly isExpanded?: (row: TRow) => boolean
  /// An optional full-width block drawn BEFORE a row — a group heading above
  /// the first row of its group. Called with the row, its index and every row
  /// in table order (so a screen can compare with the row above); return
  /// `null` for nothing. In the desk table it is a `<tr><td colSpan>`, on a
  /// phone an `<li>`; both carry `data-sub`, so arrow-key navigation steps
  /// over them. Not drawn while the rows are virtualised.
  readonly renderBefore?: (
    row: TRow,
    index: number,
    rows: readonly TRow[]
  ) => React.ReactNode
  /// A row that is not drawn — its `renderBefore` block still is, so a
  /// collapsed group keeps its heading. The row stays in the table's model
  /// (sorting, summary), it just takes no space.
  readonly isHidden?: (row: TRow) => boolean
  readonly className?: string
}

/// The two row heights, in real pixels. The virtualiser needs a number and the
/// plain path needs a class, and they have to agree or a virtualised list
/// scrolls to the wrong place.
const TOUCH_ROW = 44
const DENSE_ROW = 38

export function DataTable<TRow>({
  table,
  onRowClick,
  isSelected,
  isFresh,
  touch,
  rowHeight,
  roomy = false,
  virtualizeAbove = 150,
  empty,
  rowAction,
  cardSort = true,
  cardsApart,
  cardsOnTablet,
  onEndReached,
  more,
  summary,
  pageScroll = false,
  renderSub,
  isExpanded,
  renderBefore,
  isHidden,
  className,
}: DataTableProps<TRow>) {
  const subOf = (row: { original: unknown }): React.ReactNode =>
    renderSub !== undefined && isExpanded?.(row.original as TRow)
      ? renderSub(row.original as TRow)
      : null
  const rows = (table as AnyTable).getRowModel().rows
  const beforeOf = (index: number): React.ReactNode => {
    if (renderBefore === undefined) return null
    return renderBefore(
      rows[index].original as TRow,
      index,
      rows.map((one) => one.original as TRow)
    )
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const layout = useLayout()
  const coarse = useCoarsePointer()
  const tap = touch ?? coarse
  const cards =
    layout === "phone" || (cardsOnTablet === true && layout === "tablet")
  const height = rowHeight ?? (tap ? TOUCH_ROW : DENSE_ROW)
  const virtualise =
    !cards &&
    !pageScroll &&
    renderSub === undefined &&
    renderBefore === undefined &&
    rows.length > virtualizeAbove
  /// How wide the card actually is, and how many columns have been given up to
  /// fit it. Measured rather than read off the viewport — see below.
  ///
  /// The count is stored WITH the width it was measured at, and read as zero
  /// for any other width. That is what starts the count again when the card
  /// resizes — a table that gave up a column at 800px has to get it back at
  /// 1400 — without an effect that resets state, which is one more render and
  /// one more thing to keep in step.
  const [room, setRoom] = useState(0)
  const [budget, setBudget] = useState({ room: 0, dropped: 0 })
  const dropped = budget.room === room ? budget.dropped : 0

  /// The columns that may be given up, in the order they will be, and never
  /// including a priority 1.
  ///
  /// Highest priority number first; within one priority, the right-most column
  /// first — which is the order a reader working left to right gives up on
  /// anyway.
  const droppable = useMemo(
    () =>
      (table as AnyTable)
        .getAllLeafColumns()
        .map((column, index) => ({
          id: column.id,
          priority: column.columnDef.meta?.priority ?? 1,
          index,
        }))
        .filter((column) => column.priority > 1)
        .sort((a, b) => b.priority - a.priority || b.index - a.index)
        .map((column) => column.id),
    [table]
  )

  /// The card's width, watched.
  ///
  /// **The viewport is the wrong ruler, and this app already knows it**: the
  /// article and sourcing grids reach for container queries with a note saying
  /// a card's width is decided by the sidebar and the page rather than by the
  /// window. Same argument, arithmetic instead of CSS. An iPad in landscape is
  /// 1180px and leaves this table 872 of them; a 1180px window on a laptop
  /// with the sidebar collapsed leaves it 1100. A breakpoint cannot tell those
  /// apart, and the first of the two is the one that clips the figure the whole
  /// list is sorted by.
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const observer = new ResizeObserver((entries) =>
      setRoom(entries[0].contentRect.width)
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  /// Give up one more column while the table is wider than the card.
  ///
  /// One per pass, and the pass is skipped until the DOM has caught up with
  /// the previous one: the visibility write below lands in this same commit,
  /// so measuring here without the guard would measure the columns that are
  /// on their way out and drop two for one overflow. It terminates either
  /// way — every pass strictly shortens the table, and `droppable` is short.
  ///
  /// `useLayoutEffect`, and this is the case it exists for: measure, decide,
  /// re-render, all before the browser paints. As a passive effect the passes
  /// land one per frame and the first frame is the too-wide table — a visible
  /// flash of eight columns that then shed to five, every time the screen
  /// opens. Three synchronous layout reads on a table is the cheaper half of
  /// that trade.
  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node || cards) return
    const total = (table as AnyTable).getAllLeafColumns().length
    const expected = total - Math.min(dropped, droppable.length)
    if (node.querySelectorAll("thead th").length !== expected) return
    // The one place this component sets state from an effect, and the reason
    // it has to: what fits is a fact about the laid-out DOM, and nothing but
    // measuring it can answer.
    if (node.scrollWidth > node.clientWidth + 1 && dropped < droppable.length) {
      setBudget({ room, dropped: dropped + 1 })
    }
  }, [cards, dropped, droppable.length, room, rows.length, table])

  /// The dropped columns, hidden rather than filtered out here.
  ///
  /// Hiding is something the table already knows how to do, and it keeps the
  /// header groups and the cells under them derived from one list — a `<th>`
  /// row that disagrees with its cells is the class of bug that ends with
  /// figures under the wrong heading. It also leaves them in
  /// `getAllLeafColumns`, so the filter bar still offers a column the width
  /// happens to be hiding, and the card list below can still read every one.
  ///
  /// Idempotent on purpose: `useTable` hands back a fresh instance on most
  /// renders, so this effect cannot rely on running once. It compares before it
  /// writes, and a screen that controls `columnVisibility` itself is left alone.
  ///
  /// Layout rather than passive for the same reason as the pass above: the two
  /// take turns, and one of them painting between turns is the flash.
  useLayoutEffect(() => {
    const instance = table as AnyTable
    if (instance.options.state?.columnVisibility !== undefined) return
    // A card shows every column it has a role for: the space it is short of is
    // horizontal, and a card is laid out down the page.
    const hidden = new Set(cards ? [] : droppable.slice(0, dropped))
    const current = instance.store.state.columnVisibility ?? {}
    const budget: Record<string, boolean> = {}
    let differs = false
    for (const column of instance.getAllLeafColumns()) {
      const visible = !hidden.has(column.id)
      budget[column.id] = visible
      if ((current[column.id] ?? true) !== visible) differs = true
    }
    if (differs) instance.setColumnVisibility(budget)
  }, [cards, dropped, droppable, table])

  /// The next page, asked for a few rows before the reader gets there.
  ///
  /// Held in a ref so a new callback each render does not tear the observer
  /// down and set it up again; re-armed when the row count changes, so a page
  /// that arrived and still did not fill the box asks for the one after it.
  const reachEnd = useRef(onEndReached)
  reachEnd.current = onEndReached
  const wantsEnd = onEndReached !== undefined
  useEffect(() => {
    const marker = endRef.current
    if (!wantsEnd || marker === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) reachEnd.current?.()
      },
      {
        // The window's edge when the page is what scrolls.
        root: cards || pageScroll ? null : scrollRef.current,
        rootMargin: "0px 0px 240px 0px",
      }
    )
    observer.observe(marker)
    return () => observer.disconnect()
  }, [wantsEnd, cards, pageScroll, rows.length])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => height,
    overscan: 12,
    enabled: virtualise,
  })

  const headers = (table as AnyTable).getHeaderGroups()

  /// The narrowest a page-scrolled table can be: its held columns, and the
  /// least the growing one may shrink to.
  const pageMinWidth = pageScroll
    ? (table as AnyTable).getVisibleLeafColumns().reduce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sum: number, column: any) =>
          sum + (column.columnDef.meta?.grow ?? column.getSize()),
        0
      )
    : 0
  /// Whether a page-scrolled table is wider than its card, watched rather
  /// than guessed: set from the observer's callback, so the table and the
  /// box it sits in are measured as laid out.
  const tableRef = useRef<HTMLTableElement>(null)
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const box = scrollRef.current
    const drawn = tableRef.current
    if (!pageScroll || box === null || drawn === null) return
    const observer = new ResizeObserver(() =>
      setWide(drawn.offsetWidth > box.clientWidth + 1)
    )
    observer.observe(drawn)
    observer.observe(box)
    return () => observer.disconnect()
  }, [pageScroll, cards])

  if (cards) {
    return (
      // No inner scroll and no virtualiser: the page is the scroll container on
      // a phone, and a card list inside a second one means the header scrolls
      // away and then the list does. `className` is honoured but its height cap
      // is not — that number was measured against a viewport with a docked
      // sidebar in it.
      //
      // The cost is that every row is in the DOM. At these lists' sizes that is
      // the right trade; a phone list long enough to feel it needs a virtualiser
      // driven by the page's own scroll, which is a real piece of work and not
      // one to fake with a `slice()`.
      <div className={cn("min-h-0", className, "max-h-none overflow-visible")}>
        {cardSort && <CardSort table={table} />}
        {rows.length === 0 ? (
          <div className="px-3.5 py-10 text-center text-meta text-body">
            {empty ?? "Nothing to show."}
          </div>
        ) : (
          <ul className={cn("flex flex-col", cardsApart && "gap-2.5")}>
            {rows.map((row, index) => (
              <RowCard
                key={row.id}
                apart={cardsApart}
                row={row}
                before={beforeOf(index)}
                hidden={isHidden?.(row.original as TRow)}
                onRowClick={onRowClick}
                selected={isSelected?.(row.original as TRow) ?? false}
                fresh={isFresh?.(row.original as TRow) ?? false}
                sub={subOf(row)}
              />
            ))}
          </ul>
        )}
        {wantsEnd && <div ref={endRef} aria-hidden className="h-px" />}
        {more !== undefined && <LoadMore query={more} />}
      </div>
    )
  }

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
              fresh={isFresh?.(row.original as TRow) ?? false}
              touch={tap}
              rowAction={rowAction}
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
        {rows.map((row, index) => (
          <Row
            key={row.id}
            row={row}
            before={beforeOf(index)}
            hidden={isHidden?.(row.original as TRow)}
            onRowClick={onRowClick}
            selected={isSelected?.(row.original as TRow) ?? false}
            fresh={isFresh?.(row.original as TRow) ?? false}
            touch={tap}
            rowAction={rowAction}
            tight={pageScroll}
            roomy={roomy}
            sub={subOf(row)}
          />
        ))}
      </tbody>
    )

  return (
    <div
      ref={scrollRef}
      className={cn(
        pageScroll
          ? // Sideways only when the columns cannot fit — a narrow window, or
            // extra columns switched on. Then the heading no longer sticks
            // (a box that scrolls sideways is a scroll box), which is the
            // price of every column staying reachable.
            cn("min-w-0", wide && "overflow-x-auto")
          : "min-h-0 overflow-auto",
        className
      )}
    >
      <table
        ref={tableRef}
        className={cn(
          "w-full border-collapse text-cell",
          (virtualise || pageScroll) && "table-fixed"
        )}
        style={pageScroll ? { minWidth: pageMinWidth } : undefined}
      >
        {pageScroll && (
          <colgroup>
            {(table as AnyTable).getVisibleLeafColumns().map((column) => (
              <col
                key={column.id}
                style={
                  column.columnDef.meta?.grow === undefined
                    ? { width: column.getSize() }
                    : undefined
                }
              />
            ))}
          </colgroup>
        )}
        <thead className={cn(virtualise && "block")}>
          {headers.map((group, level) => (
            <tr key={group.id} className={cn(virtualise && "flex w-full")}>
              {group.headers.map((header) => {
                // Grouped columns (two heading rows): a column with no group
                // is drawn once, in the top row, spanning both — TanStack
                // hands it over as a placeholder up top and the real heading
                // below, and drawing both left an empty box over every
                // ungrouped heading.
                const deep = headers.length > 1
                if (deep && level > 0 && header.column.parent === undefined)
                  return null
                const spansRows = deep && level === 0 && header.isPlaceholder
                // A real group heading ("Ordered"), not the placeholder TanStack puts
                // above an ungrouped column — which also has sub-headers.
                const isGroup =
                  !header.isPlaceholder && header.subHeaders.length > 0
                // Where a column under a group heading sits in its group.
                const groupSiblings =
                  deep && level > 0 ? (header.column.parent?.columns ?? []) : []
                const groupAt = groupSiblings.findIndex(
                  (one) => one.id === header.column.id
                )
                const groupEdge =
                  groupSiblings.length === 0 || groupAt < 0
                    ? null
                    : groupSiblings.length === 1
                      ? "only"
                      : groupAt === 0
                        ? "first"
                        : groupAt === groupSiblings.length - 1
                          ? "last"
                          : null
                const sortable = !isGroup && header.column.getCanSort()
                const sorted = header.column.getIsSorted()
                const align = isGroup
                  ? "center"
                  : header.column.columnDef.meta?.align
                return (
                  <th
                    key={header.id}
                    colSpan={header.colSpan > 1 ? header.colSpan : undefined}
                    rowSpan={spansRows ? headers.length : undefined}
                    aria-sort={
                      !sortable
                        ? undefined
                        : sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : "none"
                    }
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
                      // Tinted, not white: the heading row is chrome over the
                      // rows, and the tint is what says so now that the
                      // vertical rules are gone.
                      "sticky z-10 bg-soft",
                      // The second heading row sticks under the first (h-10).
                      level > 0 ? "top-10" : "top-0",
                      // A group heading ("Ordered") is underlined by a rule of
                      // its own, inset a column's padding at both ends, so two
                      // neighbouring groups read as two spans and not as one
                      // long line running under both.
                      // Complete, as a box: the group's heading carries the
                      // rules at both its sides and under it, and the columns
                      // beneath continue the two side rules, so each group
                      // reads as one framed span (owner, 2 Oct 2026).
                      isGroup
                        ? "border-x border-b border-hairline-strong text-ink"
                        : "border-b border-hairline-2",
                      groupEdge === "first" &&
                        "border-l border-l-hairline-strong",
                      groupEdge === "last" &&
                        "border-r border-r-hairline-strong",
                      groupEdge === "only" &&
                        "border-x border-x-hairline-strong",
                      "h-10 py-0 text-eyebrow font-medium whitespace-nowrap text-body normal-case",
                      // A page-scrolled table is set 2px tighter a side: it
                      // is the one that must hold every column without a box
                      // of its own to scroll sideways in.
                      roomy ? "px-5" : pageScroll ? "px-3" : "px-3.5",
                      align === "right" ? "text-right" : "text-left",
                      align === "center" && "text-center"
                    )}
                  >
                    {header.isPlaceholder && !spansRows ? null : sortable ? (
                      <button
                        type="button"
                        onClick={() => header.column.toggleSorting()}
                        className={cn(
                          // `flex-row-reverse` on a right-aligned column puts
                          // the arrow in FRONT, so what stops at the column's
                          // edge is the heading — flush with the figures under
                          // it, rather than pushed an arrow's width off them.
                          "inline-flex items-center transition-colors hover:text-ink",
                          pageScroll ? "gap-0.5" : "gap-1",
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
        {summary !== undefined && rows.length > 0 && (
          <tfoot className={cn("sticky bottom-0 z-10", virtualise && "block")}>
            <tr
              className={cn(
                "border-t border-hairline-2 bg-soft",
                virtualise && "flex w-full"
              )}
            >
              {(table as AnyTable).getVisibleLeafColumns().map((column) => {
                const align = column.columnDef.meta?.align
                return (
                  <td
                    key={column.id}
                    style={
                      virtualise
                        ? { flex: `0 0 ${column.getSize()}px` }
                        : undefined
                    }
                    className={cn(
                      "h-11 text-[0.875rem] font-medium whitespace-nowrap text-ink tabular-nums",
                      roomy ? "px-5" : pageScroll ? "px-3" : "px-3.5",
                      align === "right" ? "text-right" : "text-left"
                    )}
                  >
                    {summary[column.id] ?? null}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        )}
      </table>
      {wantsEnd && <div ref={endRef} aria-hidden className="h-px" />}
      {more !== undefined && <LoadMore query={more} />}
    </div>
  )
}

/// A row that opens something, reachable without a mouse.
///
/// It was a click handler on a `<tr>` and nothing else, so the only way to
/// open a record from the keyboard was not to have one. Now each openable row
/// is a tab stop: Enter or Space opens it, and the arrow keys walk to the row
/// above or below — forty tabs to reach the fortieth supplier is not a way to
/// read a list. A key pressed on a control INSIDE the row (the verb in the
/// status cell, a checkbox) is that control's, and is left alone.
function openable(open: () => void) {
  return {
    tabIndex: 0,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        open()
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        // Past an expanded row's extra block, which is not a tab stop.
        let next =
          event.key === "ArrowDown"
            ? event.currentTarget.nextElementSibling
            : event.currentTarget.previousElementSibling
        while (
          next instanceof HTMLElement &&
          next.tabIndex !== 0 &&
          next.hasAttribute("data-sub")
        ) {
          next =
            event.key === "ArrowDown"
              ? next.nextElementSibling
              : next.previousElementSibling
        }
        if (next instanceof HTMLElement && next.tabIndex === 0) {
          event.preventDefault()
          next.focus()
        }
      }
    },
  }
}

/// The ring an openable row wears under the keyboard — inset, because a row
/// is flush with its neighbours and an outset ring is cut off by them.
const FOCUSED =
  "outline-none focus-visible:bg-accent-bg/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"

function Row({
  row,
  onRowClick,
  selected,
  fresh,
  touch,
  rowAction,
  style,
  virtual,
  tight,
  roomy,
  sub,
  before,
  hidden,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onRowClick?: (original: any) => void
  selected: boolean
  fresh?: boolean
  touch: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rowAction?: (original: any) => React.ReactNode
  style?: React.CSSProperties
  virtual?: boolean
  /// The page-scrolled table's tighter cells — see `pageScroll`.
  tight?: boolean
  /// More air in every cell — see `roomy` on the table.
  roomy?: boolean
  /// The block `renderSub` drew for this row, if it is open.
  sub?: React.ReactNode
  /// The block `renderBefore` drew for this row, if any.
  before?: React.ReactNode
  /// Draw only `before`, not the row — see `isHidden` on the table.
  hidden?: boolean
}) {
  const verb = rowAction?.(row.original) ?? null
  return (
    <>
      {before !== null && before !== undefined && (
        <tr data-sub>
          <td colSpan={row.getVisibleCells().length} className="p-0">
            {before}
          </td>
        </tr>
      )}
      {hidden ? null : (
        <tr
          style={style}
          onClick={onRowClick ? () => onRowClick(row.original) : undefined}
          {...(onRowClick ? openable(() => onRowClick(row.original)) : {})}
          data-selected={selected || undefined}
          data-fresh={fresh || undefined}
          aria-current={selected || undefined}
          className={cn(
            "group/row border-b border-hairline last:border-b-0",
            fresh && "row-fresh",
            onRowClick && "cursor-pointer",
            onRowClick && FOCUSED,
            // 52px, from `--spacing-row`. A minimum rather than a height, so a row
            // holding a wrapped cell grows instead of clipping. Not applied while
            // virtualising: there the height comes from the measurement the
            // virtualiser positions against, and a second opinion here would put
            // the rows and their offsets out of step.
            !virtual && !touch && "h-row",
            // `height` on a table row is a MINIMUM, which is what is wanted: a row
            // with a wrapped cell in it grows rather than clipping. Not applied
            // when virtualising — there the height is set from the measurement the
            // virtualiser is positioning rows against, and a second opinion here
            // would put the rows and their offsets out of step.
            touch && !virtual && "h-tap",
            // Selection is a tint. DESIGN.md is explicit that there is no left bar.
            // The hover is the page's own quietest grey since the surfaces went
            // neutral (2026-09-28): the old blue-white read as a second colour
            // on a charcoal-and-grey screen, not as a row lit.
            selected ? "bg-accent-bg" : "hover:bg-soft"
          )}
        >
          {row.getVisibleCells().map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (cell: any) => {
              const align = cell.column.columnDef.meta?.align
              // The cell that hands itself over to the verb while the row is
              // pointed at. Only when there IS a verb: a closed order keeps its
              // pill, and nothing blinks under the cursor for no reason.
              const swaps =
                cell.column.columnDef.meta?.swap === true && verb !== null
              const drawn = flexRender(
                cell.column.columnDef.cell,
                cell.getContext()
              )
              return (
                <td
                  key={cell.id}
                  style={
                    virtual
                      ? { flex: `0 0 ${cell.column.getSize()}px` }
                      : undefined
                  }
                  className={cn(
                    "whitespace-nowrap text-text",
                    roomy ? "px-5 py-5" : tight ? "px-3" : "px-3.5",
                    !roomy && (touch ? "py-3" : "py-2.5"),
                    virtual && "flex items-center",
                    swaps && "relative",
                    align === "right" && "justify-end text-right",
                    align === "center" && "justify-center text-center"
                  )}
                >
                  {swaps ? (
                    <>
                      <span className="inline-block transition-[opacity,transform] duration-[--t-hover] ease-out group-focus-within/row:translate-x-1.5 group-focus-within/row:opacity-0 group-hover/row:translate-x-1.5 group-hover/row:opacity-0 pointer-coarse:opacity-0">
                        {drawn}
                      </span>
                      <span
                        className={cn(
                          "absolute top-1/2 left-3.5 origin-left -translate-x-1.5 -translate-y-1/2 scale-[0.96] opacity-0",
                          "transition-[opacity,transform] duration-[--t-pop] ease-out",
                          "pointer-events-none group-hover/row:pointer-events-auto group-hover/row:translate-x-0 group-hover/row:scale-100 group-hover/row:opacity-100",
                          "group-focus-within/row:pointer-events-auto group-focus-within/row:translate-x-0 group-focus-within/row:scale-100 group-focus-within/row:opacity-100",
                          "pointer-coarse:pointer-events-auto pointer-coarse:translate-x-0 pointer-coarse:scale-100 pointer-coarse:opacity-100"
                        )}
                      >
                        {verb}
                      </span>
                    </>
                  ) : (
                    drawn
                  )}
                </td>
              )
            }
          )}
        </tr>
      )}
      {!hidden && sub !== null && sub !== undefined && (
        <tr data-sub className="border-b border-hairline last:border-b-0">
          <td colSpan={row.getVisibleCells().length} className="p-0">
            {sub}
          </td>
        </tr>
      )}
    </>
  )
}

/// The sort control a card list needs, because the header row it used to live
/// in is gone.
///
/// The kit's `<Select>`, which draws its own panel — so nine column names look
/// the same here as they do on a desk, and the same on Windows as on a Mac.
/// The direction is a separate button rather than nine more options —
/// "Outstanding, descending" as eighteen rows is a menu about the control
/// instead of about the data.
///
/// Single-sort on purpose. The table can hold several clauses and the desk
/// header can build them by shift-clicking; a phone asking for "by supplier,
/// then by outstanding" is asking for a screen that is not this one.
function CardSort({
  table,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any
}) {
  const instance = table as AnyTable
  const sortable = instance
    .getAllLeafColumns()
    .filter((column) => column.getCanSort())
  const sorting = instance.store.state.sorting ?? []
  const current = sorting[0]
  if (sortable.length === 0 || instance.getRowModel().rows.length === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-2 border-b border-hairline bg-soft px-3 py-2">
      <span className="shrink-0 text-eyebrow font-semibold text-mute uppercase">
        Sort
      </span>
      <div className="min-w-0 flex-1">
        <Select
          value={current?.id ?? ""}
          aria-label="Sort by"
          className="h-8"
          onChange={(next) =>
            instance.setSorting([{ id: next, desc: current?.desc ?? true }])
          }
        >
          {sortable.map((column) => (
            <option key={column.id} value={column.id}>
              {headerText(column)}
            </option>
          ))}
        </Select>
      </div>
      <button
        type="button"
        disabled={!current}
        aria-label={current?.desc ? "Sort ascending" : "Sort descending"}
        onClick={() =>
          current &&
          instance.setSorting([{ id: current.id, desc: !current.desc }])
        }
        className="grid size-tap shrink-0 place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-text disabled:opacity-50"
      >
        {current?.desc ? (
          <ArrowDown className="size-4 stroke-[1.7]" />
        ) : (
          <ArrowUp className="size-4 stroke-[1.7]" />
        )}
      </button>
    </div>
  )
}

/// One row, relaid as a card.
///
/// The shape is the record sheet's, one level down: the identifier in mono
/// above the name, the state pilled on the right of them, the context on a
/// line under, and the numbers along the bottom under their own micro-caps.
/// Somebody who has read a `<Sheet>` in this app has already read this.
///
/// Every cell is rendered through `flexRender` exactly as the table renders
/// it, so a pill is a pill and a warned figure is still warned. Nothing here
/// re-formats a value: the column said how it looks, in one place.
function RowCard<TRow>({
  row,
  onRowClick,
  selected,
  fresh,
  sub,
  before,
  hidden,
  apart,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any
  apart?: boolean
  onRowClick?: (original: TRow) => void
  selected: boolean
  fresh?: boolean
  sub?: React.ReactNode
  before?: React.ReactNode
  hidden?: boolean
}) {
  if (hidden) {
    return before !== null && before !== undefined ? (
      <li data-sub>{before}</li>
    ) : null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: Record<CardRole, any[]> = {
    id: [],
    title: [],
    status: [],
    metric: [],
    meta: [],
    hide: [],
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row.getVisibleCells().forEach((cell: any, index: number) => {
    const role = roleOf(cell.column, index)
    // A line of meta that says "—" is a line that says nothing: on a desk the
    // dash holds a column's place, on a card it only adds a row to scroll.
    if (role === "meta" && blank(cell.getValue())) return
    parts[role].push(cell)
  })

  return (
    <>
      {before !== null && before !== undefined && <li data-sub>{before}</li>}
      <li
        onClick={
          onRowClick ? () => onRowClick(row.original as TRow) : undefined
        }
        {...(onRowClick
          ? openable(() => onRowClick(row.original as TRow))
          : {})}
        data-selected={selected || undefined}
        data-fresh={fresh || undefined}
        aria-current={selected || undefined}
        className={cn(
          "flex items-center gap-3 px-3.5 py-3",
          apart
            ? "rounded-card border border-hairline bg-canvas shadow-soft"
            : "border-b border-hairline last:border-b-0",
          fresh && "row-fresh",
          onRowClick && "cursor-pointer",
          onRowClick && FOCUSED,
          // Selection is a tint here too. `active:` rather than `hover:`: a
          // finger has no hover, and a row that stays tinted after a tap because
          // the browser synthesised one reads as still selected.
          selected ? "bg-accent-bg" : "active:bg-soft"
        )}
      >
        {/* The content in one column and the status beside it, centred on the
            card's whole height: beside only the first lines it stood at the
            top of a card three lines tall, which read as misplaced. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="min-w-0">
            {parts.id.map((cell) => (
              <div key={cell.id} className="truncate">
                {render(cell)}
              </div>
            ))}
            {parts.title.map((cell) => (
              <div
                key={cell.id}
                className="truncate text-card-title font-semibold text-ink"
              >
                {render(cell)}
              </div>
            ))}
          </div>

          {parts.meta.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-1.5 text-[0.875rem] text-mute">
              {parts.meta.map((cell, index) => (
                <span
                  key={cell.id}
                  className="flex max-w-full min-w-0 items-center gap-x-1.5 [&>*]:min-w-0"
                >
                  {index > 0 && <span className="text-faint">·</span>}
                  {render(cell)}
                </span>
              ))}
            </div>
          )}

          {parts.metric.length > 0 && (
            // Two columns of label-over-value, so the figures line up down the
            // card and from one card to the next — they were a wrapping row of
            // shouting micro-caps, and a card with four metrics broke onto three
            // ragged lines. Sentence case, one grey lighter than the value: the
            // label names the number, it does not compete with it.
            <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2.5">
              {parts.metric.map((cell) => (
                <div key={cell.id} className="min-w-0">
                  <dt className="text-[0.875rem] leading-4 text-mute">
                    {headerText(cell.column)}
                  </dt>
                  <dd className="mt-0.5 min-w-0 text-cell text-ink tabular-nums [&>*]:max-w-full [&>*]:items-start [&>*]:justify-start [&>*]:text-left">
                    {render(cell)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {parts.status.map((cell) => (
            <span key={cell.id}>{render(cell)}</span>
          ))}
        </div>
      </li>
      {sub !== null && sub !== undefined && (
        <li data-sub className="border-b border-hairline">
          {sub}
        </li>
      )}
    </>
  )
}

/// The roles a column can take in a card. Kept in step with `meta.card` in
/// `lib/react-table.d.ts` by hand — a `ColumnMeta` lookup type would have to
/// name the table's feature set, and this list is read here.
type CardRole = "id" | "title" | "status" | "metric" | "meta" | "hide"

/// Where a column goes in a card.
///
/// `meta.card` if the column says, and otherwise a guess from what this app's
/// own conventions already encode: the first column identifies the row, a
/// right-aligned column is a number (DESIGN.md's rule, and `meta.align` is how
/// every table here states it), and everything else is context. So a list
/// nobody has thought about on a phone still reads as a list on one, and
/// thinking about it later is one line per column.
function roleOf(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  column: any,
  index: number
): CardRole {
  const meta = column.columnDef.meta
  if (meta?.card) return meta.card as CardRole
  if (index === 0) return meta?.mono ? "id" : "title"
  if (meta?.align === "right") return "metric"
  return "meta"
}

/// A column's header as text.
///
/// Headers in this app are strings; `flexRender` would be the general answer
/// but a micro-cap `<dt>` is not a place to run a header renderer that may
/// return a sort button. The column id is the fallback, which is at least a
/// name somebody chose.
function headerText(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  column: any
): string {
  return columnName(column)
}

function blank(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && (value.trim() === "" || value === "—"))
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(cell: any) {
  return flexRender(cell.column.columnDef.cell, cell.getContext())
}

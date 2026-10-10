import { ChevronDown } from "lucide-react"
import { Fragment, useState } from "react"

import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"

/// The hub's list table, without the machinery.
///
/// `frontend-hub/src/components/ui/data-table.tsx` is the reference for how a
/// list LOOKS — sentence-case headings on a `{soft}` band at the size of the
/// cells under them, hairline rows, a tint for the row under the pointer — and
/// this draws the same thing. What it leaves behind is what a shop's lists do
/// not need: TanStack Table, virtualisation, column dropping, sort state. A
/// shop's promotions are a dozen rows, not twelve thousand, and a dependency
/// bought for a problem nobody has is a dependency somebody has to upgrade.
///
/// Two shapes from one declaration, as in the hub:
///
///  - **wider than a phone** — a table. It scrolls sideways inside its card
///    rather than squeezing, so a narrow tablet keeps every column readable.
///  - **phone** — the same rows as a stack of card rows, built from the role
///    each column declares in `card`. Not a table you scroll sideways: a list
///    exists to compare its rows, and a row you have to scroll to finish
///    reading cannot be compared with the one above it.
///
/// A row with a `detail` opens in place, under itself, and only one is open at
/// a time. In place rather than in a sheet because the question asked of the
/// detail is always "and this one?" about the row beside it — and a sheet over
/// the list hides the row somebody is comparing it with.

export interface ListColumn<T> {
  readonly id: string
  readonly header: string
  readonly cell: (row: T) => React.ReactNode
  readonly align?: "left" | "right"
  /// Classes for the column's heading and cells — a width, `whitespace-normal`
  /// for a column that may wrap, or `max-lg:hidden` for one that gives way on
  /// a narrow table before the rest have to scroll.
  readonly className?: string
  /// What the column becomes in a phone's card row. The first column is the
  /// title unless it says otherwise; anything unstated is a line of context.
  readonly card?: "title" | "status" | "meta" | "hide"
}

export function ListTable<T>({
  rows,
  columns,
  rowKey,
  detail,
  empty,
  roomy = false,
  onOpen,
  className,
}: {
  rows: readonly T[]
  columns: readonly ListColumn<T>[]
  rowKey: (row: T) => string
  /// What opens under a row when it is pressed. Absent, rows are not pressable.
  detail?: (row: T) => React.ReactNode
  /// Said in place of the rows when there are none — the caller's sentence,
  /// because an empty search and an empty shop are different kinds of nothing.
  empty: React.ReactNode
  /// Pressing a row does this instead of unfolding it, and the unfolding moves
  /// to an arrow at the row's left edge: the row opens a record, the arrow
  /// opens what is inside it. With no `detail`, the row is simply pressable —
  /// on a desk, the table form of a list whose records open as a sheet.
  onOpen?: (row: T) => void
  /// A little more air above and below each row.
  roomy?: boolean
  className?: string
}) {
  const phone = useLayout() === "phone"
  const leftArrow = detail !== undefined && onOpen !== undefined
  const [open, setOpen] = useState<string | null>(null)
  const toggle = (key: string) =>
    setOpen((current) => (current === key ? null : key))

  if (rows.length === 0) {
    return (
      <div className={cn("px-4 py-10 text-center", className)}>
        <p className="mx-auto max-w-[28em] text-meta text-body">{empty}</p>
      </div>
    )
  }

  if (phone) {
    const roleOf = (column: ListColumn<T>, index: number) =>
      column.card ?? (index === 0 ? "title" : "meta")
    return (
      <ul className={className}>
        {rows.map((row) => {
          const key = rowKey(row)
          const expanded = open === key
          const cells = columns.map((column, index) => ({
            column,
            role: roleOf(column, index),
          }))
          const summary = (
            <>
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1">
                  {cells
                    .filter((one) => one.role === "title")
                    .map(({ column }) => (
                      <span
                        key={column.id}
                        className="block text-card-title font-medium text-ink"
                      >
                        {column.cell(row)}
                      </span>
                    ))}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {cells
                    .filter((one) => one.role === "status")
                    .map(({ column }) => (
                      <span key={column.id}>{column.cell(row)}</span>
                    ))}
                </span>
              </span>
              {cells
                .filter((one) => one.role === "meta")
                .map(({ column }) => (
                  <span
                    key={column.id}
                    className="mt-1 block text-meta text-body tabular-nums"
                  >
                    {column.cell(row)}
                  </span>
                ))}
            </>
          )
          return (
            <li
              key={key}
              className={cn(
                "border-b border-hairline last:border-b-0",
                expanded && "bg-soft",
              )}
            >
              {detail === undefined ? (
                <div className={cn("px-3.5", roomy ? "py-4" : "py-3")}>
                  {summary}
                </div>
              ) : leftArrow ? (
                <div className="flex items-center">
                  <span className="shrink-0 pl-1.5">
                    <ArrowToggle
                      expanded={expanded}
                      onToggle={() => toggle(key)}
                    />
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpen(row)}
                    className={cn(
                      "block min-h-tap min-w-0 flex-1 pr-3.5 pl-1.5 text-left active:bg-soft",
                      roomy ? "py-4" : "py-3",
                    )}
                  >
                    {summary}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggle(key)}
                  className={cn(
                    "block min-h-tap w-full px-3.5 text-left active:bg-soft",
                    roomy ? "py-4" : "py-3",
                  )}
                >
                  {summary}
                </button>
              )}
              {expanded && detail !== undefined && (
                <div className="px-3.5 pb-4">{detail(row)}</div>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className={cn("min-w-0 overflow-x-auto", className)}>
      <table className="w-full border-collapse text-cell">
        <thead>
          <tr>
            {leftArrow && (
              <th
                aria-hidden
                className="h-10 w-12 border-b border-hairline bg-soft"
              />
            )}
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(
                  // The hub's heading row: tinted rather than ruled, sentence
                  // case at the cells' own weight, one grey lighter.
                  "h-10 border-b border-hairline bg-soft px-3.5 py-0 text-eyebrow font-medium whitespace-nowrap text-body",
                  column.align === "right" ? "text-right" : "text-left",
                  // The column's own classes go on its heading too, so a
                  // column hidden at a width is hidden whole.
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
            {detail !== undefined && !leftArrow && (
              <th
                aria-hidden
                className="h-10 w-10 border-b border-hairline bg-soft"
              />
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row)
            const expanded = open === key
            return (
              <Fragment key={key}>
                <tr
                  onClick={
                    leftArrow || (detail === undefined && onOpen !== undefined)
                      ? () => onOpen?.(row)
                      : detail
                        ? () => toggle(key)
                        : undefined
                  }
                  onKeyDown={
                    detail || onOpen
                      ? (event) => {
                          if (event.target !== event.currentTarget) return
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            if (leftArrow || detail === undefined) onOpen?.(row)
                            else toggle(key)
                          }
                        }
                      : undefined
                  }
                  tabIndex={detail || onOpen ? 0 : undefined}
                  aria-expanded={detail && !leftArrow ? expanded : undefined}
                  className={cn(
                    // A minimum, not a height: `height` on a row is a floor,
                    // so a wrapped name grows the row instead of clipping it.
                    "border-b border-hairline last:border-b-0 pointer-coarse:h-tap",
                    roomy ? "h-[3.75rem]" : "h-row",
                    (detail || onOpen) &&
                      "cursor-pointer outline-none focus-visible:bg-soft",
                    expanded
                      ? "border-b-transparent bg-soft"
                      : "hover:bg-soft/60",
                  )}
                >
                  {leftArrow && (
                    <td className="w-12 pl-2.5 align-middle">
                      <ArrowToggle
                        expanded={expanded}
                        onToggle={(event) => {
                          event.stopPropagation()
                          toggle(key)
                        }}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cn(
                        "px-3.5 align-middle whitespace-nowrap text-text",
                        roomy ? "py-4" : "py-2.5",
                        column.align === "right" && "text-right",
                        column.className,
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                  {detail !== undefined && !leftArrow && (
                    <td className="w-10 pr-3 text-right align-middle">
                      <ChevronDown
                        aria-hidden
                        className={cn(
                          "inline size-4 text-line-ico transition-transform duration-200",
                          expanded && "rotate-180",
                        )}
                      />
                    </td>
                  )}
                </tr>
                {expanded && detail !== undefined && (
                  <tr className="border-b border-hairline bg-soft last:border-b-0">
                    <td
                      colSpan={columns.length + 1}
                      className="px-3.5 pt-1 pb-4"
                    >
                      {detail(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/// The arrow at a row's left edge that unfolds what is inside it.
function ArrowToggle({
  expanded,
  onToggle,
}: {
  expanded: boolean
  onToggle: (event: React.MouseEvent) => void
}) {
  return (
    <button
      type="button"
      aria-label={expanded ? "Collapse" : "Expand"}
      aria-expanded={expanded}
      onClick={onToggle}
      className="grid size-8 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:size-tap"
    >
      <ChevronDown
        aria-hidden
        className={cn(
          "size-4 transition-transform duration-200",
          !expanded && "-rotate-90",
        )}
      />
    </button>
  )
}

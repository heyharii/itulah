import { useStackLabels } from "@/lib/stack-table"
import { cn } from "@/lib/utils"

/// One part of a document, under its own heading.
///
/// Every block of a record wears the same shape — a rule, a heading, the
/// content — so that two screens showing the SAME document cannot drift into
/// looking like two documents. That is not hypothetical here: an order was
/// being drawn one way on the review before it was created and another way on
/// its detail sheet afterwards, and the thing somebody approved did not look
/// like the thing they came back to.
export function Section({
  title,
  actions,
  rule = true,
  flush = false,
  quiet = false,
  tight = false,
  children,
}: {
  title: React.ReactNode
  /// What can be done to this section, at its own heading — never at the foot.
  actions?: React.ReactNode
  /// The hairline above it. A rule separates two sections; the FIRST section
  /// has nothing above it to be separated from, so a rule there is just a line
  /// under whatever the sheet opened with. The air stays either way.
  rule?: boolean
  /// The very first thing in a sheet's body: no rule and no air above it,
  /// because the sheet's own header already stands there and the gap only
  /// read as an empty band (the owner, 2026-09-28).
  flush?: boolean
  /// A record's own sections, where the table is what is being read: a small
  /// plain title and no air above, so the table sits close under the facts.
  quiet?: boolean
  /// No air above it: the parent already spaces its sections, and the section's
  /// own would be added on top of it.
  tight?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3",
        flush ? "" : rule ? "border-t border-hairline pt-5" : quiet || tight ? "pt-0" : "pt-7"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4
          className={
            quiet
              ? "text-[0.875rem] font-normal text-mute"
              : "text-card-title font-semibold text-ink"
          }
        >
          {title}
        </h4>
        {actions}
      </div>
      {children}
    </section>
  )
}

/// A key → value row. The reading unit of a summary panel.
export function KeyValue({
  term,
  children,
  className,
}: {
  term: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        // No rule per row: the ladder is four short lines that end in one
        // bold total, and a rule under each of them made the record read as
        // five separate statements rather than one sum.
        "flex justify-between gap-3 py-[0.1875rem] text-meta",
        className
      )}
    >
      <span className="shrink-0 text-mute">{term}</span>
      {/* May narrow, and may break: a hash or a long code has no spaces to
          wrap at, and without these it pushed the whole row — and on a
          phone the whole page — past the edge of the glass. */}
      <span className="min-w-0 text-right font-medium break-words text-ink tabular-nums">
        {children}
      </span>
    </div>
  )
}

/// The totals ladder that closes a record: right-aligned key→value rows under a
/// hairline, where **only the final row is ink/600** and the rest are `{body}`.
///
/// That one rule is what makes a total read as a total without a box around it.
///
/// **14px, not 12.5.** This is the figure somebody checks a quote against and
/// the last thing read before a document is committed, and it was set two
/// steps below the table above it — smaller than the cells it is summing.
/// Raised on the owner's instruction, in the same direction the whole scale
/// was raised on 2026-09-04: the bottom of this type scale had been reached
/// by things that are not incidental, and a total is the least incidental
/// number on a record. Size is now uniform across the ladder and the weight
/// does the separating, which is what the rule above already said.
export function TotalsLadder({
  rows,
  total,
  className,
}: {
  rows: readonly {
    readonly label: React.ReactNode
    readonly value: React.ReactNode
  }[]
  total: { readonly label: React.ReactNode; readonly value: React.ReactNode }
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-t border-hairline pt-2.5 text-[0.875rem]",
        className
      )}
    >
      {rows.map((row, index) => (
        <div key={index} className="flex justify-between gap-3 text-body">
          <span>{row.label}</span>
          <span className="tabular-nums">{row.value}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3 font-semibold text-ink">
        <span>{total.label}</span>
        <span className="tabular-nums">{total.value}</span>
      </div>
    </div>
  )
}

/// The in-card item table. Its heading reads like every other table's —
/// sentence case, 14px, quiet by colour (owner, 2 Oct 2026: no uppercase, no
/// text under 14px, nothing cramped).
export function MiniTable({
  head,
  children,
  className,
  style,
}: {
  /// `align` defaults to right for everything but the first column, which is
  /// what every mini-table in the reference does.
  head: readonly (string | { label: string; align?: "left" | "right" })[]
  children: React.ReactNode
  className?: string
  /// For a caller that computes a minimum width from its own column count and
  /// lets an `overflow-x-auto` parent scroll. A class cannot carry a value the
  /// caller derives at render time.
  style?: React.CSSProperties
}) {
  // On a phone this table stacks instead of scrolling sideways — see
  // `useStackLabels` and `.mini-stack` in styles/index.css.
  const table = useStackLabels()

  return (
    <table
      ref={table}
      className={cn("mini-stack w-full border-collapse", className)}
      style={style}
    >
      <thead>
        <tr>
          {head.map((column, index) => {
            const label = typeof column === "string" ? column : column.label
            const align =
              typeof column === "string"
                ? index === 0
                  ? "left"
                  : "right"
                : (column.align ?? (index === 0 ? "left" : "right"))
            return (
              <th
                key={label}
                className={cn(
                  "pb-2.5 text-[0.875rem] font-medium text-body",
                  align === "right"
                    ? "pl-3 text-right"
                    : "pr-2 text-left [&:not(:first-child)]:pl-3"
                )}
              >
                {label}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}

/// A row inside a `<MiniTable>`.
///
/// Promoted from two modules that had written it identically: `<MiniTable>`
/// shipped without a row or a cell, which left every caller to re-derive the
/// hairline and the cell padding, and two of them already had.
export function MiniRow({ children }: { children: React.ReactNode }) {
  return <tr className="border-t border-hairline">{children}</tr>
}

/// A cell inside a `<MiniRow>`. Numbers go right and tabular; everything else
/// goes left — the same default `<MiniTable>`'s header uses, so a column's
/// head and its body cannot disagree.
export function MiniCell({
  children,
  align = "left",
  className,
  colSpan,
}: {
  children: React.ReactNode
  align?: "left" | "right"
  className?: string
  /// A summary cell that stands under several columns — a totals row's label,
  /// usually. It has to reach the `<td>`: on anything else the browser ignores
  /// it and every figure after it in the row shifts a column to the left.
  colSpan?: number
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        "py-3 text-[0.875rem] text-text",
        // The gap belongs on the left of a right-aligned cell: padding on the
        // right would move the edge every figure in the column lines up on,
        // and two right-aligned cells with no gap at all run their contents
        // together as soon as the column is full.
        align === "right"
          ? "pl-3 text-right tabular-nums"
          : "pr-2 [&:not(:first-child)]:pl-3",
        className
      )}
    >
      {children}
    </td>
  )
}

/// A heading inside a card or a sheet, one step below `<CardTitle>`, with an
/// optional muted note on the right.
export function SubHead({
  children,
  aside,
}: {
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
      <h4 className="text-card-title font-semibold text-ink">{children}</h4>
      {aside && <span className="text-[0.875rem] text-mute">{aside}</span>}
    </div>
  )
}

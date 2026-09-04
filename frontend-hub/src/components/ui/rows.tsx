import { cn } from "@/lib/utils"

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
        "flex justify-between gap-3 border-b border-hairline py-2 text-meta last:border-b-0",
        className
      )}
    >
      <span className="text-mute">{term}</span>
      <span className="text-right font-medium text-ink tabular-nums">
        {children}
      </span>
    </div>
  )
}

/// The totals ladder that closes a record: right-aligned key→value rows under a
/// hairline, where **only the final row is ink/600** and the rest are `{body}`.
///
/// That one rule is what makes a total read as a total without a box around it.
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
        "flex flex-col gap-1 border-t border-hairline pt-2.5 text-[0.78125rem]",
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

/// The in-card item table. This is the one place mono UPPERCASE micro-caps
/// belong — full-width list tables use Inter (see `<DataTable>`).
export function MiniTable({
  head,
  children,
  className,
}: {
  /// `align` defaults to right for everything but the first column, which is
  /// what every mini-table in the reference does.
  head: readonly (string | { label: string; align?: "left" | "right" })[]
  children: React.ReactNode
  className?: string
}) {
  return (
    <table className={cn("w-full border-collapse", className)}>
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
                  "pb-1.5 font-mono text-eyebrow tracking-[0.04em] text-body uppercase",
                  align === "right" ? "pl-3 text-right" : "text-left"
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
}: {
  children: React.ReactNode
  align?: "left" | "right"
  className?: string
}) {
  return (
    <td
      className={cn(
        "py-2 text-[0.78125rem] text-text",
        // The gap belongs on the left of a right-aligned cell: padding on the
        // right would move the edge every figure in the column lines up on,
        // and two right-aligned cells with no gap at all run their contents
        // together as soon as the column is full.
        align === "right" ? "pl-3 text-right tabular-nums" : "pr-2",
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
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h4 className="text-card-title font-semibold text-ink">{children}</h4>
      {aside && <span className="text-[0.71875rem] text-mute">{aside}</span>}
    </div>
  )
}

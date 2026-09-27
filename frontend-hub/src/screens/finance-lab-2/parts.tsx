import { money } from "@/lib/format"
import { useStackLabels } from "@/lib/stack-table"
import { cn } from "@/lib/utils"

/// The pieces every screen in this module shares.
///
/// Deliberately plain: ERPNext's reconciliation screen is a row of number
/// cards over a dense table, and the house `DataTable` is built for filtered,
/// faceted lists — a different job. Borrowing it here would have meant fighting
/// its chrome to arrive back at a plain grid.

/// One of the three figures at the top of a reconciliation.
///
/// The wording is ERPNext's, kept word for word, because the point of this lab
/// is to be able to put the two screens side by side and see the same page.
export function NumberCard({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: number | null
  note?: React.ReactNode
  tone?: "bad" | "ok"
}) {
  return (
    <div
      className={cn(
        "rounded-card border p-3",
        tone === "bad"
          ? "border-bad-fg/25 bg-bad-bg"
          : tone === "ok"
            ? "border-ok-fg/25 bg-ok-bg"
            : "border-hairline bg-canvas"
      )}
    >
      <div
        className={cn(
          "text-[0.875rem]",
          tone === "bad"
            ? "text-bad-fg"
            : tone === "ok"
              ? "text-ok-fg"
              : "text-mute"
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-[1.1875rem] font-semibold tabular-nums",
          tone === "bad"
            ? "text-bad-fg"
            : tone === "ok"
              ? "text-ok-fg"
              : "text-ink"
        )}
      >
        {/* A missing figure is not zero. No statement imported and a balance of
            nothing must not render the same. */}
        {value === null ? "—" : money(value)}
      </div>
      {note !== undefined && (
        <div
          className={cn(
            "mt-0.5 text-[0.875rem]",
            tone === "bad" ? "text-bad-fg" : "text-mute"
          )}
        >
          {note}
        </div>
      )}
    </div>
  )
}

export function CardRow({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-2.5 md:grid-cols-3">{children}</div>
}

/// A dense table in the shape ERPNext's datatable has: hairline rules, no
/// zebra, numbers right and tabular.
export function Grid({ children }: { children: React.ReactNode }) {
  // Stacks on a phone rather than scrolling sideways (`useStackLabels`).
  const table = useStackLabels()
  return (
    <div className="overflow-x-auto">
      <table
        ref={table}
        className="mini-stack w-full border-collapse text-[0.875rem]"
      >
        {children}
      </table>
    </div>
  )
}

export function Th({
  children,
  align,
  width,
}: {
  children?: React.ReactNode
  align?: "right"
  width?: string
}) {
  return (
    <th
      style={width === undefined ? undefined : { width }}
      className={cn(
        "border-b border-hairline-2 px-2 py-1.5 text-[0.875rem] font-medium whitespace-nowrap text-mute",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  align,
  className,
}: {
  children?: React.ReactNode
  align?: "right"
  className?: string
}) {
  return (
    <td
      className={cn(
        "border-b border-hairline px-2 py-2 align-top text-text",
        align === "right" ? "text-right tabular-nums" : "text-left",
        className
      )}
    >
      {children}
    </td>
  )
}

/// What a candidate agreed on, in the server's own words.
///
/// The one thing this lab changes about ERPNext's interaction: their dialog
/// shows `rank 4`, a sum of four one-or-zero terms, and never says which term
/// was which. The matcher here already returns the words — "amount matches
/// exactly", "1 day apart", "reference matches" — so the screen only has to
/// stop hiding them.
export function Reasons({ reasons }: { reasons: readonly string[] }) {
  if (reasons.length === 0) {
    return <span className="text-[0.875rem] text-mute">no stated reason</span>
  }
  return (
    <span className="flex flex-wrap gap-1">
      {reasons.map((reason) => (
        <span
          key={reason}
          className={cn(
            "rounded-full border px-1.5 py-px text-[0.875rem]",
            reason.startsWith("amount matches") ||
              reason === "reference matches"
              ? "border-ok-fg/30 bg-ok-bg text-ok-fg"
              : "border-hairline-2 text-body"
          )}
        >
          {reason}
        </span>
      ))}
    </span>
  )
}

/// Says plainly what a screen is standing on when it is not standing on an
/// endpoint of its own. Better than a convincing screen drawn over nothing.
export function LabNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-inner border border-hairline bg-soft px-3 py-2 text-[0.875rem] leading-relaxed text-body">
      {children}
    </p>
  )
}

import { cn } from "@/lib/utils"

/// How a document arrives at its total.
///
/// The ladder is a receipt, and its whole job is to make one number the
/// answer and the rest the arithmetic. So the steps are `{body}` and only the
/// last row is `{ink}`/600, and the last row takes a second hairline of its
/// own — the reader's eye can stop at the line above "Total" and know
/// everything below it is the conclusion.
///
/// It also gives tax somewhere to be named. A PO whose panel shows only a
/// grand total has quietly hidden PPN inside it, and a buyer checking a
/// supplier's invoice against our own figure has no row to compare.
export type TotalsRow = {
  label: React.ReactNode
  value: React.ReactNode
}

export function TotalsLadder({
  rows,
  total,
  className,
}: {
  rows: readonly (TotalsRow | false | null | undefined)[]
  /// The one conclusion. Optional only because a partial ladder (a running
  /// subtotal in a basket group) is legitimate; a document that has a total
  /// should always pass it here rather than as a last ordinary row.
  total?: TotalsRow
  className?: string
}) {
  const steps = rows.filter((row): row is TotalsRow => Boolean(row))
  return (
    <div
      className={cn(
        "mt-[0.625rem] border-t border-[var(--os-hairline,#ececef)] pt-2",
        className,
      )}
    >
      {steps.map((step, index) => (
        <div
          key={index}
          className="flex justify-between gap-3 py-[0.1875rem] text-[0.75rem] text-[var(--os-body,#74747b)]"
        >
          <span>{step.label}</span>
          <span className="tabular-nums">{step.value}</span>
        </div>
      ))}
      {total !== undefined && (
        <div
          className={cn(
            "mt-1 flex justify-between gap-3 pt-[0.4375rem]",
            "border-t border-[var(--os-hairline,#ececef)]",
            "text-[0.75rem] font-semibold text-[var(--os-ink,#1d1d1f)]",
          )}
        >
          <span>{total.label}</span>
          <span className="tabular-nums">{total.value}</span>
        </div>
      )}
    </div>
  )
}

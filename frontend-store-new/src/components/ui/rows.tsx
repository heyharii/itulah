import { cn } from "@/lib/utils"

/// A key → value row. The reading unit of a summary.
export function KeyValue({
  term,
  tone = "normal",
  children,
  className,
}: {
  term: React.ReactNode
  tone?: "normal" | "bad" | "ok"
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-3 border-b border-hairline py-2.5 text-[0.84375rem] last:border-b-0",
        className,
      )}
    >
      <span className="text-mute">{term}</span>
      <span
        className={cn(
          "text-right font-medium tabular-nums",
          tone === "bad"
            ? "text-bad-fg"
            : tone === "ok"
              ? "text-ok-fg"
              : "text-ink",
        )}
      >
        {children}
      </span>
    </div>
  )
}

/// The totals ladder that closes a record: key→value rows under a hairline,
/// where **only the final row is ink/600** and the rest are `{body}`.
///
/// That one rule is what makes a total read as a total without a box around it.
/// DESIGN.md drops the ladder on phones for a *shipment* — there the push
/// detail leads with items, and the money is somebody else's problem. Here the
/// money is the whole point, so it stays.
export function TotalsLadder({
  rows,
  total,
  className,
}: {
  rows: readonly {
    readonly label: React.ReactNode
    readonly value: React.ReactNode
    readonly tone?: "normal" | "bad"
  }[]
  total: { readonly label: React.ReactNode; readonly value: React.ReactNode }
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 border-t border-hairline pt-3 text-[0.84375rem]",
        className,
      )}
    >
      {rows.map((row, index) => (
        <div
          key={index}
          className={cn(
            "flex justify-between gap-3",
            row.tone === "bad" ? "text-bad-fg" : "text-body",
          )}
        >
          <span>{row.label}</span>
          <span className="tabular-nums">{row.value}</span>
        </div>
      ))}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-hairline pt-2.5 font-semibold text-ink">
        <span className="text-card-title">{total.label}</span>
        <span className="text-metric tabular-nums">{total.value}</span>
      </div>
    </div>
  )
}

/// The in-card item table. This is the one place mono UPPERCASE micro-caps
/// belong.
///
/// On a phone the middle columns go and identity + outcome stay — DESIGN.md's
/// "drop middle-first" rule, which for a basket means `ITEMS · QTY · LINE
/// TOTAL` and no unit price. This is the only `<table>` in the app and it is
/// not a list: it is the inside of one record.
export function MiniTable({
  head,
  children,
  className,
}: {
  head: readonly string[]
  children: React.ReactNode
  className?: string
}) {
  return (
    <table className={cn("w-full border-collapse", className)}>
      <thead>
        <tr>
          {head.map((label, index) => (
            <th
              key={label}
              className={cn(
                "px-3 pt-2.5 pb-1.5 font-mono text-[0.65625rem] font-medium tracking-[0.07em] text-faint uppercase",
                index === 0 ? "text-left" : "text-right",
              )}
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}

/// One mini-table row. First cell left and wrapping, the rest right and
/// tabular.
export function MiniRow({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <tr
      className={cn(
        "[&>td]:px-3 [&>td]:py-2 [&>td]:text-right [&>td]:text-cell [&>td]:text-ink",
        "[&>td:first-child]:text-left [&>td:first-child]:font-normal [&>td:first-child]:whitespace-normal",
        className,
      )}
    >
      {children}
    </tr>
  )
}

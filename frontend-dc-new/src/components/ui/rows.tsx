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
                  "pb-1.5 font-mono text-[0.625rem] tracking-[0.04em] text-faint uppercase",
                  align === "right" ? "text-right" : "text-left"
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

import { cn } from "@/lib/utils"

/// One fact per row, key left and value right, in a record panel.
///
/// A two-column `dl` grid is the usual way to lay facts out and it is wrong
/// for records whose values are money and dates: the values end up ragged
/// against an invented column edge and no two panels agree on where that edge
/// is. Pushing key and value to opposite ends of the row instead means every
/// value in the panel is right-aligned to the panel, and a column of amounts
/// lines up on its digits without anyone choosing a width.
///
/// Facts, not fields. Anything the user can change belongs in a `Field`; this
/// is for what the record already knows.
export type KeyValue = {
  label: React.ReactNode
  value: React.ReactNode
}

export function KeyValueRows({
  rows,
  className,
}: {
  /// Falsy entries are dropped, so a caller can write a conditional fact
  /// inline rather than assembling the array in a `useMemo` above the render.
  rows: readonly (KeyValue | false | null | undefined)[]
  className?: string
}) {
  const facts = rows.filter((row): row is KeyValue => Boolean(row))
  return (
    <div className={cn("text-[0.78125rem]", className)}>
      {facts.map((fact, index) => (
        <div
          key={index}
          className={cn(
            "flex justify-between gap-3 py-2",
            index > 0 && "border-t border-[var(--os-hairline,#ececef)]",
          )}
        >
          <span className="font-normal text-[var(--os-mute,#a6a6ad)]">
            {fact.label}
          </span>
          {/* Inter, not mono: mono is for identifiers, micro-caps and codes.
              Money set in a monospace face reads as a code the user is not
              allowed to touch. */}
          <span className="text-right font-medium tabular-nums text-[var(--os-ink,#1d1d1f)]">
            {fact.value}
          </span>
        </div>
      ))}
    </div>
  )
}

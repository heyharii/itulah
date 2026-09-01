import { growth, growthLabel } from "@itulah/contract/reporting"
import { cn } from "@/lib/utils"

/// How this period compares with the one before it.
///
/// The sign is in the text and the arrow, never only in the colour: a reader
/// who cannot tell the green from the red still reads "+12%" and an arrow
/// pointing up. Colour is reinforcement here, not the channel.
///
/// Down is not painted as failure. A shop can be down because last month had
/// a sale on, and a screen that shouted at every red number would be shouted
/// past within a week — so the tint is quiet and the arrow does the work.
export function Delta({
  now,
  before,
  against,
  className,
}: {
  now: number
  before: number
  /// The span being compared against, named in full for the tooltip. Without
  /// it a percentage is a number with no denominator anybody can see.
  against?: string
  className?: string
}) {
  const fraction = growth(now, before)

  // Nothing to divide by. "New" says what actually happened — this shop sold
  // nothing in the period being compared against — where a percentage would be
  // either infinity or a lie.
  if (fraction === null) {
    return (
      <span
        className={cn("text-muted-foreground text-[10.5px]", className)}
        title={
          against === undefined
            ? undefined
            : `Nothing was sold in ${against}, so there is nothing to compare against`
        }
      >
        {now > 0 ? "new" : "—"}
      </span>
    )
  }

  const flat = Math.abs(fraction) < 0.005
  return (
    <span
      className={cn(
        "text-[10.5px] font-medium tabular-nums",
        flat
          ? "text-muted-foreground"
          : fraction > 0
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-rose-700 dark:text-rose-400",
        className,
      )}
      title={`${growthLabel(fraction)} against ${against ?? "the period before"}`}
    >
      <span aria-hidden>{flat ? "→" : fraction > 0 ? "↑" : "↓"}</span>{" "}
      {flat ? "0%" : growthLabel(fraction)}
    </span>
  )
}

import { growth, growthLabel } from "@itulah/contract/reporting"

import { cn } from "@/lib/utils"

/// How this span compares with the one it is being measured against.
///
/// The sign is in the text and in the arrow, never only in the colour: a reader
/// who cannot tell the green from the red still reads "↑ 12%". Colour is
/// reinforcement here, not the channel.
///
/// Down is not painted as failure. A shop can be down because last month had a
/// sale on, and a screen that shouted at every red number would be shouted past
/// within a week — so the tint is quiet and the arrow does the work.
export function Delta({
  now,
  before,
  against,
  className,
}: {
  now: number
  before: number
  /// The span being compared against, named in full for the tooltip. Without it
  /// a percentage is a number with no denominator anybody can see.
  against?: string
  className?: string
}) {
  const fraction = growth(now, before)

  // Nothing to divide by. "new" says what actually happened — this shop sold
  // nothing in the span being compared against — where a percentage would be
  // either infinity or a lie.
  if (fraction === null) {
    return (
      <span
        className={cn("text-[0.875rem] text-mute", className)}
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
        "text-[0.875rem] font-medium tabular-nums",
        flat ? "text-mute" : fraction > 0 ? "text-ok" : "text-bad",
        className
      )}
      title={`${growthLabel(fraction)} against ${against ?? "the span before"}`}
    >
      <span aria-hidden>{flat ? "→" : fraction > 0 ? "↑" : "↓"}</span>{" "}
      {flat ? "0%" : growthLabel(fraction)}
    </span>
  )
}

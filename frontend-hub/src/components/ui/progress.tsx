import { useId } from "react"

import { Meter } from "@/components/ui/meter"
import { cn } from "@/lib/utils"

/// A labelled meter with its number on the end — the prototype's `.mwrap`.
///
/// Every station in this building measures the same thing: how much of a
/// finite job is done. Lines picked of lines owed, labels printed of labels
/// queued, pieces found of pieces expected. `<Meter>` draws the proportion;
/// this is the row it lives in, so the label, the bar and the percentage line
/// up across six screens instead of being laid out slightly differently on
/// each.
///
/// The tone follows the status grammar rather than the proportion: a bar is
/// `info` while the work is moving, `ok` when it is finished, `warn` when it
/// has stalled with something still owed. Nothing here decides that — the
/// caller knows whether 78% is progress or a short pick.
export function Progress({
  label,
  value,
  of,
  tone = "accent",
  detail,
  className,
}: {
  label: React.ReactNode
  /// How much is done.
  value: number
  /// Out of how much. Zero is drawn as an empty track rather than as NaN —
  /// a job with nothing in it is a real state, usually "just opened".
  of: number
  tone?: "accent" | "ok" | "warn" | "bad"
  /// Said on the right instead of the percentage, when the count is the more
  /// useful number ("28 short").
  detail?: React.ReactNode
  className?: string
}) {
  const share = of <= 0 ? 0 : value / of
  const labelId = useId()
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        id={labelId}
        className="w-[5.5rem] shrink-0 text-[0.9375rem] text-text"
      >
        {label}
      </span>
      <Meter value={share} tone={tone} labelledBy={labelId} />
      <span className="w-[3.25rem] shrink-0 text-right text-[0.9375rem] font-semibold text-text tabular-nums">
        {detail ?? `${Math.round(share * 100)}%`}
      </span>
    </div>
  )
}

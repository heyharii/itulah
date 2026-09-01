import { cn } from "@/lib/utils"

/// A proportion drawn on a track — sell-through, fill rate, a level against a
/// threshold.
///
/// The fill comes from the saturated `fill-*` family rather than the status
/// hues: a status colour on a meter would claim the number is a *state*, when
/// what a meter says is "how much".
export function Meter({
  value,
  tone = "accent",
  className,
}: {
  /// 0–1. Clamped, because a server that reports 1.4 sell-through should draw a
  /// full bar, not a bar wider than its track.
  value: number
  tone?: "accent" | "ok" | "warn" | "bad"
  className?: string
}) {
  const clamped = Math.max(0, Math.min(1, value))
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-full min-w-12 overflow-hidden rounded-full bg-soft-2 align-middle",
        className,
      )}
      role="meter"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={1}
    >
      <span
        className={cn(
          "block h-full rounded-full",
          tone === "accent" && "bg-accent",
          tone === "ok" && "bg-ok",
          tone === "warn" && "bg-warn",
          tone === "bad" && "bg-bad",
        )}
        style={{ width: `${clamped * 100}%` }}
      />
    </span>
  )
}

import { cn } from "@/lib/utils"

/// A proportion drawn on a track — sell-through, fill rate, a level against a
/// threshold.
///
/// The fill comes from the saturated `fill-*` family rather than the status
/// hues: a status colour on a meter would claim the number is a *state*, when
/// what a meter says is "how much".
///
/// Said to a screen reader as a percentage — 0–100 with the figure spelled out
/// in `aria-valuetext` — because a raw 0–1 is read aloud as "zero point seven
/// eight". What it measures comes from `label` or `labelledBy` when the caller
/// has words for it; `<Progress>` hands over its own.
export function Meter({
  value,
  tone = "accent",
  label,
  labelledBy,
  className,
}: {
  /// 0–1. Clamped, because a server that reports 1.4 sell-through should draw a
  /// full bar, not a bar wider than its track.
  value: number
  tone?: "accent" | "ok" | "warn" | "bad"
  /// What the bar measures, for the screen reader ("Sell-through").
  label?: string
  /// The id of a visible label that already says it.
  labelledBy?: string
  className?: string
}) {
  const clamped = Math.max(0, Math.min(1, value))
  const percent = Math.round(clamped * 100)
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-full min-w-12 overflow-hidden rounded-full bg-soft-2 align-middle",
        className
      )}
      role="meter"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${percent}%`}
    >
      <span
        className={cn(
          "block h-full rounded-full",
          tone === "accent" && "bg-accent",
          tone === "ok" && "bg-ok",
          tone === "warn" && "bg-warn",
          tone === "bad" && "bg-bad"
        )}
        style={{ width: `${clamped * 100}%` }}
      />
    </span>
  )
}

/// The same proportion, drawn round.
///
/// A bar needs width to be read and a table cell has none to spare — so where
/// a list wants "how much of it" beside a figure it already prints, this is
/// the mark: sixteen pixels, no label, no percentage. It is a density cue next
/// to its own number, not a chart, and it is deliberately too small to be read
/// as one.
///
/// Hidden from the screen reader for the same reason it has no label: the
/// number it sits beside already says it, and a second, unlabelled reading of
/// the same figure is noise.
///
/// Colours come from the tokens directly rather than from `stroke-*` classes,
/// which is what every other SVG in this app does — see `ui/chart.tsx`.
export function Dial({
  value,
  tone = "accent",
  className,
}: {
  /// 0–1. Clamped for the reason `<Meter>` clamps: more found than expected
  /// is a full ring, never a ring that overruns itself.
  value: number
  tone?: "accent" | "ok" | "warn" | "bad"
  className?: string
}) {
  const clamped = Math.max(0, Math.min(1, value))
  const circumference = 2 * Math.PI * 6
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4 shrink-0 -rotate-90", className)}
      aria-hidden
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        strokeWidth="2.5"
        stroke="var(--soft-2)"
      />
      {clamped > 0 && (
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${clamped * circumference} ${circumference}`}
          stroke={
            tone === "ok"
              ? "var(--ok)"
              : tone === "warn"
                ? "var(--warn)"
                : tone === "bad"
                  ? "var(--bad)"
                  : "var(--accent)"
          }
        />
      )}
    </svg>
  )
}

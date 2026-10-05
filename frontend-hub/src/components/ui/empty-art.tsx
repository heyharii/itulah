import { cn } from "@/lib/utils"

/// The pictures that stand over an empty state's sentence (owner, 2026-10-05).
///
/// Three, not thirty: a hub is opened all day, and an illustration that changes
/// with every screen is one more thing to look at before the work. These say
/// the three things an empty list can mean — nothing here yet, nothing that
/// matches, nothing left to do — and the sentence beneath says the rest.
///
/// Line drawings in the tokens the hub already has (`line-ico` for the stroke,
/// `soft-2` for the fill, the accent for the single touch of colour), so they
/// follow dark mode without a second set, and none of them reads as a brand
/// mark. Drawn on a 160 x 112 grid, shown at 128px wide.
export type EmptyArt = "empty" | "search" | "done"

const STROKE = "stroke-line-ico"

export function EmptyIllustration({
  art,
  className,
}: {
  art: EmptyArt
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 160 112"
      role="presentation"
      aria-hidden
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        // Arrives once, quietly: a short rise and fade, not a loop. The page
        // is already finished loading when this appears, so it should not
        // draw the eye away from the sentence under it.
        "h-auto w-32 transition-[opacity,transform] duration-300 ease-[var(--ease-out)] motion-reduce:transition-none starting:translate-y-1.5 starting:opacity-0",
        className
      )}
    >
      <ellipse cx="80" cy="100" rx="46" ry="6" className="fill-soft-2" />
      {art === "empty" && <Empty />}
      {art === "search" && <NoMatch />}
      {art === "done" && <Done />}
    </svg>
  )
}

/// Nothing here yet: an empty tray, and the outline of what would sit in it.
function Empty() {
  return (
    <>
      <path
        d="M34 62h92l-9 32H43z"
        className={cn("fill-soft-2", STROKE)}
        strokeWidth={2}
      />
      <path d="M34 62h92" className={STROKE} strokeWidth={2} />
      <path d="M52 74h56" className="stroke-hairline-2" strokeWidth={2} />
      <rect
        x="60"
        y="22"
        width="40"
        height="28"
        rx="6"
        className={STROKE}
        strokeWidth={2}
        strokeDasharray="4 5"
      />
      <circle cx="126" cy="34" r="3.5" className="fill-accent" opacity={0.55} />
      <path d="M36 38v8M32 42h8" className={STROKE} strokeWidth={2} />
    </>
  )
}

/// Nothing that matches: a short list, and a lens over it that found nothing.
function NoMatch() {
  return (
    <>
      <rect
        x="36"
        y="14"
        width="68"
        height="78"
        rx="9"
        className={cn("fill-canvas", STROKE)}
        strokeWidth={2}
      />
      <path
        d="M50 34h40M50 48h28M50 62h34"
        className="stroke-hairline-2"
        strokeWidth={3}
      />
      <circle
        cx="108"
        cy="68"
        r="17"
        className={cn("fill-canvas", STROKE)}
        strokeWidth={2.5}
      />
      <path d="M120.5 80.5L134 94" className="stroke-accent" strokeWidth={4} />
      <path d="M102 68h12" className={STROKE} strokeWidth={2.5} />
    </>
  )
}

/// Nothing left to do: a settled circle with a tick, and a spark either side.
function Done() {
  return (
    <>
      <circle
        cx="80"
        cy="54"
        r="32"
        className={cn("fill-soft-2", STROKE)}
        strokeWidth={2}
      />
      <path d="M65 55l11 11 20-23" className="stroke-accent" strokeWidth={4} />
      <path d="M30 30v8M26 34h8" className={STROKE} strokeWidth={2} />
      <circle cx="132" cy="28" r="3.5" className="fill-accent" opacity={0.55} />
      <circle
        cx="128"
        cy="84"
        r="2.5"
        className="fill-line-ico"
        opacity={0.6}
      />
    </>
  )
}

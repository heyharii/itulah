import { cn } from "@/lib/utils"

/// The four status tones, and nothing else.
///
/// Cloud Hub draws status as a soft tint fill with saturated same-hue text —
/// never as coloured text on the page's own background, and never with a
/// categorical accent. The accents (`a-*`) belong to data series, identity
/// tiles and system tags; status belongs here. Keeping the two apart is what
/// stops a screen reading as a pile of colours.
///
/// `neutral` is deliberately part of the set: an unknown or not-applicable
/// state has to be sayable without borrowing the warning colour, or every
/// unfamiliar value on the screen starts looking like a problem.
export type StatusTone = "ok" | "warn" | "bad" | "info" | "neutral"

const TONES: Record<StatusTone, string> = {
  ok: "bg-[var(--os-ok-bg,#d9f4d2)] text-[var(--os-ok,#36b827)]",
  warn: "bg-[var(--os-warn-bg,#faeacd)] text-[var(--os-warn,#c9892e)]",
  bad: "bg-[var(--os-bad-bg,#fbeaea)] text-[var(--os-bad,#d05151)]",
  info: "bg-[var(--os-info-bg,#ddebfa)] text-[var(--os-info,#2f86d8)]",
  neutral: "bg-[var(--os-soft-2,#f3f3f5)] text-[var(--os-body,#74747b)]",
}

/// A status, said once.
///
/// The leading dot is optional because the reference draws record-card pills
/// without one and dense dashboard pills with one — the dot is there to help a
/// legend or a tight row, not to decorate the label.
export function StatusPill({
  tone = "neutral",
  dot = true,
  className,
  children,
}: {
  tone?: StatusTone
  dot?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex w-max items-center gap-1.5 rounded-full px-2 py-[3px]",
        "text-[0.71875rem] leading-none font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-current opacity-70"
        />
      )}
      {children}
    </span>
  )
}

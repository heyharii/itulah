import { cn } from "@/lib/utils"

/// A mono micro-label: a code, a division, a movement type.
///
/// Not a status pill. A pill says what state a record is in and is coloured by
/// the status taxonomy; a tag is a name the data carries and is neutral unless
/// it means something.
export function Tag({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "accent" | "ok" | "warn" | "bad" | "info"
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md px-2 font-mono text-[0.875rem] font-semibold whitespace-nowrap",
        tone === "neutral" && "bg-soft-2 text-body",
        tone === "accent" && "bg-accent-bg text-accent",
        tone === "ok" && "bg-ok-bg text-ok-fg",
        tone === "warn" && "bg-warn-bg text-warn-fg",
        tone === "bad" && "bg-bad-bg text-bad-fg",
        tone === "info" && "bg-info-bg text-info-fg",
        className
      )}
      {...props}
    />
  )
}

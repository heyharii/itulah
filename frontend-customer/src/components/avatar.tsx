import { cn } from "@/lib/utils"

/// A member's colour: one of four gradients, chosen from their number so the
/// same card always wears the same one — on this phone and on the next.
function hue(memberId: string): 1 | 2 | 3 | 4 {
  let hash = 0
  for (const char of memberId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return ((hash % 4) + 1) as 1 | 2 | 3 | 4
}

/// The first letter of the name the card was enrolled under, or of the
/// number when there is no name.
function initial(memberId: string, name: string | null): string {
  const source = (name ?? "").trim() || memberId.replace(/^[^A-Za-z0-9]*/, "")
  return (source[0] ?? "?").toUpperCase()
}

export function Avatar({
  memberId,
  name,
  size = "md",
  className,
}: {
  memberId: string
  name: string | null
  size?: "md" | "xl"
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        `avatar-${hue(memberId)}`,
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-on-dark shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]",
        size === "md"
          ? "size-11 text-headline"
          : "size-24 text-[3rem] tracking-[-0.04em]",
        className,
      )}
    >
      {initial(memberId, name)}
    </span>
  )
}

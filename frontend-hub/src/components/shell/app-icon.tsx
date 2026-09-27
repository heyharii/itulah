import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/// A department's icon on the phone launcher: a white glyph on the
/// department's own hue (`--app-*` in styles/index.css), in a soft square.
///
/// The hue is looked up by the tile's id; a tile with no hue of its own
/// takes System's grey rather than a guess.
export function AppIcon({
  id,
  icon: Icon,
  size = "lg",
  className,
}: {
  id: string
  icon: LucideIcon
  size?: "lg" | "sm"
  className?: string
}) {
  return (
    <span
      style={
        {
          "--tile": `var(--app-${id}, var(--app-system))`,
        } as React.CSSProperties
      }
      className={cn(
        "app-icon grid shrink-0 place-items-center text-white",
        size === "lg"
          ? "size-14 rounded-[1.0625rem]"
          : "size-8 rounded-[0.625rem]",
        className
      )}
    >
      <Icon
        className={cn(
          "stroke-[1.9]",
          size === "lg" ? "size-[1.625rem]" : "size-[1.0625rem]"
        )}
      />
    </span>
  )
}

import { useState } from "react"

import { cn } from "@/lib/utils"

/// A colourway photograph, or an honest sentence saying there is not one.
///
/// A URL is not a photograph. Much of this catalogue points at images that no
/// longer resolve, and the browser's broken-image glyph reads as a defect in
/// the app rather than a gap in the data — so a failed load falls back to the
/// same placeholder a missing URL gets, and the card stops looking broken.
export function Thumbnail({
  url,
  fallback,
  className,
  children,
}: {
  url: string | null
  /// What stands in for the photograph when there is not one. A sentence on a
  /// card, nothing at all in a 32px table cell — a grey box in a row reads as
  /// "no photograph" on its own, and the words would not fit anyway.
  fallback?: string
  className?: string
  /// Anything that rides on top of the photograph — a division badge.
  children?: React.ReactNode
}) {
  const [broken, setBroken] = useState(false)
  const shown = url !== null && url !== "" && !broken

  return (
    <div className={cn("relative overflow-hidden bg-soft-2", className)}>
      {shown ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="size-full object-cover object-[center_15%]"
        />
      ) : (
        <span className="grid size-full place-items-center px-1 text-center text-[0.875rem] text-mute">
          {fallback}
        </span>
      )}
      {children}
    </div>
  )
}

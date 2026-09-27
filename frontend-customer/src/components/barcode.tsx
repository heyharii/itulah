import { useMemo } from "react"

import { encode128 } from "@/lib/code128"
import { cn } from "@/lib/utils"

/// A scannable Code 128 barcode, drawn as crisp SVG bars.
///
/// Ten modules of quiet zone each side: scanners find the start of a symbol by
/// the white before it, and a barcode printed edge to edge is one a cheap
/// reader will refuse.
const QUIET = 10

export function Barcode({
  value,
  className,
  label,
}: {
  value: string
  className?: string
  /// What a screen reader says instead of the bars.
  label: string
}) {
  const code = useMemo(() => encode128(value), [value])
  if (code === null) return null
  const width = code.modules + QUIET * 2
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} 1`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      className={cn("block w-full", className)}
    >
      {code.bars.map((bar) => (
        <rect
          key={bar.x}
          x={bar.x + QUIET}
          y={0}
          width={bar.width}
          height={1}
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

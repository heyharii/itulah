import { useState } from "react"

import { Garment } from "@/lib/garment"
import { cn } from "@/lib/utils"

/// The photograph, fetched through the node.
///
/// Never straight at `image_url`. The centre's URL is what the row came with,
/// and a shop's whole reason for holding a resident catalogue is that the line
/// to the centre may be down — a grid pointed there draws a page of broken
/// glyphs on the day this screen matters most. `/api/v1/catalog/image` is the
/// node's own proxy: it fetches once per URL and holds it for the life of the
/// process, so one colourway costs the shop one fetch however many tablets are
/// on the floor.
///
/// `has_image` is why nothing is requested for the products that have none. A
/// missing photograph answers 404, and a 404 per unphotographed garment is both
/// a wasted round trip and a broken-image glyph that reads as a defect in the
/// app rather than a gap in the data.
export function Photograph({
  sku,
  has,
  name,
  className,
}: {
  sku: string
  has: boolean
  /// Draws a stand-in garment from the name when there is no photograph.
  name?: string
  className?: string
}) {
  /// *Which* product failed to load, not whether one did. A boolean would have
  /// to be cleared when the SKU changes, and this card is recycled by the grid
  /// as somebody scrolls — one garment with a dead URL would blank the next
  /// twenty photographs that landed in the same slot.
  const [failed, setFailed] = useState<string | null>(null)

  if ((!has || failed === sku) && name !== undefined) {
    return (
      <span
        className={cn("block size-full", className)}
        title="No photograph yet"
      >
        <Garment name={name} />
      </span>
    )
  }
  if (!has || failed === sku) {
    return (
      <span
        className={cn(
          "grid size-full place-items-center px-2 text-center text-pill text-mute",
          className,
        )}
      >
        No photograph
      </span>
    )
  }
  return (
    <img
      src={`/api/v1/catalog/image?sku=${encodeURIComponent(sku)}`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(sku)}
      className={cn("size-full object-cover object-[center_15%]", className)}
    />
  )
}

/// The stamp on a garment nothing is left of — a rubber stamp's double ring,
/// set at a tilt so it reads as marked on, not printed in. `large` sits on a
/// tile's picture; `small` in a table's stock cell.
export function SoldOutStamp({ size = "large" }: { size?: "large" | "small" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[0.3125rem] border-2 border-current leading-none font-bold tracking-[0.1em] whitespace-nowrap text-bad-fg uppercase select-none",
        "shadow-[0_0_0_2px_var(--canvas),0_0_0_3.5px_currentColor]",
        size === "large"
          ? "-rotate-[9deg] px-2.5 py-1.5 text-[1rem]"
          : "-rotate-[5deg] px-1.5 py-1 text-[0.875rem]",
      )}
    >
      Sold out
    </span>
  )
}

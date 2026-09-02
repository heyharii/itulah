import { useState } from "react"

import { count } from "@/lib/format"
import { cn } from "@/lib/utils"

/// The pieces the articles screens draw more than once.
///
/// The list, the colour master and the colour picker all draw the same swatch,
/// and three hand-drawn dots is how one of them ends up 10px while the others
/// are 8 — a difference nobody files a bug about and everybody sees.
///
/// The facet column used to live here too. It is now `components/ui/facets`,
/// shared with Sourcing: two screens browsing two catalogues had two copies of
/// one column, and they had already drifted.

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/// The colour itself, as a dot.
///
/// `hex_code` is optional in the master on purpose: a colour can be named and
/// used long before anybody decides which pixel value stands for it. So a
/// missing hex draws an empty ring rather than a grey dot — a grey dot is a
/// claim that the colour is grey, and it would be wrong on exactly the rows
/// where somebody still has to go and set the value.
///
/// The ring is always drawn. Half this vocabulary is white, off-white and
/// cream, and a white dot on a white card is nothing at all.
export function ColourSwatch({
  hex,
  label,
  className,
}: {
  hex: string | null
  /// Named for the screen reader and the tooltip: the dot alone is unreadable
  /// to anybody who cannot see it, and unnameable to anybody who can.
  label?: string
  className?: string
}) {
  return (
    <span
      title={label}
      aria-hidden={label === undefined}
      aria-label={label}
      style={hex === null ? undefined : { backgroundColor: hex }}
      className={cn(
        "inline-block size-3 shrink-0 rounded-full ring-1 ring-hairline-strong ring-inset",
        hex === null && "bg-canvas",
        className
      )}
    />
  )
}

/// What an article comes in, at a glance: a row of dots, capped.
///
/// Ten is the permanent ceiling — the colour is one digit of an eleven-digit
/// SKU — so this never has to cope with an unbounded list. It still caps below
/// ten, because a card is a glance: six dots read as a colour range, ten read
/// as a diagram, and the row that draws all ten is a row 30px wider than every
/// other one in the table.
export function Swatches({
  colours,
  cap = 6,
  className,
}: {
  colours: readonly {
    readonly colour_code: string
    readonly label: string
    readonly hex_code: string | null
  }[]
  cap?: number
  className?: string
}) {
  if (colours.length === 0)
    return <span className="text-[0.75rem] text-mute">—</span>

  const shown = colours.slice(0, cap)
  const rest = colours.length - shown.length

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {shown.map((colour) => (
        <ColourSwatch
          key={colour.colour_code}
          hex={colour.hex_code}
          label={colour.label}
        />
      ))}
      {rest > 0 && (
        <span className="text-[0.6875rem] text-mute tabular-nums">
          +{count(rest)}
        </span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Photographs
// ---------------------------------------------------------------------------

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
        <span className="grid size-full place-items-center px-1 text-center text-[0.6875rem] text-mute">
          {fallback}
        </span>
      )}
      {children}
    </div>
  )
}

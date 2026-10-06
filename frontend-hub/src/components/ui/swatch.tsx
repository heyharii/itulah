import { count } from "@/lib/format"
import { cn } from "@/lib/utils"

/// What a garment comes in, drawn the same way wherever it is drawn.
///
/// Three screens in two modules ask this — the article list, the colour master
/// and its picker, and Sourcing's catalogue of what suppliers offer — and
/// three hand-drawn dots is how one of them ends up 10px while the others are
/// 8: a difference nobody files a bug about and everybody sees.
///
/// It lives here rather than in `screens/master/shared` for the reason the
/// facet column did before it. The moment a second module needed one, the copy
/// inside the first module stopped being that module's business.

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
  onShow,
}: {
  colours: readonly {
    readonly colour_code: string
    readonly label: string
    readonly hex_code: string | null
  }[]
  cap?: number
  className?: string
  /// Which dot the pointer rests on, by its place in `colours` — null when it
  /// leaves the row. For a card whose placeholder repaints in that colourway.
  onShow?: (at: number | null) => void
}) {
  if (colours.length === 0)
    return <span className="text-[0.875rem] text-mute">—</span>

  const shown = colours.slice(0, cap)
  const rest = colours.length - shown.length

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      onPointerLeave={onShow && (() => onShow(null))}
    >
      {shown.map((colour, at) =>
        onShow ? (
          // A 12px dot is a hard target; the padding widens it to the gap.
          <span
            key={colour.colour_code}
            className="-m-0.5 flex p-0.5"
            onPointerEnter={() => onShow(at)}
          >
            <ColourSwatch hex={colour.hex_code} label={colour.label} />
          </span>
        ) : (
          <ColourSwatch
            key={colour.colour_code}
            hex={colour.hex_code}
            label={colour.label}
          />
        )
      )}
      {rest > 0 && (
        <span className="text-[0.875rem] text-mute tabular-nums">
          +{count(rest)}
        </span>
      )}
    </span>
  )
}

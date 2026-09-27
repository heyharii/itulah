import { cn } from "@/lib/utils"

/// The record card — `fulfillment-prototype.html`'s `.reccard`, and the list
/// unit this app is mostly made of.
///
/// DESIGN.md is explicit that in the Distribution language a list is a **stack
/// of cards, not table rows**: a header strip carrying an icon tile, a mono
/// record id, a subtitle and a trailing status pill, over a white body that
/// holds a meter, a mini-table or a stop-pair.
///
/// It earns its place over `<DataTable>` wherever a row has more than one
/// thing to say — a pick round has a progress meter, a carton has a
/// destination and a position, a truck has a route. Those are two lines and a
/// bar, and squeezing them into table cells is what produces the six-column
/// list nobody can read on a handheld.
///
/// The header is a 44px touch target and it is a `<button>` when it does
/// something, so the whole strip is the tap area rather than a chevron a
/// thumb has to find.
export function RecordCard({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft",
        className
      )}
      {...props}
    />
  )
}

/// The tinted strip a record card opens with.
///
/// `id` is the record's own number and is set in mono, because that is what
/// somebody reads off a label and types into a search box. `title` is the
/// human sentence under it. `status` is the one pill.
export function RecordHead({
  tile,
  id,
  title,
  status,
  onClick,
  selected = false,
  className,
}: {
  /// A pale glyph in a white squircle. The reference uses one per record kind,
  /// which is how a stack of cards stays scannable when the ids all look alike.
  tile?: React.ReactNode
  id: React.ReactNode
  title?: React.ReactNode
  status?: React.ReactNode
  onClick?: () => void
  /// Selection is a tint, never a left bar.
  selected?: boolean
  className?: string
}) {
  const inner = (
    <>
      {tile && (
        <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-body [&_svg]:size-[0.9375rem]">
          {tile}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-id font-semibold text-ink">
          {id}
        </span>
        {title && (
          <span className="block truncate text-[0.875rem] text-mute">
            {title}
          </span>
        )}
      </span>
      {status}
    </>
  )

  const shell = cn(
    "flex min-h-tap w-full items-center gap-2.5 border-b border-hairline px-3.5 py-2 text-left",
    selected ? "bg-accent-bg" : "bg-soft",
    onClick && "transition-colors hover:bg-soft-2",
    className
  )

  return onClick ? (
    <button type="button" onClick={onClick} className={shell}>
      {inner}
    </button>
  ) : (
    <div className={shell}>{inner}</div>
  )
}

export function RecordBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-3.5 py-3", className)} {...props} />
}

/// The row of actions at the foot of a record card.
///
/// First is the one emphasised control and the rest are ghosts — the
/// screen-level "one black CTA" rule scaled down to a card, so a stack of six
/// cards does not become six competing primaries. Lives inside the card, never
/// as a loose rule across the well.
export function RecordActions({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-t border-hairline px-3.5 py-2.5",
        className
      )}
      {...props}
    />
  )
}

import { ChevronDown } from "lucide-react"
import { useState } from "react"

import { cn } from "@/lib/utils"

/// Records one under the other, with the gap a card list uses everywhere — and,
/// on a desk, optionally the same cards in a responsive grid.
///
/// `<CardList>` is only the stack; the cards are `<LeadCard>`s
/// (`lead-card.tsx`). The grid is a CONTAINER query on the list's own box, so
/// the number of columns follows the room the page leaves (a docked panel, a
/// folded sidebar) rather than the window: one column on a phone, two from
/// 40rem of list, three from 80rem.
///
/// Cards that belong under a heading go in `<CardGroup>`s: a heading row that
/// folds on a tap and sticks to the top of the page while its cards scroll
/// under it, as a phone's own grouped lists do.
export function CardList({
  grid = false,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /// Lay the cards out as a responsive grid from 40rem of list (a tablet or a
  /// desk). Left off, the cards stack in one column at every width.
  grid?: boolean
}) {
  if (!grid)
    return <div className={cn("flex flex-col gap-2.5", className)} {...props} />
  // The container is the wrapper: a box cannot query its own width, only its
  // descendants can.
  return (
    <div className="@container min-w-0">
      <div
        className={cn(
          "grid grid-cols-1 gap-2.5 @2xl:grid-cols-2 @2xl:gap-3.5 @7xl:grid-cols-3",
          className,
        )}
        {...props}
      />
    </div>
  )
}

/// A group of cards under a heading that folds.
///
/// The heading is a button: the group's name at the left, `aside` (a count, a
/// sum — "12 articles") beside it, and a chevron. It sticks to the top of the
/// page scroller (`sticky top-0`) on the page's own grey, so cards pass
/// behind it. Folding hides the cards and keeps the heading, so a collapsed
/// group is still found.
///
/// `grid` lays its cards out as `<CardList grid>` does.
export function CardGroup({
  heading,
  aside,
  defaultFolded = false,
  sticky = true,
  grid = false,
  children,
  className,
}: {
  heading: React.ReactNode
  aside?: React.ReactNode
  defaultFolded?: boolean
  /// Stick the heading to the top of the page while its cards scroll under it.
  /// Off where something else already sticks there (a table's header).
  sticky?: boolean
  grid?: boolean
  children: React.ReactNode
  className?: string
}) {
  const [folded, setFolded] = useState(defaultFolded)
  return (
    <section className={cn("not-first:mt-3", className)}>
      <button
        type="button"
        aria-expanded={!folded}
        onClick={() => setFolded((was) => !was)}
        className={cn(
          "flex w-full items-center gap-2 bg-soft-3 px-1 py-2 text-left transition-opacity active:opacity-60",
          sticky && "sticky top-0 z-10",
        )}
      >
        <span className="min-w-0 text-[1rem] font-semibold break-words text-ink">
          {heading}
        </span>
        {aside !== undefined && (
          <span className="shrink-0 text-[0.9375rem] text-mute tabular-nums">
            {aside}
          </span>
        )}
        <span className="flex-1" />
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-line-ico transition-[rotate] duration-200 ease-(--ease-out) motion-reduce:transition-none",
            folded && "-rotate-90",
          )}
        />
      </button>
      {!folded && <CardList grid={grid}>{children}</CardList>}
    </section>
  )
}

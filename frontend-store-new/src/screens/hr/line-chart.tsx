import { useLayoutEffect, useRef } from "react"

import { Pill } from "@/components/ui/pill"
import { initials, type Line } from "@/lib/line"
import { cn } from "@/lib/utils"

/// The shop's line of report as a tree of boxes, top-down — the prototype's
/// *Staff › Chart* (`store-menu-prototype.html`, `orgNode`).
///
/// A card is an initials avatar, the full name and the position; pressing one
/// opens the person's sheet, where the boss is changed. There is no dragging: a
/// card is moved by asking, in the sheet's picker, the same on a desk and on a
/// phone.
///
/// # Shape
///
///  - **Top cards** are the people whose boss is not on this shop's books.
///    Nothing is drawn above them.
///  - **A manager whose reports lead nobody** stacks them in a column under the
///    card, so a shop of a dozen stays about four cards wide. Anyone who leads
///    somebody fans out in a row with elbow connectors instead.
///  - **The tree scrolls inside its own box** when it is wider than the page —
///    on a phone, mostly — and never moves the page.
///
/// The connectors are drawn per card from where the card stands among its
/// siblings (first, last, only), rather than by sibling selectors, so a branch
/// of one is as unbroken as a branch of five.

/// The connector's colour: the hairline one step darker than a card's border.
const WIRE = "border-hairline-2"
/// One level of the tree: the height of a drop between a card and the next.
const DROP = "h-7"

/// The round initials. `text` stands in for a name that has none to take
/// initials from — "HO".
export function Avatar({ name, text }: { name: string; text?: string }) {
  return (
    <span
      aria-hidden
      className="grid size-[2.125rem] shrink-0 place-items-center rounded-full bg-soft-2 text-[0.9375rem] font-semibold text-ink"
    >
      {text ?? initials(name)}
    </span>
  )
}

export function LineChart({
  line,
  onOpen,
}: {
  line: Line
  onOpen: (id: string) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  // A tree wider than its box opens on its middle, where the top card is —
  // not on the left edge, where only a branch of it is.
  useLayoutEffect(() => {
    const el = box.current
    if (el !== null) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
  }, [])
  return (
    <div ref={box} className="max-w-full overflow-x-auto pt-2 pb-6">
      {/* As wide as the tree and never narrower than the box, so a tree wider
          than the box scrolls from its left edge instead of being cut off. */}
      <ul className="flex w-max min-w-full items-start justify-center gap-6">
        {line.roots.map((id) => (
          <Branch key={id} line={line} id={id} place="top" onOpen={onOpen} />
        ))}
      </ul>
    </div>
  )
}

/// Where a card stands among the cards beside it.
type Place = "top" | { readonly first: boolean; readonly last: boolean }

function Branch({
  line,
  id,
  place,
  onOpen,
}: {
  line: Line
  id: string
  place: Place
  onOpen: (id: string) => void
}) {
  const kids = line.reports(id)
  return (
    <li
      className={cn(
        "relative flex flex-col items-center px-2",
        place === "top" ? "pt-0" : "pt-7",
      )}
    >
      {place !== "top" && <Elbow first={place.first} last={place.last} />}
      <Card line={line} id={id} onOpen={onOpen} />
      {kids.length > 0 &&
        (line.stacked(id) ? (
          <Stack line={line} ids={kids} onOpen={onOpen} />
        ) : (
          <ul
            className={cn(
              "relative flex justify-center pt-7",
              // The stub from the card down to the bar the children hang from.
              "before:absolute before:top-0 before:left-1/2 before:h-7 before:border-l-[1.5px] before:border-hairline-2 before:content-['']",
            )}
          >
            {kids.map((kid, index) => (
              <Branch
                key={kid}
                line={line}
                id={kid}
                place={{ first: index === 0, last: index === kids.length - 1 }}
                onOpen={onOpen}
              />
            ))}
          </ul>
        ))}
    </li>
  )
}

/// The elbow over a card: the bar its siblings hang from, and the drop to the
/// card's top. One card alone has the drop and no bar; the first has the bar
/// only to its right, the last only to its left, so the bar begins and ends at
/// a card's centre with a rounded corner.
function Elbow({ first, last }: { first: boolean; last: boolean }) {
  if (first && last) {
    return (
      <span
        aria-hidden
        className={cn("absolute top-0 left-1/2 border-l-[1.5px]", DROP, WIRE)}
      />
    )
  }
  return (
    <>
      {!first && (
        <span
          aria-hidden
          className={cn(
            "absolute top-0 right-1/2 w-1/2 border-t-[1.5px]",
            DROP,
            WIRE,
            last && "rounded-tr-[0.625rem] border-r-[1.5px]",
          )}
        />
      )}
      {!last && (
        <span
          aria-hidden
          className={cn(
            "absolute top-0 left-1/2 w-1/2 border-t-[1.5px] border-l-[1.5px]",
            DROP,
            WIRE,
            first && "rounded-tl-[0.625rem]",
          )}
        />
      )}
    </>
  )
}

/// A manager's reports as a column under their card, with a spine down the
/// left and a short tick into each — for the people who lead nobody.
function Stack({
  line,
  ids,
  onOpen,
}: {
  line: Line
  ids: readonly string[]
  onOpen: (id: string) => void
}) {
  return (
    <div className="mt-5 flex flex-col gap-2 pl-[1.375rem]">
      {ids.map((id, index) => (
        <div key={id} className="relative">
          {/* The spine reaches up to the card above (20px) or the card before
              (the 8px gap), and stops at the middle of the last card. */}
          <span
            aria-hidden
            className={cn(
              "absolute -left-3 border-l-[1.5px]",
              WIRE,
              index === 0 ? "-top-5" : "-top-2",
              index === ids.length - 1 ? "bottom-1/2" : "bottom-0",
            )}
          />
          <span
            aria-hidden
            className={cn(
              "absolute top-1/2 -left-3 w-3 border-t-[1.5px]",
              WIRE,
            )}
          />
          <Card line={line} id={id} onOpen={onOpen} narrow />
        </div>
      ))}
    </div>
  )
}

function Card({
  line,
  id,
  onOpen,
  narrow = false,
}: {
  line: Line
  id: string
  onOpen: (id: string) => void
  narrow?: boolean
}) {
  const one = line.member(id)
  const waiting = line.waiting(id)
  if (one === undefined) return null
  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      className={cn(
        "flex items-center gap-2.5 rounded-xl border border-hairline bg-canvas px-3 py-2.5 text-left shadow-soft",
        "transition-[box-shadow,scale] duration-(--t-hover) ease-(--ease-out) active:scale-[0.98]",
        "hover:shadow-[0_0_0_1.5px_var(--accent),0_4px_12px_rgb(16_24_40/8%)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        narrow ? "w-[13.25rem]" : "w-[14.5rem]",
      )}
    >
      <Avatar name={one.name} />
      <span className="flex min-w-0 flex-col items-start leading-[1.3]">
        <span className="max-w-full truncate text-cell font-semibold text-ink">
          {one.name}
        </span>
        <span className="max-w-full truncate text-meta text-body">
          {one.role}
        </span>
        {waiting !== undefined && (
          <Pill tone="warn" className="mt-1.5">
            Waiting for HO
          </Pill>
        )}
      </span>
    </button>
  )
}

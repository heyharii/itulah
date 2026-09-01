import { Checkbox } from "@/components/ui/checkbox"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import { Plus } from "lucide-react"
import { useEffect, useRef } from "react"
import type { Vocabulary } from "@/lib/vocabulary"
import { Tag, Thumb } from "./columns"
import { UNCLASSIFIED, type SourcingRow } from "./rows"

/// The same rows as the table, looked at rather than compared.
///
/// Clothing is bought by eye first: a buyer scanning for a shape or a colour is
/// not reading a price column. This view exists for that pass and deliberately
/// shows less — photo, name, supplier, price — with the rest one click away in
/// the item itself.
/// Watches the end of the list and asks for the next page before it is
/// reached. An observer rather than a scroll handler: a scroll handler fires
/// on every pixel and has to be told which element scrolls, while this one
/// fires when the sentinel is actually about to be seen — including when the
/// window is resized or the grid reflows into fewer columns, which a scroll
/// position alone would miss.
function useReachedEnd(onReachEnd?: () => void) {
  const sentinel = useRef<HTMLDivElement | null>(null)
  // Held in a ref, not in the dependency list. The caller passes a fresh arrow
  // every render, so depending on it tore the observer down and rebuilt it on
  // each one — and an IntersectionObserver reports asynchronously, so a
  // rebuild before that first report simply loses it. The list would then load
  // its next page only when a render happened to be quiet at the right moment,
  // which looked exactly like an intermittent bug and was one.
  const latest = useRef(onReachEnd)
  latest.current = onReachEnd

  useEffect(() => {
    const node = sentinel.current
    if (node === null) return
    // Observed against the element that actually scrolls, not the viewport.
    // The grid lives inside a scrolling panel, and an observer left on the
    // default root reports against the window — a different rectangle, which
    // never contains the bottom of a panel taller than the screen.
    let root: Element | null = node.parentElement
    while (root !== null && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) {
      root = root.parentElement
    }
    const observer = new IntersectionObserver(
      (entries) => {
        // `latest` may be undefined while a page is in flight or when there is
        // nothing left to fetch; the observer stays attached either way, so it
        // is still watching when there is something to ask for again.
        if (entries.some((entry) => entry.isIntersecting)) latest.current?.()
      },
      // A screenful of warning, so the next page is usually already there by
      // the time the buyer gets to where it goes.
      { root, rootMargin: "600px" },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return sentinel
}

export function ProductGrid({
  rows,
  held,
  isSelected,
  onSelect,
  onAdd,
  onOpen,
  vocabulary,
  onReachEnd,
  loadingMore,
}: {
  rows: readonly SourcingRow[]
  held: Map<string, number>
  vocabulary: Vocabulary
  /// Called when the buyer scrolls within a screen of the bottom. The grid
  /// asks for more rather than the page asking, because the grid is the thing
  /// that knows where the bottom is.
  onReachEnd?: () => void
  loadingMore?: boolean
  isSelected: (id: string) => boolean
  onSelect: (id: string, selected: boolean) => void
  onAdd: (id: string) => void
  onOpen: (id: string) => void
}) {
  const sentinel = useReachedEnd(onReachEnd)
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(178px,1fr))] gap-2.5 p-3.5">
      {rows.map((row) => {
        const selected = isSelected(row.id)
        const inBasket = held.get(row.id) ?? 0
        const onHold = row.status !== "ACTIVE"
        return (
          <article
            key={row.id}
            className={cn(
              "group relative flex flex-col overflow-hidden rounded-lg border transition-colors",
              selected ? "border-primary ring-primary/20 ring-2" : "hover:border-foreground/20",
            )}
          >
            {/* The whole card opens the item, the way a product tile does.
                The controls layered on top stop the click from reaching it. */}
            <button
              type="button"
              onClick={() => onOpen(row.id)}
              aria-label={`Open ${row.name}`}
              className="text-left"
            >
              <Thumb row={row} className="aspect-4/5 w-full rounded-none object-cover" />
            </button>

            <div
              className={cn(
                "absolute top-2 left-2 transition-opacity",
                selected
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
              )}
            >
              <Checkbox
                checked={selected}
                onCheckedChange={(checked) => onSelect(row.id, checked === true)}
                aria-label={`Select ${row.name}`}
                className="bg-background/90 backdrop-blur"
              />
            </div>

            <button
              type="button"
              disabled={onHold}
              aria-label={`Add one ${row.name} to the basket`}
              title={onHold ? "On hold — cannot be ordered" : "Add one to the basket"}
              onClick={() => onAdd(row.id)}
              className={cn(
                "bg-background/90 absolute top-2 right-2 grid size-7 place-items-center rounded-md backdrop-blur transition-opacity",
                "disabled:pointer-events-none disabled:opacity-30",
                inBasket > 0
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 focus:opacity-100",
              )}
            >
              <Plus className="size-4" />
            </button>

            {inBasket > 0 && (
              <span className="absolute top-2 right-11 rounded-md bg-emerald-600 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-white">
                {inBasket}
              </span>
            )}

            <div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
              <button
                type="button"
                onClick={() => onOpen(row.id)}
                className="truncate text-left text-[13px] font-medium hover:underline"
              >
                {row.name}
              </button>
              <div className="text-muted-foreground truncate text-[11.5px]">{row.supplier}</div>

              <div className="mt-auto flex items-center justify-between gap-2 pt-1.5">
                <span className="font-mono text-xs font-medium tabular-nums">
                  {money(row.price, row.currency)}
                </span>
                {/* Only the exception is worth a word. Nearly everything in the
                    catalogue is orderable, so labelling that state put the same
                    badge on every card and left the buyer nothing to notice. */}
                {onHold && (
                  <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-500">
                    On hold
                  </span>
                )}
              </div>

              {/* What it is, in the vocabulary rather than in codes. Division
                  first and set apart: it is the coarse cut a buyer navigates
                  by, and the tags qualify it rather than compete with it. */}
              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                {row.division !== UNCLASSIFIED && (
                  <span className="bg-foreground/85 text-background inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap">
                    {vocabulary.division(row.division)}
                  </span>
                )}
                {row.tags.slice(0, 2).map((tag) => (
                  <Tag key={tag}>{vocabulary.tag(tag)}</Tag>
                ))}
              </div>
            </div>
          </article>
        )
      })}
      {/* Always rendered, even with nothing left to fetch: the observer is
          attached once, and a sentinel that comes and goes would take the
          observer with it. */}
      <div
        ref={sentinel}
        className="text-muted-foreground col-span-full py-6 text-center text-[11.5px]"
      >
        {loadingMore === true ? "Loading more…" : ""}
      </div>
    </div>
  )
}

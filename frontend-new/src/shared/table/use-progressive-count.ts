/**
 * How many items of a list to actually render, grown as the user scrolls.
 *
 * The plain-CSS alternative to virtualising a card grid. A `VirtualGrid` built on the virtualiser's `lanes` tried
 * absolute positioning with measured column offsets, and it broke the moment
 * the pane got narrower than the width it had measured: five columns' worth of
 * cards kept their old x offsets and spilled straight out of a 468px container.
 * The lesson is that a virtualiser has to re-derive by hand every single thing
 * a CSS grid recomputes for free — column count, column width, row height,
 * wrapping — and each one is a chance to disagree with the layout.
 *
 * So the grid goes back to being a grid, `grid-template-columns` and all, and
 * the only thing kept from virtualisation is the part that actually mattered:
 * not putting 1,551 cards in the DOM at once. Responsiveness then costs
 * nothing, because it is the browser doing it.
 *
 * The trade against a virtualised grid is honest: the DOM grows as the user scrolls
 * rather than staying flat. For a catalogue that is browsed from the top and
 * filtered down, reaching the bottom of 1,551 cards is rare, and the cards that
 * accumulate are cheap. A ten-thousand-row *table* is the case where that trade
 * flips — which is why `VirtualRows` stays.
 */

import { useEffect, useRef, useState } from "react"

export interface ProgressiveCount {
  /** Render `items.slice(0, count)`. */
  count: number
  /**
   * Put on an element after the last item. Null once everything is shown, so
   * the sentinel unmounts rather than sitting there observing nothing.
   */
  sentinelRef: (node: HTMLElement | null) => void
  done: boolean
}

export function useProgressiveCount(
  total: number,
  step = 60
): ProgressiveCount {
  const [count, setCount] = useState(() => Math.min(step, total))
  const observerRef = useRef<IntersectionObserver | null>(null)

  /* A shorter list — a filter narrowed it, or the user switched tabs — must
   * shrink the window too, or a later, longer list starts already unrolled. */
  useEffect(() => {
    setCount((current) => Math.min(Math.max(current, step), total))
  }, [total, step])

  const done = count >= total

  const sentinelRef = (node: HTMLElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return

    /* `rootMargin` reveals the next batch before the sentinel is on screen, so
     * scrolling stays continuous instead of stuttering at each boundary. The
     * root is left as the viewport: the sentinel is inside whatever pane
     * scrolls, and intersection with the viewport is the question either way. */
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setCount((current) => Math.min(current + step, total))
        }
      },
      { rootMargin: "600px 0px" }
    )
    observer.observe(node)
    observerRef.current = observer
  }

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return { count, sentinelRef, done }
}

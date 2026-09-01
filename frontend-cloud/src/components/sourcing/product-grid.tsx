import { Checkbox } from "@/components/ui/checkbox"
import { StatusPill } from "@/components/custom/status-pill"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
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
///
/// Layout is `catalog.html` merch cards: photo, system-tag, metric grid, one
/// action pill. The cards themselves float on the well; they are not nested
/// inside another card.
function useReachedEnd(onReachEnd?: () => void) {
  const sentinel = useRef<HTMLDivElement | null>(null)
  const latest = useRef(onReachEnd)
  useEffect(() => {
    latest.current = onReachEnd
  })

  useEffect(() => {
    const node = sentinel.current
    if (node === null) return
    let root: Element | null = node.parentElement
    while (root !== null && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) {
      root = root.parentElement
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current?.()
      },
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
  onReachEnd?: () => void
  loadingMore?: boolean
  isSelected: (id: string) => boolean
  onSelect: (id: string, selected: boolean) => void
  onAdd: (id: string) => void
  onOpen: (id: string) => void
}) {
  const sentinel = useReachedEnd(onReachEnd)
  return (
    <div className="grid grid-cols-1 gap-[1.125rem] sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => {
        const selected = isSelected(row.id)
        const inBasket = held.get(row.id) ?? 0
        const onHold = row.status !== "ACTIVE"
        return (
          <article
            key={row.id}
            className={cn(
              "os-card group relative flex flex-col overflow-hidden transition-[box-shadow,transform,border-color]",
              selected
                ? "border-[var(--os-accent,#3c52f0)]"
                : "hover:-translate-y-0.5 hover:shadow-[var(--os-shadow-pop,0_8px_20px_rgba(20,20,25,.06))]",
            )}
          >
            <button
              type="button"
              onClick={() => onOpen(row.id)}
              aria-label={`Open ${row.name}`}
              className="text-left"
            >
              <div className="relative h-[9.875rem] overflow-hidden bg-[#efeeec]">
                <Thumb row={row} className="h-full w-full rounded-none object-cover" />
                {row.division !== UNCLASSIFIED && (
                  <span className="absolute top-2.5 left-2.5 inline-flex h-[1.4375rem] items-center gap-1.5 rounded-full bg-white/95 px-2.5 text-[0.6875rem] font-semibold shadow-[0_1px_3px_rgba(20,20,25,.1)] text-[var(--os-accent,#3c52f0)]">
                    <span className="size-1.5 rounded-full bg-[var(--os-accent,#3c52f0)]" />
                    {vocabulary.division(row.division)}
                  </span>
                )}
              </div>
            </button>

            <div
              className={cn(
                "absolute top-2.5 left-2.5 transition-opacity",
                selected
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
              )}
            >
              <Checkbox
                checked={selected}
                onCheckedChange={(checked) => onSelect(row.id, checked === true)}
                aria-label={`Select ${row.name}`}
                className="bg-white/90"
              />
            </div>

            <div className="flex min-w-0 flex-1 flex-col px-[0.9375rem] pt-[0.8125rem] pb-[0.875rem]">
              <button
                type="button"
                onClick={() => onOpen(row.id)}
                className="truncate text-left text-[0.875rem] font-medium text-[var(--os-ink,#1d1d1f)] hover:underline"
              >
                {row.name}
              </button>
              <div className="mt-[0.1875rem] truncate font-[var(--os-mono,ui-monospace)] text-[0.6875rem] text-[var(--os-mute,#a6a6ad)]">
                {row.code}
              </div>

              <div className="mt-[0.8125rem] grid grid-cols-2 gap-x-[0.875rem] gap-y-3 border-t border-[var(--os-hairline,#eeeef1)] pt-[0.8125rem]">
                <div>
                  <div className="text-[0.59375rem] font-semibold tracking-[0.045em] text-[var(--os-mute,#a6a6ad)] uppercase">
                    Supplier
                  </div>
                  <div className="mt-[0.1875rem] truncate text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--os-ink,#1d1d1f)]">
                    {row.supplier}
                  </div>
                </div>
                <div>
                  <div className="text-[0.59375rem] font-semibold tracking-[0.045em] text-[var(--os-mute,#a6a6ad)] uppercase">
                    Article
                  </div>
                  <div className="mt-[0.1875rem] truncate font-[var(--os-mono,ui-monospace)] text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--os-ink,#1d1d1f)]">
                    {row.article ?? "—"}
                  </div>
                </div>
              </div>

              {row.tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 pt-2">
                  {row.tags.slice(0, 2).map((tag) => (
                    <Tag key={tag}>{vocabulary.tag(tag)}</Tag>
                  ))}
                </div>
              )}

              <div className="mt-[0.8125rem] flex items-center justify-between gap-2 border-t border-[var(--os-hairline,#eeeef1)] pt-3">
                <span className="text-[1rem] font-semibold tracking-[-0.01em] tabular-nums text-[var(--os-ink,#1d1d1f)]">
                  {money(row.price, row.currency)}
                </span>
                {onHold ? (
                  <StatusPill tone="warn" dot={false}>
                    On hold
                  </StatusPill>
                ) : (
                  <button
                    type="button"
                    aria-label={`Add one ${row.name} to the basket`}
                    onClick={() => onAdd(row.id)}
                    className={cn(
                      "inline-flex h-[1.6875rem] items-center gap-1 rounded-full px-3 text-[0.75rem] font-semibold",
                      inBasket > 0
                        ? "bg-[var(--os-accent-bg,#ebedfd)] text-[var(--os-accent,#3c52f0)]"
                        : "bg-[var(--os-ink,#1d1d1f)] text-white",
                    )}
                  >
                    {inBasket > 0 ? `In basket · ${inBasket}` : "Add"}
                  </button>
                )}
              </div>
            </div>
          </article>
        )
      })}
      <div
        ref={sentinel}
        className="col-span-full py-6 text-center text-[0.71875rem] text-[var(--os-body,#74747b)]"
      >
        {loadingMore === true ? "Loading more…" : ""}
      </div>
    </div>
  )
}

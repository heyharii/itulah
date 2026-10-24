import { ChevronRight } from "lucide-react"
import { useState } from "react"

import { Input } from "@/components/ui/field"
import { count, sku } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { StockMove } from "@/screens/stock/move-stock"
import {
  figureLabel,
  sum,
  type Figure,
  type StockArticle,
} from "@/screens/stock/stock-model"
import { placeLabel } from "@/screens/stock/shared"

/// Stock as an accordion: an article is one row with the places on screen and
/// their total; open, it is its "Colour Size" rows. In a move the same rows become
/// From | Move | To, and Move is a box to type into.
///
/// The columns are one grid template on every row, so a figure stands under
/// its heading whichever row it is in.

/// By how many figures a row carries: one place alone, or two and their total.
const COLS: Readonly<Record<number, string>> = {
  1: "grid-cols-[minmax(0,1fr)_3.5rem] md:grid-cols-[minmax(0,1fr)_7rem]",
  2: "grid-cols-[minmax(0,1fr)_repeat(2,3.5rem)] md:grid-cols-[minmax(0,1fr)_repeat(2,7rem)]",
  3: "grid-cols-[minmax(0,1fr)_repeat(3,3.5rem)] md:grid-cols-[minmax(0,1fr)_repeat(3,7rem)]",
  4: "grid-cols-[minmax(0,1fr)_repeat(4,3.5rem)] md:grid-cols-[minmax(0,1fr)_repeat(4,7rem)]",
}
const MOVE_COLS = "grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_3.5rem] md:grid-cols-[minmax(0,1fr)_7rem_9rem_7rem]"

/// A place's colour: the sales floor is the shop's blue, the store room a
/// neutral, the reject an amber — the same dot in the KPI, the heading, the
/// route and the panel.
export function PoolDot({ pool }: { pool: Figure }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        pool === "floor" && "bg-accent",
        pool === "warehouse" && "bg-line-ico",
        (pool === "reject" || pool === "over" || pool === "ho") && "bg-warn",
      )}
    />
  )
}

function Figure({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        "text-right tabular-nums",
        value === 0 ? "text-faint" : "text-ink",
        className,
      )}
    >
      {count(value)}
    </span>
  )
}

export function StockTable({
  articles,
  pools,
  move,
  forceOpen,
}: {
  articles: readonly StockArticle[]
  /// The places (or pockets) drawn as columns; with more than one, a Total
  /// follows.
  pools: readonly Figure[]
  move: StockMove
  /// A search opens every article it finds.
  forceOpen: boolean
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const everyOpen =
    articles.length > 0 && articles.every((one) => forceOpen || open.has(one.key))
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })

  // Enter in a box goes to the next one down.
  const next = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    const boxes = [
      ...event.currentTarget
        .closest("[data-stock-table]")!
        .querySelectorAll<HTMLInputElement>("input[data-qty]"),
    ]
    boxes[boxes.indexOf(event.currentTarget) + 1]?.focus()
  }

  const { moving, from, to } = move
  const totalled = pools.length > 1
  const cols = COLS[pools.length + (totalled ? 1 : 0)]
  return (
    <div data-stock-table className="rounded-card border border-hairline bg-canvas">
      <div
        className={cn(
          "sticky top-0 z-10 grid items-center rounded-t-card border-b border-hairline bg-canvas/95 text-[0.9375rem] font-medium text-body backdrop-blur",
          moving ? MOVE_COLS : cols,
        )}
      >
        <div className="flex items-center gap-3 px-3 py-3 md:px-4">
          Article
          {!forceOpen && (
            <button
              type="button"
              className="text-[0.9375rem] font-medium text-accent"
              onClick={() =>
                setOpen(
                  everyOpen ? new Set() : new Set(articles.map((one) => one.key)),
                )
              }
            >
              {everyOpen ? "Collapse all" : "Expand all"}
            </button>
          )}
        </div>
        {moving ? (
          <>
            <Heading pool={from} />
            <div className="px-1 text-center font-semibold text-accent md:px-3">
              Move
            </div>
            <Heading pool={to} accent />
          </>
        ) : (
          <>
            {pools.map((pool) => (
              <Heading key={pool} pool={pool} />
            ))}
            {totalled && <div className="px-1 text-right md:px-3">Total</div>}
          </>
        )}
      </div>

      {articles.length === 0 ? (
        <div className="px-4 py-12 text-center text-[0.9375rem] text-mute">
          No articles
        </div>
      ) : (
        articles.map((article) => {
          const shown = forceOpen || open.has(article.key)
          const pieces = article.skus.reduce(
            (total, one) => total + (move.quantities.get(one.sku) ?? 0),
            0,
          )
          return (
            <section key={article.key} className="border-b border-hairline last:border-0">
              <div
                role="button"
                tabIndex={0}
                aria-expanded={shown}
                onClick={() => toggle(article.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    toggle(article.key)
                  }
                }}
                className={cn(
                  "grid min-h-16 cursor-pointer items-center text-[0.9375rem] font-semibold transition-colors hover:bg-soft",
                  moving ? MOVE_COLS : cols,
                )}
              >
                <div className="flex min-w-0 items-center gap-2 py-2 pr-1 pl-2 md:pl-3">
                  <ChevronRight
                    className={cn(
                      "size-4 shrink-0 text-line-ico transition-transform duration-200 ease-(--ease-out)",
                      shown && "rotate-90",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{article.name}</span>
                    <span className="block truncate text-[0.875rem] font-normal text-mute">
                      <span className="font-mono">{sku(article.key)}</span>
                    </span>
                  </span>
                </div>
                {moving ? (
                  <>
                    <Figure value={sum(article.skus, from)} className="px-1 md:px-3" />
                    <span className="px-1 text-center tabular-nums text-accent md:px-3">
                      {pieces > 0 ? pieces : ""}
                    </span>
                    <Figure value={sum(article.skus, to)} className="px-1 md:px-3" />
                  </>
                ) : (
                  <>
                    {pools.map((pool) => (
                      <Figure key={pool} value={sum(article.skus, pool)} className="px-1 md:px-3" />
                    ))}
                    {totalled && (
                      <Figure
                        value={pools.reduce((total, pool) => total + sum(article.skus, pool), 0)}
                        className="px-1 md:px-3"
                      />
                    )}
                  </>
                )}
              </div>

              {shown &&
                article.skus.map((one) => {
                  const max = one[from]
                  const typed = move.quantities.get(one.sku) ?? 0
                  return (
                    <div
                      key={one.sku}
                      className={cn(
                        "grid min-h-12 items-center border-t border-hairline text-[0.9375rem] text-ink",
                        moving ? MOVE_COLS : cols,
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2 py-1 pr-1 pl-9 md:pl-12">
                        <span
                          aria-hidden
                          className="size-3 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)]"
                          style={{ background: one.paint }}
                        />
                        <span className="truncate">{one.label}</span>
                        <span className="shrink-0 font-mono text-[0.875rem] text-mute">
                          {sku(one.sku)}
                        </span>
                      </div>
                      {moving ? (
                        <>
                          <Figure value={max - typed} className="px-1 md:px-3" />
                          <div className="flex justify-center px-1">
                            <Input
                              data-qty
                              inputMode="numeric"
                              autoComplete="off"
                              placeholder="0"
                              aria-label={`${article.name} ${one.label}: move from ${placeLabel(from)} to ${placeLabel(to)}`}
                              padLabel={`${article.name} ${one.label}`}
                              disabled={max === 0}
                              value={typed > 0 ? String(typed) : ""}
                              onFocus={(event) => event.currentTarget.select()}
                              onKeyDown={next}
                              onChange={(event) => {
                                const wanted = Number.parseInt(event.target.value, 10)
                                move.set(
                                  one.sku,
                                  Number.isNaN(wanted) ? 0 : Math.min(wanted, max),
                                )
                              }}
                              className={cn(
                                "h-9 w-16 px-1 text-center font-semibold tabular-nums",
                                typed > 0 && "border-accent bg-accent-bg text-accent",
                              )}
                            />
                          </div>
                          <Figure value={one[to] + typed} className="px-1 md:px-3" />
                        </>
                      ) : (
                        <>
                          {pools.map((pool) => (
                            <Figure key={pool} value={one[pool]} className="px-1 md:px-3" />
                          ))}
                          {totalled && (
                            <Figure
                              value={pools.reduce((total, pool) => total + one[pool], 0)}
                              className="px-1 md:px-3"
                            />
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
            </section>
          )
        })
      )}
    </div>
  )
}

function Heading({ pool, accent }: { pool: Figure; accent?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-1.5 px-1 text-right leading-tight md:px-3",
        accent && "font-semibold text-accent",
      )}
    >
      <span className="max-md:hidden">
        <PoolDot pool={pool} />
      </span>
      {figureLabel(pool)}
    </div>
  )
}

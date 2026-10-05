import { useVirtualizer } from "@tanstack/react-virtual"
import { Search, X } from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Panel } from "@/components/ui/dialog"
import { PageHeader } from "@/components/ui/page-header"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/states"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  COLS,
  useArticles,
  type ArticleRow,
  type Col,
} from "@/screens/operations/articles/data"
import { History } from "@/screens/operations/articles/history"
import { TwoLines } from "@/screens/operations/two-lines"

/// **Stock by article** (stock-options-prototype.html, D · Band, with a search
/// box in front of it).
///
/// The box is the screen: it finds an article by name, SKU, article code or
/// order number. Under it the pool totals of what was found stand as the
/// table's header band; pressing one keeps the articles in that pool and sorts
/// by it. A row opens where the article is.
///
/// Reads the CLOUD, not the DC node, so it is registered outside
/// `OperationsGate` in `screens/operations/index.tsx`.

/// 96px band, 72px rows (docs/design-rules-goods-flow.md asks for 64 and more
/// for a two-line cell), 56px totals.
const BAND = 96
const ROW = 72
const TOTALS = 56

/// The article, then eleven figures.
const GRID = "grid grid-cols-[minmax(15rem,2fr)_repeat(11,minmax(6.5rem,1fr))]"

const none = <span className="text-faint">—</span>

function Figure({ col, pcs }: { col: Col; pcs: number }) {
  if (pcs <= 0) return none
  return (
    <span
      className={cn(
        "tabular-nums",
        col === "total" && "font-semibold text-ink",
        col === "missing" && "text-warn-fg"
      )}
    >
      {count(pcs)}
    </span>
  )
}

export function StockByArticle() {
  const data = useArticles()
  const [text, setText] = useState("")
  const [col, setCol] = useState<Col | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const typed = useDeferredValue(text).trim().toLowerCase()
  const found = useMemo(() => {
    const tokens = typed.split(/\s+/).filter(Boolean)
    return tokens.length === 0
      ? data.rows
      : data.rows.filter((r) => tokens.every((t) => r.haystack.includes(t)))
  }, [data.rows, typed])

  const sums = useMemo(() => sumOf(found), [found])

  const shown = useMemo(
    () =>
      col === null
        ? found
        : found
            .filter((r) => r.v[col] > 0)
            .sort(
              (a, b) => b.v[col] - a.v[col] || a.name.localeCompare(b.name)
            ),
    [found, col]
  )
  const shownSums = useMemo(
    () => (col === null ? null : sumOf(shown)),
    [shown, col]
  )

  const head = BAND + (shownSums ? TOTALS : 0)
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 12,
    scrollMargin: head,
  })

  // A new result starts at its top.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [typed, col])

  const opened = open === null ? null : data.rows.find((r) => r.key === open)

  return (
    <PageContent fill>
      <PageHeader title="Stock by Article" />

      <label className="relative mb-6 block">
        <span className="sr-only">Search</span>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-mute"
        />
        <input
          type="search"
          value={text}
          autoFocus
          onChange={(event) => setText(event.target.value)}
          className="h-16 w-full rounded-card border border-hairline-2 bg-canvas pr-14 pl-14 text-[1.25rem] text-ink shadow-soft transition-colors outline-none placeholder:text-mute focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {text !== "" && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Clear"
            className="absolute top-1/2 right-3 -translate-y-1/2"
            onClick={() => setText("")}
          >
            <X />
          </Button>
        )}
      </label>

      {data.failed && !data.pending && (
        <Banner tone="warn" className="mb-4">
          Some figures could not be read.
        </Banner>
      )}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {data.fleetError !== null ? (
          <ErrorState error={data.fleetError} onRetry={data.retry} />
        ) : data.pending ? (
          <LoadingState />
        ) : (
          <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
            <div role="table" className="min-w-[86.5rem]">
              <div role="rowgroup" className="sticky top-0 z-20 bg-canvas">
                <div
                  role="row"
                  className={cn(GRID, "border-b border-hairline-2")}
                >
                  <div
                    role="columnheader"
                    className="sticky left-0 z-10 flex h-24 flex-col justify-center bg-canvas px-4"
                  >
                    <b className="text-[1.375rem] leading-[1.3] font-semibold text-ink tabular-nums">
                      {count(found.length)}
                    </b>
                    <span className="mt-0.5 font-medium text-body">
                      Articles
                    </span>
                  </div>
                  {COLS.map((c) => {
                    const on = col === c.id
                    return (
                      <div
                        key={c.id}
                        role="columnheader"
                        aria-sort={on ? "descending" : undefined}
                        className="h-24"
                      >
                        <button
                          type="button"
                          aria-pressed={on}
                          disabled={sums[c.id] === 0 && !on}
                          onClick={() => setCol(on ? null : c.id)}
                          className={cn(
                            "flex h-full w-full flex-col items-end justify-center px-4 text-right transition-colors",
                            on
                              ? "bg-accent-bg text-accent shadow-[inset_0_-2px_0_var(--accent)]"
                              : "enabled:hover:bg-soft"
                          )}
                        >
                          <b
                            className={cn(
                              "text-[1.375rem] leading-[1.3] font-semibold tabular-nums",
                              on
                                ? "text-accent"
                                : c.id === "missing" && sums[c.id] > 0
                                  ? "text-warn-fg"
                                  : "text-ink"
                            )}
                          >
                            {count(sums[c.id])}
                          </b>
                          <span
                            className={cn(
                              "mt-0.5 font-medium",
                              on ? "text-accent" : "text-body"
                            )}
                          >
                            {c.label}
                          </span>
                        </button>
                      </div>
                    )
                  })}
                </div>
                {shownSums && (
                  <div
                    role="row"
                    className={cn(
                      GRID,
                      "h-14 items-center bg-soft font-medium"
                    )}
                  >
                    <div
                      role="cell"
                      className="sticky left-0 z-10 flex h-full items-center bg-soft px-4 text-ink"
                    >
                      Total
                    </div>
                    {COLS.map((c) => (
                      <div
                        key={c.id}
                        role="cell"
                        className={cn(
                          "px-4 text-right",
                          col === c.id && "text-accent"
                        )}
                      >
                        <Figure col={c.id} pcs={shownSums[c.id]} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {shown.length === 0 ? (
                <EmptyState>Nothing found.</EmptyState>
              ) : (
                <div
                  role="rowgroup"
                  className="relative"
                  style={{ height: virtualizer.getTotalSize() }}
                >
                  {virtualizer.getVirtualItems().map((item) => {
                    const row = shown[item.index]!
                    return (
                      <div
                        key={row.key}
                        role="row"
                        tabIndex={0}
                        onClick={() => setOpen(row.key)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            setOpen(row.key)
                          }
                        }}
                        className={cn(
                          GRID,
                          "group absolute top-0 left-0 w-full cursor-pointer items-center border-b border-hairline transition-colors outline-none hover:bg-soft focus-visible:bg-soft"
                        )}
                        style={{
                          height: ROW,
                          transform: `translateY(${item.start - head}px)`,
                        }}
                      >
                        <div
                          role="cell"
                          className="sticky left-0 z-10 flex h-full min-w-0 items-center bg-canvas px-4 group-hover:bg-soft group-focus-visible:bg-soft"
                        >
                          <TwoLines top={row.name} bottom={row.second} mono />
                        </div>
                        {COLS.map((c) => (
                          <div
                            key={c.id}
                            role="cell"
                            className={cn(
                              "flex h-full items-center justify-end px-4",
                              col === c.id && "bg-accent-bg"
                            )}
                          >
                            <Figure col={c.id} pcs={row.v[c.id]} />
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <Where row={opened ?? null} onClose={() => setOpen(null)} />
    </PageContent>
  )
}

function sumOf(rows: readonly ArticleRow[]): Record<Col, number> {
  const out = Object.fromEntries(COLS.map((c) => [c.id, 0])) as Record<
    Col,
    number
  >
  for (const row of rows) for (const c of COLS) out[c.id] += row.v[c.id]
  return out
}

/// Where one article is, and what has happened to it: a one-row strip of
/// stage and pieces, then its History. The state is here and not in the URL
/// because `lib/sheets.ts` is shared and has no key for it.
function Where({
  row,
  onClose,
}: {
  row: ArticleRow | null
  onClose: () => void
}) {
  // Keep the last article on screen while the panel fades out.
  const [last, setLast] = useState<ArticleRow | null>(row)
  if (row !== null && row !== last) setLast(row)
  const shown = row ?? last

  const now = shown
    ? COLS.filter((c) => c.id !== "total" && shown.v[c.id] > 0)
    : []

  return (
    <Panel
      open={row !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={shown?.name ?? ""}
      sub={shown?.second}
      wide
    >
      {shown && (
        <>
          {now.length === 0 ? (
            <EmptyState>Nothing here.</EmptyState>
          ) : (
            <div className="flex flex-wrap gap-x-8 gap-y-3 rounded-card bg-soft px-5 py-4">
              {now.map((c) => (
                <div key={c.id} className="flex items-baseline gap-2">
                  <span className="text-body">{c.label}</span>
                  <b
                    className={cn(
                      "font-semibold tabular-nums",
                      c.id === "missing" ? "text-warn-fg" : "text-ink"
                    )}
                  >
                    {count(shown.v[c.id])}
                  </b>
                </div>
              ))}
            </div>
          )}
          {row !== null && <History key={row.key} row={row} />}
        </>
      )}
    </Panel>
  )
}

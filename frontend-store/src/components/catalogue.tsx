/* eslint-disable react-refresh/only-export-components -- the wire shape and its
   cache key belong beside the one component that reads them. */
import { Input } from "@/components/ui/input"
import { node } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { CatalogRow } from "@itulah/contract"
import { money, units } from "@itulah/contract/money"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Search } from "lucide-react"
import { useDeferredValue, useMemo, useRef, useState } from "react"

/// What this shop may sell, at the price this shop's till will charge.
///
/// The catalogue as the till holds it, not as head office holds it — this app
/// is served by the shop's own node, so the number here is read from the same
/// resident price book the counter reads, by the same evaluator. That is the
/// whole reason a shelf-price screen is worth having: an assistant asked "how
/// much is this" can answer without walking to a till, and be right.
///
/// It works with the shop offline. The price book is resident; nothing on this
/// screen asks head office anything.
export interface Catalogue {
  readonly site_id: string
  readonly channel: string
  readonly as_of: string
  /// False when no price book has ever reached this shop. Not the same as an
  /// empty catalogue, and the difference is what somebody needs to be told.
  readonly has_price_book: boolean
  readonly publication_version: number | null
  readonly currency: string
  readonly item_count: number
  readonly limit: number
  readonly next_cursor: string | null
  readonly items: readonly CatalogRow[]
}

export const catalogueKey = (needle = "") => ["store", "catalogue", needle] as const

/// Look a price up.
export function CatalogueView() {
  const [search, setSearch] = useState("")
  // The list is thousands of rows and the box is typed into fast. Deferring the
  // filter keeps every keystroke landing immediately while the rows catch up,
  // rather than making somebody wait mid-word.
  const needle = useDeferredValue(search).trim().toLowerCase()

  const catalogue = useInfiniteQuery({
    queryKey: catalogueKey(needle),
    queryFn: ({ pageParam, signal }) => {
      const parameters = new URLSearchParams({ limit: "100" })
      if (needle !== "") parameters.set("q", needle)
      if (pageParam !== undefined) parameters.set("cursor", pageParam)
      return node.get<Catalogue>(`/api/v1/store/catalog?${parameters.toString()}`, { signal })
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    // A price book arrives on the sync lane while the shop is open. A screen
    // left on the counter should catch up without anybody reloading it.
    refetchInterval: 60_000,
  })

  const pages = catalogue.data?.pages ?? []
  const all = useMemo(() => pages.flatMap((page) => page.items), [pages])
  const summary = pages[0]
  const rows = all

  const cleared = rows.filter(isCleared).length

  // The whole range is scrollable, not the first screenful of it. A shop's
  // catalogue runs to thousands of rows and a phone will try to draw every one
  // of them, so only the rows in front of somebody are in the document —
  // which is a different thing from only keeping the first sixty, because the
  // rest are still reachable by scrolling.
  const scroller = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    // Measured for real once drawn: a markdown row carries a struck-through
    // price above the live one and is taller than the rest.
    estimateSize: () => 57,
    overscan: 8,
  })

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 pb-3">
        <label className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Scan a barcode, or type a name or code…"
            aria-label="Find a product"
            // Focused on arrival: this screen exists to be typed into, and a
            // scanner sends its keystrokes wherever the caret happens to be.
            autoFocus
            className="h-11 pl-9 text-base"
          />
        </label>
        <p className="text-muted-foreground text-xs">
          {catalogue.isPending
            ? "loading…"
            : `${units(rows.length)} of ${units(all.length)}` +
              (cleared > 0 ? ` · ${units(cleared)} on markdown` : "")}
        </p>
      </div>

      {summary !== undefined && !summary.has_price_book && (
        /* No book has ever arrived. Said plainly, because the till is in the
           same position: it cannot price anything either, and somebody needs to
           know that before a customer is standing there. */
        <p className="border-destructive/40 bg-destructive/5 text-destructive mb-3 rounded-md border px-3 py-2 text-sm">
          This shop has never received a price book. Nothing here can be sold
          until one arrives.
        </p>
      )}

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-auto rounded-md border"
      >
        {catalogue.isPending ? (
          <Empty>Reading the shop's price book…</Empty>
        ) : catalogue.isError ? (
          <Empty tone="problem">The catalogue could not be read from this node.</Empty>
        ) : rows.length === 0 ? (
          <Empty>
            {all.length === 0
              ? "The catalogue is empty."
              : `Nothing matches “${search.trim()}”.`}
          </Empty>
        ) : (
          <>
            <ul className="relative" style={{ height: virtual.getTotalSize() }}>
              {virtual.getVirtualItems().map((item) => {
                const row = rows[item.index]
                return row === undefined ? null : (
                  <Row
                    key={row.sku_code}
                    row={row}
                    index={item.index}
                    measure={virtual.measureElement}
                    offset={item.start}
                  />
                )
              })}
            </ul>
            {catalogue.hasNextPage && (
              <div className="border-t p-2 text-center">
                <button
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-xs"
                  disabled={catalogue.isFetchingNextPage}
                  onClick={() => void catalogue.fetchNextPage()}
                >
                  {catalogue.isFetchingNextPage ? "Loading…" : "Load 100 more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {summary?.publication_version != null && (
        <p className="text-muted-foreground pt-2 text-[11px]">
          Price book v{summary.publication_version} · {summary.site_id} ·
          prices are read from this shop's own copy, so they hold when the line is
          down.
        </p>
      )}
    </section>
  )
}

function isCleared(row: CatalogRow): boolean {
  return row.unit_price_minor < row.base_unit_price_minor
}

function Row({
  row,
  index,
  measure,
  offset,
}: {
  row: CatalogRow
  index: number
  /// Reports this row's real height back, so a taller markdown row does not
  /// push everything below it out of place.
  measure: (node: Element | null) => void
  offset: number
}) {
  const cleared = isCleared(row)
  return (
    <li
      ref={measure}
      data-index={index}
      style={{ transform: `translateY(${offset}px)` }}
      className={cn(
        "absolute top-0 left-0 flex w-full items-center gap-3 border-b px-3 py-2.5",
        cleared && "bg-amber-50/60 dark:bg-amber-950/10",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{row.name}</span>
        <span className="text-muted-foreground font-mono text-[11px]">
          {row.sku_code}
          {row.barcode !== null && ` · ${row.barcode}`}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        {cleared && (
          <span className="text-muted-foreground font-mono text-[11px] line-through">
            {money(row.base_unit_price_minor, row.currency)}
          </span>
        )}
        <span
          className={cn(
            "font-mono text-base tabular-nums",
            cleared && "font-medium text-amber-700 dark:text-amber-500",
          )}
        >
          {money(row.unit_price_minor, row.currency)}
        </span>
        {/* Where the price came from. Only said when it is not the ordinary
            answer: a row that reads "company price" on every line is noise, and
            a markdown or a price written for this shop is not. */}
        {row.price_source !== "COMPANY_PRICE" && (
          <span className="text-muted-foreground text-[10px]">
            {describeSource(row.price_source)}
          </span>
        )}
      </div>
    </li>
  )
}

/// The words somebody on the shop floor would use.
function describeSource(source: string): string {
  switch (source) {
    case "MARKDOWN":
      return "markdown"
    case "SITE_PRICE":
      return "this shop's price"
    case "SITE_GROUP_PRICE":
      return "group price"
    case "TIER_PRICE":
      return "member price"
    case "MANUAL_OVERRIDE":
      return "typed in"
    default:
      return source.toLowerCase().replace(/_/g, " ")
  }
}

function Empty({
  children,
  tone = "quiet",
}: {
  children: React.ReactNode
  tone?: "quiet" | "problem"
}) {
  return (
    <p
      className={cn(
        "px-3 py-10 text-center text-sm",
        tone === "problem" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  )
}

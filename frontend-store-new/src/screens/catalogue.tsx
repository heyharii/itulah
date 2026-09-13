import { useQuery } from "@tanstack/react-query"
import { Search, Sparkles, X } from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { Screen } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, label } from "@/lib/format"
import { useGo } from "@/lib/go"
import { useParam } from "@/lib/params"
import {
  catalogueKey,
  fetchCatalogue,
  offersKey,
  fetchOffers,
} from "@/lib/queries"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import type { CatalogRow } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// The range, as somebody standing in front of it sees it.
///
/// The shop already had a price *list* — `/sell` searches the resident book
/// when a scan fails, and answers with rows of text. This is the other half of
/// the same data and a different question: the list answers "how much is this
/// one", and a person asking it is holding the garment. This answers "what do
/// we have", and a person asking that is not holding anything yet. That is why
/// it is a grid of photographs and not a table — the console's Sourcing screen
/// is shaped this way for the same reason, and the reasoning travels: somebody
/// browsing arrives without knowing what they want, and a wall of codes asks
/// them to read twelve lines before anything catches their eye.
///
/// **Everything on this screen is decided in the browser.** One request fetches
/// the whole resident book — which `lib/queries.ts` already does for the till —
/// and the search, the division filter, the counts and the sort all run over
/// what is in hand. On the console that would be wrong and the server counts
/// its own facets; here it is the entire point. A shop's catalogue is thousands
/// of rows, not millions, it is already cached for the counter, and a screen
/// that asked the node for each keystroke would stop working in exactly the
/// hour the shop needs it: the line down, the customer still standing there.
export function Catalogue() {
  const go = useGo()
  const search = useParam("q")
  const division = useParam("division")

  /// What is being typed, held locally and pushed to the URL as it settles.
  ///
  /// Two boxes for one value, and the split is deliberate: writing the URL on
  /// every keystroke makes a history nobody can walk back through, and reading
  /// it back on every keystroke makes the caret fight the router. So the input
  /// is local and immediate, and the address bar catches up — which is what
  /// makes a filtered catalogue survive the tablet going to sleep.
  const [typed, setTyped] = useState(search.value ?? "")
  useEffect(() => {
    const timer = setTimeout(
      () => search.set(typed.trim() === "" ? undefined : typed.trim()),
      350,
    )
    return () => clearTimeout(timer)
    // `search.set` is a fresh closure each render; depending on it would
    // reschedule the timer forever and the value would never land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed])

  // The list is long and the box is typed into fast. Deferring the filter keeps
  // every keystroke landing immediately while the grid catches up.
  const needle = useDeferredValue(typed).trim().toLowerCase()

  const catalogue = useQuery({
    queryKey: catalogueKey(),
    queryFn: ({ signal }) => fetchCatalogue(signal),
    /// A minute, and it overrides the app's five-minute staleness.
    ///
    /// The rest of the till is right to be lazy: a basket is priced from the
    /// book in hand and a five-minute-old book prices it identically. A screen
    /// **showing a price to a customer** is the one place that is not true. A
    /// publication lands on the sync lane while the shop is open, and a tablet
    /// left on a rail quoting yesterday's number is the exact failure this
    /// whole surface exists to prevent — the app this replaces polled the same
    /// screen at the same interval for the same reason. It only runs while
    /// somebody is looking at it.
    refetchInterval: 60_000,
  })

  /// Only to put a number on the promotions strip. A failure here must not
  /// take the catalogue down with it — the prices are the point, and an offers
  /// endpoint an older node does not serve should cost the strip and nothing
  /// else.
  const offers = useQuery({
    queryKey: offersKey(),
    queryFn: ({ signal }) => fetchOffers(signal),
  })
  const running = offers.data?.running.length ?? 0
  const soon = offers.data?.upcoming.length ?? 0

  const book = catalogue.data
  const rows = useMemo(() => book?.items ?? [], [book])

  /// How much of the range sits in each division, counted over everything the
  /// *words* match and not over the current selection.
  ///
  /// The distinction is the one the console's facets make and it matters as
  /// much here: if choosing Menswear made every other division read zero, the
  /// row of chips would stop being a map of the shop and become a description
  /// of the filter already applied. A shop assistant uses it to find out what
  /// else is there.
  const divisions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (!matchesWords(row, needle)) continue
      const code = row.division_code
      if (code === null || code === "") continue
      counts.set(code, (counts.get(code) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) =>
      a[1] === b[1] ? a[0].localeCompare(b[0]) : b[1] - a[1],
    )
  }, [rows, needle])

  const [order, setOrder] = useState<Order>("range")

  const shown = useMemo(() => {
    const picked = rows.filter(
      (row) =>
        matchesWords(row, needle) &&
        (division.value === undefined || row.division_code === division.value),
    )
    return sorted(picked, order)
  }, [rows, needle, division.value, order])

  /// How many cards are in the document.
  ///
  /// The whole book is in memory — that is what makes this screen work offline
  /// — but a thousand `<img>` tags in one grid is a phone that stops scrolling.
  /// Grown on demand rather than virtualised: this app has no virtualiser and
  /// adding one for a screen somebody scrolls a page or two of would be a
  /// dependency bought for a problem nobody has.
  ///
  /// Reset by comparing during render rather than in an effect. A new filter
  /// showing the previous filter's scroll depth would draw four hundred cards
  /// for a search that matched nine — and an effect would draw them first and
  /// then throw them away, which on a counter tablet is a visible stutter every
  /// time somebody types.
  const [limit, setLimit] = useState(PAGE)
  const scope = `${needle}|${division.value ?? ""}|${order}`
  const [lastScope, setLastScope] = useState(scope)
  if (scope !== lastScope) {
    setLastScope(scope)
    setLimit(PAGE)
  }

  const filtered = needle !== "" || division.value !== undefined

  return (
    <Screen className="@container">
      <div className="pt-1 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-[1.125rem] -translate-y-1/2 text-line-ico" />
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Search the range"
            aria-label="Search the range"
            className="pr-12 pl-11"
            enterKeyHint="search"
          />
          {typed !== "" && (
            <button
              type="button"
              onClick={() => setTyped("")}
              aria-label="Clear the search"
              className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center text-line-ico"
            >
              <X className="size-[1.125rem]" />
            </button>
          )}
        </div>
      </div>

      {/* What is on, one tap away. A promotion is not a price, so nothing below
          this line can show one — the cards carry markdowns because a markdown
          IS the price, and "buy two get one" appears on no shelf edge anywhere.
          Hidden entirely at zero rather than shown as "0 promotions": a shop
          running nothing does not need to be told so every time it looks up a
          price. */}
      {running + soon > 0 && (
        <button
          type="button"
          onClick={() => go("/catalogue/offers")}
          className="mb-3 flex w-full items-center gap-3 rounded-card border border-hairline bg-accent-bg px-4 py-3 text-left"
        >
          <Sparkles className="size-[1.125rem] shrink-0 text-accent" />
          <span className="min-w-0 flex-1 text-meta text-ink">
            {running > 0
              ? `${count(running)} ${running === 1 ? "promotion is" : "promotions are"} running`
              : `${count(soon)} ${soon === 1 ? "promotion starts" : "promotions start"} soon`}
            {running > 0 && soon > 0 && `, ${count(soon)} starting soon`}
          </span>
          <span className="shrink-0 text-meta font-medium text-accent">
            See
          </span>
        </button>
      )}

      {/* The range across the top, the way a marketplace puts its categories
          there. A column of filters is the console's shape and there is no room
          for one on a counter tablet held in one hand. */}
      {divisions.length > 0 && (
        <div className="-mx-4 mb-3 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1 [&::-webkit-scrollbar]:hidden">
          <FacetChip
            on={division.value === undefined}
            onClick={() => division.set(undefined)}
          >
            Everything
          </FacetChip>
          {divisions.map(([code, howMany]) => (
            <FacetChip
              key={code}
              on={division.value === code}
              onClick={() =>
                division.set(division.value === code ? undefined : code)
              }
            >
              {label(code)}
              <span className="ml-1.5 tabular-nums opacity-60">
                {count(howMany)}
              </span>
            </FacetChip>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-meta text-body">
          <b className="font-medium text-ink">{count(shown.length)}</b>{" "}
          {filtered
            ? shown.length === 1
              ? "product matches"
              : "products match"
            : shown.length === 1
              ? "product"
              : "products"}
        </span>
        {ORDERS.map(([value, name]) => (
          <button
            key={value}
            type="button"
            onClick={() => setOrder(value)}
            className={cn(
              "h-9 shrink-0 rounded-inner px-3 text-meta font-medium transition-colors",
              order === value
                ? "bg-accent text-on-dark"
                : "bg-soft-2 text-body",
            )}
          >
            {name}
          </button>
        ))}
      </div>

      {/* A shop with no price book is not a shop with an empty range, and the
          difference is whose problem it is: one is a sync that has not landed,
          the other is a merchandiser's. */}
      {book !== undefined && !book.has_price_book && (
        <Banner tone="warn" className="mb-3">
          No price book has reached this shop yet, so nothing here can be
          priced. Check the sync.
        </Banner>
      )}

      {queryState(catalogue, {
        loading: "Reading this shop's range…",
        render: () =>
          shown.length === 0 ? (
            <EmptyState
              action={
                filtered ? (
                  <Button
                    onClick={() => {
                      setTyped("")
                      division.set(undefined)
                    }}
                  >
                    Show everything
                  </Button>
                ) : undefined
              }
            >
              {filtered
                ? "Nothing in the range matches that."
                : "This shop has no priced products yet."}
            </EmptyState>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2.5 @md:grid-cols-3 @2xl:grid-cols-4">
                {shown.slice(0, limit).map((row) => (
                  <ProductCard
                    key={row.sku_code}
                    row={row}
                    currency={book?.currency ?? "IDR"}
                    onOpen={() =>
                      go("/catalogue/product", { sku: row.sku_code })
                    }
                  />
                ))}
              </div>
              {shown.length > limit && (
                <div className="mt-4 flex justify-center">
                  <Button onClick={() => setLimit((was) => was + PAGE)}>
                    Show {count(Math.min(PAGE, shown.length - limit))} more
                  </Button>
                </div>
              )}
            </>
          ),
      })}
    </Screen>
  )
}

/// How many cards are drawn before somebody asks for more.
const PAGE = 48

type Order = "range" | "cheapest" | "dearest" | "name"

const ORDERS: readonly (readonly [Order, string])[] = [
  ["range", "Range"],
  ["cheapest", "Cheapest"],
  ["name", "A–Z"],
]

function sorted(
  rows: readonly CatalogRow[],
  order: Order,
): readonly CatalogRow[] {
  switch (order) {
    // The order the node sent them in — by SKU code, which is the order the
    // range is numbered in, which is how a shop's own people talk about it.
    case "range":
      return rows
    case "cheapest":
      return [...rows].sort((a, b) => a.unit_price_minor - b.unit_price_minor)
    case "dearest":
      return [...rows].sort((a, b) => b.unit_price_minor - a.unit_price_minor)
    case "name":
      return [...rows].sort((a, b) => a.name.localeCompare(b.name))
  }
}

/// Whether the typed words describe this product.
///
/// Name, code and barcode — the three things somebody has when they are asking.
/// Every word has to match somewhere, so "denim m" finds the medium and not
/// every denim in the shop.
function matchesWords(row: CatalogRow, needle: string): boolean {
  if (needle === "") return true
  const haystack =
    `${row.name} ${row.sku_code} ${row.barcode ?? ""} ${row.article_code ?? ""}`.toLowerCase()
  return needle.split(/\s+/).every((word) => haystack.includes(word))
}

function FacetChip({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-11 shrink-0 rounded-inner px-4 text-meta font-medium whitespace-nowrap transition-colors",
        on
          ? "bg-accent text-on-dark"
          : "border border-hairline-2 bg-canvas text-body",
      )}
    >
      {children}
    </button>
  )
}

/// One product, before anybody knows they want it.
export function ProductCard({
  row,
  currency,
  onOpen,
}: {
  row: CatalogRow
  currency: string
  onOpen: () => void
}) {
  const down = row.unit_price_minor < row.base_unit_price_minor

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={row.name}
      className="pressable overflow-hidden rounded-card border border-hairline bg-canvas text-left shadow-soft"
    >
      <div className="relative aspect-[4/5] bg-soft-2">
        <Photograph sku={row.sku_code} has={row.has_image} />
        {/* Two corners, never one. At two columns on a phone a card is about
            160px across, and a division badge and a markdown flag on the same
            row truncate each other to "Menswe" — which is how the first draft
            of this drew it. Capped at 70% for the same reason: a long division
            name must eat its own tail rather than the flag's. */}
        {row.division_code !== null && row.division_code !== "" && (
          <span className="absolute top-2 left-2 max-w-[70%] truncate rounded-inner bg-canvas/95 px-2 py-[0.1875rem] text-pill font-semibold text-ink shadow-soft backdrop-blur-[5px]">
            {label(row.division_code)}
          </span>
        )}
        {down && (
          <span className="absolute bottom-2 left-2">
            <Pill tone="bad">Price down</Pill>
          </span>
        )}
      </div>
      <div className="px-3 pt-2.5 pb-3">
        <div className="line-clamp-2 min-h-[2.5em] text-card-title font-medium text-ink">
          {row.name}
        </div>
        <div className="mt-1 truncate font-mono text-pill text-mute">
          {row.sku_code}
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
          <span className="text-title font-semibold text-ink tabular-nums">
            {money(row.unit_price_minor, currency)}
          </span>
          {/* Both numbers, because a was-price with nothing struck through is
              just a smaller price and reads as a mistake. Only drawn when the
              two actually differ — `base` equals `unit` on everything that is
              not marked down. */}
          {down && (
            <span className="text-pill text-mute tabular-nums line-through">
              {money(row.base_unit_price_minor, currency)}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

/// The photograph, fetched through the node.
///
/// Never straight at `image_url`. The centre's URL is what the row came with,
/// and a shop's whole reason for holding a resident catalogue is that the line
/// to the centre may be down — a grid pointed there draws a page of broken
/// glyphs on the day this screen matters most. `/api/v1/catalog/image` is the
/// node's own proxy: it fetches once per URL and holds it for the life of the
/// process, so one colourway costs the shop one fetch however many tablets are
/// on the floor.
///
/// `has_image` is why nothing is requested for the products that have none. A
/// missing photograph answers 404, and a 404 per unphotographed garment is both
/// a wasted round trip and a broken-image glyph that reads as a defect in the
/// app rather than a gap in the data.
export function Photograph({
  sku,
  has,
  className,
}: {
  sku: string
  has: boolean
  className?: string
}) {
  /// *Which* product failed to load, not whether one did. A boolean would have
  /// to be cleared when the SKU changes, and this card is recycled by the grid
  /// as somebody scrolls — one garment with a dead URL would blank the next
  /// twenty photographs that landed in the same slot.
  const [failed, setFailed] = useState<string | null>(null)

  if (!has || failed === sku) {
    return (
      <span
        className={cn(
          "grid size-full place-items-center px-2 text-center text-pill text-mute",
          className,
        )}
      >
        No photograph
      </span>
    )
  }
  return (
    <img
      src={`/api/v1/catalog/image?sku=${encodeURIComponent(sku)}`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(sku)}
      className={cn("size-full object-cover object-[center_15%]", className)}
    />
  )
}

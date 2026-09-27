import { Menu } from "@base-ui/react/menu"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowUpDown,
  Check,
  ChevronRight,
  Search,
  Sparkles,
  X,
} from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
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
/// **Drawn as the console's Sourcing page**, on the owner's word (2026-09-25):
/// no module column, the grid straight under the title, the price on every
/// card, and the divisions docked at the right where there is room for them.
/// One product, one app — a merchandiser who browses suppliers in the hub and
/// the range on a shop's tablet should not have to learn the grid twice.
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

  /// Everything the *words* match, before a division narrows it.
  ///
  /// The base the facets and the two figures in the panel are counted over —
  /// the distinction the console's facets make and it matters as much here:
  /// if choosing Menswear made every other division read zero, the list of
  /// divisions would stop being a map of the shop and become a description of
  /// the filter already applied. A shop assistant uses it to find out what
  /// else is there.
  const searchable = useMemo(
    () => rows.filter((row) => matchesWords(row, needle)),
    [rows, needle],
  )

  const divisions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of searchable) {
      const code = row.division_code
      if (code === null || code === "") continue
      counts.set(code, (counts.get(code) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) =>
      a[1] === b[1] ? a[0].localeCompare(b[0]) : b[1] - a[1],
    )
  }, [searchable])

  const markedDown = useMemo(
    () => searchable.filter((row) => isDown(row)).length,
    [searchable],
  )

  const [order, setOrder] = useState<Order>("range")

  const shown = useMemo(() => {
    const picked =
      division.value === undefined
        ? searchable
        : searchable.filter((row) => row.division_code === division.value)
    return sorted(picked, order)
  }, [searchable, division.value, order])

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
  const pick = (code: string | undefined) => division.set(code)

  return (
    <Screen
      counter
      sub="Everything this shop sells, at today's price. Open a product for its details and promotions."
      // Named, because the grid column below is a container too and the two
      // questions are different: THIS one asks whether the page has room for
      // the division panel, that one how many cards fit beside it.
      className="@container/page"
    >
      {/* The Sourcing page's shape: what is on the glass at the left, what
          narrows it docked at the right where there is room for it.

          Docked by a CONTAINER query on the page, not by `dock:`. The hub's
          `dock:` reads `data-dock`, which its shell publishes from the width
          of the page column; this shell does not publish it yet, and a screen
          that set a flag on <html> from inside itself would leave it set on
          every screen visited afterwards. The page's own width is the same
          question asked of the same box, with nothing to clean up. 60rem of
          page is the hub's threshold (1000px of column, less the gutters). */}
      <div className="grid min-w-0 items-start gap-5 @min-[60rem]/page:grid-cols-[minmax(0,1fr)_16rem]">
        {/* `@container` on the column the cards are laid out in, not on the
            page: its width is whatever the panel leaves it, and a breakpoint
            reading the viewport would put four cards in the space for three. */}
        <div className="@container flex min-w-0 flex-col">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-line-ico" />
            {/* The console's search box: a soft well that turns white when it
                is being typed in. 16px text under a finger, because anything
                smaller and iOS zooms the whole page the moment it is touched. */}
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Name, SKU or barcode"
              aria-label="Search the range"
              enterKeyHint="search"
              className="h-10 w-full rounded-[1.25rem] border border-transparent bg-soft-2 pr-11 pl-10 text-[0.875rem] text-ink transition-colors outline-none placeholder:text-mute hover:border-hairline-2 hover:bg-soft-3 focus-visible:border-hairline-2 focus-visible:bg-canvas pointer-coarse:h-tap pointer-coarse:text-[1rem]"
            />
            {typed !== "" && (
              <button
                type="button"
                onClick={() => setTyped("")}
                aria-label="Clear the search"
                className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:right-0 pointer-coarse:size-tap"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {/* What is on, one tap away. A promotion is not a price, so nothing
              below this line can show one — the cards carry markdowns because a
              markdown IS the price, and "buy two get one" appears on no shelf
              edge anywhere. Hidden entirely at zero rather than shown as "0
              promotions": a shop running nothing does not need to be told so
              every time it looks up a price. */}
          {running + soon > 0 && (
            <button
              type="button"
              onClick={() => go("/promotions")}
              className="mb-3 flex min-h-10 w-full items-center gap-2.5 rounded-card border border-hairline bg-accent-bg px-3.5 py-2 text-left transition-colors hover:border-hairline-2 pointer-coarse:min-h-tap"
            >
              <Sparkles className="size-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 text-[0.8125rem] text-ink">
                {running > 0
                  ? `${count(running)} ${running === 1 ? "promotion is" : "promotions are"} running`
                  : `${count(soon)} ${soon === 1 ? "promotion starts" : "promotions start"} soon`}
                {running > 0 && soon > 0 && `, ${count(soon)} starting soon`}
              </span>
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[0.8125rem] font-medium text-accent">
                See
                <ChevronRight className="size-3.5" />
              </span>
            </button>
          )}

          {/* The divisions across the top where the panel has no room — a
              phone, a tablet held upright. A column of filters is no use on a
              counter tablet held in one hand, and a row that scrolls sideways
              is how a marketplace puts its categories in the same place. */}
          {divisions.length > 0 && (
            <div className="-mx-4 mb-3 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0 @min-[60rem]/page:hidden [&::-webkit-scrollbar]:hidden">
              <FacetChip
                on={division.value === undefined}
                onClick={() => pick(undefined)}
              >
                Everything
              </FacetChip>
              {divisions.map(([code, howMany]) => (
                <FacetChip
                  key={code}
                  on={division.value === code}
                  onClick={() =>
                    pick(division.value === code ? undefined : code)
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

          {/* One line the width of the grid: what is on screen at the left,
              how it is ordered at the right — the line every list in the hub
              wears, in the same order. */}
          <div className="mb-[1.125rem] flex flex-wrap items-center gap-1.5">
            <span className="mr-auto min-w-0 truncate text-[0.84375rem] text-body">
              <b className="font-medium text-ink">{count(shown.length)}</b>{" "}
              {filtered
                ? shown.length === 1
                  ? "product matches"
                  : "products match"
                : shown.length === 1
                  ? "product"
                  : "products"}
            </span>
            <OrderMenu value={order} onChange={setOrder} />
          </div>

          {/* A shop with no price book is not a shop with an empty range, and
              the difference is whose problem it is: one is a sync that has not
              landed, the other is a merchandiser's. */}
          {book !== undefined && !book.has_price_book && (
            <Banner tone="warn" className="mb-[1.125rem]">
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
                          pick(undefined)
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
                  {/* The hub's grid, with two changes, both because this card
                      is smaller than Sourcing's: a photograph, a name and a
                      price, where that one also carries a supplier, tags and a
                      basket button. Two columns on a phone rather than one —
                      one card per screen is a list somebody scrolls for ever —
                      and four from 56rem rather than 64, because at 1440 with
                      no module column this one has ~1000px, and three cards
                      there are three posters. */}
                  <div className="grid grid-cols-2 gap-2.5 @md:gap-[1.125rem] @2xl:grid-cols-3 @4xl:grid-cols-4">
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
                    <div className="mt-6 flex justify-center">
                      <Button onClick={() => setLimit((was) => was + PAGE)}>
                        Show {count(Math.min(PAGE, shown.length - limit))} more
                      </Button>
                    </div>
                  )}
                </>
              ),
          })}
        </div>

        <DivisionPanel
          divisions={divisions}
          chosen={division.value}
          onPick={pick}
          loaded={book !== undefined}
          products={searchable.length}
          markedDown={markedDown}
          className="hidden @min-[60rem]/page:flex"
        />
      </div>
    </Screen>
  )
}

/// How many cards are drawn before somebody asks for more.
const PAGE = 48

type Order = "range" | "cheapest" | "dearest" | "name"

const ORDERS: readonly (readonly [Order, string])[] = [
  ["range", "Range"],
  ["cheapest", "Cheapest"],
  ["dearest", "Dearest"],
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

/// Marked down: selling under the book's own base price. `base` equals `unit`
/// on everything that is not, so this is never true by rounding.
function isDown(row: CatalogRow): boolean {
  return row.unit_price_minor < row.base_unit_price_minor
}

/// The order the grid is read in, as one menu rather than a row of pills.
///
/// The hub's `ChoiceMenu`, drawn here rather than imported: this app has no
/// menu kit yet and one control is not a reason to start one. Four buttons
/// sitting open said that choosing an order was as important as the thing
/// being ordered, and every list in the console names its order from a menu
/// with this trigger.
function OrderMenu({
  value,
  onChange,
}: {
  value: Order
  onChange: (next: Order) => void
}) {
  const here = ORDERS.find(([one]) => one === value) ?? ORDERS[0]

  return (
    <Menu.Root>
      <Menu.Trigger className="inline-flex h-[2.125rem] items-center gap-1.5 rounded-inner px-[0.5625rem] text-[0.75rem] font-medium text-body transition-colors hover:bg-soft-2 hover:text-ink data-[popup-open]:bg-soft-2 data-[popup-open]:text-ink pointer-coarse:h-tap pointer-coarse:px-3">
        <ArrowUpDown className="size-3.5 stroke-[1.7]" />
        {here[1]}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          className="z-50"
        >
          {/* Grows from the trigger, 160ms on the strong ease-out — the hub's
              `POP_MOTION`. Reduced motion keeps the fade, drops the growth. */}
          <Menu.Popup className="min-w-[13rem] origin-(--transform-origin) rounded-card border border-hairline bg-canvas p-1.5 shadow-pop transition-[opacity,scale] duration-(--t-pop) ease-(--ease-out) outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
            <span className="block px-2 pt-1 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-mute uppercase">
              Sort by
            </span>
            {ORDERS.map(([one, name]) => {
              const on = one === value
              return (
                <Menu.Item
                  key={one}
                  onClick={() => onChange(one)}
                  className={cn(
                    "flex min-h-8 cursor-default items-center gap-2 rounded-inner px-2 text-[0.8125rem] text-text outline-none select-none data-[highlighted]:bg-soft-2 pointer-coarse:min-h-tap",
                    on && "text-ink",
                  )}
                >
                  <span className="grid w-3.5 shrink-0 place-items-center text-accent">
                    {on && <Check className="size-3.5" />}
                  </span>
                  {name}
                </Menu.Item>
              )
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/// The divisions, docked beside the grid — the hub's `DockedFilters` for a
/// list that has exactly one thing to narrow by.
///
/// A list of every division with its count rather than a select: a catalogue
/// is browsed rather than queried, and the counts are how somebody discovers
/// that what they are after is filed under a division they had not thought of.
/// The two figures above it are counted over the same base as the list, so a
/// figure and the rows under it cannot disagree.
function DivisionPanel({
  divisions,
  chosen,
  onPick,
  loaded,
  products,
  markedDown,
  className,
}: {
  divisions: readonly (readonly [string, number])[]
  chosen: string | undefined
  onPick: (code: string | undefined) => void
  /// False until the book has arrived, so the figures read "—" rather than a
  /// confident zero while the request is still in flight.
  loaded: boolean
  products: number
  markedDown: number
  className?: string
}) {
  return (
    <aside
      aria-label="Divisions"
      className={cn(
        "sticky top-5 flex-col gap-2.5 self-start rounded-card border border-hairline bg-canvas p-4",
        className,
      )}
    >
      <dl className="-mx-1 mb-1 grid grid-cols-2 gap-x-3 gap-y-2 border-b border-hairline px-1 pb-3">
        <div className="min-w-0">
          <dt className="truncate text-[0.625rem] font-medium tracking-[0.04em] text-mute uppercase">
            Products
          </dt>
          <dd className="truncate text-[0.8125rem] font-semibold text-ink tabular-nums">
            {loaded ? count(products) : "—"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-[0.625rem] font-medium tracking-[0.04em] text-mute uppercase">
            Price down
          </dt>
          <dd
            title="Products selling under their base price."
            className="truncate text-[0.8125rem] font-semibold text-ink tabular-nums"
          >
            {loaded ? count(markedDown) : "—"}
          </dd>
        </div>
      </dl>

      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[0.8125rem] font-medium text-body">Division</h4>
        {chosen !== undefined && (
          <button
            type="button"
            onClick={() => onPick(undefined)}
            className="text-[0.75rem] font-medium text-body transition-colors hover:text-ink pointer-coarse:min-h-tap"
          >
            Clear
          </button>
        )}
      </div>

      <div className="-mx-1 flex flex-col gap-px">
        <DivisionRow
          on={chosen === undefined}
          onClick={() => onPick(undefined)}
          name="Everything"
          howMany={loaded ? products : undefined}
        />
        {divisions.map(([code, howMany]) => (
          <DivisionRow
            key={code}
            on={chosen === code}
            onClick={() => onPick(chosen === code ? undefined : code)}
            name={label(code)}
            howMany={howMany}
          />
        ))}
      </div>
    </aside>
  )
}

/// One division in the panel. Chosen is the sidebar's own grammar — the soft
/// fill and the heavier weight — so the panel reads as the same kind of list as
/// the module column it stands in for.
function DivisionRow({
  on,
  onClick,
  name,
  howMany,
}: {
  on: boolean
  onClick: () => void
  name: string
  howMany: number | undefined
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex min-h-[2.125rem] w-full items-center gap-2 rounded-inner px-2.5 text-left text-[0.8125rem] transition-colors pointer-coarse:min-h-tap",
        on
          ? "bg-soft-2 font-medium text-ink"
          : "text-text hover:bg-soft-2 hover:text-ink",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="shrink-0 text-[0.75rem] font-normal text-mute tabular-nums">
        {count(howMany)}
      </span>
    </button>
  )
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
        "h-9 shrink-0 rounded-inner px-3.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors pointer-coarse:h-tap",
        on
          ? "bg-accent text-on-dark"
          : "border border-hairline-2 bg-canvas text-body shadow-soft",
      )}
    >
      {children}
    </button>
  )
}

/// One product, before anybody knows they want it — the hub's Sourcing card.
///
/// The photograph with the division riding on it, the name, the price. The
/// SKU code stays, where the Sourcing card dropped its supplier's code: a
/// supplier's eleven digits mean nothing to a buyer, and a shop's own SKU is
/// how its people talk about the range ("the 30101 in navy").
export function ProductCard({
  row,
  currency,
  onOpen,
}: {
  row: CatalogRow
  currency: string
  onOpen: () => void
}) {
  const down = isDown(row)

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={row.name}
      // The hub's lift on hover, and a press on touch: Tailwind's `hover:`
      // only applies where the pointer can hover, so a finger never leaves a
      // card floating after it has been tapped.
      //
      // A flex column, not a block: a <button> centres its content vertically,
      // so a card stretched to the height of a taller neighbour in its row
      // (a two-line name, a was-price that wrapped) floated its photograph
      // down off its own top edge.
      className="flex w-full min-w-0 flex-col overflow-hidden rounded-card border border-hairline bg-canvas text-left shadow-soft transition duration-150 hover:-translate-y-0.5 hover:shadow-pop active:scale-[0.99]"
    >
      <div className="relative h-[9.875rem] w-full shrink-0 overflow-hidden bg-soft-2">
        <Photograph sku={row.sku_code} has={row.has_image} />
        {/* The division rides on the photograph, the way a marketplace puts
            its category badge there: it is what the picture IS, so it belongs
            with the picture rather than in a list of facts under it. */}
        {row.division_code !== null && row.division_code !== "" && (
          <span className="absolute top-2.5 left-2.5 max-w-[calc(100%-1.25rem)] truncate rounded-full bg-canvas/95 px-2 py-[0.1875rem] text-[0.625rem] font-semibold text-ink shadow-soft backdrop-blur-[5px]">
            {label(row.division_code)}
          </span>
        )}
        {/* Two corners, never one. At two columns on a phone a card is about
            160px across, and a division badge and a markdown flag on the same
            row truncate each other to "Menswe" — which is how the first draft
            of this drew it. Same shape as the division, in the colour of a
            price that moved. */}
        {down && (
          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-canvas/95 px-2 py-[0.1875rem] text-[0.625rem] font-semibold text-bad-fg shadow-soft backdrop-blur-[5px]">
            Price down
          </span>
        )}
      </div>
      <div className="px-3 pt-2.5 pb-3 @md:px-[0.9375rem] @md:pt-3 @md:pb-3.5">
        {/* Two lines where a card is phone-narrow, one where it is not: at
            160px a garment's name truncates to its first two words, and they
            are usually the same two words on every card in the division. */}
        <div className="line-clamp-2 min-h-[2.5em] text-[0.875rem] leading-[1.25] font-medium text-ink @2xl:line-clamp-1 @2xl:min-h-0">
          {row.name}
        </div>
        <div className="mt-1 truncate font-mono text-[0.6875rem] text-mute">
          {row.sku_code}
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span className="text-[1rem] font-semibold text-ink tabular-nums">
            {money(row.unit_price_minor, currency)}
          </span>
          {/* Both numbers, because a was-price with nothing struck through is
              just a smaller price and reads as a mistake. */}
          {down && (
            <span className="text-[0.71875rem] text-mute tabular-nums line-through">
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

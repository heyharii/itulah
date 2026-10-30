import { Menu } from "@base-ui/react/menu"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useRouter } from "@tanstack/react-router"
import {
  ArrowUpDown,
  Check,
  PackageCheck,
  PackageX,
  Search,
  Sparkles,
  Tag,
  X,
  type LucideIcon,
} from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { articleId, count, label, pcs, sku as skuText } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useParam, type Search as UrlSearch } from "@/lib/params"
import {
  catalogueQuery,
  finalPricesQuery,
  offersQuery,
  skuStockQuery,
} from "@/lib/queries"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import {
  shapeBook,
  sizeLine,
  swatchBackground,
  type ArticleColour,
} from "@/lib/variants"
import {
  cardsOf,
  dealsOfCard,
  haystackOf,
  holdingsOf,
  isBlank,
  itemsOf,
  matchesQuery,
  ORDERS,
  parseQuery,
  percentOff,
  sizesLeft,
  sortCards,
  type Card,
  type Holding,
  type Item,
  type Order,
} from "@/screens/catalogue-model"
import { Photograph, SoldOutStamp } from "@/screens/catalogue-parts"
import { CatalogueTable, Sizes } from "@/screens/catalogue-table"
import { ProductSheet } from "@/screens/product"
import type { StoreOffer } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// The range, as somebody standing in front of it sees it: one box that
/// finds anything in it.
///
/// ## What is on the page
///
/// A search, and nothing to scroll until something is typed. Under the empty
/// box, a few things people ask for most — on promotion, in stock, sold out,
/// each division — each a press that types it, with how many articles it
/// finds. There are no filters: a name, a code, a barcode, a colour, a size,
/// a division, a tag, a promotion's name, "sold out", "diskon", "<100k" all
/// go in the same box and narrow together (`parseQuery`). On a phone the box
/// is the dock's (`DockTools`), with the order and the views in its ⚙ sheet.
///
/// What it finds are a shop's product tiles, as any online shop draws them:
/// the garment, its colours as swatches, the article's name, the price and
/// the sizes — two across on a phone, as many as fit on a desk — or the same
/// records as a table. Pointing at a swatch shows that colour; pressing one
/// opens the article on it. An article opens as a sheet over the page
/// (`ProductSheet`, `?sku=` in the URL).
///
/// ## The price is the counter's
///
/// What a tile says an article costs is what the till takes from a walk-in
/// shopper for one piece right now: the shelf price, less the markdown, less
/// every promotion that reaches a single piece (`/store/final-prices`, the
/// engine's own answer). Struck under it, the price before any of that. A
/// voucher or a members' price is not in it — those need a code or a card —
/// and is said as a deal instead.
///
/// **Everything on this screen is decided in the browser.** One request fetches
/// the whole resident book — which `lib/queries.ts` already does for the till —
/// and the search and the sort run over what is in hand (`catalogue-model.ts`).
/// A shop's catalogue is thousands of rows, not millions, it is already cached
/// for the counter, and a screen that asked the node for each keystroke would
/// stop working in exactly the hour the shop needs it: the line down, the
/// customer still standing there.
export function Catalogue() {
  const router = useRouter()
  const navigate = useNavigate()
  const phone = useLayout() === "phone"
  const search = useParam("q")
  const viewParam = useParam("view")
  const layoutParam = useParam("layout")
  const sku = useParam("sku")
  const view = viewParam.value ?? "article"
  const bySku = view === "sku"
  const layout = layoutParam.value ?? "grid"

  /// What is being typed, held locally and pushed to the URL as it settles.
  ///
  /// Two boxes for one value, and the split is deliberate: writing the URL on
  /// every keystroke makes a history nobody can walk back through, and reading
  /// it back on every keystroke makes the caret fight the router. So the input
  /// is local and immediate, and the address bar catches up — which is what
  /// makes a search survive the tablet going to sleep.
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

  // The book is long and the box is typed into fast. Deferring the search
  // keeps every keystroke landing immediately while the grid catches up.
  const needle = useDeferredValue(typed).trim()

  const catalogue = useQuery({
    ...catalogueQuery(),
    /// A minute, and it overrides the app's five-minute staleness.
    ///
    /// The rest of the till is right to be lazy: a basket is priced from the
    /// book in hand and a five-minute-old book prices it identically. A screen
    /// **showing a price to a customer** is the one place that is not true. A
    /// publication lands on the sync lane while the shop is open, and a tablet
    /// left on a rail quoting yesterday's number is the exact failure this
    /// whole surface exists to prevent. It only runs while somebody is looking
    /// at it.
    refetchInterval: 60_000,
  })

  /// Which deals reach an article. A failure here must not take the catalogue
  /// down with it — the prices are the point, and an offers endpoint an older
  /// node does not serve should cost the deals and nothing else.
  const offers = useQuery(offersQuery())

  /// The price a walk-in pays. Refetched each minute for the catalogue's own
  /// reason, and more: a promotion's hour starts with no new publication. A
  /// node that does not serve it yet costs the promotions their place in the
  /// price, and the shelf price shows — never an error over the range.
  const finals = useQuery({
    ...finalPricesQuery(),
    refetchInterval: 60_000,
  })

  /// What the shop holds of each SKU — the stamps, the struck sizes, the
  /// figures. Until it arrives nothing is known to be sold out.
  const stock = useQuery({
    ...skuStockQuery(),
    refetchInterval: 60_000,
  })

  const book = catalogue.data
  const rows = useMemo(() => book?.items ?? [], [book])
  const currency = book?.currency ?? "IDR"
  /// Every article's colours and sizes, read once per book rather than per
  /// tile per keystroke — and over the whole book, so a search for "navy"
  /// still shows the article's other colours on its tile.
  const shapes = useMemo(() => shapeBook(rows), [rows])
  const finalMap = useMemo(
    () =>
      new Map(
        (finals.data?.items ?? []).map((one) => [one.sku_code, one] as const),
      ),
    [finals.data],
  )
  const stockMap = useMemo(
    () =>
      stock.data === undefined
        ? null
        : new Map(stock.data.items.map((one) => [one.sku_code, one] as const)),
    [stock.data],
  )
  const runningOffers = offers.data?.running ?? NO_OFFERS
  const items = useMemo(
    () =>
      itemsOf({
        rows,
        shapes,
        finals: finalMap,
        stock: stockMap,
        offers: runningOffers,
      }),
    [rows, shapes, finalMap, stockMap, runningOffers],
  )
  /// Each article's pieces by size and colour, over all its SKUs whatever was
  /// found — a size is sold out whether or not it is being looked at.
  const holdings = useMemo(() => holdingsOf(items), [items])

  /// What a word can find on each SKU, and the book's sizes — built once per
  /// book, not per keystroke.
  const haystacks = useMemo(
    () =>
      new Map(
        items.map(
          (item) =>
            [item, haystackOf(item, label(item.row.division_code))] as const,
        ),
      ),
    [items],
  )
  const sizes = useMemo(
    () =>
      new Set(
        items.flatMap((item) =>
          item.size === null ? [] : [item.size.toLowerCase()],
        ),
      ),
    [items],
  )
  const find = useMemo(
    () => (text: string) => {
      const query = parseQuery(text, currency)
      return isBlank(query)
        ? []
        : items.filter((item) =>
            matchesQuery(item, query, haystacks.get(item) ?? "", sizes),
          )
    },
    [items, haystacks, sizes, currency],
  )
  const matched = useMemo(() => find(needle), [find, needle])

  /// What to press when nothing is typed: each one is words the box already
  /// understands, so a suggestion and typing it are the same search.
  const suggestions = useMemo(() => {
    const divisions = [
      ...new Set(
        items.flatMap((item) =>
          item.row.division_code ? [item.row.division_code] : [],
        ),
      ),
    ]
    const all: { icon: LucideIcon; label: string; words: string }[] = [
      { icon: Sparkles, label: "On promotion", words: "promo" },
      ...(stockMap === null
        ? []
        : [
            { icon: PackageCheck, label: "In stock", words: "in stock" },
            { icon: PackageX, label: "Sold out", words: "sold out" },
          ]),
      ...divisions.map((code) => ({
        icon: Tag,
        label: label(code),
        words: label(code),
      })),
    ]
    return all
      .map((one) => ({
        ...one,
        articles: new Set(find(one.words).map((item) => item.key)).size,
      }))
      .filter((one) => one.articles > 0)
  }, [items, stockMap, find])

  const [order, setOrder] = useState<Order>("range")
  const cards = useMemo(
    () => sortCards(cardsOf(matched, shapes, bySku), order),
    [matched, shapes, bySku, order],
  )

  /// How many cards are in the document.
  ///
  /// The whole book is in memory — that is what makes this screen work offline
  /// — but a thousand `<img>` tags in one list is a phone that stops scrolling.
  /// Grown on demand rather than virtualised: this app has no virtualiser and
  /// adding one for a screen somebody scrolls a page or two of would be a
  /// dependency bought for a problem nobody has.
  ///
  /// Reset by comparing during render rather than in an effect. A new search
  /// showing the previous search's scroll depth would draw four hundred cards
  /// for one that matched nine — and an effect would draw them first and then
  /// throw them away, which on a counter tablet is a visible stutter every
  /// time somebody types.
  const [limit, setLimit] = useState(PAGE)
  const scope = `${needle}|${order}|${view}|${layout}`
  const [lastScope, setLastScope] = useState(scope)
  if (scope !== lastScope) {
    setLastScope(scope)
    setLimit(PAGE)
  }

  const blank = isBlank(parseQuery(needle, currency))

  // An article opens as a sheet over the page. Opening pushes a history entry
  // so the phone's back gesture closes the sheet instead of leaving the screen;
  // swapping to a sibling SKU replaces it. Closing goes back when the sheet was
  // opened here, and otherwise (a link, a reload) just drops the key.
  const opened = useRef(false)
  const open = (code: string) => {
    opened.current = true
    void navigate({
      to: ".",
      search: (previous: UrlSearch) => ({ ...previous, sku: code }),
    })
  }
  const close = () => {
    if (opened.current && router.history.canGoBack()) {
      opened.current = false
      router.history.back()
    } else sku.set(undefined)
  }

  return (
    <Screen counter>
      {/* The dock, on a phone: renders nothing anywhere else. */}
      <DockTools
        search={{
          value: typed,
          onChange: setTyped,
          label: "Search the range",
        }}
        sort={{
          label: orderName(order),
          directional: false,
          choices: {
            options: ORDERS.map(([value, name]) => ({ value, label: name })),
            value: order,
            desc: false,
            onChange: (next) => setOrder(next as Order),
          },
        }}
        views={[
          {
            title: "View",
            value: view,
            options: VIEWS,
            onChange: (next) =>
              viewParam.set(next === "article" ? undefined : (next as View)),
          },
          {
            title: "Layout",
            value: layout,
            options: LAYOUTS,
            onChange: (next) =>
              layoutParam.set(next === "grid" ? undefined : (next as Layout)),
          },
        ]}
      />

      {/* A shop with no price book is not a shop with an empty range, and
          the difference is whose problem it is: one is a sync that has not
          landed, the other is a merchandiser's. */}
      {book !== undefined && !book.has_price_book && (
        <Banner tone="warn" className="mb-3.5">
          No price book has reached this shop yet, so nothing here can be
          priced. Check the sync.
        </Banner>
      )}

      {/* The desk's box: on a phone it is the dock's. */}
      <label className="relative mb-5 block max-w-[40rem] max-md:hidden">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-line-ico" />
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Name, code, colour, size, promo or price"
          aria-label="Search the range"
          enterKeyHint="search"
          autoFocus={!phone}
          className="h-12 w-full rounded-card border border-hairline-2 bg-canvas pr-12 pl-12 text-[1rem] text-ink shadow-soft outline-none placeholder:text-body hover:border-hairline-strong focus:border-accent"
        />
        {typed !== "" && (
          <button
            type="button"
            onClick={() => setTyped("")}
            aria-label="Clear the search"
            className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
          >
            <X className="size-4" />
          </button>
        )}
      </label>

      {queryState(catalogue, {
        loading: "Reading this shop's range…",
        render: () =>
          rows.length === 0 ? (
            <EmptyState>This shop has no priced articles yet.</EmptyState>
          ) : blank ? (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((one) => (
                <button
                  key={one.label}
                  type="button"
                  onClick={() => setTyped(one.words)}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-hairline-2 bg-canvas pr-4 pl-3.5 text-[0.9375rem] font-medium text-ink shadow-soft transition-[border-color,scale] duration-(--t-press) ease-(--ease-out) hover:border-hairline-strong active:scale-[0.97] motion-reduce:active:scale-100"
                >
                  <one.icon className="size-[1.125rem] text-accent" />
                  {one.label}
                  <span className="text-mute tabular-nums">
                    {count(one.articles)}
                  </span>
                </button>
              ))}
            </div>
          ) : cards.length === 0 ? (
            <EmptyState
              action={<Button onClick={() => setTyped("")}>Clear</Button>}
            >
              Nothing in the range matches that.
            </EmptyState>
          ) : (
            <>
              {/* What was found, and on a desk how to read it. On a phone
                  the view, layout and order are the dock's. */}
              <div className="mb-3.5 flex flex-wrap items-center gap-[0.4375rem]">
                <span className="text-[0.9375rem] text-body tabular-nums">
                  {count(cards.length)}{" "}
                  {bySku
                    ? cards.length === 1
                      ? "SKU"
                      : "SKUs"
                    : cards.length === 1
                      ? "article"
                      : "articles"}
                </span>
                <span className="flex-1" />
                <div className="contents max-md:hidden">
                  <Segmented<View>
                    value={view}
                    onChange={(next) =>
                      viewParam.set(next === "article" ? undefined : next)
                    }
                    options={VIEWS}
                  />
                  <Segmented<Layout>
                    value={layout}
                    onChange={(next) =>
                      layoutParam.set(next === "grid" ? undefined : next)
                    }
                    options={LAYOUTS}
                  />
                  <OrderMenu value={order} onChange={setOrder} />
                </div>
              </div>
              {layout === "table" ? (
                <CatalogueTable
                  cards={cards.slice(0, limit)}
                  bySku={bySku}
                  currency={currency}
                  holdings={holdings}
                  onOpen={open}
                />
              ) : (
                // Columns by the room the list has (a container query, so a
                // folded sidebar counts): two on a phone, three on a tablet
                // held upright, four to six on a desk.
                <div className="@container min-w-0">
                  <div className="grid grid-cols-2 gap-2.5 @lg:grid-cols-3 @lg:gap-3.5 @3xl:grid-cols-4 @5xl:grid-cols-5 @7xl:grid-cols-6">
                    {cards.slice(0, limit).map((card) => (
                      <ProductTile
                        key={card.key}
                        card={card}
                        bySku={bySku}
                        holding={
                          bySku ? null : (holdings.get(card.lead.key) ?? null)
                        }
                        currency={currency}
                        onOpen={open}
                      />
                    ))}
                  </div>
                </div>
              )}
              {cards.length > limit && (
                <div className="mt-5 flex justify-center">
                  <Button onClick={() => setLimit((was) => was + PAGE)}>
                    Show {count(Math.min(PAGE, cards.length - limit))} more
                  </Button>
                </div>
              )}
            </>
          ),
      })}

      <ProductSheet
        sku={sku.value}
        rows={rows}
        items={items}
        loaded={book !== undefined}
        offers={offers.data?.running ?? null}
        currency={currency}
        onSku={(next) => sku.set(next)}
        onClose={close}
      />
    </Screen>
  )
}

/// How many cards are drawn before somebody asks for more.
const PAGE = 48

const NO_OFFERS: readonly StoreOffer[] = []

type View = "article" | "sku"
type Layout = "grid" | "table"

const VIEWS: readonly { readonly value: View; readonly label: string }[] = [
  { value: "article", label: "By article" },
  { value: "sku", label: "By SKU" },
]

const LAYOUTS: readonly { readonly value: Layout; readonly label: string }[] = [
  { value: "grid", label: "Grid" },
  { value: "table", label: "Table" },
]

function orderName(order: Order): string {
  return (ORDERS.find(([one]) => one === order) ?? ORDERS[0])[1]
}

/// One article — or one SKU — as a shop's product tile.
///
///   ┌──────────────┐
///   │ −20%         │  what comes off, when something does
///   │      👕      │  the garment, in the colour pointed at — and a
///   │              │  SOLD OUT stamp across it when none is left
///   ├──────────────┤
///   │ ● ● ○ ●  +2  │  its colours, four and a count; a sold-out one slashed
///   │ Kemeja Oxford│  the article's name
///   │ Gajian Okt…  │  the deal it is in
///   │ Rp 46.400    │  what a walk-in pays — red, with the shelf price struck
///   │ M L XL  9 pcs│  its sizes (struck where none is left) and its stock
///   └──────────────┘
///
/// Pointing at a swatch (or tabbing to it) shows that colour in the picture;
/// pressing it opens the article on that colour. The rest of the tile opens it
/// on the SKU the tile stands for. By SKU, a tile is one colour and one size.
function ProductTile({
  card,
  bySku,
  holding,
  currency,
  onOpen,
}: {
  card: Card
  bySku: boolean
  /// The article's pieces by size and colour; `null` while unknown, or by SKU.
  holding: Holding | null
  currency: string
  onOpen: (sku: string) => void
}) {
  const { lead, shape } = card
  const ownColour = shape.colours.find((one) => sameColour(one, lead.colour))
  const colours = bySku && ownColour !== undefined ? [ownColour] : shape.colours
  const sizes = bySku ? (lead.size === null ? [] : [lead.size]) : shape.sizes

  /// The colour the picture shows while a swatch is pointed at.
  const [preview, setPreview] = useState<ArticleColour | null>(null)
  const pictured = preview?.skus[0] ?? lead.row
  const showing = preview ?? ownColour

  /// While a colour is pointed at, the tile speaks for that colour alone: its
  /// sizes (struck where that colour has none left), its pieces, and the
  /// stamp when it is gone — so "no Navy in M, but there is an L", and "Navy
  /// is gone but Black is not", are both on the tile.
  const looked =
    preview === null || holding === null
      ? null
      : {
          sizes: shape.sizes.filter((size) =>
            preview.skus.some(
              (one) => shape.variant.get(one.sku_code)?.size === size,
            ),
          ),
          held: holding.byColour.get((preview.label ?? "").toLowerCase()),
        }
  const lookedPieces =
    looked === null
      ? null
      : [...(looked.held?.values() ?? [])].reduce((a, b) => a + b, 0)
  const stamped = lookedPieces === null ? card.soldOut : lookedPieces <= 0
  const pieces = lookedPieces ?? card.stock?.total ?? null

  const was = lead.row.base_unit_price_minor
  const down = lead.final < was
  const off = percentOff(lead.final, was)
  const deals = dealsOfCard(card.items)
  const voucher = deals.voucher[0]?.coupon_code
  const deal =
    deals.applied[0]?.name ??
    deals.promotion[0]?.name ??
    (voucher != null ? `Code ${voucher}` : undefined)
  const hidden = colours.length - SWATCHES
  const gone = (colour: ArticleColour) =>
    holding !== null &&
    (holding.colours.get((colour.label ?? "").toLowerCase()) ?? 0) <= 0
  /// What a swatch says when pointed at or read aloud: which sizes of it are
  /// left.
  const left = (colour: ArticleColour) => {
    if (holding === null) return undefined
    const sizes = sizesLeft(holding, colour.label, shape.sizes)
    return sizes.length === 0
      ? "sold out"
      : sizes.length === 1 && sizes[0] === ""
        ? "in stock"
        : `${sizes.join(", ")} left`
  }

  return (
    <div
      tabIndex={0}
      onClick={() => onOpen(lead.row.sku_code)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen(lead.row.sku_code)
        }
      }}
      onPointerLeave={() => setPreview(null)}
      className="@container/tile flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft transition-[border-color,scale] duration-(--t-press) ease-(--ease-out) outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent active:scale-[0.98] motion-reduce:active:scale-100 [@media(hover:hover)]:hover:border-hairline-strong"
    >
      <div className="relative aspect-square bg-soft-2">
        <div
          className={cn(
            "size-full transition-opacity duration-(--t-panel)",
            stamped && "opacity-35 grayscale",
          )}
        >
          <Photograph
            sku={pictured.sku_code}
            has={pictured.has_image}
            name={pictured.name}
          />
        </div>
        {off > 0 && (
          <span className="absolute top-2 left-2 rounded-full bg-bad px-2 py-0.5 text-[0.875rem] font-semibold text-on-dark tabular-nums">
            −{off}%
          </span>
        )}
        {stamped && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <SoldOutStamp />
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 px-3 pt-2.5 pb-3">
        {colours.length > 0 && (
          <div className="-ml-0.5 flex min-h-7 min-w-0 items-center">
            {colours.slice(0, SWATCHES).map((colour, at) => (
              <Swatch
                key={colour.label ?? ""}
                colour={colour}
                on={colours.length > 1 && colour === showing}
                gone={!bySku && gone(colour)}
                note={bySku ? undefined : left(colour)}
                onPreview={() => setPreview(colour)}
                onPick={() => onOpen((colour.skus[0] ?? lead.row).sku_code)}
                // A tile two across on a 320px phone has room for three.
                className={
                  at === SWATCHES - 1 ? "@max-[9rem]/tile:hidden" : undefined
                }
              />
            ))}
            {colours.length === 1 && (colours[0]?.label ?? null) !== null && (
              <span className="ml-1 min-w-0 truncate text-[0.875rem] text-mute">
                {colours[0]?.label}
              </span>
            )}
            {hidden > 0 && (
              <span className="ml-1 text-[0.875rem] text-mute tabular-nums @max-[9rem]/tile:hidden">
                +{count(hidden)}
              </span>
            )}
            {colours.length >= SWATCHES && (
              <span className="ml-1 hidden text-[0.875rem] text-mute tabular-nums @max-[9rem]/tile:inline">
                +{count(hidden + 1)}
              </span>
            )}
          </div>
        )}

        <p className="line-clamp-2 text-[0.9375rem] leading-snug font-medium break-words text-ink">
          {shape.name}
        </p>
        <p className="truncate font-mono text-[0.875rem] text-mute">
          {bySku
            ? `${articleId(lead.row.article_code, lead.row.sku_code)} · ${skuText(lead.row.sku_code)}`
            : articleId(lead.row.article_code, lead.row.sku_code)}
        </p>
        {deal !== undefined && (
          <p className="truncate text-[0.875rem] text-accent">{deal}</p>
        )}

        <p className="mt-auto flex flex-wrap items-baseline gap-x-1.5 pt-1 tabular-nums">
          {card.from && <span className="text-[0.875rem] text-mute">From</span>}
          <span
            className={cn(
              "text-[0.9375rem] font-semibold",
              down ? "text-bad-fg" : "text-ink",
            )}
          >
            {money(lead.final, currency)}
          </span>
          {/* Both numbers when it is brought down: a was-price with nothing
              struck through is just a smaller price. */}
          {down && (
            <span className="text-[0.875rem] text-mute line-through">
              {money(was, currency)}
            </span>
          )}
        </p>

        <div className="flex items-baseline justify-between gap-2 text-[0.875rem] text-mute">
          <span className="min-w-0 truncate">
            {looked !== null ? (
              <Sizes
                sizes={looked.sizes}
                holding={{
                  sizes: looked.held ?? new Map(),
                  colours: holding?.colours ?? new Map(),
                  byColour: holding?.byColour ?? new Map(),
                }}
              />
            ) : (
              sizes.length > 0 &&
              (sizes.length <= 5 ? (
                <Sizes sizes={sizes} holding={holding} />
              ) : (
                sizeLine(sizes)
              ))
            )}
          </span>
          {pieces !== null && !stamped && (
            <span className="shrink-0 tabular-nums">{pcs(pieces)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

/// Swatches drawn on a tile before the rest are a count.
const SWATCHES = 4

function sameColour(colour: ArticleColour, label: Item["colour"] | undefined) {
  return (colour.label ?? "").toLowerCase() === (label ?? "").toLowerCase()
}

/// One colour on a tile: an 18px dot, ringed while it is the one pictured and
/// slashed when none of it is left. The button is 24px and its hit area a
/// little more — four of them and a "+N" still fit a tile two across on a
/// 320px phone.
function Swatch({
  colour,
  on,
  gone,
  note,
  onPreview,
  onPick,
  className,
}: {
  colour: ArticleColour
  on: boolean
  gone: boolean
  /// Which of its sizes are left: "L, XL left", "sold out".
  note?: string
  onPreview: () => void
  onPick: () => void
  className?: string
}) {
  const name = `${colour.label ?? "No colour"}${note === undefined ? "" : ` · ${note}`}`
  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      onClick={(event) => {
        event.stopPropagation()
        onPick()
      }}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") onPreview()
      }}
      onFocus={onPreview}
      className={cn(
        "relative grid size-6 shrink-0 place-items-center rounded-full outline-none after:absolute after:-inset-0.5 after:content-[''] focus-visible:outline-2 focus-visible:outline-accent",
        className,
      )}
    >
      <span
        style={{ background: swatchBackground(colour.paint) }}
        className={cn(
          "relative size-[1.125rem] rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)] transition-[box-shadow] duration-(--t-hover) ease-(--ease-out)",
          on &&
            "shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14),0_0_0_2px_var(--canvas),0_0_0_3.5px_var(--ink)]",
          gone &&
            "before:absolute before:top-1/2 before:left-1/2 before:h-[1.5px] before:w-[125%] before:-translate-1/2 before:-rotate-45 before:bg-canvas before:shadow-[0_0_0_0.75px_rgb(0_0_0/0.55)] before:content-['']",
        )}
      />
    </button>
  )
}

/// The order the list is read in, as one menu — the desk's; on a phone it is a
/// row of the dock's ⚙ sheet.
///
/// The hub's `ChoiceMenu`, drawn here rather than imported: this app has no
/// menu kit yet and one control is not a reason to start one.
function OrderMenu({
  value,
  onChange,
}: {
  value: Order
  onChange: (next: Order) => void
}) {
  return (
    <Menu.Root>
      <Menu.Trigger className="inline-flex h-9 items-center gap-1.5 rounded-inner px-3 text-[0.875rem] font-medium text-body transition-colors hover:bg-soft-2 hover:text-ink data-[popup-open]:bg-soft-2 data-[popup-open]:text-ink pointer-coarse:h-11">
        <ArrowUpDown className="size-4 stroke-[1.7]" />
        {orderName(value)}
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
            <span className="block px-2 pt-1 pb-1.5 text-[0.875rem] font-medium text-mute">
              Sort by
            </span>
            {ORDERS.map(([one, name]) => {
              const on = one === value
              return (
                <Menu.Item
                  key={one}
                  onClick={() => onChange(one)}
                  className={cn(
                    "flex min-h-9 cursor-default items-center gap-2 rounded-inner px-2 text-[0.875rem] text-text outline-none select-none data-[highlighted]:bg-soft-2 pointer-coarse:min-h-tap",
                    on && "text-ink",
                  )}
                >
                  <span className="grid w-4 shrink-0 place-items-center text-accent">
                    {on && <Check className="size-4" />}
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

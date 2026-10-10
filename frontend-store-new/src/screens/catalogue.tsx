import { Menu } from "@base-ui/react/menu"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { ArrowUpDown, Check, Plus, Search, Sparkles, X } from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { CardList } from "@/components/ui/card-list"
import { LeadCard } from "@/components/ui/lead-card"
import { PickerSheet } from "@/components/ui/picker-sheet"
import { Pill } from "@/components/ui/pill"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, label } from "@/lib/format"
import { useGo } from "@/lib/go"
import { useParam, type Search as UrlSearch } from "@/lib/params"
import {
  catalogueKey,
  fetchCatalogue,
  fetchOffers,
  offersKey,
} from "@/lib/queries"
import { isDown } from "@/lib/prices"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { Photograph } from "@/screens/catalogue-parts"
import { ProductSheet } from "@/screens/product"
import type { CatalogRow } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// The range, as somebody standing in front of it sees it — and the TEMPLATE
/// for a list screen in this app (the hub's patterns, on the shop's data).
///
/// ## What is on the page
///
/// Nothing at the top but the title and one line of figures. Everything that
/// searches, narrows or orders the list lives in the DOCK over the phone's
/// bottom bar (`DockTools`): the search, the division as the status chip
/// (Everything / Pria / Wanita…), and in its ⚙ sheet the order ("Range") and
/// the By article / By SKU view, and the tags as the filter. On a desk the same
/// controls are a toolbar and a docked panel, because a mouse has the room.
///
/// The records are the uniform lead-figure card (`LeadCard`): a thumbnail, the
/// name over its code, the price as the one figure, and "N SKUs" in the foot —
/// one column on a phone, the same cards in a grid on a desk. An article opens
/// as a sheet over the list (`ProductSheet`, `?sku=` in the URL).
///
/// The shop already had a price *list* — `/sell` searches the resident book
/// when a scan fails, and answers with rows of text. This is the other half of
/// the same data and a different question: the list answers "how much is this
/// one", and a person asking it is holding the garment. This answers "what do
/// we have", and a person asking that is not holding anything yet.
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
  const router = useRouter()
  const navigate = useNavigate()
  const search = useParam("q")
  const division = useParam("division")
  const viewParam = useParam("view")
  const sku = useParam("sku")
  const view = viewParam.value ?? "article"

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
    /// whole surface exists to prevent. It only runs while somebody is looking
    /// at it.
    refetchInterval: 60_000,
  })

  /// Only to put a number on the promotions line and to say which promotions
  /// reach an article. A failure here must not take the catalogue down with it
  /// — the prices are the point, and an offers endpoint an older node does not
  /// serve should cost the line and nothing else.
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
  /// the filter already applied.
  const wordMatched = useMemo(
    () => rows.filter((row) => matchesWords(row, needle)),
    [rows, needle],
  )

  /// Tags the range is narrowed to; a row must carry every one.
  const [chosenTags, setChosenTags] = useState<readonly string[]>([])
  const [tagsOpen, setTagsOpen] = useState(false)
  const searchable = useMemo(
    () =>
      chosenTags.length === 0
        ? wordMatched
        : wordMatched.filter((row) =>
            chosenTags.every((tag) => row.tags.includes(tag)),
          ),
    [wordMatched, chosenTags],
  )
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of wordMatched)
      for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) =>
      a[1] === b[1] ? a[0].localeCompare(b[0]) : b[1] - a[1],
    )
  }, [wordMatched])

  /// What each division holds, counted in the unit the list is showing —
  /// articles in the article view, SKUs in the SKU view — so a division's
  /// figure and the cards it narrows to cannot disagree.
  const divisions = useMemo(() => {
    const units = new Map<string, Set<string>>()
    for (const row of searchable) {
      const code = row.division_code
      if (code === null || code === "") continue
      const unit =
        view === "sku" ? row.sku_code : (row.article_code ?? row.sku_code)
      const set = units.get(code)
      if (set === undefined) units.set(code, new Set([unit]))
      else set.add(unit)
    }
    return [...units.entries()]
      .map(([code, set]) => [code, set.size] as const)
      .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : b[1] - a[1]))
  }, [searchable, view])

  /// An article is a style; a SKU is one of its sizes or colours. A row
  /// without an article code stands alone.
  const articles = useMemo(
    () =>
      new Set(searchable.map((row) => row.article_code ?? row.sku_code)).size,
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

  /// One card per article: its SKUs folded into the cheapest of them, in the
  /// order the first of them appeared. A row with no article code stands alone.
  const cards = useMemo(() => {
    if (view === "sku")
      return shown.map((row) => ({ row, skus: 1, from: false }))
    const groups = new Map<string, CatalogRow[]>()
    for (const row of shown) {
      const key = row.article_code ?? row.sku_code
      const group = groups.get(key)
      if (group === undefined) groups.set(key, [row])
      else group.push(row)
    }
    return [...groups.values()].map((group) => {
      const row = group.reduce((a, b) =>
        b.unit_price_minor < a.unit_price_minor ? b : a,
      )
      return {
        row,
        skus: group.length,
        from: group.some(
          (one) => one.unit_price_minor !== row.unit_price_minor,
        ),
      }
    })
  }, [shown, view])

  /// How many cards are in the document.
  ///
  /// The whole book is in memory — that is what makes this screen work offline
  /// — but a thousand `<img>` tags in one list is a phone that stops scrolling.
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
  const scope = `${needle}|${division.value ?? ""}|${order}|${view}|${chosenTags.join(",")}`
  const [lastScope, setLastScope] = useState(scope)
  if (scope !== lastScope) {
    setLastScope(scope)
    setLimit(PAGE)
  }

  const filtered =
    needle !== "" || division.value !== undefined || chosenTags.length > 0
  const pick = (code: string | undefined) => division.set(code)
  const noun =
    view === "sku"
      ? cards.length === 1
        ? "SKU"
        : "SKUs"
      : cards.length === 1
        ? "article"
        : "articles"

  // An article opens as a sheet over the list. Opening pushes a history entry
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
    <Screen
      counter
      // Named, because the grid below is a container too and the two questions
      // are different: THIS one asks whether the page has room for the
      // division panel, that one how many cards fit beside it.
      className="@container/page"
    >
      {/* The dock, on a phone: renders nothing anywhere else. */}
      <DockTools
        search={{
          value: typed,
          onChange: setTyped,
          label: view === "sku" ? "Search SKUs" : "Search articles",
        }}
        status={{
          value: division.value ?? "",
          options: [
            {
              value: "",
              label: "Everything",
              count: view === "sku" ? searchable.length : articles,
            },
            ...divisions.map(([code, howMany]) => ({
              value: code,
              label: label(code),
              count: howMany,
            })),
          ],
          onChange: (next) => pick(next === "" ? undefined : next),
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
        filter={{
          count: chosenTags.length,
          label: "Tags",
          onOpen: () => setTagsOpen(true),
        }}
        views={[
          {
            title: "View",
            value: view,
            options: [
              { value: "article", label: "By article" },
              { value: "sku", label: "By SKU" },
            ],
            onChange: (next) =>
              viewParam.set(next === "article" ? undefined : (next as View)),
          },
        ]}
      />
      <PickerSheet
        open={tagsOpen}
        onOpenChange={setTagsOpen}
        title="Tags"
        multiple
        searchable
        options={tagCounts.map(([tag, howMany]) => ({
          value: tag,
          text: `${tag} ${label(tag)}`,
          label: (
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate">{label(tag)}</span>
              <span className="text-body tabular-nums">{count(howMany)}</span>
            </span>
          ),
        }))}
        selected={chosenTags}
        onPick={(tag) =>
          setChosenTags((was) =>
            was.includes(tag)
              ? was.filter((one) => one !== tag)
              : [...was, tag],
          )
        }
      />

      {/* The Sourcing page's shape: what is on the glass at the left, what
          narrows it docked at the right where there is room for it.

          Docked by a CONTAINER query on the page, not by `dock:`. The hub's
          `dock:` reads `data-dock`, which its shell publishes from the width
          of the page column; this shell does not publish it yet. The page's
          own width is the same question asked of the same box, with nothing to
          clean up. 60rem of page is the hub's threshold. */}
      <div className="grid min-w-0 items-start gap-5 @min-[60rem]/page:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          {/* The desk's toolbar: search at the left, the view and the order at
              the right. On a phone all three are the dock's. */}
          <div className="mb-3.5 flex flex-wrap items-center gap-[0.4375rem] max-md:hidden">
            <label className="relative min-w-0 flex-[0_1_18rem]">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-line-ico" />
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Name, SKU or barcode"
                aria-label="Search the range"
                enterKeyHint="search"
                className="h-9 w-full rounded-inner border border-hairline-2 bg-canvas pr-9 pl-8 text-[0.875rem] text-ink shadow-soft outline-none placeholder:text-body hover:border-hairline-strong focus:border-accent pointer-coarse:h-11"
              />
              {typed !== "" && (
                <button
                  type="button"
                  onClick={() => setTyped("")}
                  aria-label="Clear the search"
                  className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:size-9"
                >
                  <X className="size-4" />
                </button>
              )}
            </label>
            <span className="flex-1" />
            <Segmented<View>
              value={view}
              onChange={(next) =>
                viewParam.set(next === "article" ? undefined : next)
              }
              options={[
                { value: "article", label: "By article" },
                { value: "sku", label: "By SKU" },
              ]}
            />
            <OrderMenu value={order} onChange={setOrder} />
          </div>

          {/* The divisions across the top where the panel has no room — a
              tablet held upright. Wrapping, never scrolling sideways. On a
              phone they are the dock's status chip. */}
          {divisions.length > 0 && (
            <div className="mb-3.5 flex flex-wrap gap-2 max-md:hidden @min-[60rem]/page:hidden">
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

          {/* One line of figures — what is on the glass — and, when something
              is on offer, where to read it. A promotion is not a price, so no
              card can show one; hidden entirely at zero rather than shown as "0
              promotions": a shop running nothing does not need to be told so
              every time it looks up a price. */}
          <div className="mb-3 flex items-center gap-3">
            <p className="min-w-0 flex-1 truncate text-meta text-body">
              <b className="font-medium text-ink">{count(cards.length)}</b>{" "}
              {noun}
              {filtered && " match"}
            </p>
            {running + soon > 0 && (
              <button
                type="button"
                onClick={() => go("/promotions")}
                className="relative inline-flex shrink-0 items-center gap-1.5 text-meta font-medium text-accent after:absolute after:-inset-2 after:content-['']"
              >
                <Sparkles className="size-4" />
                {running > 0
                  ? `${count(running)} ${running === 1 ? "promotion" : "promotions"} on`
                  : `${count(soon)} starting soon`}
              </button>
            )}
          </div>

          {/* A shop with no price book is not a shop with an empty range, and
              the difference is whose problem it is: one is a sync that has not
              landed, the other is a merchandiser's. */}
          {book !== undefined && !book.has_price_book && (
            <Banner tone="warn" className="mb-3.5">
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
                          setChosenTags([])
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
                    : "This shop has no priced articles yet."}
                </EmptyState>
              ) : (
                <>
                  <CardList grid>
                    {cards.slice(0, limit).map(({ row, skus, from }) => (
                      <ProductCard
                        key={row.sku_code}
                        row={row}
                        skus={view === "article" ? skus : undefined}
                        from={from}
                        currency={book?.currency ?? "IDR"}
                        onOpen={() => open(row.sku_code)}
                      />
                    ))}
                  </CardList>
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
        </div>

        <DivisionPanel
          divisions={divisions}
          chosen={division.value}
          onPick={pick}
          loaded={book !== undefined}
          articles={articles}
          skus={searchable.length}
          everything={view === "sku" ? searchable.length : articles}
          tags={tagCounts}
          chosenTags={chosenTags}
          onTags={setChosenTags}
          className="hidden @min-[60rem]/page:flex"
        />
      </div>

      <ProductSheet
        sku={sku.value}
        rows={rows}
        loaded={book !== undefined}
        offers={offers.data?.running ?? null}
        currency={book?.currency ?? "IDR"}
        onSku={(next) => sku.set(next)}
        onClose={close}
      />
    </Screen>
  )
}

/// How many cards are drawn before somebody asks for more.
const PAGE = 48

type View = "article" | "sku"
type Order = "range" | "cheapest" | "dearest" | "name"

const ORDERS: readonly (readonly [Order, string])[] = [
  ["range", "Range"],
  ["cheapest", "Cheapest"],
  ["dearest", "Dearest"],
  ["name", "A–Z"],
]

function orderName(order: Order): string {
  return (ORDERS.find(([one]) => one === order) ?? ORDERS[0])[1]
}

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

/// One article — or one SKU — as the uniform card: the photograph at the left
/// of the name, the code under it, the price as the one figure, and how many
/// SKUs it folds in the foot. A marked-down price says so in the foot's one
/// status and strikes the old price under the figure.
function ProductCard({
  row,
  skus,
  from = false,
  currency,
  onOpen,
}: {
  row: CatalogRow
  /// Set when the card stands for an article: how many SKUs it folds.
  skus?: number
  /// The article's SKUs are not all the same price, so this is the lowest.
  from?: boolean
  currency: string
  onOpen: () => void
}) {
  const down = isDown(row)
  const division =
    row.division_code !== null && row.division_code !== ""
      ? label(row.division_code)
      : undefined
  const info =
    skus === undefined
      ? division
      : `${count(skus)} ${skus === 1 ? "SKU" : "SKUs"}${division === undefined ? "" : ` · ${division}`}`

  return (
    <LeadCard
      onOpen={onOpen}
      media={
        <Photograph sku={row.sku_code} has={row.has_image} name={row.name} />
      }
      title={row.name}
      code={
        skus === undefined ? row.sku_code : (row.article_code ?? row.sku_code)
      }
      lead={{
        figure: money(row.unit_price_minor, currency),
        // Both numbers when it is marked down, because a was-price with
        // nothing struck through is just a smaller price and reads as a
        // mistake.
        caption: from ? (
          "from"
        ) : down ? (
          <span className="line-through">
            {money(row.base_unit_price_minor, currency)}
          </span>
        ) : undefined,
      }}
      foot={{
        info,
        status: down ? <Pill tone="bad">Price down</Pill> : undefined,
      }}
    />
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

/// The divisions, docked beside the list — the hub's `DockedFilters` for a list
/// that has exactly one thing to narrow by.
///
/// A list of every division with its count rather than a select: a catalogue is
/// browsed rather than queried, and the counts are how somebody discovers that
/// what they are after is filed under a division they had not thought of. The
/// two figures above it are counted over the same base as the list, so a figure
/// and the rows under it cannot disagree.
function DivisionPanel({
  divisions,
  chosen,
  onPick,
  loaded,
  articles,
  skus,
  everything,
  tags,
  chosenTags,
  onTags,
  className,
}: {
  /// Every tag on the words-matched range, commonest first, with its count.
  tags: readonly (readonly [string, number])[]
  chosenTags: readonly string[]
  onTags: (next: readonly string[]) => void
  divisions: readonly (readonly [string, number])[]
  chosen: string | undefined
  onPick: (code: string | undefined) => void
  /// False until the book has arrived, so the figures read "—" rather than a
  /// confident zero while the request is still in flight.
  loaded: boolean
  articles: number
  skus: number
  /// What "Everything" holds in the unit the list shows.
  everything: number
  className?: string
}) {
  return (
    <aside
      aria-label="Divisions"
      className={cn(
        "sticky top-5 flex-col gap-2.5 self-start rounded-card border border-hairline bg-canvas p-4 shadow-soft",
        className,
      )}
    >
      <dl className="-mx-1 mb-1 grid grid-cols-2 gap-x-3 gap-y-2 border-b border-hairline px-1 pb-3">
        <div className="min-w-0">
          <dt className="truncate text-[0.875rem] text-body">Articles</dt>
          <dd className="truncate text-[1.125rem] leading-tight font-semibold text-ink tabular-nums">
            {loaded ? count(articles) : "—"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-[0.875rem] text-body">SKUs</dt>
          <dd className="truncate text-[1.125rem] leading-tight font-semibold text-ink tabular-nums">
            {loaded ? count(skus) : "—"}
          </dd>
        </div>
      </dl>

      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[0.9375rem] font-medium text-body">Division</h4>
        {chosen !== undefined && (
          <button
            type="button"
            onClick={() => onPick(undefined)}
            className="text-[0.875rem] font-medium text-body transition-colors hover:text-ink pointer-coarse:min-h-tap"
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
          howMany={loaded ? everything : undefined}
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

      <TagPicker tags={tags} chosen={chosenTags} onChange={onTags} />
    </aside>
  )
}

/// Tags, without listing them all: the ones in use as removable chips, and a
/// "+ Tags" button that opens a search over the rest. A range can carry
/// hundreds of tags, so the list only ever shows what matches what is typed.
function TagPicker({
  tags,
  chosen,
  onChange,
}: {
  tags: readonly (readonly [string, number])[]
  chosen: readonly string[]
  onChange: (next: readonly string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const needle = typed.trim().toLowerCase()
  const matches = tags
    .filter(
      ([tag]) =>
        !chosen.includes(tag) &&
        (needle === "" ||
          `${tag} ${label(tag)}`.toLowerCase().includes(needle)),
    )
    .slice(0, 6)
  const add = (tag: string) => {
    onChange([...chosen, tag])
    setTyped("")
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-hairline pt-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[0.9375rem] font-medium text-body">Tags</h4>
        {chosen.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[0.875rem] font-medium text-body transition-colors hover:text-ink"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chosen.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onChange(chosen.filter((one) => one !== tag))}
            aria-label={`Remove ${label(tag)}`}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-accent px-3 text-[0.875rem] font-medium text-on-dark"
          >
            {label(tag)}
            <X className="size-3.5" />
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-hairline-2 px-3 text-[0.875rem] font-medium text-body transition-colors hover:text-ink"
        >
          <Plus className="size-3.5" />
          Tags
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1 rounded-inner border border-hairline p-1.5">
          <input
            autoFocus
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false)
              if (event.key === "Enter" && matches[0] !== undefined)
                add(matches[0][0])
            }}
            placeholder="Search tags"
            aria-label="Search tags"
            className="h-9 w-full rounded-inner bg-soft-2 px-2.5 text-[0.875rem] text-ink outline-none placeholder:text-mute"
          />
          {matches.length === 0 ? (
            <span className="px-2 py-1.5 text-[0.875rem] text-mute">
              No tag matches
            </span>
          ) : (
            matches.map(([tag, howMany]) => (
              <button
                key={tag}
                type="button"
                onClick={() => add(tag)}
                className="flex min-h-9 items-center justify-between gap-2 rounded-inner px-2 text-left text-[0.875rem] text-body transition-colors hover:bg-soft-2 hover:text-ink"
              >
                <span className="truncate">{label(tag)}</span>
                <span className="text-mute tabular-nums">{count(howMany)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/// One division in the panel. Chosen is the panel's own grammar — the accent's
/// wash and the heavier weight — the same as a screen's row in the light
/// sidebar.
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
        "flex min-h-9 w-full items-center gap-2 rounded-inner px-2.5 text-left text-[0.875rem] transition-colors pointer-coarse:min-h-tap",
        on
          ? "bg-accent-bg font-medium text-accent"
          : "text-body hover:bg-soft-2 hover:text-ink",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="shrink-0 text-[0.875rem] font-normal text-mute tabular-nums">
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
        "h-9 shrink-0 rounded-inner px-3.5 text-[0.875rem] font-medium whitespace-nowrap transition-colors pointer-coarse:h-tap",
        on
          ? "bg-accent text-on-dark"
          : "border border-hairline-2 bg-canvas text-body shadow-soft",
      )}
    >
      {children}
    </button>
  )
}

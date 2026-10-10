import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query"
import { Menu } from "@base-ui/react/menu"
import { ChevronRight, Eye } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/field"
import { FilterOmnibox } from "@/components/ui/filter-omnibox"
import { PageHeader } from "@/components/ui/page-header"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Switch } from "@/components/ui/form"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Thumbnail } from "@/components/ui/thumbnail"
import {
  Banner,
  EmptyState,
  LoadMore,
  type Pageable,
} from "@/components/ui/states"
import {
  ago,
  count,
  day,
  dayMonth,
  money,
  moment,
  percent,
  percentBps,
} from "@/lib/format"
import { POP_MOTION } from "@/lib/filter-chrome"
import { cn } from "@/lib/utils"
import {
  articlePrices,
  articlePricesPagesQuery,
  campaignCatalogue,
  commercialKeys,
  commercialProductsByArticles,
  priceScopeFromFilters,
  type ArticlePriceScope,
  describeLevel,
  describeSource,
  listPriceBooks,
  markupBps,
  priceBookDetail,
  priceHistory,
  priceHistoryKeys,
  promotionCatalogue,
  shelfPrices,
  simulate,
  type AppliedRule,
  type RejectedRule,
  type SimulateResult,
  type PricelistShop,
  type ArticlePricePoint,
  type ArticlePriceRow,
  type ArticlePriceRule,
  type ArticlePriceShop,
  type ArticlePrices,
  type CommercialChannel,
  type PriceScope,
  type PublishReceipt,
} from "@/lib/queries/commercial"
import {
  fleetPools,
  inventoryKeys,
  poolAvailability,
} from "@/lib/queries/inventory"
import { useFilterState, type FilterField } from "@/lib/filters"
import { useLayout } from "@/lib/layout"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import {
  listTerms,
  vocabularyKeys,
  type MasterTerm,
} from "@/lib/queries/vocabulary"
import { useDebounced } from "@/lib/use-debounced"
import { ChangePriceSheet } from "@/screens/commercial/change-price-sheet"
import { Named, Quiet } from "@/screens/commercial/parts"
import {
  CardFigure,
  CardFoot,
  CardName,
  Fig,
  PhoneCard,
  Sentence,
} from "@/components/ui/phone-cards"
import { cellKey, conditionsOf } from "@/screens/commercial/shared"

/// The pricelist — what every article costs at every shop, right now, and why.
///
/// This is the merged reading of the grid: one row per band of sizes that
/// costs the same everywhere, one column per shop, one figure per cell — what
/// the till charges a walk-in shopper *right now*, promotions included. There
/// is no separate "pricelist" reading any more: asking for the shelf price
/// without what a shopper actually pays was always the same question asked one
/// step too early, and keeping both meant every screen that read this file had
/// to say twice which one it meant.
///
///  1. **The column model is data.** `shops[]` comes back from the endpoint —
///     the STORE origins the centre knows about — so the grid's shape changes
///     when the client opens a branch, and nothing here names a shop.
///  2. **A band is a fact about the data, not a rendering choice.** When every
///     SKU of a style shares one signature — the same base price, the same
///     winning rule at every shop, the same final price where that is known —
///     it is one row, "All sizes". When they do not, each group of SKUs that
///     agree gets its own row, labelled by the sizes it covers.
///  3. **Markdown and Promotion never stack.** The engine's own `final_price`
///     is what is drawn; a markdown rung that lost to a promotion (or the
///     reverse) is shown struck through underneath the one that won, because
///     both are real and only one of them is being charged.

/// What the till would charge before any promotion — the best-ranked
/// candidate that is not a markdown. A markdown is measured against this, not
/// against the base price: a store with its own price that then marks down is
/// cutting ITS price, not the company's.
/// Whether a rung prices this SKU. A rung with no breakdown covers everything
/// it won; one with a breakdown covers only the SKUs it names — a markdown on
/// size XL is not a markdown on size M.
function covers(rule: ArticlePriceRule, skuCode: string | null): boolean {
  if (skuCode === null) return true
  const points = pointsOf(rule)
  if (points.length === 1 && points[0].sku_codes.length === 0) return true
  return points.some((point) => point.sku_codes.includes(skuCode))
}

function regularRuleOf(
  shop: ArticlePriceShop | undefined,
  skuCode: string | null = null
): ArticlePriceRule | undefined {
  return shop?.stack.find(
    (rule) => rule.source !== "MARKDOWN" && covers(rule, skuCode)
  )
}

function markdownRuleOf(
  shop: ArticlePriceShop | undefined,
  skuCode: string | null = null
): ArticlePriceRule | undefined {
  return shop?.stack.find(
    (rule) => rule.source === "MARKDOWN" && covers(rule, skuCode)
  )
}

/// What the till charges, before promotions. `undefined` when this shop
/// cannot sell the style at all — absent rather than zero, because no price is
/// not a price.
function winner(
  shop: ArticlePriceShop | undefined
): ArticlePriceRule | undefined {
  return shop?.stack[0]
}

/// The distinct prices one candidate carries, always as a list.
///
/// `points` is the server's own breakdown of the same rung it drew the range
/// from. The fallback is for a rung that arrives without one: a price is never
/// dropped just because the breakdown is missing, and a rung with no
/// breakdown is read as one price covering every SKU it won.
function pointsOf(rule: ArticlePriceRule): readonly ArticlePricePoint[] {
  if (rule.points.length > 0) return rule.points
  return [
    {
      unit_price_minor: rule.min_unit_price_minor,
      sku_codes: [],
      in_force_for: rule.in_force_for,
    },
  ]
}

/// A candidate's prices as one sentence, for prose that has no rows to use.
function amounts(rule: ArticlePriceRule): string {
  return pointsOf(rule)
    .map((point) => money(point.unit_price_minor))
    .join(", ")
}

/// One rule's price for one SKU. `null` when the rule's own breakdown does not
/// mention that SKU at all — a shop whose assortment skips a size prices
/// nothing for it, and that is different from pricing it at the rule's lowest
/// point.
function amountFor(
  rule: ArticlePriceRule | undefined,
  skuCode: string | null
): number | null {
  if (rule === undefined) return null
  const points = pointsOf(rule)
  // No real breakdown — the rung is one price, uniform over everything it won.
  if (points.length === 1 && points[0].sku_codes.length === 0)
    return points[0].unit_price_minor
  if (skuCode === null) return points[0]?.unit_price_minor ?? null
  return (
    points.find((point) => point.sku_codes.includes(skuCode))
      ?.unit_price_minor ?? null
  )
}

/// The key a cell is opened under, and read back from.
function readCellKey(value: string | undefined): {
  articleCode: string
  siteId: string
} | null {
  if (value === undefined) return null
  const at = value.lastIndexOf("@")
  if (at <= 0 || at === value.length - 1) return null
  return { articleCode: value.slice(0, at), siteId: value.slice(at + 1) }
}

/// A date in the merged grid: the house format without the year — "01 Jul –
/// 02 Aug" reads in one glance where a date with a year would not fit a cell.
/// The browser's own local time, not UTC: a markdown published today, WIB,
/// otherwise reads as if it started yesterday.
const shortDay = dayMonth
function shortSpan(from: string, to: string | null): string {
  return to === null
    ? `from ${shortDay(from)}`
    : `${shortDay(from)} – ${shortDay(to)}`
}

/// Signed percentage, the direction stated rather than implied — a markdown is
/// always shown as the cut it is.
function pctVs(amountMinor: number, ofMinor: number): string | null {
  if (ofMinor === 0) return null
  const pct = Math.round(((amountMinor - ofMinor) / ofMinor) * 100)
  if (pct === 0) return null
  return percent(pct, { signed: true })
}

/// The channel this grid is about.
///
/// A constant rather than a picker. The engine takes all three channels and
/// `ONLINE`/`MARKETPLACE` are real, but nothing in this business sells on them
/// yet, so the control offered two answers that were always empty and made the
/// third look like a choice. When a second channel starts trading, this becomes
/// a `Segmented` again.
const CHANNEL: CommercialChannel = "STORE"

/// The ticks in the right-hand panel that keep only articles carrying one of
/// these somewhere. None ticked = every article.
type PriceKind = "promotion" | "markdown" | "store"
const KIND_TICKS: readonly { value: PriceKind; label: string }[] = [
  { value: "promotion", label: "Promotion" },
  { value: "markdown", label: "Markdown" },
  { value: "store", label: "Store price" },
]

export function Pricelist() {
  // A phone draws a card per article instead of the grid, and keeps the search
  // and the filters in the drawer over the bottom bar (`DockTools`).
  const phone = useLayout() === "phone"
  /// What was typed. In the URL like every other search box in this app.
  const search = useSheet("q")
  const cell = useSheet("price")
  /// One style across every shop.
  const style = useSheet("article")
  /// One shop's whole shelf, opened from its column heading.
  const shop = useSheet("shop")

  const fields = useMemo<FilterField[]>(
    () => [
      {
        column: "division",
        label: "Division",
        spec: { kind: "option", single: true, operators: ["isAnyOf"] },
      },
      {
        column: "tag",
        label: "Tag",
        spec: { kind: "multi", single: true, operators: ["includesAnyOf"] },
      },
      {
        column: "price",
        label: "Price",
        spec: {
          kind: "number",
          unit: "Rp",
          operators: ["gte", "lte"],
        },
      },
      // The three ticks a desk keeps in its side panel ("Only articles with"),
      // as the one filter a phone has room for. Answered in the browser, over
      // the page loaded, exactly as the ticks are — the server never hears it.
      ...(phone
        ? [
            {
              column: "kind",
              label: "Only articles with",
              spec: {
                kind: "option",
                single: true,
                operators: ["isAnyOf"],
                options: KIND_TICKS.map((one) => ({
                  value: one.value,
                  label: one.label,
                })),
              },
            } satisfies FilterField,
          ]
        : []),
    ],
    [phone]
  )

  const filters = useFilterState(fields)

  /// Which reading a phone draws: the pricelist (what each article is listed
  /// at, before any promotion) or the final price (what the till charges a
  /// walk-in shopper). It is the dock's status button; a desk has the final
  /// price only.
  const [reading, setReading] = useState<"final" | "pricelist">("final")

  const divisions = useQuery({
    queryKey: vocabularyKeys.list("divisions"),
    queryFn: ({ signal }) => listTerms("divisions", signal),
  })
  const tags = useQuery({
    queryKey: vocabularyKeys.list("tags"),
    queryFn: ({ signal }) => listTerms("tags", signal),
  })

  const typed = (search.value ?? "").trim()
  const needle = useDebounced(typed, 400)
  const narrowed = useMemo<ArticlePriceScope>(
    () => ({
      ...priceScopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
    }),
    [filters.filters, needle]
  )

  /// Always the final price — what the till actually charges a walk-in
  /// shopper, promotions included. There is no other reading any more.
  const scope = useMemo<ArticlePriceScope>(
    () => ({ ...narrowed, final: !phone || reading === "final" }),
    [narrowed, phone, reading]
  )

  const prices = useInfiniteQuery(articlePricesPagesQuery(CHANNEL, scope))

  const page = useMemo(() => {
    const first = prices.data?.pages[0]
    if (first === undefined) return undefined
    return {
      ...first,
      rows: prices.data?.pages.flatMap((one: ArticlePrices) => one.rows) ?? [],
    }
  }, [prices.data])

  const books = useQuery({
    queryKey: commercialKeys.books(),
    queryFn: ({ signal }) => listPriceBooks(signal),
  })

  /// The next book that has not started yet — the same read the "Upcoming"
  /// section of the cell panel uses.
  const upcomingFrom = useMemo(() => {
    if (page === undefined) return null
    const drawnAt = new Date(page.as_of).getTime()
    const future = (books.data ?? [])
      .filter(
        (book) =>
          book.status === "PUBLISHED" &&
          new Date(book.effective_from).getTime() > drawnAt
      )
      .map((book) => book.effective_from)
      .sort()
    return future[0] ?? null
  }, [books.data, page])

  const UPCOMING_CAP = 200
  const upcoming = useQuery({
    queryKey: commercialKeys.articlePrices(CHANNEL, upcomingFrom, narrowed),
    queryFn: ({ signal }) =>
      articlePrices(
        {
          channel: CHANNEL,
          at: upcomingFrom!,
          limit: UPCOMING_CAP,
          ...narrowed,
        },
        signal
      ),
    enabled: upcomingFrom !== null,
  })

  const bookNames = useMemo(() => {
    const map = new Map<number, string>()
    for (const book of books.data ?? []) map.set(book.version, book.name)
    return map
  }, [books.data])

  /// Every published promotion's own window, by name — the merged grid draws
  /// only the promotion's name from `final_price`, and the date line beside it
  /// has to come from somewhere else. The rule's own `effective_from`/`to` wins
  /// over the book's, the same preference `describePeriod` reads by.
  const promoCatalogue = useQuery({
    queryKey: commercialKeys.catalogue(),
    queryFn: ({ signal }) => promotionCatalogue(signal),
  })
  const promoWindows = useMemo(() => {
    const map = new Map<string, string>()
    for (const rule of promoCatalogue.data?.rules ?? []) {
      const conditions = conditionsOf(rule.definition)
      const from = conditions.effective_from ?? rule.book.effective_from
      const to = conditions.effective_to ?? rule.book.effective_to
      if (!map.has(rule.name)) map.set(rule.name, shortSpan(from, to))
    }
    return map
  }, [promoCatalogue.data])

  const items = page?.rows ?? []
  const open = readCellKey(cell.value)

  /// Size names for the band rows ("XL", "34, 36") instead of raw SKU codes.
  /// One read for the loaded articles; until it lands the rows say "N SKU".
  const articleCodes = useMemo(
    () => items.map((row) => row.article_code),
    [items]
  )
  const products = useQuery({
    queryKey: commercialKeys.productsByArticles(articleCodes, 2000),
    queryFn: ({ signal }) =>
      commercialProductsByArticles(articleCodes, 2000, signal),
    enabled: articleCodes.length > 0,
  })
  useMemo(() => {
    for (const product of products.data ?? []) {
      if (product.size) SKU_SIZE.set(product.sku_code, product.size)
      const list = ARTICLE_SKUS.get(product.article_code) ?? []
      if (!list.some((one) => one.code === product.sku_code))
        list.push({
          code: product.sku_code,
          size: product.size,
          color: product.color,
        })
      ARTICLE_SKUS.set(product.article_code, list)
    }
  }, [products.data])

  /// "Only where stores differ" — client-side, over the page already loaded:
  /// a row stays when some shop charges something other than the base price,
  /// or cannot sell it at all.
  const [kinds, setKinds] = useState<ReadonlySet<PriceKind>>(() => new Set())
  const toggleKind = (kind: PriceKind, on: boolean) =>
    setKinds((was) => {
      const next = new Set(was)
      if (on) next.add(kind)
      else next.delete(kind)
      return next
    })
  /// What the rows must carry: the desk's ticks, or on a phone the filter that
  /// stands for them.
  const wanted = useMemo<ReadonlySet<PriceKind>>(
    () =>
      phone
        ? new Set(
            filters.filters
              .filter((clause) => clause.column === "kind")
              .flatMap((clause) => clause.values as PriceKind[])
          )
        : kinds,
    [phone, filters.filters, kinds]
  )
  const filteredItems = useMemo(() => {
    if (wanted.size === 0 || page === undefined) return items
    return items.filter((row) =>
      rowCarries(row, page.shops, promoWindows, wanted)
    )
  }, [items, wanted, page, promoWindows])

  // ── selection and the "Change price" sheet ────────────────────────────────
  //
  // A selection is article codes, not cells: the new sheet asks "which
  // articles, at which stores" and a row's checkbox answers the first half.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const toggleArticle = (code: string) =>
    setSelected((was) => {
      const next = new Set(was)
      if (!next.delete(code)) next.add(code)
      return next
    })
  const selectVisible = (on: boolean) =>
    setSelected(on ? new Set(items.map((row) => row.article_code)) : new Set())

  const [changePrice, setChangePrice] = useState<{
    targets: readonly ArticlePriceRow[]
    presetSites?: readonly string[]
    presetKind?: "price" | "markdown"
  } | null>(null)
  /// The open sheet's key, kept after it closes: re-keying on close remounts
  /// the sheet in the same tick and takes its "… published" dialog with it.
  const [changePriceKey, setChangePriceKey] = useState("empty")
  const openKey =
    changePrice === null
      ? changePriceKey
      : `${changePrice.targets.map((one) => one.article_code).join(",")}|${changePrice.presetSites?.join(",") ?? ""}|${changePrice.presetKind ?? ""}`
  if (openKey !== changePriceKey) setChangePriceKey(openKey)

  /// Every book the last publish wrote. Usually one; more when the batch held
  /// prices starting on different days, which is one book each.
  const [receipt, setReceipt] = useState<readonly PublishReceipt[]>([])

  /// The number a new book has to carry to win.
  const nextVersion =
    (books.data ?? []).reduce(
      (highest, book) => Math.max(highest, book.version),
      0
    ) + 1

  // ── stock, asked for only when the toggle is on ───────────────────────────
  const [showStock, setShowStock] = useState(false)
  const pools = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
    enabled: showStock,
  })
  /// Each shop's floor — the only pool a shelf price answers for.
  const floorPoolOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const one of pools.data?.items ?? [])
      if (one.pool_code === "FLOOR" && !map.has(one.site_id))
        map.set(one.site_id, one.id)
    return map
  }, [pools.data])
  const stockQueries = useQueries({
    queries: (page?.shops ?? []).map((shopMeta) => {
      const poolId = floorPoolOf.get(shopMeta.site_id)
      return {
        queryKey: inventoryKeys.poolAvailability(
          poolId ?? `none:${shopMeta.site_id}`
        ),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          poolAvailability(poolId!, {}, signal),
        enabled: showStock && poolId !== undefined,
        staleTime: 5 * 60_000,
      }
    }),
  })
  /// Site → SKU → on hand, and site → article → on hand for the rare article
  /// with no per-SKU breakdown anywhere. Built once per answer rather than
  /// searched per cell — the grid asks this map once a band, not once a SKU.
  const stockBySite = useMemo(() => {
    const map = new Map<
      string,
      {
        readonly bySku: Map<string, number>
        readonly byArticle: Map<string, number>
      }
    >()
    ;(page?.shops ?? []).forEach((shopMeta, index) => {
      const data = stockQueries[index]?.data
      if (data === undefined) return
      const bySku = new Map<string, number>()
      const byArticle = new Map<string, number>()
      for (const item of data.items) {
        bySku.set(item.sku_code, item.on_hand_qty)
        byArticle.set(
          item.article_code,
          (byArticle.get(item.article_code) ?? 0) + item.on_hand_qty
        )
      }
      map.set(shopMeta.site_id, { bySku, byArticle })
    })
    return map
  }, [page?.shops, stockQueries])

  const divisionLabels = useMemo(
    () =>
      new Map(
        (divisions.data?.terms ?? []).map((term) => [term.code, term.label])
      ),
    [divisions.data]
  )
  const tagLabels = useMemo(
    () =>
      new Map((tags.data?.terms ?? []).map((term) => [term.code, term.label])),
    [tags.data]
  )

  const counted = useCountedFields(
    fields,
    page,
    divisions.data?.terms,
    tags.data?.terms
  )

  return (
    <PageContent fill={!phone}>
      <PageHeader crumb="Marketing" title="Pricelist" />

      {/* The search and the filters are the phone's drawer, and the colour key
          is said in words on each card. */}
      {!phone && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <FilterOmnibox
              model={{ ...filters, fields: counted }}
              text={typed === "" ? undefined : typed}
              onText={(next) => (next ? search.open(next) : search.close())}
              className="min-w-0 flex-1"
            />
            <ShowMenu
              showStock={showStock}
              onStock={() => setShowStock((was) => !was)}
              kinds={kinds}
              onKind={(value) => toggleKind(value, !kinds.has(value))}
            />
          </div>

          {/* Grey = same as base, black = a store's own price, and colour only
              for a markdown or a promotion — said once here rather than in
              every square. */}
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[0.875rem] text-body">
            {LEGEND.map((one) => (
              <span key={one.label} className="flex items-center gap-2">
                <i
                  aria-hidden
                  className="h-3.5 w-5 rounded-[4px] border"
                  style={{ background: one.fill, borderColor: one.edge }}
                />
                {one.label}
              </span>
            ))}
          </div>
        </>
      )}

      {/* The search and its clauses on one line over the grid, as Purchase
          Orders has them; what this screen adds is its Show menu, at the end
          of that line: what the grid shows, and which kinds of price an
          article must carry. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {queryState(prices, {
            loading: "Loading prices…",
            render: () =>
              page === undefined ? null : (
                <>
                  {page.shops.length === 0 && (
                    <Banner tone="warn" className="mb-4">
                      No store is registered yet.
                    </Banner>
                  )}

                  {receipt.length > 0 &&
                    (() => {
                      const named = (one: PublishReceipt) =>
                        bookNames.get(one.version) ?? "This price change"
                      const nowhere = receipt.filter(
                        (one) => one.delivered_to.length === 0
                      )
                      if (nowhere.length === 0) return null
                      return (
                        <Banner
                          tone="warn"
                          className="mb-4"
                          onDismiss={() => setReceipt([])}
                        >
                          {nowhere.length === receipt.length ? (
                            <>
                              {receipt.map(named).join(", ")}{" "}
                              {receipt.length === 1 ? "was" : "were"} published
                              but reached no store.
                            </>
                          ) : (
                            <>
                              {nowhere.map(named).join(" and ")} reached nobody.
                            </>
                          )}
                        </Banner>
                      )
                    })()}

                  {selected.size > 0 && (
                    <div className="mb-4 flex h-14 items-center gap-3 rounded-inner bg-accent-bg px-4 text-info-fg">
                      <b className="font-medium">
                        {count(selected.size)}{" "}
                        {selected.size === 1 ? "article" : "articles"} selected
                      </b>
                      <Button
                        variant="primary"
                        className="ml-auto"
                        onClick={() =>
                          setChangePrice({
                            targets: items.filter((row) =>
                              selected.has(row.article_code)
                            ),
                          })
                        }
                      >
                        Change price…
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setSelected(new Set())}
                      >
                        Clear
                      </Button>
                    </div>
                  )}

                  {phone && (
                    <>
                      {page.shops.some((one) => one.pending_publication) && (
                        <Banner tone="warn" className="mb-4">
                          {count(
                            page.shops.filter((one) => one.pending_publication)
                              .length
                          )}{" "}
                          of {count(page.shops.length)} stores have not picked
                          up the latest prices yet.
                        </Banner>
                      )}
                      {items.length > 0 && (
                        <Sentence>
                          <Fig>{count(filteredItems.length)}</Fig> of{" "}
                          <Fig>{count(page.total)}</Fig> articles.
                        </Sentence>
                      )}
                    </>
                  )}

                  <Card className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
                    {items.length === 0 ? (
                      needle === "" && filters.filters.length === 0 ? (
                        <EmptyState>No prices published yet.</EmptyState>
                      ) : (
                        <EmptyState
                          action={
                            <Button
                              variant="ghost"
                              onClick={() => {
                                search.close()
                                filters.clear()
                              }}
                            >
                              Clear search and filters
                            </Button>
                          }
                        >
                          {needle === ""
                            ? "No articles match these filters."
                            : `No articles match “${needle}”.`}
                        </EmptyState>
                      )
                    ) : filteredItems.length === 0 ? (
                      <EmptyState
                        action={
                          <Button
                            variant="ghost"
                            onClick={() => setKinds(new Set())}
                          >
                            Show every article
                          </Button>
                        }
                      >
                        No articles match.
                      </EmptyState>
                    ) : phone ? (
                      <PhonePrices
                        page={page}
                        items={filteredItems}
                        promoWindows={promoWindows}
                        divisionLabels={divisionLabels}
                        onOpenArticle={(articleCode) => style.open(articleCode)}
                        onChange={(row) => setChangePrice({ targets: [row] })}
                        more={prices}
                      />
                    ) : (
                      <PriceGrid
                        page={page}
                        items={filteredItems}
                        openCell={cell.value}
                        onOpenCell={(articleCode, siteId) => {
                          const row = items.find(
                            (one) => one.article_code === articleCode
                          )
                          if (row === undefined) return
                          const onMarkdown = row.shops
                            .find((one) => one.site_id === siteId)
                            ?.stack.some((rule) => rule.source === "MARKDOWN")
                          setChangePrice({
                            targets: [row],
                            presetSites: [siteId],
                            presetKind: onMarkdown ? "markdown" : "price",
                          })
                        }}
                        onOpenArticle={(articleCode) => style.open(articleCode)}
                        onOpenShop={(siteId) => shop.open(siteId)}
                        selected={selected}
                        onToggleArticle={toggleArticle}
                        onSelectVisible={selectVisible}
                        showStock={showStock}
                        stockBySite={stockBySite}
                        promoWindows={promoWindows}
                        divisionLabels={divisionLabels}
                        tagLabels={tagLabels}
                        more={prices}
                      />
                    )}

                    {items.length > 0 && !phone && (
                      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-hairline-2 px-4 py-3">
                        <span className="text-[0.875rem] text-mute tabular-nums">
                          {count(filteredItems.length)} of {count(page.total)}{" "}
                          articles
                        </span>
                      </div>
                    )}
                  </Card>
                </>
              ),
          })}
        </div>
      </div>

      {/* On a phone the search and the filter live in the drawer over the
          bottom bar, not at the top of the list. */}
      <DockTools
        search={{
          value: typed,
          onChange: (next) => (next ? search.replace(next) : search.close()),
          label: "Search Pricelist",
        }}
        filter={{
          count: filters.filters.length,
          panel: {
            model: filters,
            filterModel: { ...filters, fields: counted },
          },
        }}
        status={{
          value: reading,
          options: [
            { value: "pricelist", label: "Pricelist" },
            { value: "final", label: "Final price" },
          ],
          onChange: (next) => setReading(next as typeof reading),
        }}
      />

      <StoreSheet
        siteId={shop.value ?? null}
        label={
          (page?.shops ?? []).find((one) => one.site_id === shop.value)
            ?.label ?? null
        }
        channel={CHANNEL}
        at={null}
        onClose={shop.close}
      />

      <ArticleSheet
        row={
          style.value === undefined
            ? null
            : ((page?.rows ?? []).find(
                (one) => one.article_code === style.value
              ) ?? null)
        }
        shops={page?.shops ?? []}
        promoWindows={promoWindows}
        onClose={style.close}
        onOpenCell={(siteId) => {
          const row = (page?.rows ?? []).find(
            (one) => one.article_code === style.value
          )
          style.close()
          if (row === undefined) return
          setChangePrice({
            targets: [row],
            presetSites: [siteId],
            presetKind: "price",
          })
        }}
      />

      <CellSheet
        cell={open}
        channel={CHANNEL}
        at={null}
        bookNames={bookNames}
        shops={page?.shops ?? []}
        upcoming={upcoming.data ?? null}
        upcomingAt={upcomingFrom}
        row={
          open === null
            ? null
            : ((page?.rows ?? []).find(
                (one) => one.article_code === open.articleCode
              ) ?? null)
        }
        onClose={cell.close}
        onChangePrice={(preset) => {
          const row = (page?.rows ?? []).find(
            (one) => one.article_code === open?.articleCode
          )
          if (row === undefined) return
          cell.close()
          setChangePrice({
            targets: [row],
            presetSites: [preset.siteId],
            presetKind: preset.kind,
          })
        }}
      />

      <ChangePriceSheet
        key={openKey}
        open={changePrice !== null}
        targets={changePrice?.targets ?? []}
        shops={page?.shops ?? []}
        presetSites={changePrice?.presetSites}
        presetKind={changePrice?.presetKind}
        nextVersion={nextVersion}
        onClose={() => setChangePrice(null)}
        onPublished={(published) => {
          setReceipt(published)
          setSelected(new Set())
          setChangePrice(null)
        }}
      />
    </PageContent>
  )
}

/// The filter bar's fields, decorated with the server's own facet counts —
/// pulled out of the render body so the switch's removal does not leave this
/// screen re-computing it under a different name.
function useCountedFields(
  fields: readonly FilterField[],
  page: ArticlePrices | undefined,
  divisionTerms: readonly MasterTerm[] | undefined,
  tagTerms: readonly MasterTerm[] | undefined
): FilterField[] {
  return useMemo(() => {
    const names = (terms: readonly MasterTerm[] | undefined) =>
      new Map((terms ?? []).map((term) => [term.code, term.label]))
    const divisionNames = names(divisionTerms)
    const tagNames = names(tagTerms)
    const facets = page?.facets
    return fields.map((field) => {
      if (field.column === "division")
        return {
          ...field,
          spec: {
            ...field.spec,
            counted: facets?.divisions,
            format: (code: string) => divisionNames.get(code) ?? code,
          },
        }
      if (field.column === "tag")
        return {
          ...field,
          spec: {
            ...field.spec,
            counted: facets?.tags,
            format: (code: string) => tagNames.get(code) ?? code,
          },
        }
      return field
    })
  }, [fields, page?.facets, divisionTerms, tagTerms])
}

/// The four kinds of price a cell can show, as colour blocks — the same fill
/// the cells use, so the key reads as a sample of the grid.
const LEGEND = [
  {
    label: "Base price",
    fill: "#ffffff",
    edge: "var(--color-hairline-2, #dce1e8)",
  },
  { label: "Store price", fill: "#20242c", edge: "#20242c" },
  {
    label: "Markdown",
    fill: "color-mix(in srgb,#d6447e 22%,white)",
    edge: "#d6447e",
  },
  {
    label: "Promotion",
    fill: "color-mix(in srgb,#0f8a7e 22%,white)",
    edge: "#0f8a7e",
  },
] as const

// ── the grid ───────────────────────────────────────────────────────────────

/// One group of SKUs that costs the same at every shop — the base price, every
/// shop's winning rule and (where known) the final price agree for every SKU
/// in it. Almost always every SKU of the article, in which case there is one
/// band and it says "All sizes".
interface Band {
  readonly skuCodes: readonly string[]
  readonly label: string
}

/// Every SKU code any rung on this row mentions. The base for the band split —
/// when nothing mentions one, the article has no real per-SKU breakdown
/// anywhere and there is exactly one band, whatever its size count says.
function skuUniverse(row: ArticlePriceRow): readonly string[] {
  const set = new Set<string>()
  for (const shop of row.shops)
    for (const rule of shop.stack)
      for (const point of rule.points)
        for (const code of point.sku_codes) set.add(code)
  return [...set]
}

/// The common size order this catalogue actually uses, so "S–L" reads in size
/// order rather than in string order (where "L" sorts before "S"). Anything
/// not on the list falls back to numeric, then plain string, order.
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"]
/// SKU code → size, filled once the page's products have been read.
const SKU_SIZE = new Map<string, string>()
/// Article code → its SKUs, from the same read — the rows under an opened
/// article.
interface SkuLine {
  readonly code: string
  readonly size: string | null
  readonly color: string | null
}
const ARTICLE_SKUS = new Map<string, SkuLine[]>()

function sizeRank(size: string | null): number {
  if (size === null) return 999
  const known = SIZE_ORDER.indexOf(size.toUpperCase())
  if (known >= 0) return known
  return /^\d+$/.test(size) ? 100 + Number(size) : 500
}

/// One line per SKU of an article, colour then size order. Falls back to the
/// codes the price rules mention while the product read is in flight.
function skusOf(row: ArticlePriceRow): readonly SkuLine[] {
  const known = ARTICLE_SKUS.get(row.article_code)
  const lines: SkuLine[] =
    known ??
    skuUniverse(row).map((code) => ({
      code,
      size: SKU_SIZE.get(code) ?? null,
      color: null,
    }))
  return lines
    .slice()
    .sort(
      (a, b) =>
        (a.color ?? "").localeCompare(b.color ?? "") ||
        sizeRank(a.size) - sizeRank(b.size) ||
        a.code.localeCompare(b.code)
    )
}
function sizeLabel(codes: readonly string[]): string {
  if (!codes.every((code) => SKU_SIZE.has(code)))
    return `${count(codes.length)} SKU`
  const suffixes = [...new Set(codes.map((code) => SKU_SIZE.get(code)!))]
  if (suffixes.length === 0) return `${count(codes.length)} SKU`
  const known = suffixes.every((one) => SIZE_ORDER.includes(one.toUpperCase()))
  const numeric = suffixes.every((one) => /^\d+$/.test(one))
  const sorted = suffixes
    .slice()
    .sort((a, b) =>
      known
        ? SIZE_ORDER.indexOf(a.toUpperCase()) -
          SIZE_ORDER.indexOf(b.toUpperCase())
        : numeric
          ? Number(a) - Number(b)
          : a.localeCompare(b)
    )
  if (sorted.length > 6) return `${count(codes.length)} SKU`
  return sorted.length > 2
    ? `${sorted[0]}–${sorted[sorted.length - 1]}`
    : sorted.join(", ")
}

/// The COMPANY_PRICE rung, from whichever shop happens to carry it — it is the
/// one rung meant to be the same everywhere, so any shop's copy of it answers
/// for the whole row.
function companyRuleOf(row: ArticlePriceRow): ArticlePriceRule | undefined {
  for (const shop of row.shops) {
    const found = shop.stack.find((rule) => rule.source === "COMPANY_PRICE")
    if (found !== undefined) return found
  }
  return undefined
}

/// Split one row's SKUs into bands. Two SKUs share a band when the base price,
/// every shop's pre-promotion price and (when the shop's final price is
/// uniform across the whole article) the final price all agree — which is
/// every SKU, almost always.
function bandsOf(
  row: ArticlePriceRow,
  shops: readonly PricelistShop[],
  companyRule: ArticlePriceRule | undefined
): readonly Band[] {
  const codes = skuUniverse(row)
  if (codes.length === 0) return [{ skuCodes: [], label: "All sizes" }]

  const signatureOf = (code: string) => {
    const parts: (number | string | null)[] = [amountFor(companyRule, code)]
    for (const shopMeta of shops) {
      const shop = row.shops.find((one) => one.site_id === shopMeta.site_id)
      const regular = regularRuleOf(shop, code)
      const markdown = markdownRuleOf(shop, code)
      const finalUniform =
        shop?.final_price != null && shop.final_price.distinct <= 1
          ? shop.final_price.min_unit_price_minor
          : null
      parts.push(
        amountFor(regular, code),
        regular?.source ?? null,
        amountFor(markdown, code),
        finalUniform
      )
    }
    return parts.join("|")
  }

  const groups = new Map<string, string[]>()
  for (const code of codes) {
    const key = signatureOf(code)
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [code])
    else list.push(code)
  }
  const list = [...groups.values()]
  if (list.length === 1) return [{ skuCodes: list[0], label: "All sizes" }]
  return list.map((skuCodes) => ({ skuCodes, label: sizeLabel(skuCodes) }))
}

/// Whether any shop charges this article at anything other than the base
/// price, or cannot sell it at all — the "Only where stores differ" filter.
function rowCarries(
  row: ArticlePriceRow,
  shops: readonly PricelistShop[],
  promoWindows: ReadonlyMap<string, string>,
  kinds: ReadonlySet<PriceKind>
): boolean {
  const companyRule = companyRuleOf(row)
  for (const band of bandsOf(row, shops, companyRule)) {
    for (const shopMeta of shops) {
      const facts = factsFor(row, band, shopMeta, companyRule, promoWindows)
      if (facts !== null && facts.kind !== "base" && kinds.has(facts.kind))
        return true
    }
  }
  return false
}

/// What one band's cell actually says: the price, its kind, and the words that
/// go with it. The heavy lifting for the whole merged grid.
interface CellFacts {
  readonly kind: "base" | "store" | "markdown" | "promotion"
  readonly amountMinor: number
  /// The store's normal price for this band — its own price, else the base.
  readonly normalMinor: number
  readonly pct: string | null
  readonly label: string | null
  readonly dateLine: string | null
  readonly loser: { readonly label: string; readonly pct: string | null } | null
}

function factsFor(
  row: ArticlePriceRow,
  band: Band,
  shopMeta: PricelistShop,
  companyRule: ArticlePriceRule | undefined,
  promoWindows: ReadonlyMap<string, string>
): CellFacts | null {
  const shop = row.shops.find((one) => one.site_id === shopMeta.site_id)
  if (shop === undefined || shop.stack.length === 0) return null
  const sku = band.skuCodes[0] ?? null

  const regularRule = regularRuleOf(shop, sku)
  const markdownRule = markdownRuleOf(shop, sku)
  // Per SKU: a markdown on this size wins, otherwise the size's regular price.
  const winnerRule = markdownRule ?? regularRule
  const baseMinor =
    companyRule === undefined ? null : amountFor(companyRule, sku)
  const regularMinor =
    regularRule === undefined ? baseMinor : amountFor(regularRule, sku)
  const markdownMinor =
    markdownRule === undefined ? null : amountFor(markdownRule, sku)
  const winnerMinor =
    winnerRule === undefined ? null : amountFor(winnerRule, sku)

  if (regularMinor === null && winnerMinor === null) return null

  const final = shop.final_price
  const promotions = final?.promotions ?? []
  let amountMinor: number
  if (final == null || final.distinct > 1)
    amountMinor = winnerMinor ?? regularMinor!
  else amountMinor = final.min_unit_price_minor

  if (baseMinor !== null && amountMinor === baseMinor)
    return {
      kind: "base",
      amountMinor,
      normalMinor: regularMinor ?? amountMinor,
      pct: null,
      label: null,
      dateLine: null,
      loser: null,
    }

  if (
    regularMinor !== null &&
    promotions.length > 0 &&
    amountMinor < regularMinor &&
    (markdownMinor === null || amountMinor <= markdownMinor)
  ) {
    const loser =
      markdownRule !== undefined &&
      markdownMinor !== null &&
      markdownMinor !== amountMinor
        ? { label: "Markdown", pct: pctVs(markdownMinor, regularMinor) }
        : null
    return {
      kind: "promotion",
      amountMinor,
      normalMinor: regularMinor,
      pct: pctVs(amountMinor, regularMinor),
      label: promotions.join(" · "),
      dateLine: promoWindows.get(promotions[0]) ?? null,
      loser,
    }
  }

  if (
    regularMinor !== null &&
    markdownRule !== undefined &&
    markdownMinor !== null &&
    amountMinor === markdownMinor
  ) {
    return {
      kind: "markdown",
      amountMinor,
      normalMinor: regularMinor,
      pct: pctVs(amountMinor, regularMinor),
      label: "Markdown",
      dateLine: shortSpan(
        markdownRule.effective_from,
        markdownRule.effective_to
      ),
      loser:
        promotions.length > 0
          ? { label: promotions.join(" · "), pct: null }
          : null,
    }
  }

  // The store's own price — not the base, and nothing further off it.
  return {
    kind: "store",
    amountMinor,
    normalMinor: amountMinor,
    pct: baseMinor === null ? null : pctVs(amountMinor, baseMinor),
    label: null,
    dateLine:
      regularRule?.effective_from !== undefined
        ? `from ${shortDay(regularRule.effective_from)}`
        : null,
    loser: null,
  }
}

const KIND_TEXT: Record<CellFacts["kind"], string> = {
  base: "text-line-ico",
  store: "font-semibold text-ink",
  markdown: "font-semibold text-[#d6447e]",
  promotion: "font-semibold text-[#0f8a7e]",
}
const KIND_BG: Record<CellFacts["kind"], string> = {
  base: "",
  store: "",
  markdown: "bg-[color-mix(in_srgb,#d6447e_7%,white)]",
  promotion: "bg-[color-mix(in_srgb,#0f8a7e_7%,white)]",
}
const KIND_CHIP: Record<CellFacts["kind"], string> = {
  base: "",
  store: "bg-[color-mix(in_srgb,var(--ink)_14%,white)] text-ink",
  markdown: "bg-[color-mix(in_srgb,#d6447e_14%,white)] text-[#d6447e]",
  promotion: "bg-[color-mix(in_srgb,#0f8a7e_14%,white)] text-[#0f8a7e]",
}
/// Line 2's colour — the same hue as the price, but never bold: "what set it"
/// is a caption under the figure, not a second figure.
const KIND_LABEL: Record<CellFacts["kind"], string> = {
  base: "",
  store: "",
  markdown: "text-[#d6447e]",
  promotion: "text-[#0f8a7e]",
}

function PriceGrid({
  page,
  items,
  openCell,
  onOpenCell,
  onOpenArticle,
  onOpenShop,
  selected,
  onToggleArticle,
  onSelectVisible,
  showStock,
  stockBySite,
  promoWindows,
  divisionLabels,
  tagLabels,
  more,
}: {
  page: ArticlePrices
  items: readonly ArticlePriceRow[]
  openCell: string | undefined
  onOpenCell: (articleCode: string, siteId: string) => void
  onOpenArticle: (articleCode: string) => void
  onOpenShop: (siteId: string) => void
  selected: ReadonlySet<string>
  onToggleArticle: (articleCode: string) => void
  onSelectVisible: (on: boolean) => void
  showStock: boolean
  stockBySite: ReadonlyMap<
    string,
    {
      readonly bySku: ReadonlyMap<string, number>
      readonly byArticle: ReadonlyMap<string, number>
    }
  >
  promoWindows: ReadonlyMap<string, string>
  divisionLabels: ReadonlyMap<string, string>
  tagLabels: ReadonlyMap<string, string>
  more: Pageable
}) {
  const allOn =
    items.length > 0 && items.every((row) => selected.has(row.article_code))
  /// The cell under the pointer, and where it is on screen — the hover card
  /// is drawn fixed so the grid's own scrolling box cannot clip it.
  const [hover, setHover] = useState<HoverInfo | null>(null)
  /// Articles opened to their SKU lines.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const toggleExpanded = (code: string) =>
    setExpanded((was) => {
      const next = new Set(was)
      if (!next.delete(code)) next.add(code)
      return next
    })
  const someOn = items.some((row) => selected.has(row.article_code))

  const stockFor = (
    siteId: string,
    band: Band,
    row: ArticlePriceRow
  ): number | null => {
    const at = stockBySite.get(siteId)
    if (at === undefined) return null
    // No per-SKU breakdown anywhere for this article — the article total is
    // the whole answer, since there is only ever one band in that case.
    if (band.skuCodes.length === 0)
      return at.byArticle.get(row.article_code) ?? null
    let total = 0
    let any = false
    for (const code of band.skuCodes) {
      const qty = at.bySku.get(code)
      if (qty !== undefined) {
        total += qty
        any = true
      }
    }
    return any ? total : null
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full table-fixed border-separate border-spacing-0 text-cell">
        <colgroup>
          <col className="w-[15rem]" />
          <col className="w-[8rem]" />
          <col className="w-[8rem]" />
          {page.shops.map((shopMeta) => (
            <col key={shopMeta.site_id} className="w-[10.5rem]" />
          ))}
        </colgroup>

        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-30 border-r border-b border-hairline-2 bg-canvas px-3.5 py-3 text-left text-cell font-normal text-body"
            >
              <span className="flex items-center gap-2">
                <Checkbox
                  checked={allOn}
                  indeterminate={someOn && !allOn}
                  onChange={onSelectVisible}
                  label={
                    <span className="sr-only">
                      {allOn
                        ? "Clear the selection"
                        : "Select every loaded article"}
                    </span>
                  }
                />
                Article
              </span>
            </th>
            <th
              scope="col"
              className="sticky top-0 z-20 border-r border-b border-hairline-2 bg-canvas px-3.5 py-3 text-left text-cell font-normal text-body"
            >
              Division
            </th>
            <th
              scope="col"
              className="sticky top-0 z-20 border-r border-b border-hairline-2 bg-canvas px-3.5 py-3 text-right text-cell font-normal text-body"
            >
              Base price
            </th>
            {page.shops.map((shopMeta, index) => (
              <th
                key={shopMeta.site_id}
                scope="col"
                className={cn(
                  "sticky top-0 z-20 truncate border-b border-hairline-2 bg-canvas px-3.5 py-3 text-right align-top text-cell font-normal text-body",
                  index === page.shops.length - 1 ? "" : "border-r"
                )}
              >
                <button
                  type="button"
                  onClick={() => onOpenShop(shopMeta.site_id)}
                  className="rounded-inner text-right underline-offset-2 hover:underline focus:bg-soft focus-visible:outline-none"
                >
                  {shopMeta.label ?? shopMeta.site_id}
                </button>
                {/* The grid shows what head office published; a till that has
                    not picked it up yet still charges the older book. Said
                    on the column, not only in the hover card. */}
                {shopMeta.pending_publication && (
                  <span
                    className="mt-0.5 flex items-center justify-end gap-1.5 text-[0.875rem] text-warn-fg"
                    title={`${shopMeta.pending_publication.name} — published ${ago(shopMeta.pending_publication.published_at)}, not yet at the till`}
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-warn" />
                    Not updated yet
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {items.map((row) => {
            const companyRule = companyRuleOf(row)
            const bands = bandsOf(row, page.shops, companyRule)
            const picked = selected.has(row.article_code)
            const skus = skusOf(row)
            const opened = expanded.has(row.article_code)
            const bases = [
              ...new Set(
                bands.map((band) =>
                  amountFor(companyRule, band.skuCodes[0] ?? null)
                )
              ),
            ]

            const priceCells = (
              band: Band | null,
              sizes: string | null,
              groupEnd: boolean
            ) =>
              page.shops.map((shopMeta, shopIndex) => {
                const last = shopIndex === page.shops.length - 1
                const key = cellKey(row.article_code, shopMeta.site_id)
                // The article line: one price when every SKU agrees at this
                // store, otherwise a count that opens the SKU lines.
                let facts: CellFacts | null
                if (band === null) {
                  const all = bands.map((one) =>
                    factsFor(row, one, shopMeta, companyRule, promoWindows)
                  )
                  const amounts = new Set(
                    all.map((one) => one?.amountMinor ?? null)
                  )
                  if (amounts.size > 1)
                    return (
                      <VariesCell
                        key={shopMeta.site_id}
                        prices={amounts.size}
                        groupEnd={groupEnd}
                        last={last}
                        onOpen={() => toggleExpanded(row.article_code)}
                      />
                    )
                  facts = all[0] ?? null
                } else {
                  facts = factsFor(
                    row,
                    band,
                    shopMeta,
                    companyRule,
                    promoWindows
                  )
                }
                const stock = showStock
                  ? stockFor(
                      shopMeta.site_id,
                      band ?? { skuCodes: [], label: "" },
                      row
                    )
                  : null
                return (
                  <Cell
                    key={shopMeta.site_id}
                    facts={facts}
                    stockQty={stock}
                    showStock={showStock}
                    open={band === null && openCell === key}
                    groupEnd={groupEnd}
                    last={last}
                    onOpen={() => {
                      setHover(null)
                      onOpenCell(row.article_code, shopMeta.site_id)
                    }}
                    onHover={(element) =>
                      setHover(
                        element === null || facts === null
                          ? null
                          : {
                              rect: element.getBoundingClientRect(),
                              article: row.article_name ?? row.article_code,
                              store: shopMeta.label ?? shopMeta.site_id,
                              sizes,
                              baseMinor: amountFor(
                                companyRule,
                                band?.skuCodes[0] ?? null
                              ),
                              facts,
                              stock,
                              waiting:
                                shopMeta.pending_publication?.name ?? null,
                            }
                      )
                    }
                  />
                )
              })

            return [
              <tr key={row.article_code}>
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-20 max-w-0 border-r border-b bg-canvas p-0 text-left align-top font-normal",
                    opened ? "border-hairline" : "border-hairline-strong",
                    picked && "bg-accent-bg"
                  )}
                >
                  <ArticleCell
                    row={row}
                    tags={row.tags.map((code) => tagLabels.get(code) ?? code)}
                    picked={picked}
                    opened={opened}
                    canOpen={skus.length > 1}
                    onExpand={() => toggleExpanded(row.article_code)}
                    onToggle={() => onToggleArticle(row.article_code)}
                    onOpen={() => onOpenArticle(row.article_code)}
                  />
                </th>
                <td
                  className={cn(
                    "border-r border-b px-3.5 py-3.5 align-top text-ink",
                    opened ? "border-hairline" : "border-hairline-strong"
                  )}
                >
                  {row.division_code === null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    (divisionLabels.get(row.division_code) ?? row.division_code)
                  )}
                </td>
                <td
                  className={cn(
                    "border-r border-b px-3.5 py-3.5 text-right align-top",
                    opened ? "border-hairline" : "border-hairline-strong"
                  )}
                >
                  {bases.length > 1 ? (
                    <span className="text-faint">
                      {count(bases.length)} prices
                    </span>
                  ) : (
                    <b className="text-ink tabular-nums">
                      {bases[0] == null ? "—" : money(bases[0])}
                    </b>
                  )}
                </td>
                {priceCells(null, null, !opened)}
              </tr>,
              ...(opened
                ? skus.map((sku, index) => {
                    const end = index === skus.length - 1
                    const band: Band = {
                      skuCodes: [sku.code],
                      label: skuLabel(sku),
                    }
                    const base = amountFor(companyRule, sku.code)
                    return (
                      <tr key={`${row.article_code}:${sku.code}`}>
                        <th
                          scope="row"
                          className={cn(
                            "sticky left-0 z-20 max-w-0 border-r border-b bg-canvas py-3.5 pr-3.5 pl-[3.25rem] text-left align-top font-normal",
                            end ? "border-hairline-strong" : "border-hairline"
                          )}
                        >
                          <span className="block truncate text-ink">
                            {skuLabel(sku)}
                          </span>
                          <span className="block truncate font-mono text-id text-mute">
                            {sku.code}
                          </span>
                        </th>
                        <td
                          className={cn(
                            "border-r border-b",
                            end ? "border-hairline-strong" : "border-hairline"
                          )}
                        />
                        <td
                          className={cn(
                            "border-r border-b px-3.5 py-3.5 text-right align-top",
                            end ? "border-hairline-strong" : "border-hairline"
                          )}
                        >
                          <span className="text-body tabular-nums">
                            {base === null ? "—" : money(base)}
                          </span>
                        </td>
                        {priceCells(band, band.label, end)}
                      </tr>
                    )
                  })
                : []),
            ]
          })}
        </tbody>
      </table>
      <LoadMore query={more} className="py-3" />
      {hover !== null && <HoverCard info={hover} />}
    </div>
  )
}

/// The pricelist on a phone: a card per article, in place of a grid of shops
/// that is wider than the glass.
///
/// What the card says is what the grid's first columns say — the article, its
/// base price — and what the rest of the grid is read for: where the stores do
/// NOT charge the base price, said in words and in the grid's own colours
/// ("2 markdown · 1 promotion"). Which store charges what is one tap on the
/// card away (the article's sheet, which lists every store), and Change opens
/// the same price sheet the grid's cells do. Nothing here is a second reading
/// of the prices: it asks `factsFor`, the one function the grid asks.
function PhonePrices({
  page,
  items,
  promoWindows,
  divisionLabels,
  onOpenArticle,
  onChange,
  more,
}: {
  page: ArticlePrices
  items: readonly ArticlePriceRow[]
  promoWindows: ReadonlyMap<string, string>
  divisionLabels: ReadonlyMap<string, string>
  onOpenArticle: (articleCode: string) => void
  onChange: (row: ArticlePriceRow) => void
  more: Pageable
}) {
  return (
    <div className="min-h-0">
      <ul className="flex flex-col gap-2.5">
        {items.map((row) => {
          const companyRule = companyRuleOf(row)
          const bands = bandsOf(row, page.shops, companyRule)
          const bases = [
            ...new Set(
              bands.map((band) =>
                amountFor(companyRule, band.skuCodes[0] ?? null)
              )
            ),
          ]
          // How many stores carry each kind of price, and how many do not sell
          // the article at all. A store counts once per kind however many size
          // bands carry it.
          const tally = { promotion: 0, markdown: 0, store: 0, away: 0 }
          for (const shopMeta of page.shops) {
            const all = bands.map((band) =>
              factsFor(row, band, shopMeta, companyRule, promoWindows)
            )
            if (all.every((one) => one === null)) tally.away += 1
            else
              for (const kind of ["promotion", "markdown", "store"] as const)
                if (all.some((one) => one?.kind === kind)) tally[kind] += 1
          }
          const parts = [
            tally.promotion > 0 && {
              key: "promotion",
              text: `${count(tally.promotion)} promotion`,
              tone: KIND_TEXT.promotion,
            },
            tally.markdown > 0 && {
              key: "markdown",
              text: `${count(tally.markdown)} markdown`,
              tone: KIND_TEXT.markdown,
            },
            tally.store > 0 && {
              key: "store",
              text: `${count(tally.store)} store ${tally.store === 1 ? "price" : "prices"}`,
              tone: "font-semibold text-ink",
            },
            tally.away > 0 && {
              key: "away",
              text: `not sold at ${count(tally.away)}`,
              tone: "text-faint",
            },
          ].filter((one) => one !== false)
          const name = row.article_name ?? row.article_code
          const cost = row.unit_cost_minor
          const markup = bases.length === 1 ? markupBps(bases[0], cost) : null
          return (
            <PhoneCard
              key={row.article_code}
              onOpen={() => onOpenArticle(row.article_code)}
              head={
                <div className="flex items-start gap-3">
                  <Thumbnail
                    url={row.image_url}
                    name={name}
                    division={row.division_code}
                    className="size-12 shrink-0 rounded-inner"
                  />
                  <CardName
                    name={name}
                    code={`${row.article_code} · ${count(row.sku_count)} SKU`}
                    line={
                      row.division_code === null
                        ? undefined
                        : (divisionLabels.get(row.division_code) ??
                          row.division_code)
                    }
                  />
                </div>
              }
              lead={
                <CardFigure
                  value={
                    bases.length > 1
                      ? `${count(bases.length)} prices`
                      : bases[0] == null
                        ? "—"
                        : money(bases[0])
                  }
                  caption="base price"
                  tone={
                    bases.length !== 1 || bases[0] == null ? "quiet" : undefined
                  }
                />
              }
              foot={
                <CardFoot>
                  {cost != null && cost > 0 && (
                    <span className="block">
                      Cost {money(cost)}
                      {markup !== null && ` · Markup ${percentBps(markup)}`}
                    </span>
                  )}
                  {parts.length === 0
                    ? "Base price at every store"
                    : parts.map((one, index) => (
                        <span key={one.key} className={one.tone}>
                          {index > 0 && (
                            <span className="font-normal text-faint"> · </span>
                          )}
                          {one.text}
                        </span>
                      ))}
                </CardFoot>
              }
              action={
                <Button
                  variant="tint"
                  size="card"
                  aria-label={`Change the price of ${name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onChange(row)
                  }}
                >
                  Change
                </Button>
              }
            />
          )
        })}
      </ul>
      <LoadMore query={more} className="py-3" />
    </div>
  )
}

interface HoverInfo {
  readonly rect: DOMRect
  readonly article: string
  readonly store: string
  readonly sizes: string | null
  readonly baseMinor: number | null
  readonly facts: CellFacts
  readonly stock: number | null
  readonly waiting: string | null
}

/// What a cell's price is made of, on hover: base, the store's own price, the
/// markdown or promotion on top with its dates, and anything not charged yet.
/// Clicking the cell is the way to change it.
function HoverCard({ info }: { info: HoverInfo }) {
  const { facts } = info
  const width = 288
  const left = Math.min(
    Math.max(8, info.rect.right - width),
    window.innerWidth - width - 8
  )
  const below = info.rect.bottom + 6
  const top = below + 220 > window.innerHeight ? info.rect.top - 6 : below
  const lift = below + 220 > window.innerHeight
  const line = (
    label: React.ReactNode,
    value: React.ReactNode,
    strong = false
  ) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className={strong ? "font-medium text-ink" : "text-body"}>
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          strong ? "font-semibold text-ink" : "text-text"
        )}
      >
        {value}
      </span>
    </div>
  )
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 flex flex-col gap-2 rounded-card bg-canvas p-4 text-[0.875rem] shadow-pop ring-1 ring-hairline"
      style={{
        left,
        top,
        width,
        transform: lift ? "translateY(-100%)" : undefined,
      }}
    >
      <div className="mb-0.5">
        <div className="font-medium text-ink">{info.article}</div>
        <div className="text-mute">
          {info.store}
          {info.sizes !== null ? ` · sizes ${info.sizes}` : ""}
        </div>
      </div>
      {info.baseMinor !== null && line("Base price", money(info.baseMinor))}
      {info.baseMinor !== null &&
        facts.normalMinor !== info.baseMinor &&
        line("Store price", money(facts.normalMinor))}
      {(facts.kind === "markdown" || facts.kind === "promotion") && (
        <div className="flex items-baseline justify-between gap-3">
          <span className={KIND_LABEL[facts.kind]}>
            {facts.label} {facts.pct}
            {facts.dateLine !== null && (
              <span className="block text-mute">{facts.dateLine}</span>
            )}
          </span>
          <span className={cn("tabular-nums", KIND_LABEL[facts.kind])}>
            {money(facts.amountMinor)}
          </span>
        </div>
      )}
      {facts.loser !== null && (
        <div className="text-mute line-through decoration-faint">
          {facts.loser.label} {facts.loser.pct ?? ""}
        </div>
      )}
      <div className="mt-0.5 border-t border-hairline pt-1.5">
        {line("Charged now", money(facts.amountMinor), true)}
      </div>
      {info.stock !== null && line("Stock", count(info.stock))}
      {info.waiting !== null && (
        <div className="text-warn-fg">
          Waiting for {info.store} to update · {info.waiting}
        </div>
      )}
    </div>
  )
}

/// The frozen left-hand square: what the style IS, and the checkbox that adds
/// it to a batch price change.
function ArticleCell({
  row,
  tags,
  picked,
  opened,
  canOpen,
  onExpand,
  onToggle,
  onOpen,
}: {
  row: ArticlePriceRow
  tags: readonly string[]
  picked: boolean
  opened: boolean
  canOpen: boolean
  onExpand: () => void
  onToggle: () => void
  onOpen: () => void
}) {
  return (
    <span className="flex items-start gap-1.5 py-3.5 pr-3.5 pl-1.5">
      {canOpen ? (
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={opened}
          aria-label={`${opened ? "Hide" : "Show"} the SKUs of ${row.article_name ?? row.article_code}`}
          className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-inner text-mute hover:bg-soft hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          <ChevronRight
            className={cn(
              "size-4 transition-transform duration-150",
              opened && "rotate-90"
            )}
          />
        </button>
      ) : (
        <span className="size-6 shrink-0" />
      )}
      <Checkbox
        checked={picked}
        onChange={onToggle}
        className="mt-1 shrink-0"
        label={
          <span className="sr-only">
            Select {row.article_name ?? row.article_code}
          </span>
        }
      />
      <button
        type="button"
        onClick={onOpen}
        title={`Compare ${row.article_name ?? row.article_code} across every store`}
        className="group/name min-w-0 rounded-inner text-left focus:bg-soft focus-visible:outline-none"
      >
        <span className="block min-w-0 leading-tight">
          <span className="line-clamp-2 font-medium text-ink group-hover/name:underline group-hover/name:underline-offset-2">
            {row.article_name ?? "—"}
          </span>
          <span className="block truncate font-mono text-id text-mute">
            {row.article_code} · {count(row.sku_count)} SKU
          </span>
          {tags.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-[5px] bg-soft px-1.5 text-[0.875rem] leading-6 text-body"
                >
                  {tag}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
    </span>
  )
}

/// What the grid shows and which kinds of price an article must carry — the
/// ticks the right-hand panel used to hold, as a menu at the end of the
/// search line. A count on the button says how many are on, so a closed menu
/// never hides that the grid is narrowed.
function ShowMenu({
  showStock,
  onStock,
  kinds,
  onKind,
}: {
  showStock: boolean
  onStock: () => void
  kinds: ReadonlySet<PriceKind>
  onKind: (value: PriceKind) => void
}) {
  const row =
    "flex min-h-8 cursor-default items-center justify-between gap-4 rounded-inner px-2 text-[0.875rem] text-ink outline-none select-none data-[highlighted]:bg-soft-2"
  const heading =
    "block px-2 pt-1 pb-1.5 text-eyebrow font-semibold tracking-[0.05em] text-mute uppercase"
  const on = (showStock ? 1 : 0) + kinds.size
  return (
    <Menu.Root>
      <Menu.Trigger className="inline-flex h-control shrink-0 items-center gap-1.5 rounded-inner px-[0.5625rem] text-[0.875rem] font-medium text-body transition-colors hover:bg-soft-2 hover:text-ink">
        <Eye className="size-3.5 stroke-[1.7]" />
        Show
        {on > 0 && (
          <span className="rounded-full bg-accent-bg px-1.5 text-accent tabular-nums">
            {on}
          </span>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          className="z-50"
        >
          <Menu.Popup
            className={cn(
              "min-w-[13rem] rounded-card border border-hairline bg-canvas p-1.5 shadow-pop",
              POP_MOTION
            )}
          >
            <span className={heading}>Show</span>
            <Menu.Item closeOnClick={false} onClick={onStock} className={row}>
              Stock
              <span className="pointer-events-none">
                <Switch on={showStock} label="Stock" onToggle={() => {}} />
              </span>
            </Menu.Item>
            <span className={cn(heading, "pt-3")}>Only articles with</span>
            {KIND_TICKS.map((tick) => (
              <Menu.Item
                key={tick.value}
                closeOnClick={false}
                onClick={() => onKind(tick.value)}
                className={row}
              >
                {tick.label}
                <span className="pointer-events-none">
                  <Switch
                    on={kinds.has(tick.value)}
                    label={tick.label}
                    onToggle={() => {}}
                  />
                </span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/// "M / Black" — the SKU's size and colour, else its code.
function skuLabel(sku: SkuLine): string {
  const parts = [sku.size, sku.color].filter((one): one is string => !!one)
  return parts.length === 0 ? sku.code : parts.join(" · ")
}

/// The article line at a store where its SKUs sell at different prices: how
/// many, and a click opens the SKU lines.
function VariesCell({
  prices,
  groupEnd,
  last,
  onOpen,
}: {
  prices: number
  groupEnd: boolean
  last: boolean
  onOpen: () => void
}) {
  return (
    <td
      className={cn(
        "border-b p-0 align-top hover:bg-soft",
        groupEnd ? "border-hairline-strong" : "border-hairline",
        !last && "border-r"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full px-3.5 py-3.5 text-right text-mute"
      >
        {count(prices)} prices
      </button>
    </td>
  )
}

/// One band of one article at one shop — the merged cell: the price the till
/// actually charges now, right-aligned over three lines.
function Cell({
  facts,
  stockQty,
  showStock,
  open,
  groupEnd,
  last,
  onOpen,
  onHover,
}: {
  facts: CellFacts | null
  stockQty: number | null
  showStock: boolean
  open: boolean
  groupEnd: boolean
  last: boolean
  onOpen: () => void
  onHover: (element: HTMLElement | null) => void
}) {
  const rules =
    "border-b " +
    (groupEnd ? "border-hairline-strong " : "border-hairline ") +
    (last ? "" : "border-r ")

  if (facts === null)
    return (
      <td
        className={cn(
          rules,
          "px-3.5 py-3.5 text-right align-top text-faint hover:bg-soft"
        )}
      >
        not sold
      </td>
    )

  const told = [
    facts.label,
    facts.kind === "base"
      ? "same as the base price"
      : facts.kind === "store"
        ? "the store's own price"
        : facts.kind,
    facts.loser !== null ? `${facts.loser.label} lost to it` : null,
  ]
    .filter((one) => one !== null)
    .join(" · ")

  return (
    <td
      className={cn(
        rules,
        "group/cell relative p-0 align-top",
        KIND_BG[facts.kind],
        open ? "bg-soft-2" : "hover:bg-soft"
      )}
    >
      <button
        type="button"
        aria-label={told}
        onClick={onOpen}
        onMouseEnter={(event) => onHover(event.currentTarget)}
        onMouseLeave={() => onHover(null)}
        className="flex w-full min-w-[10.5rem] flex-col items-end gap-0.5 px-3.5 py-3.5 text-right"
      >
        <span className="flex w-full flex-wrap items-center justify-end gap-x-1.5">
          <span
            className={cn(
              "break-words whitespace-normal tabular-nums",
              KIND_TEXT[facts.kind]
            )}
          >
            {money(facts.amountMinor)}
          </span>
          {facts.pct !== null && (
            <span
              className={cn(
                "inline-block shrink-0 rounded-[5px] px-1.5 text-[0.875rem] font-medium",
                KIND_CHIP[facts.kind]
              )}
            >
              {facts.pct}
            </span>
          )}
        </span>
        {facts.label !== null && (
          <span
            className={cn(
              "w-full text-[0.875rem] break-words whitespace-normal",
              KIND_LABEL[facts.kind]
            )}
          >
            {facts.label}
          </span>
        )}
        {facts.dateLine !== null && (
          <span className="w-full text-[0.875rem] break-words whitespace-normal text-mute">
            {facts.dateLine}
          </span>
        )}
        {facts.loser !== null && (
          <span className="w-full text-[0.875rem] break-words whitespace-normal text-mute line-through decoration-faint">
            {facts.loser.label}
            {facts.loser.pct !== null ? ` ${facts.loser.pct}` : ""}
          </span>
        )}
        {showStock &&
          (stockQty === null ? null : stockQty > 0 ? (
            <span className="w-full text-[0.875rem] break-words whitespace-normal text-mute">
              {count(stockQty)} in stock
            </span>
          ) : (
            <span className="w-full text-[0.875rem] break-words whitespace-normal text-bad">
              Out of stock
            </span>
          ))}
      </button>
    </td>
  )
}

// ── the drill-down ─────────────────────────────────────────────────────────

/// One cell, opened: what the till takes for it, why the shelf price is what
/// it is, how it got there, and which stores have it in service.
function CellSheet({
  cell,
  row,
  channel,
  at,
  bookNames,
  shops,
  upcoming,
  upcomingAt,
  onClose,
  onChangePrice,
}: {
  cell: { articleCode: string; siteId: string } | null
  row: ArticlePriceRow | null
  channel: CommercialChannel
  at: string | null
  bookNames: ReadonlyMap<number, string>
  /// Every column of the matrix — the "Upcoming" section reads a shop's
  /// `pending_publication`, which lives here and not on `ArticlePriceShop`.
  shops: readonly PricelistShop[]
  /// The same capped answer the grid's "falling to" markers used to read —
  /// now read only here, for the one cell somebody actually opened.
  upcoming: ArticlePrices | null
  upcomingAt: string | null
  onClose: () => void
  onChangePrice: (preset: {
    siteId: string
    kind: "price" | "markdown"
  }) => void
}) {
  const scope: PriceScope = useMemo(
    () => ({
      siteId: cell?.siteId ?? "",
      channel,
      at: at ?? undefined,
    }),
    [cell?.siteId, channel, at]
  )

  const shopRow =
    cell === null || row === null
      ? undefined
      : row.shops.find((one) => one.site_id === cell.siteId)
  const top = winner(shopRow)
  const shopMeta =
    cell === null ? undefined : shops.find((one) => one.site_id === cell.siteId)

  const laterRow = upcoming?.rows.find(
    (one) => one.article_code === cell?.articleCode
  )
  const laterShop = laterRow?.shops.find((one) => one.site_id === cell?.siteId)
  const laterTop = winner(laterShop)
  const laterDiffers =
    laterTop !== undefined &&
    (top === undefined ||
      laterTop.min_unit_price_minor !== top.min_unit_price_minor)

  const products = useQuery({
    queryKey: commercialKeys.prices(scope),
    queryFn: ({ signal }) => shelfPrices(scope, signal),
    enabled: cell !== null && scope.siteId !== "",
  })

  const lines = useMemo(
    () =>
      (products.data?.items ?? []).filter(
        (item) => item.article_code === cell?.articleCode
      ),
    [products.data, cell?.articleCode]
  )

  return (
    <Sheet
      open={cell !== null}
      onOpenChange={(open) => !open && onClose()}
      id={cell?.articleCode}
      title={row?.article_name ?? "Price"}
      actions={
        cell === null ? null : (
          <Button
            variant="primary"
            onClick={() =>
              onChangePrice({
                siteId: cell.siteId,
                kind: top?.source === "MARKDOWN" ? "markdown" : "price",
              })
            }
          >
            Change price…
          </Button>
        )
      }
    >
      {cell === null ? null : (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="Store">{shopRow?.label ?? cell.siteId}</Fact>
            <Fact term="SKUs">{count(row?.sku_count)}</Fact>
            <Fact term="Shelf price">
              {top === undefined ? "—" : amounts(top)}
            </Fact>
            <Fact term="Set by">
              {top === undefined
                ? "—"
                : `${describeSource(top.source)} · ${bookNames.get(top.publication_version) ?? `v${top.publication_version}`}`}
            </Fact>
          </Facts>

          {shopRow === undefined || shopRow.stack.length === 0 ? (
            <Quiet>This store does not sell this article.</Quiet>
          ) : (
            <>
              <div>
                <SubHead>At the till</SubHead>
                {queryState(products, {
                  loading: "Loading…",
                  render: () =>
                    lines.length === 0 ? (
                      <Quiet>No SKU to price here.</Quiet>
                    ) : (
                      <TillCheck
                        skuCodes={lines.map((line) => line.sku_code)}
                        siteId={cell.siteId}
                        channel={channel}
                        costMinor={row?.unit_cost_minor ?? null}
                      />
                    ),
                })}
              </div>

              <div>
                <SubHead>Why this shelf price</SubHead>
                <MiniTable
                  head={[
                    "Comes from",
                    { label: "Applies to", align: "left" },
                    "SKUs",
                    "Price",
                  ]}
                >
                  {shopRow.stack.flatMap((rule, index) =>
                    pointsOf(rule).map((point, within) => (
                      <MiniRow
                        key={`${rule.source}-${rule.publication_version}-${index}-${point.unit_price_minor}`}
                      >
                        <MiniCell className="py-3.5">
                          {within === 0 && (
                            <>
                              <span
                                className={
                                  index === 0 ? "text-ink" : "text-mute"
                                }
                              >
                                {describeSource(rule.source)}
                              </span>
                              <span className="block text-[0.875rem] text-mute">
                                {bookNames.get(rule.publication_version) ?? "—"}
                              </span>
                            </>
                          )}
                        </MiniCell>
                        <MiniCell className="py-3.5">
                          {within === 0 && (
                            <span
                              className={
                                index === 0
                                  ? "text-[0.875rem] text-body"
                                  : "text-[0.875rem] text-mute"
                              }
                            >
                              {describeLevel(rule.applies_to)}
                            </span>
                          )}
                        </MiniCell>
                        <MiniCell align="right" className="py-3.5">
                          <span
                            className={index === 0 ? "text-text" : "text-mute"}
                          >
                            {count(point.in_force_for)} of{" "}
                            {count(rule.sku_count)}
                          </span>
                        </MiniCell>
                        <MiniCell align="right" className="py-3.5">
                          <span
                            className={
                              index === 0 ? "font-medium text-ink" : "text-mute"
                            }
                          >
                            {money(point.unit_price_minor)}
                          </span>
                        </MiniCell>
                      </MiniRow>
                    ))
                  )}
                </MiniTable>
              </div>

              {(shopMeta?.pending_publication !== null &&
                shopMeta !== undefined) ||
              laterDiffers ? (
                <div>
                  <SubHead>Upcoming</SubHead>
                  <div className="flex flex-col gap-3">
                    {shopMeta?.pending_publication != null && (
                      <p className="text-[0.875rem] text-body">
                        Waiting for {shopMeta.label ?? cell.siteId} to update ·{" "}
                        {shopMeta.pending_publication.name} · from{" "}
                        {day(shopMeta.pending_publication.effective_from)}
                      </p>
                    )}
                    {laterDiffers && upcomingAt !== null && (
                      <p className="text-[0.875rem] text-body">
                        {day(upcomingAt)} · {amounts(laterTop!)}
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
            </>
          )}

          {lines.length > 0 && (
            <PriceHistorySection
              skuCode={lines[0].sku_code}
              siteId={cell.siteId}
              channel={channel}
              skuCount={lines.length}
            />
          )}

          {top !== undefined && <InService version={top.publication_version} />}
        </div>
      )}
    </Sheet>
  )
}

/// How many SKUs of one article "At the till" prices. Each is a basket of its
/// own, asked twice (walk-in and member), so this is a count of requests — an
/// article with more SKUs than this is priced on the first few and says so.
const TILL_CAP = 8

/// Offers that matched this article and still did not come off.
///
/// Only the reasons the engine decides AFTER it has matched the basket. It
/// gates every promotion on its window, its stores, its audience and its
/// coupon first, so "members only" is said of a promotion on trousers as
/// readily as of one on this shirt — listing those would bury the few that
/// are about this article under every promotion the business runs.
const NEAR_MISSES: ReadonlySet<string> = new Set([
  "QUANTITY_TOO_LOW",
  "AMOUNT_TOO_LOW",
  "ADVISORY_ONLY",
  "MARKDOWN_EXCLUDED",
  "OUTBID_BY_BETTER_OFFER",
  "DISPLACED_BY_EXCLUSIVE_RULE",
])

/// The member "At the till" prices for. `CustomerScope::Members` asks only
/// that a customer is named, so a placeholder answers "what does a member
/// pay" without borrowing a real member — whose own usage would make the
/// answer theirs rather than the shelf's.
const MEMBER_PREVIEW = "price-check-member"

/// One SKU's two answers.
interface TillAnswer {
  readonly skuCode: string
  readonly walkIn: SimulateResult
  readonly member: SimulateResult
}

/// What a receipt prints, as one string: SKUs whose receipts would read the
/// same share one, which is every SKU of most articles.
function receiptKey(answer: TillAnswer): string {
  const side = (result: SimulateResult) =>
    [
      result.lines[0]?.base_unit_price_minor,
      result.lines[0]?.unit_price_minor,
      result.amount_due_minor,
      ...result.applied_rules.map(
        (rule) => `${rule.rule_id}:${rule.benefit_minor}`
      ),
      ...result.free_lines.map((free) => `${free.sku_code}:${free.quantity}`),
    ].join("|")
  return `${side(answer.walkIn)}/${side(answer.member)}`
}

/// What one piece of this article costs at the till — the pricelist, the sale
/// price, every promotion and campaign — for a walk-in shopper and a member.
///
/// Asked of the engine a till runs (`/commercial/simulate`), one SKU per
/// basket of one: a basket holding every size at once would be a multi-buy
/// and trip offers nobody buying one shirt gets.
function TillCheck({
  skuCodes,
  siteId,
  channel,
  costMinor,
}: {
  skuCodes: readonly string[]
  siteId: string
  channel: CommercialChannel
  costMinor: number | null
}) {
  const priced = skuCodes.slice(0, TILL_CAP)
  const asked = useQueries({
    queries: priced.flatMap((skuCode) =>
      [false, true].map((member) => ({
        queryKey: commercialKeys.tillCheck(siteId, channel, skuCode, member),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          simulate(
            {
              site_id: siteId,
              channel,
              lines: [{ sku_code: skuCode, quantity: 1 }],
              customer_id: member ? MEMBER_PREVIEW : null,
            },
            signal
          ),
      }))
    ),
  })

  const campaigns = useQuery({
    queryKey: commercialKeys.campaigns(),
    queryFn: ({ signal }) => campaignCatalogue(signal),
  })
  const campaignName = useMemo(() => {
    const map = new Map<string, string>()
    for (const one of campaigns.data ?? [])
      map.set(one.campaign.campaign_id, one.campaign.name)
    return map
  }, [campaigns.data])

  if (asked.some((query) => query.isPending)) return <Quiet>Loading…</Quiet>

  const answers: TillAnswer[] = []
  const failed: string[] = []
  priced.forEach((skuCode, index) => {
    const walkIn = asked[index * 2]
    const member = asked[index * 2 + 1]
    if (walkIn.data !== undefined && member.data !== undefined)
      answers.push({ skuCode, walkIn: walkIn.data, member: member.data })
    else {
      const error = walkIn.error ?? member.error
      failed.push(error instanceof Error ? error.message : "no answer")
    }
  })

  if (answers.length === 0)
    return <Quiet>No price available{failed[0] ? `: ${failed[0]}` : ""}.</Quiet>

  const groups: { skuCodes: string[]; answer: TillAnswer }[] = []
  const byKey = new Map<string, { skuCodes: string[]; answer: TillAnswer }>()
  for (const answer of answers) {
    const key = receiptKey(answer)
    const held = byKey.get(key)
    if (held !== undefined) held.skuCodes.push(answer.skuCode)
    else {
      const group = { skuCodes: [answer.skuCode], answer }
      byKey.set(key, group)
      groups.push(group)
    }
  }

  const misses = new Map<string, RejectedRule>()
  for (const answer of answers)
    for (const rule of answer.walkIn.rejected_rules)
      if (NEAR_MISSES.has(rule.reason) && !misses.has(rule.rule_id))
        misses.set(rule.rule_id, rule)

  const named = (rule: AppliedRule) => {
    const campaign =
      rule.campaign_id === null ? undefined : campaignName.get(rule.campaign_id)
    return campaign === undefined || campaign === rule.name
      ? rule.name
      : `${rule.name} · ${campaign}`
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <Receipt
          key={group.skuCodes.join(",")}
          // Named only when the SKUs disagree. One receipt for every SKU is
          // the common case, and a heading saying so would be noise.
          label={groups.length > 1 ? group.skuCodes.join(", ") : null}
          answer={group.answer}
          costMinor={costMinor}
          named={named}
        />
      ))}

      {failed.length > 0 && (
        <p className="text-[0.875rem] text-warn-fg">
          {count(failed.length)} SKU{failed.length === 1 ? "" : "s"} could not
          be priced: {failed[0]}
        </p>
      )}

      {misses.size > 0 && (
        <div>
          <p className="mb-2 text-[0.875rem] text-body">Did not come off</p>
          {[...misses.values()].map((rule) => (
            <div
              key={rule.rule_id}
              className="flex items-baseline justify-between gap-3 border-t border-hairline py-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-ink">{rule.name}</span>
                <span className="block text-[0.875rem] text-mute">
                  {rule.explanation.charAt(0).toUpperCase() +
                    rule.explanation.slice(1)}
                </span>
              </span>
              {rule.would_have_saved_minor !== null && (
                <span className="shrink-0 text-[0.875rem] text-mute tabular-nums">
                  saves {money(rule.would_have_saved_minor)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {skuCodes.length > TILL_CAP && (
        <p className="text-[0.875rem] text-mute">
          First {count(TILL_CAP)} of {count(skuCodes.length)} SKUs
        </p>
      )}
    </div>
  )
}

/// One receipt: the pricelist, the sale price, what each promotion took off,
/// and what a walk-in shopper and a member pay.
function Receipt({
  label,
  answer,
  costMinor,
  named,
}: {
  label: string | null
  answer: TillAnswer
  costMinor: number | null
  named: (rule: AppliedRule) => string
}) {
  const walkIn = answer.walkIn
  const member = answer.member
  const line = walkIn.lines[0]
  const memberOnly = member.applied_rules.filter(
    (rule) => !walkIn.applied_rules.some((one) => one.rule_id === rule.rule_id)
  )
  /// Tax the book adds on top. Nought for a tax-inclusive book, which is the
  /// usual case; drawn only when it is not.
  const taxOnTop = walkIn.amount_due_minor - walkIn.total_minor
  const markup = markupBps(walkIn.total_minor, costMinor)
  return (
    <div>
      {label !== null && (
        <p className="mb-2 truncate font-mono text-id text-mute">{label}</p>
      )}
      <dl className="flex flex-col">
        <ReceiptRow
          term="Pricelist"
          amount={money(line?.base_unit_price_minor ?? null)}
        />
        {line !== undefined &&
          line.unit_price_minor < line.base_unit_price_minor && (
            <ReceiptRow
              term="Sale price"
              amount={money(line.unit_price_minor)}
            />
          )}
        {walkIn.applied_rules.map((rule) => (
          <ReceiptRow
            key={rule.rule_id}
            term={named(rule)}
            amount={money(-rule.benefit_minor)}
          />
        ))}
        {walkIn.free_lines.map((free) => (
          <ReceiptRow
            key={`${free.sku_code}-${free.granted_by_rule_id}`}
            term={`Free ${free.sku_code} × ${count(free.quantity)}`}
            amount={money(free.value_minor)}
          />
        ))}
        {taxOnTop !== 0 && (
          <ReceiptRow term="Tax on top" amount={money(taxOnTop)} />
        )}
        <ReceiptRow
          term="Walk-in pays"
          note={markup === null ? undefined : `${percentBps(markup)} markup`}
          amount={money(walkIn.amount_due_minor)}
          strong
        />
        <ReceiptRow
          term="Member pays"
          note={
            memberOnly.length === 0
              ? undefined
              : memberOnly.map(named).join(", ")
          }
          amount={money(member.amount_due_minor)}
          strong
        />
      </dl>
    </div>
  )
}

function ReceiptRow({
  term,
  note,
  amount,
  strong = false,
}: {
  term: string
  note?: string
  amount: string
  strong?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 border-t py-3 first:border-t-0",
        strong ? "border-hairline-strong" : "border-hairline"
      )}
    >
      <dt className="min-w-0">
        <span
          className={cn(
            "block truncate",
            strong ? "font-medium text-ink" : "text-body"
          )}
        >
          {term}
        </span>
        {note !== undefined && (
          <span className="block truncate text-[0.875rem] text-mute">
            {note}
          </span>
        )}
      </dt>
      <dd
        className={cn(
          "shrink-0 tabular-nums",
          strong ? "font-medium text-ink" : "text-body"
        )}
      >
        {amount}
      </dd>
    </div>
  )
}

/// Which shops have actually put the book this price came from into service.
///
/// "Published" and "in force" are different things, and this is the difference
/// — the reason the fleet screen existed and the reason it did not need to be a
/// screen. The gap between the shop's clock (`activated_at`) and the centre's
/// (`reported_at`) is the number to watch: a shop that switched an hour before
/// the centre heard is priced correctly and reporting late, which is a
/// different fault from a shop that never switched at all.
function InService({ version }: { version: number }) {
  const books = useQuery({
    queryKey: commercialKeys.books(),
    queryFn: ({ signal }) => listPriceBooks(signal),
  })

  const book = (books.data ?? []).find((one) => one.version === version)

  const detail = useQuery({
    queryKey: commercialKeys.book(book?.id ?? ""),
    queryFn: ({ signal }) => priceBookDetail(book!.id, signal),
    enabled: book !== undefined,
  })

  if (book === undefined) return null

  return (
    <div>
      <SubHead aside={book.name}>In service at</SubHead>
      {detail.data === undefined ? (
        <Quiet>Loading…</Quiet>
      ) : detail.data.activated_by.length === 0 ? (
        <Quiet>Not in service at any store yet.</Quiet>
      ) : (
        <MiniTable
          head={["Store", { label: "Since", align: "left" }, "Rules Taken"]}
        >
          {detail.data.activated_by.map((activation) => (
            <MiniRow key={activation.origin_id}>
              <MiniCell className="py-3.5">
                <Named
                  name={activation.site_id ?? "Unsited"}
                  code={activation.origin_id}
                />
              </MiniCell>
              <MiniCell className="py-3.5">
                <span className="text-[0.875rem] text-body">
                  {moment(activation.activated_at)}
                </span>
                <span className="block text-[0.875rem] text-mute">
                  told us {moment(activation.reported_at)}
                </span>
              </MiniCell>
              <MiniCell align="right" className="py-3.5">
                {count(activation.price_rule_count)}
              </MiniCell>
            </MiniRow>
          ))}
        </MiniTable>
      )}
    </div>
  )
}

/// Every price this store has charged for one SKU, oldest first.
///
/// # Why one SKU and not the article
///
/// A history is a question about a thing with a price, and a style does not
/// have one — it has as many as it has sizes and colourways, which may have
/// moved on different days for different reasons. Showing the first product and
/// naming it is honest; averaging them would invent a price that was never on a
/// shelf edge.
///
/// # Why the book and the person are on every row
///
/// "The price went up on the third" is a fact somebody already has — they are
/// looking at this screen because of it. "Ramadan Pricing v21, published by
/// Andi on the second" is the answer, and it is the difference between a chart
/// and something a person can act on.
function PriceHistorySection({
  skuCode,
  siteId,
  channel,
  skuCount,
}: {
  skuCode: string
  siteId: string
  channel: CommercialChannel
  skuCount: number
}) {
  const history = useQuery({
    queryKey: priceHistoryKeys.of(skuCode, siteId, channel),
    queryFn: ({ signal }) => priceHistory(skuCode, siteId, channel, signal),
  })

  const periods = history.data?.periods ?? []

  return (
    <div>
      <SubHead
        aside={skuCount > 1 ? `${skuCode}, 1 of ${count(skuCount)}` : skuCode}
      >
        How it got here
      </SubHead>
      {queryState(history, {
        loading: "Loading…",
        render: (data) =>
          data.never_priced || periods.length === 0 ? (
            <Quiet>No history.</Quiet>
          ) : periods.length === 1 ? (
            <Quiet>Not changed since it was set.</Quiet>
          ) : (
            <MiniTable
              head={[
                "From",
                { label: "Set by", align: "left" },
                "Change",
                "Price",
              ]}
            >
              {periods.map((period) => (
                <MiniRow key={`${period.from}-${period.publication_version}`}>
                  <MiniCell className="py-3.5">
                    <span className="text-ink">{day(period.from)}</span>
                    <span className="block text-[0.875rem] text-mute">
                      {period.until === null
                        ? "still in force"
                        : `until ${day(period.until)}`}
                    </span>
                  </MiniCell>
                  <MiniCell className="py-3.5">
                    <span className="text-ink">
                      {describeSource(period.source)}
                    </span>
                    <span className="block text-[0.875rem] text-mute">
                      {period.publication_name ??
                        `v${period.publication_version}`}
                      {period.published_by !== null &&
                        ` · ${period.published_by}`}
                    </span>
                  </MiniCell>
                  <MiniCell align="right" className="py-3.5 tabular-nums">
                    {/* The first period has nothing to have moved from, and
                        drawing it as a rise from nought would report a price
                        being set as a price going up. */}
                    {period.change_minor === null ? (
                      <span className="text-mute">—</span>
                    ) : (
                      <span
                        className={
                          period.change_minor < 0 ? "text-ok" : "text-warn"
                        }
                      >
                        {period.change_minor > 0 ? "+" : ""}
                        {money(period.change_minor)}
                      </span>
                    )}
                  </MiniCell>
                  <MiniCell
                    align="right"
                    className="py-3.5 text-ink tabular-nums"
                  >
                    {money(period.unit_price_minor)}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          ),
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------

/// One style, priced at every shop — UI-001 §4's second drill-down.
///
/// **No fetch.** Every figure here is already on the row the grid drew: the
/// matrix asked for the whole cascade at every shop and this reads the same
/// answer down a column instead of across a row. Asking the server again would
/// be a second opinion about a question already answered, and two opinions
/// about one price is the failure this module exists to end.
///
/// ## Regular and Markdown are read off the stack, never recomputed
///
/// The stack arrives in the engine's own order — rank 0 is what the till
/// charges. **Regular** is the best-ranked candidate that is not a markdown;
/// **Markdown** is the markdown rung when there is one. So a shop with a
/// clearance shows both and the difference between them is visible, and a shop
/// without one shows the same number in the price column and nothing beside it.
/// Deriving "regular" by undoing a percentage would be inventing a figure no
/// book contains.
///
/// A shop absent from `shops` is not priced here, and says so. It is NOT shown
/// as zero and not filled in from the company price — §3's last row again.
function ArticleSheet({
  row,
  shops,
  promoWindows,
  onClose,
  onOpenCell,
}: {
  row: ArticlePriceRow | null
  /// Every column of the grid, so a store that does not sell it still says so.
  shops: readonly PricelistShop[]
  promoWindows: ReadonlyMap<string, string>
  onClose: () => void
  onOpenCell: (siteId: string) => void
}) {
  const companyRule = row === null ? undefined : companyRuleOf(row)
  const bands = row === null ? [] : bandsOf(row, shops, companyRule)
  return (
    <Sheet
      open={row !== null}
      onOpenChange={(next) => !next && onClose()}
      id={row?.article_code}
      title={row?.article_name ?? "Article"}
      width="wide"
    >
      {row === null ? null : (
        <div className="flex flex-col gap-8">
          {bands.map((band) => {
            const baseMinor =
              companyRule === undefined
                ? null
                : amountFor(companyRule, band.skuCodes[0] ?? null)
            return (
              <div key={band.skuCodes.join(",") || "all"}>
                <SubHead
                  aside={
                    baseMinor === null
                      ? undefined
                      : `Base price ${money(baseMinor)}`
                  }
                >
                  {bands.length === 1 ? "Every store" : `Sizes ${band.label}`}
                </SubHead>
                <MiniTable
                  head={[
                    "Store",
                    { label: "Price", align: "right" },
                    "Set by",
                    "Dates",
                  ]}
                >
                  {shops.map((shopMeta) => {
                    const facts = factsFor(
                      row,
                      band,
                      shopMeta,
                      companyRule,
                      promoWindows
                    )
                    const name = shopMeta.label ?? shopMeta.site_id
                    if (facts === null)
                      return (
                        <MiniRow key={shopMeta.site_id}>
                          <MiniCell className="py-3.5">{name}</MiniCell>
                          <MiniCell align="right" className="py-3.5">
                            <span className="text-faint">not sold</span>
                          </MiniCell>
                          <MiniCell className="py-3.5">{null}</MiniCell>
                          <MiniCell className="py-3.5">{null}</MiniCell>
                        </MiniRow>
                      )
                    return (
                      <MiniRow key={shopMeta.site_id}>
                        <MiniCell className="py-3.5">
                          <button
                            type="button"
                            onClick={() => onOpenCell(shopMeta.site_id)}
                            title="Change the price at this store"
                            className="text-left text-ink underline-offset-2 hover:underline"
                          >
                            {name}
                          </button>
                        </MiniCell>
                        <MiniCell align="right" className="py-3.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={cn(
                                "tabular-nums",
                                KIND_TEXT[facts.kind]
                              )}
                            >
                              {money(facts.amountMinor)}
                            </span>
                            {facts.pct !== null && (
                              <span
                                className={cn(
                                  "rounded-[5px] px-1.5 text-[0.875rem] font-medium",
                                  KIND_CHIP[facts.kind]
                                )}
                              >
                                {facts.pct}
                              </span>
                            )}
                          </span>
                        </MiniCell>
                        <MiniCell className="py-3.5">
                          <span
                            className={cn(
                              "text-[0.875rem]",
                              KIND_LABEL[facts.kind] || "text-body"
                            )}
                          >
                            {facts.kind === "base"
                              ? "Base price"
                              : facts.kind === "store"
                                ? "Store price"
                                : facts.label}
                          </span>
                          {facts.loser !== null && (
                            <span className="block text-[0.875rem] text-mute line-through decoration-faint">
                              {facts.loser.label}
                              {facts.loser.pct !== null
                                ? ` ${facts.loser.pct}`
                                : ""}
                            </span>
                          )}
                        </MiniCell>
                        <MiniCell className="py-3.5">
                          <span className="text-[0.875rem] text-mute">
                            {facts.dateLine ?? ""}
                          </span>
                        </MiniCell>
                      </MiniRow>
                    )
                  })}
                </MiniTable>
              </div>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

/// One shop's whole shelf — UI-001 §4's first drill-down.
///
/// **This one does fetch**, and it is the only drill-down that has to. The
/// matrix holds a page of styles; this question is about a SHOP, and answering
/// it from the loaded page would report "Toko Medan prices twenty styles"
/// because twenty is how many the grid happened to have. `/commercial/offers`
/// is the same read the shop's own till makes, which is why the answer here and
/// the answer at the counter cannot drift.
///
/// ## Grouped back into styles, because the column heading is a style column
///
/// The endpoint answers in products; §4 asks for `Article | Regular | Markdown
/// | Harga sebelum promo`. So the SKUs are folded per article and each figure
/// becomes a range when the sizes disagree — never a representative SKU, which
/// §4 forbids by name.
///
/// **Promotions is absent from the columns**, and that is a gap rather than a
/// decision: a promotion is a statement about a basket, `/commercial/offers`
/// carries none, and inventing a column that is empty on every row would say
/// this shop runs no offers when what is true is that this read cannot see
/// them. The cell explanation next door does show them.
function StoreSheet({
  siteId,
  label,
  channel,
  at,
  onClose,
}: {
  siteId: string | null
  label: string | null
  channel: CommercialChannel
  at: string | null
  onClose: () => void
}) {
  const scope: PriceScope = useMemo(
    () => ({ siteId: siteId ?? "", channel, at: at ?? undefined }),
    [siteId, channel, at]
  )

  const shelf = useQuery({
    queryKey: commercialKeys.prices(scope),
    queryFn: ({ signal }) => shelfPrices(scope, signal),
    enabled: siteId !== null,
  })

  const styles = useMemo(() => {
    const by = new Map<
      string,
      {
        code: string
        name: string
        charged: number[]
        regular: number[]
        markdowns: number
        skus: number
      }
    >()
    for (const item of shelf.data?.items ?? []) {
      const held = by.get(item.article_code) ?? {
        code: item.article_code,
        name: item.article_name,
        charged: [],
        regular: [],
        markdowns: 0,
        skus: 0,
      }
      held.charged.push(item.unit_price_minor)
      held.regular.push(item.base_unit_price_minor)
      if (item.markdown_id !== null) held.markdowns += 1
      held.skus += 1
      by.set(item.article_code, held)
    }
    return [...by.values()].sort((a, b) => a.code.localeCompare(b.code))
  }, [shelf.data])

  /// A set of amounts as one figure, or as the range it actually is.
  ///
  /// Never a representative SKU — §2: "tidak memilih representative SKU
  /// sebagai harga Article". Two sizes at different prices is a fact about the
  /// style, and picking one of them to print is how a shelf edge comes to
  /// disagree with the till for half the sizes on the rail.
  const span = (amounts: readonly number[]): string => {
    if (amounts.length === 0) return "—"
    const low = Math.min(...amounts)
    const high = Math.max(...amounts)
    return low === high ? money(low) : `${money(low)} – ${money(high)}`
  }

  return (
    <Sheet
      open={siteId !== null}
      onOpenChange={(next) => !next && onClose()}
      id={siteId ?? undefined}
      title={label ?? siteId ?? "Store"}
      // Five hundred styles by four columns. This is a table with a sheet
      // around it.
      width="table"
    >
      {queryState(shelf, {
        loading: "Loading…",
        render: (data) =>
          data.items.length === 0 ? (
            <EmptyState>No prices in service.</EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              <div>
                <SubHead
                  aside={`${count(data.item_count)} SKUs · ${count(styles.length)} articles`}
                >
                  On the shelf
                </SubHead>
                <MiniTable
                  head={[
                    "Article",
                    { label: "Pricelist", align: "right" },
                    { label: "On Sale", align: "right" },
                    { label: "Charged", align: "right" },
                  ]}
                >
                  {styles.map((style) => (
                    <MiniRow key={style.code}>
                      <MiniCell className="py-3.5">
                        <span className="block truncate text-ink">
                          {style.name}
                        </span>
                        <span className="block truncate font-mono text-[0.875rem] text-mute">
                          {style.code} · {count(style.skus)} SKU
                        </span>
                      </MiniCell>
                      <MiniCell align="right" className="py-3.5">
                        <span className="text-body tabular-nums">
                          {span(style.regular)}
                        </span>
                      </MiniCell>
                      <MiniCell align="right" className="py-3.5">
                        {/* The markdown column says how many PRODUCTS are cut,
                            not an amount: a style where two sizes are cleared
                            and four are not has no single markdown price, and
                            printing the cut one would claim the rail is on
                            sale. The amount is in the charged column, which is
                            where the till's number belongs. */}
                        {style.markdowns === 0 ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <span className="text-accent tabular-nums">
                            {count(style.markdowns)} of {count(style.skus)}
                          </span>
                        )}
                      </MiniCell>
                      <MiniCell align="right" className="py-3.5">
                        <span className="font-medium text-ink tabular-nums">
                          {span(style.charged)}
                        </span>
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              </div>
            </div>
          ),
      })}
    </Sheet>
  )
}
